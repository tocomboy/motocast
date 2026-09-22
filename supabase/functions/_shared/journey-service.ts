import { parseRouteRequest, type RoutePointRequest } from "./route-request.ts";
import { seoulCalendarDate } from "./strict-time.ts";
import { parseJourneyWeatherRequest, remainingJourneyPlan, type JourneyWeatherRequest } from "./journey-weather-request.ts";
import { orchestrateRecommendedRoute, type RoutablePoint } from "./route-orchestration.ts";
import { buildJourneyWeatherTimeline } from "./journey-weather-timeline.ts";
import { conditionFrom, forecastTarget, gridFromCoordinates, latestForecastBase } from "./weather-forecast.ts";
import { bundleForecastValues, type WeatherBundle, type WeatherBundleKey } from "./weather-bundle.ts";

export type SourceReader = (source: JourneyWeatherRequest["source"]) => Promise<unknown>;
export async function verifiedJourneyCourse(value: unknown, secret: string, now: number): Promise<RoutePointRequest[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_JOURNEY_SOURCE");
  const course = value as Record<string, unknown>;
  const departure = new Date(now);
  const parsed = await parseRouteRequest({ planningId: crypto.randomUUID(), tripId: null,
    origin: course.origin, destination: course.destination, waypoints: course.points,
    departureAt: departure.toISOString(), serviceDate: seoulCalendarDate(departure) }, secret, () => departure);
  const points = [parsed.origin, ...parsed.waypoints, parsed.destination];
  if (points.length > 7) throw new Error("INVALID_JOURNEY_SOURCE");
  return points;
}

type RouteDependencies = Parameters<typeof orchestrateRecommendedRoute>[2];
export async function calculateJourneyRoute(value: unknown, deps: {
  now: () => number; readSource: SourceReader; verificationSecret: string; routing: RouteDependencies;
}) {
  const now = deps.now();
  const request = parseJourneyWeatherRequest(value, now);
  const course = await verifiedJourneyCourse(await deps.readSource(request.source), deps.verificationSecret, now);
  const plan = remainingJourneyPlan(request, course, now);
  const origin: RoutablePoint = { id: "journey-current-position", name: "현재 위치", label: "현재 위치", ...plan.origin,
    kind: "pass-through", dwellMinutes: 0, selected: true, winding: false };
  const remaining = plan.remaining.map(p => course[p.visitIndex]);
  const route = await orchestrateRecommendedRoute([origin, ...remaining], new Date(plan.departureAt).toISOString(), deps.routing);
  const timeline = buildJourneyWeatherTimeline(plan, route.legs.map((leg, index) => ({
    visitIndex: plan.remaining[index].visitIndex,
    roads: leg.sections.flatMap(section => section.roads.map(road => ({ durationSeconds: road.duration,
      coordinates: Array.from({ length: road.vertexes.length / 2 }, (_, i) => ({ longitude: road.vertexes[i * 2], latitude: road.vertexes[i * 2 + 1] })) }))),
  })));
  // Share revocation, account/source removal or an edited course during provider I/O cannot return a new result.
  const current = await verifiedJourneyCourse(await deps.readSource(request.source), deps.verificationSecret, deps.now());
  if (JSON.stringify(current) !== JSON.stringify(course)) throw new Error("INVALID_JOURNEY_SOURCE");
  return { request, route, timeline, course };
}

export async function recheckJourneySource(result: Awaited<ReturnType<typeof calculateJourneyRoute>>, read: SourceReader, secret: string, now: number) {
  const current = await verifiedJourneyCourse(await read(result.request.source), secret, now);
  if (JSON.stringify(current) !== JSON.stringify(result.course)) throw new Error("INVALID_JOURNEY_SOURCE");
}

export async function forecastJourneySamples(timeline: ReturnType<typeof buildJourneyWeatherTimeline>,
  bundle: (key: WeatherBundleKey) => Promise<WeatherBundle>, now: Date) {
  const base = latestForecastBase("ultra", now);
  const planned = timeline.samples.map(sample => {
    const grid = gridFromCoordinates(sample.latitude, sample.longitude);
    const key: WeatherBundleKey = { model: "ultra", ...grid, baseDate: base.date, baseTime: base.time };
    return { sample, key, identity: `${key.model}:${key.nx}:${key.ny}:${key.baseDate}:${key.baseTime}` };
  });
  const keys = [...new Map(planned.map(p => [p.identity, p.key])).entries()];
  const fetched = new Map<string, WeatherBundle>();
  // Bounded concurrency across different material; same material is single-flight in PostgreSQL.
  for (let index = 0; index < keys.length; index += 3) {
    const batch = await Promise.allSettled(keys.slice(index, index + 3).map(async ([id, key]) => { fetched.set(id, await bundle(key)); }));
    const failure = batch.find(r => r.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  const forecasts = planned.map(({ sample, key, identity }) => {
    const data = fetched.get(identity)!;
    const target = forecastTarget(new Date(sample.at));
    const values = bundleForecastValues(data.items, target);
    return { ...sample, grid: { nx: key.nx, ny: key.ny }, model: key.model, baseDate: key.baseDate, baseTime: key.baseTime,
      targetDate: target.date, targetTime: target.time, fetchedAt: data.fetchedAt, expiresAt: data.expiresAt,
      condition: conditionFrom(values), temperatureC: Number(values.T1H), windSpeedMps: Number(values.WSD),
      precipitationProbability: values.POP === undefined ? null : Number(values.POP) };
  });
  return { forecasts, metrics: { sampleCount: planned.length, uniqueBundles: keys.length } };
}
