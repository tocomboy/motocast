export type ForecastModel = "ultra" | "short";

export type KmaItem = {
  baseDate: string;
  baseTime: string;
  category: string;
  fcstDate: string;
  fcstTime: string;
  fcstValue: string;
  nx: number;
  ny: number;
};

const VILLAGE_BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];
const SIX_HOURS_MS = 6 * 60 * 60_000;
const FIVE_DAYS_MS = 5 * 24 * 60 * 60_000;

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

export function forecastWindow(eta: Date, now: Date): ForecastModel | "outside-window" {
  const difference = eta.getTime() - now.getTime();
  if (difference > FIVE_DAYS_MS) return "outside-window";
  return difference <= SIX_HOURS_MS ? "ultra" : "short";
}

export function latestForecastBase(model: ForecastModel, now: Date) {
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

export function forecastTarget(eta: Date) {
  const serial = localSerial(eta);
  if (serial.getUTCMinutes() >= 30) serial.setUTCHours(serial.getUTCHours() + 1);
  serial.setUTCMinutes(0);
  return formatBase(serial, "00");
}

export function issuedAtIso(base: { date: string; time: string }) {
  const value = `${base.date.slice(0, 4)}-${base.date.slice(4, 6)}-${base.date.slice(6, 8)}T${base.time.slice(0, 2)}:${base.time.slice(2, 4)}:00+09:00`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("KMA_FORECAST_NOT_FOUND");
  return parsed.toISOString();
}

export function gridFromCoordinates(latitude: number, longitude: number) {
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

export function conditionFrom(values: Record<string, string>) {
  const precipitation = Number(values.PTY ?? 0);
  if ([3, 7].includes(precipitation)) return "snow" as const;
  if (precipitation > 0) return "rain" as const;
  const sky = Number(values.SKY ?? 0);
  if (sky >= 3) return "cloudy" as const;
  if (sky === 1) return "clear" as const;
  return "unknown" as const;
}

export function closestForecast(items: KmaItem[], target: { date: string; time: string }) {
  const groups = new Map<string, KmaItem[]>();
  for (const item of items) {
    const key = `${item.fcstDate}${item.fcstTime}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const targetKey = `${target.date}${target.time}`;
  const closestKey = [...groups.keys()].sort(
    (left, right) => Math.abs(Number(left) - Number(targetKey)) - Math.abs(Number(right) - Number(targetKey)),
  )[0];
  if (!closestKey) throw new Error("KMA_FORECAST_NOT_FOUND");
  const selected = groups.get(closestKey) ?? [];
  return Object.fromEntries(selected.map((item) => [item.category, item.fcstValue]));
}

export function validatedForecastValues(
  items: KmaItem[],
  target: { date: string; time: string },
  model: ForecastModel,
) {
  const values = closestForecast(items, target);
  const required = model === "ultra"
    ? ["T1H", "WSD", "SKY", "PTY"]
    : ["TMP", "POP", "WSD", "SKY", "PTY"];
  if (!required.every((category) => Object.hasOwn(values, category))) {
    throw new Error("KMA_INVALID_RESPONSE");
  }
  return values;
}
