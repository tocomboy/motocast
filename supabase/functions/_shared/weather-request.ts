import { parseStrictRfc3339 } from "./strict-time.ts";

export type WeatherPoint = {
  id: string;
  label: string;
  longitude: number;
  latitude: number;
  eta: string;
};

export function parseWeatherPoints(value: unknown, nowMs = Date.now()): WeatherPoint[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { points?: unknown }).points)) {
    throw new Error("INVALID_REQUEST");
  }
  const points = (value as { points: unknown[] }).points;
  if (points.length === 0 || points.length > 40) throw new Error("INVALID_POINTS");
  return points.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error("INVALID_POINT");
    const point = raw as Partial<WeatherPoint>;
    const eta = parseStrictRfc3339(point.eta);
    if (
      typeof point.longitude !== "number" || !Number.isFinite(point.longitude) || point.longitude < 124 || point.longitude > 132 ||
      typeof point.latitude !== "number" || !Number.isFinite(point.latitude) || point.latitude < 32 || point.latitude > 39.5 ||
      !eta || eta.getTime() < nowMs - 60 * 60_000
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
