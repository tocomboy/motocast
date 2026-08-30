import { consumeBudget, requireMember } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse, safeErrorMessage } from "../_shared/http.ts";

type WeatherPoint = {
  id: string;
  label: string;
  longitude: number;
  latitude: number;
  eta: string;
};

type KmaItem = {
  baseDate: string;
  baseTime: string;
  category: string;
  fcstDate: string;
  fcstTime: string;
  fcstValue: string;
  nx: number;
  ny: number;
};

type ForecastModel = "ultra" | "short";

const VILLAGE_BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];

function parseLimit() {
  const value = Number(Deno.env.get("KMA_DAILY_LIMIT"));
  if (!Number.isInteger(value) || value <= 0) throw new Error("API_BUDGET_NOT_CONFIGURED");
  return value;
}

function parsePoints(value: unknown): WeatherPoint[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { points?: unknown }).points)) {
    throw new Error("INVALID_REQUEST");
  }
  const points = (value as { points: unknown[] }).points;
  if (points.length === 0 || points.length > 40) throw new Error("INVALID_POINTS");
  return points.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error("INVALID_POINT");
    const point = raw as Partial<WeatherPoint>;
    const eta = new Date(point.eta ?? "");
    if (
      typeof point.longitude !== "number" || point.longitude < 124 || point.longitude > 132 ||
      typeof point.latitude !== "number" || point.latitude < 32 || point.latitude > 39.5 ||
      Number.isNaN(eta.getTime()) || eta.getTime() < Date.now() - 60 * 60_000
    ) throw new Error("INVALID_POINT");
    return {
      id: typeof point.id === "string" ? point.id.slice(0, 100) : `point-${index}`,
      label: typeof point.label === "string" ? point.label.slice(0, 160) : `지점 ${index + 1}`,
      longitude: point.longitude,
      latitude: point.latitude,
      eta: eta.toISOString(),
    };
  });
}

function kstParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

function localSerial(date: Date) {
  const parts = kstParts(date);
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)));
}

