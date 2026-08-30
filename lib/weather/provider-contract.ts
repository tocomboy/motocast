import { parseStrictRfc3339 } from "../../supabase/functions/_shared/strict-time";

export type WeatherForecast = {
  id: string;
  label: string;
  longitude: number;
  latitude: number;
  eta: string;
  status: "forecast" | "outside-window";
  model?: "ultra" | "short";
  issuedAt?: string;
  condition?: "clear" | "cloudy" | "rain" | "snow" | "unknown";
  temperatureC?: number | null;
  precipitationProbability?: number | null;
  windSpeedMps?: number | null;
  reason?: "FORECAST_WINDOW_EXCEEDED";
};

export type WeatherFailureKind = "provider" | "budget" | "configuration" | "persistence" | "request";

export type WeatherTimelineResponse = {
  generatedAt: string;
  issuedAt: string;
  validUntil: string;
  source: "live" | "cache" | "snapshot";
  stale: boolean;
  staleReason?: string;
  failureKind?: WeatherFailureKind;
  staleObservedAt?: string | null;
  forecasts: WeatherForecast[];
};

export class WeatherContractError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "WeatherContractError";
  }
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function nullableNumber(value: unknown) {
  return value === null || finiteNumber(value);
}

function timestamp(value: unknown) {
  const parsed = parseStrictRfc3339(value);
  if (!parsed) throw new WeatherContractError("INVALID_WEATHER_TIME");
  return parsed.toISOString();
}

export function parseWeatherForecast(value: unknown): WeatherForecast {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WeatherContractError("INVALID_WEATHER_RESPONSE");
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" || raw.id.length < 1 || raw.id.length > 100 ||
    typeof raw.label !== "string" || raw.label.length < 1 || raw.label.length > 160 ||
    !finiteNumber(raw.longitude) || Number(raw.longitude) < 124 || Number(raw.longitude) > 132 ||
    !finiteNumber(raw.latitude) || Number(raw.latitude) < 32 || Number(raw.latitude) > 39.5
  ) throw new WeatherContractError("INVALID_WEATHER_POINT");

  const common = {
    id: raw.id,
    label: raw.label,
    longitude: Number(raw.longitude),
    latitude: Number(raw.latitude),
    eta: timestamp(raw.eta),
  };
  if (raw.status === "outside-window") {
    if (raw.reason !== "FORECAST_WINDOW_EXCEEDED") throw new WeatherContractError("INVALID_WEATHER_WINDOW");
    return { ...common, status: "outside-window", reason: "FORECAST_WINDOW_EXCEEDED" };
  }
  if (
    raw.status !== "forecast" ||
    !["ultra", "short"].includes(String(raw.model)) ||
    !["clear", "cloudy", "rain", "snow", "unknown"].includes(String(raw.condition)) ||
    !nullableNumber(raw.temperatureC) ||
    !nullableNumber(raw.precipitationProbability) ||
    !nullableNumber(raw.windSpeedMps)
  ) throw new WeatherContractError("INVALID_WEATHER_FORECAST");

  return {
    ...common,
    status: "forecast",
    model: raw.model as "ultra" | "short",
    issuedAt: timestamp(raw.issuedAt),
    condition: raw.condition as WeatherForecast["condition"],
    temperatureC: raw.temperatureC as number | null,
    precipitationProbability: raw.precipitationProbability as number | null,
    windSpeedMps: raw.windSpeedMps as number | null,
  };
}

export function parseWeatherTimelineResponse(value: unknown): WeatherTimelineResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WeatherContractError("INVALID_WEATHER_RESPONSE");
  }
  const raw = value as Record<string, unknown>;
  if (
    !["live", "cache", "snapshot"].includes(String(raw.source)) ||
    typeof raw.stale !== "boolean" ||
    !Array.isArray(raw.forecasts) || raw.forecasts.length === 0 || raw.forecasts.length > 40 ||
    (raw.source === "snapshot") !== raw.stale ||
    (raw.stale && (typeof raw.staleReason !== "string" || raw.staleReason.length < 1 || raw.staleReason.length > 300)) ||
    (raw.stale && !["provider", "budget", "configuration", "persistence", "request"].includes(String(raw.failureKind))) ||
    (raw.stale && typeof raw.staleObservedAt !== "string") ||
    (!raw.stale && raw.failureKind !== undefined) ||
    (!raw.stale && raw.staleObservedAt !== undefined && raw.staleObservedAt !== null)
  ) throw new WeatherContractError("INVALID_WEATHER_RESPONSE");

  const parsed = raw.forecasts.map(parseWeatherForecast);
  if (new Set(parsed.map((item) => item.id)).size !== parsed.length) {
    throw new WeatherContractError("DUPLICATE_WEATHER_POINTS");
  }
  return {
    generatedAt: timestamp(raw.generatedAt),
    issuedAt: timestamp(raw.issuedAt),
    validUntil: timestamp(raw.validUntil),
    source: raw.source as WeatherTimelineResponse["source"],
    stale: raw.stale,
    staleReason: raw.stale ? String(raw.staleReason) : undefined,
    failureKind: raw.stale ? raw.failureKind as WeatherTimelineResponse["failureKind"] : undefined,
    staleObservedAt: raw.stale ? timestamp(raw.staleObservedAt) : null,
    forecasts: parsed,
  };
}
