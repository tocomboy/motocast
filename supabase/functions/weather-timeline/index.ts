import { consumeBudget, requireMember, serviceClient } from "../_shared/auth.ts";
import {
  closestForecast,
  conditionFrom,
  forecastTarget,
  forecastWindow,
  gridFromCoordinates,
  issuedAtIso,
  latestForecastBase,
  type ForecastModel,
  type KmaItem,
} from "../_shared/weather-forecast.ts";
import { corsHeaders, jsonResponse, safeErrorMessage, safeErrorStatus } from "../_shared/http.ts";
import { parseWeatherRequest, type WeatherPoint, type WeatherRequest } from "../_shared/weather-request.ts";

type MemberClient = Awaited<ReturnType<typeof requireMember>>["supabase"];

type ForecastResult = {
  values: Record<string, string>;
  base: { date: string; time: string };
};

type TimelineForecast = WeatherPoint & (
  | { status: "outside-window"; reason: "FORECAST_WINDOW_EXCEEDED" }
  | {
    status: "forecast";
    model: ForecastModel;
    grid: { nx: number; ny: number };
    issuedAt: string;
    condition: "clear" | "cloudy" | "rain" | "snow" | "unknown";
    temperatureC: number | null;
    precipitationProbability: number | null;
    windSpeedMps: number | null;
  }
);

function parseLimit() {
  const value = Number(Deno.env.get("KMA_DAILY_LIMIT"));
  if (!Number.isInteger(value) || value <= 0) throw new Error("API_BUDGET_NOT_CONFIGURED");
  return value;
}

async function weatherRequestHash(request: WeatherRequest) {
  const payload = new TextEncoder().encode(JSON.stringify({
    candidateProfile: request.candidateProfile,
    points: request.points.map(({ id, longitude, latitude, eta }) => ({ id, longitude, latitude, eta })),
  }));
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function assertOwnedTrip(supabase: MemberClient, tripId: string) {
  const { data, error } = await supabase.from("trips").select("id").eq("id", tripId).maybeSingle();
  if (error) throw new Error("WEATHER_PERSIST_FAILED");
  if (!data) throw new Error("TRIP_NOT_FOUND");
}

async function readSnapshot(
  supabase: MemberClient,
  request: WeatherRequest,
  requestHash: string,
  freshOnly: boolean,
) {
  if (!request.tripId) return null;
  let query = supabase
    .from("weather_snapshots")
    .select("issued_at, created_at, segments")
    .eq("trip_id", request.tripId)
    .eq("candidate_profile", request.candidateProfile)
    .eq("request_hash", requestHash)
    .order("created_at", { ascending: false })
    .limit(1);
  if (freshOnly) query = query.gte("created_at", new Date(Date.now() - 20 * 60_000).toISOString());
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("WEATHER_PERSIST_FAILED");
  if (!data || !Array.isArray(data.segments)) return null;
  return {
    issuedAt: String(data.issued_at),
    generatedAt: String(data.created_at),
    forecasts: data.segments,
  };
}

async function fetchForecast(input: {
  model: ForecastModel;
  nx: number;
  ny: number;
  apiKey: string;
  target: { date: string; time: string };
  now: Date;
}): Promise<ForecastResult> {
  const base = latestForecastBase(input.model, input.now);
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

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  } catch {
    throw new Error("KMA_REQUEST_FAILED");
  }
  if (!response.ok) throw new Error("KMA_REQUEST_FAILED");
  const data = await response.json() as {
    response?: { header?: { resultCode?: string }; body?: { items?: { item?: KmaItem[] } } };
  };
  if (data.response?.header?.resultCode !== "00") throw new Error("KMA_REQUEST_FAILED");
  const items = data.response.body?.items?.item;
  if (!Array.isArray(items) || items.length === 0) throw new Error("KMA_FORECAST_NOT_FOUND");
  return { values: closestForecast(items, input.target), base };
}