function formatBase(serial: Date, minute: string) {
  const year = serial.getUTCFullYear().toString().padStart(4, "0");
  const month = (serial.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = serial.getUTCDate().toString().padStart(2, "0");
  const hour = serial.getUTCHours().toString().padStart(2, "0");
  return { date: `${year}${month}${day}`, time: `${hour}${minute}` };
}

function latestBase(model: ForecastModel, now: Date) {
  const serial = localSerial(now);
  if (model === "ultra") {
    if (serial.getUTCMinutes() < 45) serial.setUTCHours(serial.getUTCHours() - 1);
    return formatBase(serial, "30");
  }

  serial.setUTCMinutes(serial.getUTCMinutes() - 15);
  const currentHour = serial.getUTCHours();
  const chosen = [...VILLAGE_BASE_HOURS].reverse().find((hour) => hour <= currentHour);
  if (chosen === undefined) {
    serial.setUTCDate(serial.getUTCDate() - 1);
    serial.setUTCHours(23);
  } else {
    serial.setUTCHours(chosen);
  }
  return formatBase(serial, "00");
}

function forecastTarget(eta: Date) {
  const serial = localSerial(eta);
  if (serial.getUTCMinutes() >= 30) serial.setUTCHours(serial.getUTCHours() + 1);
  serial.setUTCMinutes(0);
  return formatBase(serial, "00");
}

function gridFromCoordinates(latitude: number, longitude: number) {
  const RE = 6371.00877;
  const GRID = 5.0;
  const SLAT1 = 30.0;
  const SLAT2 = 60.0;
  const OLON = 126.0;
  const OLAT = 38.0;
  const XO = 43;
  const YO = 136;
  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = Math.pow(sf, sn) * Math.cos(slat1) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = re * sf / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + latitude * DEGRAD * 0.5);
  ra = re * sf / Math.pow(ra, sn);
  let theta = longitude * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;
  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

function conditionFrom(values: Record<string, string>) {
  const precipitation = Number(values.PTY ?? 0);
  if ([3, 7].includes(precipitation)) return "snow";
  if (precipitation > 0) return "rain";
  const sky = Number(values.SKY ?? 0);
  if (sky >= 3) return "cloudy";
  if (sky === 1) return "clear";
  return "unknown";
}

function closestForecast(items: KmaItem[], target: { date: string; time: string }) {
  const groups = new Map<string, KmaItem[]>();
  for (const item of items) {
    const key = `${item.fcstDate}${item.fcstTime}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const targetKey = `${target.date}${target.time}`;
  const closestKey = [...groups.keys()].sort((a, b) => Math.abs(Number(a) - Number(targetKey)) - Math.abs(Number(b) - Number(targetKey)))[0];
  if (!closestKey) throw new Error("KMA_FORECAST_NOT_FOUND");
  const selected = groups.get(closestKey) ?? [];
  return Object.fromEntries(selected.map((item) => [item.category, item.fcstValue]));
}

async function fetchForecast(input: {
  model: ForecastModel;
  nx: number;
  ny: number;
  apiKey: string;
  target: { date: string; time: string };
}) {
  const base = latestBase(input.model, new Date());
  const operation = input.model === "ultra" ? "getUltraSrtFcst" : "getVilageFcst";
  const url = new URL(`https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/${operation}`);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "1000");
  url.searchParams.set("dataType", "JSON");
  url.searchParams.set("base_date", base.date);
  url.searchParams.set("base_time", base.time);
  url.searchParams.set("nx", String(input.nx));
  url.searchParams.set("ny", String(input.ny));
  url.searchParams.set("authKey", input.apiKey);

  const response = await fetch(url);
  if (!response.ok) throw new Error("KMA_REQUEST_FAILED");
  const data = await response.json() as {
    response?: { header?: { resultCode?: string }; body?: { items?: { item?: KmaItem[] } } };
  };
  if (data.response?.header?.resultCode !== "00") throw new Error("KMA_REQUEST_FAILED");
  const items = data.response.body?.items?.item;
  if (!Array.isArray(items) || items.length === 0) throw new Error("KMA_FORECAST_NOT_FOUND");
  return { values: closestForecast(items, input.target), base, operation };
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (!cors) return jsonResponse({ error: "ORIGIN_NOT_ALLOWED" }, 403, {});
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405, cors);

  try {
    const { supabase } = await requireMember(request);
    const points = parsePoints(await request.json());
    const apiKey = Deno.env.get("KMA_APIHUB_KEY");
    if (!apiKey) throw new Error("PROVIDER_NOT_CONFIGURED");
    const fiveDays = 5 * 24 * 60 * 60_000;
    const sixHours = 6 * 60 * 60_000;
    const now = Date.now();
    const cache = new Map<string, Awaited<ReturnType<typeof fetchForecast>>>();
    const forecasts = [];

    for (const point of points) {
      const eta = new Date(point.eta);
      if (eta.getTime() - now > fiveDays) {
        forecasts.push({ ...point, status: "draft", reason: "FORECAST_WINDOW_EXCEEDED" });
        continue;
      }
      const model: ForecastModel = eta.getTime() - now <= sixHours ? "ultra" : "short";
      const { nx, ny } = gridFromCoordinates(point.latitude, point.longitude);
      const target = forecastTarget(eta);
      const cacheKey = `${model}:${nx}:${ny}:${target.date}:${target.time}`;
      let forecast = cache.get(cacheKey);
      if (!forecast) {
        await consumeBudget(supabase, "kma", model === "ultra" ? "ultra_forecast" : "short_forecast", parseLimit());
        forecast = await fetchForecast({ model, nx, ny, apiKey, target });
        cache.set(cacheKey, forecast);
      }
      const temperature = forecast.values.T1H ?? forecast.values.TMP;
      forecasts.push({
        ...point,
        status: "forecast",
        model,
        grid: { nx, ny },
        issuedAtKst: `${forecast.base.date}${forecast.base.time}`,
        condition: conditionFrom(forecast.values),
        temperatureC: temperature === undefined ? null : Number(temperature),
        precipitationProbability: forecast.values.POP === undefined ? null : Number(forecast.values.POP),
        windSpeedMps: forecast.values.WSD === undefined ? null : Number(forecast.values.WSD),
      });
    }

    return jsonResponse({ generatedAt: new Date().toISOString(), forecasts }, 200, cors);
  } catch (error) {
    console.error("weather-timeline failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ error: safeErrorMessage(error) }, 400, cors);
  }
});
