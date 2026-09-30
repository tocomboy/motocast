import { journeyCoordinate, type JourneyCoordinate, type remainingJourneyPlan } from "./journey-weather-request.ts";

type Plan = ReturnType<typeof remainingJourneyPlan>;
export type JourneyRoadLeg = { visitIndex: number; roads: { durationSeconds: number; coordinates: JourneyCoordinate[] }[] };
type Segment = { start: number; end: number; coordinates: JourneyCoordinate[] };
export class JourneyRoadError extends Error { constructor() { super("INVALID_JOURNEY_ROADS"); } }
function check(value: unknown): asserts value { if (!value) throw new JourneyRoadError(); }
function near(a: JourneyCoordinate, b: JourneyCoordinate, tolerance: number) {
  return Math.abs(a.longitude - b.longitude) <= tolerance && Math.abs(a.latitude - b.latitude) <= tolerance;
}
function distance(a: JourneyCoordinate, b: JourneyCoordinate) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
/** Interpolates within provider road vertices, never along a straight origin/destination shortcut.
 * Road duration is provider ETA; speed within each road is approximated by cumulative arc length.
 */
function coordinateAt(segment: Segment, at: number): JourneyCoordinate {
  const points = segment.coordinates;
  if (points.length === 1) return { ...points[0] };
  const lengths = points.slice(1).map((p, i) => distance(points[i], p));
  let left = lengths.reduce((a, b) => a + b, 0) * (at - segment.start) / (segment.end - segment.start);
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] && lengths[i] > 0) {
      const fraction = left / lengths[i]; const a = points[i]; const b = points[i + 1];
      return { longitude: a.longitude + (b.longitude - a.longitude) * fraction, latitude: a.latitude + (b.latitude - a.latitude) * fraction };
    }
    left -= lengths[i];
  }
  return { ...points[points.length - 1] };
}

/** Pure planning only: adapter must supply normalized, motorcycle-safe provider roads. */
export function buildJourneyWeatherTimeline(plan: Plan, legs: readonly JourneyRoadLeg[]) {
  check(legs.length === plan.remaining.length && legs.length > 0);
  const segments: Segment[] = [];
  const visits: { visitIndex: number; arrivalAt: number; departureAt: number }[] = [];
  let cursor = plan.departureAt;
  check(Number.isSafeInteger(cursor) && cursor >= plan.calculatedAt);
  if (cursor > plan.calculatedAt) segments.push({ start: plan.calculatedAt, end: cursor, coordinates: [plan.origin] });
  let previousEnd: JourneyCoordinate | null = null;
  legs.forEach((leg, index) => {
    const visit = plan.remaining[index];
    check(leg.visitIndex === visit.visitIndex && leg.roads.length > 0);
    let legSeconds = 0;
    leg.roads.forEach((road, roadIndex) => {
      check(Number.isSafeInteger(road.durationSeconds) && road.durationSeconds >= 0 && road.durationSeconds < 86_400);
      check(road.coordinates.length >= 2);
      const coordinates = road.coordinates.map(journeyCoordinate);
      if (previousEnd) check(near(previousEnd, coordinates[0], 0.0002));
      if (roadIndex === 0) check(near(coordinates[0], index === 0 ? plan.origin : plan.remaining[index - 1], 0.005));
      previousEnd = coordinates[coordinates.length - 1];
      if (road.durationSeconds > 0) segments.push({ start: cursor, end: cursor + road.durationSeconds * 1000, coordinates });
      cursor += road.durationSeconds * 1000;
      legSeconds += road.durationSeconds;
    });
    check(legSeconds > 0 && previousEnd !== null && near(previousEnd, visit, 0.005));
    const arrivalAt = cursor;
    // Final arrival ends the ride; a destination's dwell does not extend weather tracking.
    if (index < legs.length - 1 && visit.dwellMinutes > 0) {
      cursor += visit.dwellMinutes * 60_000;
      segments.push({ start: arrivalAt, end: cursor, coordinates: [{ ...previousEnd! }] });
    }
    visits.push({ visitIndex: visit.visitIndex, arrivalAt, departureAt: cursor });
  });
  check(cursor - plan.calculatedAt < 86_400_000);
  const endAt = Math.min(cursor, plan.calculatedAt + 120 * 60_000);
  const times = new Set<number>([plan.calculatedAt, endAt]);
  for (let at = plan.calculatedAt + 10 * 60_000; at < endAt; at += 10 * 60_000) times.add(at);
  for (const visit of visits) for (const at of [visit.arrivalAt, visit.departureAt]) if (at <= endAt) times.add(at);
  if (plan.departureAt <= endAt) times.add(plan.departureAt);
  const samples = [...times].sort((a, b) => a - b).map(at => {
    const segment = segments.find(s => at >= s.start && at < s.end) ?? segments[segments.length - 1];
    return { at, ...coordinateAt(segment, Math.min(at, segment.end)) };
  });
  return { calculatedAt: plan.calculatedAt, endAt, arrivalAt: cursor, visits, samples };
}