async function fetchTimeline(memberId: string, points: WeatherPoint[], apiKey: string | null): Promise<TimelineForecast[]> {
  const now = new Date();
  const cache = new Map<string, ForecastResult>();
  const forecasts: TimelineForecast[] = [];

  for (const point of points) {
    const eta = new Date(point.eta);
    const window = forecastWindow(eta, now);
    if (window === "outside-window") {
      forecasts.push({ ...point, status: "outside-window", reason: "FORECAST_WINDOW_EXCEEDED" });
      continue;
    }
    if (!apiKey) throw new Error("PROVIDER_NOT_CONFIGURED");

    const model = window;
    const { nx, ny } = gridFromCoordinates(point.latitude, point.longitude);
    const target = forecastTarget(eta);
    const cacheKey = `${model}:${nx}:${ny}:${target.date}:${target.time}`;
    let forecast = cache.get(cacheKey);
    if (!forecast) {
      await consumeBudget(memberId, "kma", model === "ultra" ? "ultra_forecast" : "short_forecast", parseLimit());
      forecast = await fetchForecast({ model, nx, ny, apiKey, target, now });
      cache.set(cacheKey, forecast);
    }
    const temperature = forecast.values.T1H ?? forecast.values.TMP;
    forecasts.push({
      ...point,
      status: "forecast",
      model,
      grid: { nx, ny },
      issuedAt: issuedAtIso(forecast.base),
      condition: conditionFrom(forecast.values),
      temperatureC: temperature === undefined ? null : Number(temperature),
      precipitationProbability: forecast.values.POP === undefined ? null : Number(forecast.values.POP),
      windSpeedMps: forecast.values.WSD === undefined ? null : Number(forecast.values.WSD),
    });
  }
  return forecasts;
}

async function persistSnapshot(
  request: WeatherRequest,
  requestHash: string,
  forecasts: TimelineForecast[],
  generatedAt: string,
) {
  if (!request.tripId) return;
  const issueTimes = forecasts.flatMap((forecast) => forecast.status === "forecast" ? [Date.parse(forecast.issuedAt)] : []);
  const oldestIssue = issueTimes.length ? Math.min(...issueTimes) : Date.parse(generatedAt);
  const lastEta = Math.max(...request.points.map((point) => Date.parse(point.eta)));
  const validUntil = new Date(Math.max(lastEta + 60 * 60_000, oldestIssue + 60 * 60_000)).toISOString();
  const { error } = await serviceClient().from("weather_snapshots").insert({
    trip_id: request.tripId,
    source: "kma",
    issued_at: new Date(oldestIssue).toISOString(),
    valid_until: validUntil,
    segments: forecasts,
    request_hash: requestHash,
    candidate_profile: request.candidateProfile,
    created_at: generatedAt,
  });
  if (error) throw new Error("WEATHER_PERSIST_FAILED");
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (!cors) return jsonResponse({ error: "ORIGIN_NOT_ALLOWED" }, 403, {});
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405, cors);

  let supabase: MemberClient | null = null;
  let memberId: string | null = null;
  let weatherRequest: WeatherRequest | null = null;
  let requestHash: string | null = null;
  try {
    const member = await requireMember(request);
    supabase = member.supabase;
    memberId = member.user.id;
    weatherRequest = parseWeatherRequest(await request.json());
    if (weatherRequest.tripId) await assertOwnedTrip(supabase, weatherRequest.tripId);
    requestHash = await weatherRequestHash(weatherRequest);

    const cached = await readSnapshot(supabase, weatherRequest, requestHash, true);
    if (cached) {
      return jsonResponse({ ...cached, source: "cache", stale: false }, 200, cors);
    }

    const generatedAt = new Date().toISOString();
    const forecasts = await fetchTimeline(memberId, weatherRequest.points, Deno.env.get("KMA_APIHUB_KEY") ?? null);
    await persistSnapshot(weatherRequest, requestHash, forecasts, generatedAt);
    const issueTimes = forecasts.flatMap((forecast) => forecast.status === "forecast" ? [forecast.issuedAt] : []);
    return jsonResponse({
      generatedAt,
      issuedAt: issueTimes.sort()[0] ?? generatedAt,
      source: "live",
      stale: false,
      forecasts,
    }, 200, cors);
  } catch (error) {
    if (supabase && weatherRequest?.tripId && requestHash) {
      try {
        const stale = await readSnapshot(supabase, weatherRequest, requestHash, false);
        if (stale) {
          console.warn("weather-timeline stale fallback", error instanceof Error ? error.message : "unknown error");
          return jsonResponse({
            ...stale,
            source: "snapshot",
            stale: true,
            staleReason: safeErrorMessage(error),
          }, 200, cors);
        }
      } catch {
        console.error("weather-timeline snapshot read failed");
      }
    }
    console.error("weather-timeline failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ error: safeErrorMessage(error) }, safeErrorStatus(error), cors);
  }
});
