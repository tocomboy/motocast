/** Versioned mobile contract. Parsing never authorizes a trip or a bearer share. */
export type JourneyCoordinate = { longitude: number; latitude: number };
export type JourneyCoursePoint = JourneyCoordinate & { id: string; dwellMinutes: number };
export type JourneySource = { kind: "owned"; tripId: string } | { kind: "shared"; token: string };
export type JourneyWeatherRequest = {
  schemaVersion: 1; journeyId: string; requestId: string; routeRevision: number;
  source: JourneySource; course: JourneyCoursePoint[];
  position: JourneyCoordinate & { accuracyMeters: number; observedAt: number };
  progress: { currentIndex: number; phase: "PENDING" | "ARRIVED"; arrivedAt: number | null; skippedIndices: number[] };
};

export class JourneyWeatherInputError extends Error {
  constructor() { super("INVALID_JOURNEY_WEATHER_REQUEST"); }
}
function check(value: unknown): asserts value { if (!value) throw new JourneyWeatherInputError(); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value));
  const result = value as Record<string, unknown>;
  check(Object.keys(result).length === keys.length && keys.every(key => Object.hasOwn(result, key)));
  return result;
}
function integer(value: unknown, min: number, max: number): number {
  check(typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max); return value;
}
function uuid(value: unknown): string {
  check(typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)); return value;
}
export function journeyCoordinate(value: JourneyCoordinate): JourneyCoordinate {
  check(typeof value.longitude === "number" && value.longitude >= 124.5 && value.longitude <= 132);
  check(typeof value.latitude === "number" && value.latitude >= 32.8 && value.latitude <= 38.7);
  return { longitude: value.longitude, latitude: value.latitude };
}
export function parseJourneyWeatherRequest(value: unknown, now: number): JourneyWeatherRequest {
  integer(now, 1, Number.MAX_SAFE_INTEGER - 86_400_000);
  const r = record(value, ["schemaVersion", "journeyId", "requestId", "routeRevision", "source", "course", "position", "progress"]);
  check(r.schemaVersion === 1);
  const rawSource = r.source as Record<string, unknown> | null;
  let source: JourneySource;
  if (rawSource?.kind === "owned") {
    const s = record(rawSource, ["kind", "tripId"]); source = { kind: "owned", tripId: uuid(s.tripId) };
  } else {
    const s = record(rawSource, ["kind", "token"]);
    check(s.kind === "shared" && typeof s.token === "string" && /^[A-Za-z0-9_-]{43}$/.test(s.token));
    source = { kind: "shared", token: s.token };
  }
  check(Array.isArray(r.course) && r.course.length >= 2 && r.course.length <= 7);
  const course = r.course.map(value => {
    const p = record(value, ["id", "longitude", "latitude", "dwellMinutes"]);
    check(typeof p.id === "string" && p.id.trim().length > 0 && p.id.length <= 100);
    return { ...journeyCoordinate(p as JourneyCoordinate), id: p.id, dwellMinutes: integer(p.dwellMinutes, 0, 1440) };
  });
  const p = record(r.position, ["longitude", "latitude", "accuracyMeters", "observedAt"]);
  check(typeof p.accuracyMeters === "number" && Number.isFinite(p.accuracyMeters) && p.accuracyMeters >= 0 && p.accuracyMeters <= 50);
  const observedAt = integer(p.observedAt, Math.max(1, now - 30_000), now + 5_000);
  const progress = record(r.progress, ["currentIndex", "phase", "arrivedAt", "skippedIndices"]);
  const currentIndex = integer(progress.currentIndex, 0, course.length - 1);
  check(progress.phase === "PENDING" || progress.phase === "ARRIVED");
  check(currentIndex !== 0 || progress.phase === "ARRIVED");
  check(currentIndex !== course.length - 1 || progress.phase !== "ARRIVED");
  const arrivedAt = progress.phase === "ARRIVED" ? integer(progress.arrivedAt, 1, observedAt) : null;
  if (progress.phase === "PENDING") check(progress.arrivedAt === null);
  check(Array.isArray(progress.skippedIndices));
  const skippedIndices = progress.skippedIndices.map(i => integer(i, 1, currentIndex - 1));
  check(skippedIndices.every((i, index) => index === 0 || i > skippedIndices[index - 1]));
  return {
    schemaVersion: 1, journeyId: uuid(r.journeyId), requestId: uuid(r.requestId),
    routeRevision: integer(r.routeRevision, 0, 2_147_483_647), source, course,
    position: { ...journeyCoordinate(p as JourneyCoordinate), accuracyMeters: p.accuracyMeters, observedAt },
    progress: { currentIndex, phase: progress.phase, arrivedAt, skippedIndices },
  };
}

/** Invoke only after resolving source with membership, ownership/revocation and expiry checks.
 * Exact ordered occurrence matching detects edited courses; matching alone is not authorization.
 */
export function remainingJourneyPlan(request: JourneyWeatherRequest, authorizedCourse: readonly JourneyCoursePoint[], now: number) {
  const r = parseJourneyWeatherRequest(request, now);
  check(authorizedCourse.length === r.course.length && authorizedCourse.every((p, i) => {
    const q = r.course[i]; return p.id === q.id && p.longitude === q.longitude && p.latitude === q.latitude && p.dwellMinutes === q.dwellMinutes;
  }));
  const { currentIndex, phase, arrivedAt } = r.progress;
  const departureAt = phase === "ARRIVED" ? Math.max(now, arrivedAt! + authorizedCourse[currentIndex].dwellMinutes * 60_000) : now;
  const start = currentIndex + (phase === "ARRIVED" ? 1 : 0);
  return {
    calculatedAt: now, departureAt, origin: journeyCoordinate(r.position),
    remaining: authorizedCourse.slice(start).map((p, index) => ({ ...p, visitIndex: start + index })),
  };
}
