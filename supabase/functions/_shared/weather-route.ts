import { parseStrictRfc3339 } from "./strict-time.ts";
import type { WeatherPoint, WeatherRequest } from "./weather-request.ts";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_WEATHER_ROUTE");
  return value as Record<string, unknown>;
}

export function weatherPointsFromStoredRoute(value: unknown, profile: WeatherRequest["candidateProfile"]): WeatherPoint[] {
  const route = record(value);
  const candidate = record(route.candidate);
  if (candidate.id !== profile || !Array.isArray(route.legs) || route.legs.length < 1 || route.legs.length > 40) {
    throw new Error("INVALID_WEATHER_ROUTE");
  }
  return route.legs.map((value, index) => {
    const leg = record(value);
    const to = record(leg.to);
    const eta = parseStrictRfc3339(leg.arrivalAt);
    if (
      typeof to.label !== "string" || to.label.trim().length < 1 || to.label.length > 160 ||
      typeof to.longitude !== "number" || !Number.isFinite(to.longitude) || to.longitude < 124.5 || to.longitude > 132 ||
      typeof to.latitude !== "number" || !Number.isFinite(to.latitude) || to.latitude < 32.8 || to.latitude > 38.7 ||
      !eta
    ) throw new Error("INVALID_WEATHER_ROUTE");
    return {
      id: `${profile}-${index}`,
      label: to.label.trim(),
      longitude: to.longitude,
      latitude: to.latitude,
      eta: eta.toISOString(),
    };
  });
}

export function assertWeatherPointsMatch(requested: WeatherPoint[], stored: WeatherPoint[]) {
  if (requested.length !== stored.length || requested.some((point, index) => (
    point.id !== stored[index].id || point.label !== stored[index].label ||
    point.longitude !== stored[index].longitude || point.latitude !== stored[index].latitude ||
    point.eta !== stored[index].eta
  ))) throw new Error("INVALID_WEATHER_ROUTE");
}
