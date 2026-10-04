import { executeBudgetedProviderCall } from "./budgeted-call.ts";
import { isRoutePointErrorCode, routeResponseDiagnostic, type NormalizedKakaoRoute } from "./kakao-route.ts";
import type { MealTarget, RecommendationRequest } from "./restaurant-recommendation-request.ts";
import { isFutureDeparture, type RoutablePoint, type RouteChunkRequest, type RouteOperation } from "./route-orchestration.ts";
import { parseStrictRfc3339 } from "./strict-time.ts";

// ---------------------------------------------------------------------------
// Public response contract (docs/work/research/2026-10-05-restaurant-recommendation.md §3.3)

export type SingleRejectReason = "WINDOW" | "DETOUR" | "RETURN_24H";

export type RecommendationCandidate = {
  savedPlaceId: string;
  savedPlaceRevision: number;
  displayName: string;
  placeName: string;
  address: string;
  longitude: number;
  latitude: number;
  insertion: { legIndex: number; afterPointId: string; beforePointId: string };
  single: {
    feasible: boolean;
    arrivalAt: string;
    extraDriveSeconds: number;
    returnAt: string;
    reason: SingleRejectReason | null;
  };
};

export type RecommendationMeal = {
  index: number;
  targetAt: string;
  windowStartAt: string;
  windowEndAt: string;
  dwellMinutes: number;
  candidates: RecommendationCandidate[];
};

export type RecommendationPair = {
  firstSavedPlaceId: string;
  secondSavedPlaceId: string;
  firstArrivalAt: string;
  secondArrivalAt: string;
  extraDriveSeconds: number;
  returnAt: string;
};

export type RecommendationCoverage = {
  savedRestaurants: number;
  invalidSaved: number;
  alreadyInRoute: number;
  nearRoute: number;
  evaluated: number;
  unreachable: number;
  notEvaluated: number;
  providerRequests: number;
};

export type RecommendationResponse = {
  status: "OK" | "NO_SAVED_RESTAURANTS";
  basis: { tripId: string; departureAt: string; returnAt: string; pointIds: string[]; arrivalAts: string[] };
  settings: { mealCount: 1 | 2; toleranceMinutes: number; detourLimitMinutes: number };
  meals: RecommendationMeal[];
  pairs: RecommendationPair[];
  coverage: RecommendationCoverage;
};

export type RecommendationDependencies = {
  now: () => number;
  limitFor: (operation: RouteOperation) => number;
  consumeBudget: (operation: RouteOperation, hardLimit: number) => Promise<number>;
  requestProvider: (input: RouteChunkRequest) => Promise<NormalizedKakaoRoute>;
};

// ---------------------------------------------------------------------------
// Fixed limits

export const MAX_ROUTE_WAYPOINTS = 30;
export const SINGLE_MEAL_EVALUATIONS = 6;
export const TWO_MEAL_EVALUATIONS_PER_MEAL = 5;
export const SAME_LEG_PAIR_EVALUATIONS = 4;
export const PROVIDER_CONCURRENCY = 4;
const MAX_PROVIDER_CALLS = { 1: SINGLE_MEAL_EVALUATIONS, 2: 2 * TWO_MEAL_EVALUATIONS_PER_MEAL + SAME_LEG_PAIR_EVALUATIONS };
const DAY_MS = 24 * 60 * 60_000;
const SCREEN_MARGIN_MS = 15 * 60_000;
const SAME_POINT_DEGREES = 0.000001 + 1e-9;
const EARTH_RADIUS_KM = 6371.0088;
// Straight-line detour estimates: 60 km/h round trip for exclusion, 40 km/h for ranking/arrival.
const SECONDS_PER_KM_AT_40 = 90;

// ---------------------------------------------------------------------------
// Stored route (route_cache.summary for profile "recommended")

type StoredPoint = { id: string; label: string; longitude: number; latitude: number };
type TimedVertex = { longitude: number; latitude: number; atMs: number };
export type StoredLeg = {
  from: StoredPoint;
  to: StoredPoint;
  departureMs: number;
  arrivalMs: number;
  durationSeconds: number;
  vertices: TimedVertex[];
};
export type StoredRoute = {
  departureMs: number;
  returnMs: number;
  pointIds: string[];
  legs: StoredLeg[];
};

function stale(): never {
  throw new Error("RECOMMENDATION_ROUTE_STALE");
}

function storedRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) stale();
  return value as Record<string, unknown>;
}

function inKorea(longitude: unknown, latitude: unknown): boolean {
  return typeof longitude === "number" && Number.isFinite(longitude) && longitude >= 124.5 && longitude <= 132 &&
    typeof latitude === "number" && Number.isFinite(latitude) && latitude >= 32.8 && latitude <= 38.7;
}

function storedPoint(value: unknown): StoredPoint & { dwellMinutes: number } {
  const point = storedRecord(value);
  if (
    typeof point.id !== "string" || point.id.length < 1 || point.id.length > 100 ||
    typeof point.label !== "string" || point.label.trim().length < 1 || point.label.length > 160 ||
    !inKorea(point.longitude, point.latitude) ||
    !Number.isInteger(point.dwellMinutes) || Number(point.dwellMinutes) < 0 || Number(point.dwellMinutes) > 1440
  ) stale();
  return {
    id: point.id,
    label: point.label,
    longitude: point.longitude as number,
    latitude: point.latitude as number,
    dwellMinutes: point.dwellMinutes as number,
  };
}

function storedTime(value: unknown): number {
  const parsed = parseStrictRfc3339(value);
  if (!parsed) stale();
  return parsed.getTime();
}

function planarKm(aLongitude: number, aLatitude: number, bLongitude: number, bLatitude: number) {
  const cosLatitude = Math.cos(((aLatitude + bLatitude) / 2) * Math.PI / 180);
  const dx = (bLongitude - aLongitude) * cosLatitude * 111.32;
  const dy = (bLatitude - aLatitude) * 110.574;
  return Math.sqrt(dx * dx + dy * dy);
}

export function haversineKm(aLongitude: number, aLatitude: number, bLongitude: number, bLatitude: number) {
  const toRadians = Math.PI / 180;
  const dLatitude = (bLatitude - aLatitude) * toRadians;
  const dLongitude = (bLongitude - aLongitude) * toRadians;
  const h = Math.sin(dLatitude / 2) ** 2 +
    Math.cos(aLatitude * toRadians) * Math.cos(bLatitude * toRadians) * Math.sin(dLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

type StoredRoad = { duration: number; vertexes: number[] };

function storedRoads(leg: Record<string, unknown>): StoredRoad[] {
  if (!Array.isArray(leg.sections) || leg.sections.length < 1) stale();
  return leg.sections.flatMap((value) => {
    const section = storedRecord(value);
    if (!Array.isArray(section.roads) || section.roads.length < 1) stale();
    return section.roads.map((value) => {
      const road = storedRecord(value);
      const vertexes = road.vertexes;
      if (
        !Number.isSafeInteger(road.duration) || Number(road.duration) < 0 ||
        !Array.isArray(vertexes) || vertexes.length < 4 || vertexes.length % 2 !== 0
      ) stale();
      for (let index = 0; index < vertexes.length; index += 2) {
        if (!inKorea(vertexes[index], vertexes[index + 1])) stale();
      }
      return { duration: road.duration as number, vertexes: vertexes as number[] };
    });
  });
}

// Interpolates the stored pass time of every road vertex. Road durations are
// scaled to the leg duration so the timeline always spans departure→arrival.
export function timedVertices(roads: StoredRoad[], departureMs: number, durationSeconds: number): TimedVertex[] {
  const roadTotal = roads.reduce((sum, road) => sum + road.duration, 0);
  const vertices: TimedVertex[] = [];
  let roadStartMs = departureMs;
  roads.forEach((road, roadIndex) => {
    const roadMs = roadTotal > 0
      ? road.duration / roadTotal * durationSeconds * 1000
      : durationSeconds * 1000 / roads.length;
    const lengths = [0];
    for (let index = 2; index < road.vertexes.length; index += 2) {
      lengths.push(lengths.at(-1)! + planarKm(
        road.vertexes[index - 2], road.vertexes[index - 1], road.vertexes[index], road.vertexes[index + 1],
      ));
    }
    const total = lengths.at(-1)!;
    const count = lengths.length;
    lengths.forEach((length, vertexIndex) => {
      const fraction = total > 0 ? length / total : (count > 1 ? vertexIndex / (count - 1) : 0);
      vertices.push({
        longitude: road.vertexes[vertexIndex * 2],
        latitude: road.vertexes[vertexIndex * 2 + 1],
        atMs: roadIndex === roads.length - 1 && vertexIndex === count - 1
          ? departureMs + durationSeconds * 1000
          : roadStartMs + roadMs * fraction,
      });
    });
    roadStartMs += roadMs;
  });
  return vertices;
}

export function parseStoredRoute(summary: unknown): StoredRoute {
  const route = storedRecord(summary);
  const candidate = storedRecord(route.candidate);
  if (candidate.id !== "recommended" || !Array.isArray(route.legs) || route.legs.length < 1 || route.legs.length > MAX_ROUTE_WAYPOINTS + 1) {
    stale();
  }
  const legs: StoredLeg[] = [];
  let expectedDepartureMs: number | null = null;
  let previousTo: (StoredPoint & { dwellMinutes: number }) | null = null;
  for (const value of route.legs) {
    const leg = storedRecord(value);
    const from = storedPoint(leg.from);
    const to = storedPoint(leg.to);
    const departureMs = storedTime(leg.departureAt);
    const arrivalMs = storedTime(leg.arrivalAt);
    if (!Number.isSafeInteger(leg.durationSeconds) || Number(leg.durationSeconds) <= 0) stale();
    const durationSeconds = leg.durationSeconds as number;
    if (arrivalMs !== departureMs + durationSeconds * 1000) stale();
    // Adjacent legs must share the same point: ID, coordinates and timing.
    if (previousTo && (
      previousTo.id !== from.id ||
      previousTo.longitude !== from.longitude ||
      previousTo.latitude !== from.latitude ||
      departureMs !== expectedDepartureMs
    )) stale();
    legs.push({
      from: { id: from.id, label: from.label, longitude: from.longitude, latitude: from.latitude },
      to: { id: to.id, label: to.label, longitude: to.longitude, latitude: to.latitude },
      departureMs,
      arrivalMs,
      durationSeconds,
      vertices: timedVertices(storedRoads(leg), departureMs, durationSeconds),
    });
    expectedDepartureMs = arrivalMs + to.dwellMinutes * 60_000;
    previousTo = to;
  }
  const returnMs = storedTime(route.returnAt);
  if (returnMs !== expectedDepartureMs) stale();
  return {
    departureMs: legs[0].departureMs,
    returnMs,
    pointIds: [legs[0].from.id, ...legs.map((leg) => leg.to.id)],
    legs,
  };
}

// The screen's basis must name exactly the stored route: first departure,
// return, ordered occurrence IDs and every leg arrival. Anything else is a stale screen result.
export function prepareStoredRoute(request: RecommendationRequest, summary: unknown): StoredRoute {
  const route = parseStoredRoute(summary);
  if (
    route.departureMs !== Date.parse(request.basis.departureAt) ||
    route.returnMs !== Date.parse(request.basis.returnAt) ||
    route.pointIds.length !== request.basis.pointIds.length ||
    route.pointIds.some((id, index) => id !== request.basis.pointIds[index]) ||
    request.basis.arrivalAts.length !== route.legs.length ||
    route.legs.some((leg, index) => leg.arrivalMs !== Date.parse(request.basis.arrivalAts[index]))
  ) stale();
  if (route.legs.length - 1 + request.mealCount > MAX_ROUTE_WAYPOINTS) {
    throw new Error("RECOMMENDATION_WAYPOINT_LIMIT");
  }
  return route;
}

// ---------------------------------------------------------------------------
// Saved restaurants (owner RLS rows of saved_places kind='restaurant')

export type SavedRestaurant = {
  id: string;
  revision: number;
  displayName: string;
  placeName: string;
  address: string;
  longitude: number;
  latitude: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value.trim() !== value) return null;
  return value;
}

function savedRestaurant(value: unknown): SavedRestaurant | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const place = row.place;
  if (!place || typeof place !== "object" || Array.isArray(place)) return null;
  const raw = place as Record<string, unknown>;
  const name = cleanText(raw.name, 160);
  const address = cleanText(raw.address, 300);
  const roadAddress = raw.roadAddress === null || raw.roadAddress === "" ? null : cleanText(raw.roadAddress, 300);
  const alias = row.alias === null || row.alias === undefined ? null : cleanText(row.alias, 80);
  if (
    typeof row.id !== "string" || !UUID.test(row.id) ||
    !Number.isSafeInteger(row.revision) || Number(row.revision) <= 0 ||
    !name || !address || (raw.roadAddress !== null && raw.roadAddress !== "" && !roadAddress) ||
    (row.alias !== null && row.alias !== undefined && !alias) ||
    !inKorea(raw.longitude, raw.latitude)
  ) return null;
  return {
    id: row.id,
    revision: row.revision as number,
    displayName: alias ?? name,
    placeName: name,
    address: roadAddress ?? address,
    longitude: raw.longitude as number,
    latitude: raw.latitude as number,
  };
}

export function parseSavedRestaurants(rows: unknown[]): { restaurants: SavedRestaurant[]; invalid: number } {
  const restaurants: SavedRestaurant[] = [];
  let invalid = 0;
  for (const row of rows) {
    const restaurant = savedRestaurant(row);
    if (restaurant) restaurants.push(restaurant);
    else invalid += 1;
  }
  return { restaurants, invalid };
}

// ---------------------------------------------------------------------------
// Pre-screening (no provider calls)

type MealWindow = {
  index: number;
  targetMs: number;
  windowStartMs: number;
  windowEndMs: number;
  dwellMinutes: number;
  // Meal 2 may also be delayed by meal 1: its dwell plus 0…limit of extra driving.
  pairedDelayMs: number | null;
};

export type ScreenedCandidate = {
  restaurant: SavedRestaurant;
  legIndex: number;
  distanceKm: number;
  estimatedExtraSeconds: number;
  estimatedArrivalMs: number;
  gapMs: number;
};

function mealWindows(targets: MealTarget[]): MealWindow[] {
  return targets.map((target, index) => ({
    index: target.index,
    targetMs: target.targetAt.getTime(),
    windowStartMs: target.windowStartAt.getTime(),
    windowEndMs: target.windowEndAt.getTime(),
    dwellMinutes: target.dwellMinutes,
    pairedDelayMs: index === 0 ? null : targets[0].dwellMinutes * 60_000,
  }));
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart <= bEnd && bStart <= aEnd;
}

function gapToTarget(start: number, end: number, target: number) {
  if (target < start) return start - target;
  if (target > end) return target - end;
  return 0;
}

function nearestVertex(leg: StoredLeg, restaurant: SavedRestaurant) {
  let best: TimedVertex | null = null;
  let bestKm = Number.POSITIVE_INFINITY;
  for (const vertex of leg.vertices) {
    const km = planarKm(restaurant.longitude, restaurant.latitude, vertex.longitude, vertex.latitude);
    if (km < bestKm) {
      bestKm = km;
      best = vertex;
    }
  }
  return best!;
}

function samePoint(restaurant: SavedRestaurant, point: StoredPoint) {
  return Math.abs(restaurant.longitude - point.longitude) <= SAME_POINT_DEGREES &&
    Math.abs(restaurant.latitude - point.latitude) <= SAME_POINT_DEGREES;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

type LegBox = { minLongitude: number; maxLongitude: number; minLatitude: number; maxLatitude: number };

function legBox(leg: StoredLeg, radiusKm: number): LegBox {
  let minLongitude = Infinity, maxLongitude = -Infinity, minLatitude = Infinity, maxLatitude = -Infinity;
  for (const vertex of leg.vertices) {
    minLongitude = Math.min(minLongitude, vertex.longitude);
    maxLongitude = Math.max(maxLongitude, vertex.longitude);
    minLatitude = Math.min(minLatitude, vertex.latitude);
    maxLatitude = Math.max(maxLatitude, vertex.latitude);
  }
  // Generous degree padding (≥ radius everywhere in Korea); exact distance is checked afterwards.
  const latitudePad = radiusKm / 110 + 0.001;
  const longitudePad = radiusKm / (111.32 * Math.cos(39 * Math.PI / 180)) + 0.001;
  return {
    minLongitude: minLongitude - longitudePad,
    maxLongitude: maxLongitude + longitudePad,
    minLatitude: minLatitude - latitudePad,
    maxLatitude: maxLatitude + latitudePad,
  };
}

export function screenCandidates(
  route: StoredRoute,
  restaurants: SavedRestaurant[],
  targets: MealTarget[],
  detourLimitMinutes: number,
) {
  const windows = mealWindows(targets);
  const limitMs = detourLimitMinutes * 60_000;
  const radiusKm = detourLimitMinutes / 2;
  const routePoints = [route.legs[0].from, ...route.legs.map((leg) => leg.to)];
  const boxes = route.legs.map((leg) => legBox(leg, radiusKm));
  const perMeal: ScreenedCandidate[][] = windows.map(() => []);
  let alreadyInRoute = 0;
  let nearRoute = 0;

  for (const restaurant of restaurants) {
    if (routePoints.some((point) => samePoint(restaurant, point))) {
      alreadyInRoute += 1;
      continue;
    }
    const nearest = route.legs.map((leg, legIndex) => {
      const box = boxes[legIndex];
      if (
        restaurant.longitude < box.minLongitude || restaurant.longitude > box.maxLongitude ||
        restaurant.latitude < box.minLatitude || restaurant.latitude > box.maxLatitude
      ) return null;
      const vertex = nearestVertex(leg, restaurant);
      const distanceKm = haversineKm(restaurant.longitude, restaurant.latitude, vertex.longitude, vertex.latitude);
      // Even a 60 km/h straight round trip of 2d km would exceed the limit.
      return distanceKm > radiusKm ? null : { vertex, distanceKm };
    });
    let near = false;
    windows.forEach((window, mealIndex) => {
      let best: ScreenedCandidate | null = null;
      route.legs.forEach((leg, legIndex) => {
        const hit = nearest[legIndex];
        if (!hit) return;
        // An inserted stop's ETA lies in [dep, arr + limit]; meal 2 paired with meal 1
        // is shifted by [dwell₁, dwell₁ + limit] on top of its own estimate.
        const ranges: Array<[number, number, number, number]> = [[leg.departureMs, leg.arrivalMs + limitMs, 0, 0]];
        if (window.pairedDelayMs !== null) {
          ranges.push([
            leg.departureMs + window.pairedDelayMs, leg.arrivalMs + limitMs + window.pairedDelayMs,
            window.pairedDelayMs, window.pairedDelayMs + limitMs,
          ]);
        }
        const estimatedArrivalMs = hit.vertex.atMs + hit.distanceKm * SECONDS_PER_KM_AT_40 * 1000;
        const usable = ranges.filter(([legStart, legEnd, delayLow, delayHigh]) => (
          overlaps(legStart, legEnd, window.windowStartMs, window.windowEndMs) &&
          overlaps(
            estimatedArrivalMs + delayLow, estimatedArrivalMs + delayHigh,
            window.windowStartMs - SCREEN_MARGIN_MS, window.windowEndMs + SCREEN_MARGIN_MS,
          )
        ));
        if (usable.length === 0) return;
        const candidate: ScreenedCandidate = {
          restaurant,
          legIndex,
          distanceKm: hit.distanceKm,
          estimatedExtraSeconds: 2 * hit.distanceKm * SECONDS_PER_KM_AT_40,
          estimatedArrivalMs,
          gapMs: Math.min(...usable.map(([, , delayLow, delayHigh]) => (
            gapToTarget(estimatedArrivalMs + delayLow, estimatedArrivalMs + delayHigh, window.targetMs)
          ))),
        };
        if (
          !best || candidate.estimatedExtraSeconds < best.estimatedExtraSeconds ||
          (candidate.estimatedExtraSeconds === best.estimatedExtraSeconds && candidate.gapMs < best.gapMs)
        ) best = candidate;
      });
      if (best) {
        perMeal[mealIndex].push(best);
        near = true;
      }
    });
    if (near) nearRoute += 1;
  }

  for (const list of perMeal) {
    list.sort((left, right) => (
      left.estimatedExtraSeconds - right.estimatedExtraSeconds ||
      left.gapMs - right.gapMs ||
      compareText(left.restaurant.displayName, right.restaurant.displayName) ||
      compareText(left.restaurant.id, right.restaurant.id)
    ));
  }
  return { perMeal, alreadyInRoute, nearRoute };
}

// ---------------------------------------------------------------------------
// Provider execution: budget before every call, hard call cap, 4-way pool,
// no new call after a fatal failure.

class AbortedCall extends Error {
  constructor() {
    super("RECOMMENDATION_ABORTED");
  }
}

// A candidate-only routing failure: the provider found no motorcycle-safe road
// or blamed one requested point (result codes 101–107).
export function isCandidateUnreachable(error: unknown) {
  return error instanceof Error && (error.message === "SAFE_ROUTE_NOT_FOUND" || isRoutePointErrorCode(error.message));
}

class ProviderRunner {
  calls = 0;
  aborted = false;

  constructor(private readonly maxCalls: number, private readonly dependencies: RecommendationDependencies) {}

  // The shared stop flag is set at the exact point a fatal error is first observed
  // (budget, configuration, provider or response check), before it propagates, so a
  // concurrent lane whose budget receipt completes afterwards never calls the provider.
  private fail(error: unknown): never {
    this.aborted = true;
    throw error;
  }

  async route(points: RoutablePoint[], departureMs: number): Promise<NormalizedKakaoRoute | null> {
    if (this.aborted) throw new AbortedCall();
    try {
      if (this.calls >= this.maxCalls) throw new Error("RECOMMENDATION_CALL_CAP_EXCEEDED");
      const departureAt = new Date(departureMs);
      const isFuture = isFutureDeparture(departureAt, this.dependencies.now());
      const operation: RouteOperation = isFuture ? "future_directions" : "directions";
      const hardLimit = this.dependencies.limitFor(operation);
      this.calls += 1;
      const { result } = await executeBudgetedProviderCall(
        () => this.dependencies.consumeBudget(operation, hardLimit).catch((error: unknown) => this.fail(error)),
        async () => {
          if (this.aborted) throw new AbortedCall();
          try {
            return await this.dependencies.requestProvider({
              origin: points[0],
              destination: points.at(-1)!,
              waypoints: points.slice(1, -1),
              departureAt,
              isFuture,
            });
          } catch (error) {
            if (isCandidateUnreachable(error)) return null;
            return this.fail(error);
          }
        },
      );
      if (result && result.sections.length !== points.length - 1) this.fail(new Error("INVALID_ROUTE_PROVIDER_RESPONSE"));
      return result;
    } catch (error) {
      if (!(error instanceof AbortedCall)) this.aborted = true;
      throw error;
    }
  }
}

export async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
  onFatal: () => void = () => {},
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: { error: unknown } | null = null;
  const lane = async () => {
    while (!failure && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await worker(items[index]);
      } catch (error) {
        if (!failure) {
          failure = { error };
          onFatal();
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  if (failure) throw (failure as { error: unknown }).error;
  return results;
}

// ---------------------------------------------------------------------------
// Evaluation and assembly

function routePoint(point: StoredPoint): RoutablePoint {
  return {
    id: point.id,
    label: point.label,
    name: point.label,
    longitude: point.longitude,
    latitude: point.latitude,
    kind: "pass-through",
    dwellMinutes: 0,
    selected: true,
    winding: false,
  };
}

function restaurantPoint(restaurant: SavedRestaurant, dwellMinutes: number): RoutablePoint {
  return {
    id: restaurant.id,
    label: restaurant.displayName,
    name: restaurant.placeName,
    longitude: restaurant.longitude,
    latitude: restaurant.latitude,
    kind: "stop",
    dwellMinutes,
    selected: true,
    winding: false,
    stopRole: "meal",
  };
}

type SingleEvaluation = {
  restaurant: SavedRestaurant;
  legIndex: number;
  reachable: boolean;
  arrivalMs: number;
  extraSeconds: number;
};

type PairEvaluation = { reachable: boolean; firstArrivalMs: number; secondArrivalMs: number; extraSeconds: number };

type Judge = {
  departureMs: number;
  baseReturnMs: number;
  toleranceMs: number;
  limitSeconds: number;
};

function withinWindow(arrivalMs: number, window: MealWindow, judge: Judge) {
  return Math.abs(arrivalMs - window.targetMs) <= judge.toleranceMs;
}

function returnWithin24Hours(returnMs: number, judge: Judge) {
  return returnMs - judge.departureMs < DAY_MS;
}

function judgeSingle(evaluation: SingleEvaluation, window: MealWindow, judge: Judge) {
  const returnMs = judge.baseReturnMs + (evaluation.extraSeconds + window.dwellMinutes * 60) * 1000;
  const reason: SingleRejectReason | null = !withinWindow(evaluation.arrivalMs, window, judge)
    ? "WINDOW"
    : evaluation.extraSeconds > judge.limitSeconds
      ? "DETOUR"
      : !returnWithin24Hours(returnMs, judge) ? "RETURN_24H" : null;
  return { feasible: reason === null, returnMs, reason };
}

function singleKey(restaurantId: string, legIndex: number) {
  return `${restaurantId}#${legIndex}`;
}

function sameLegPairChoices(
  first: SingleEvaluation[],
  second: SingleEvaluation[],
  windows: MealWindow[],
  judge: Judge,
) {
  const [meal1, meal2] = windows;
  const choices: Array<{ first: SingleEvaluation; second: SingleEvaluation; estimate: number; gap: number }> = [];
  for (const a of first) {
    for (const b of second) {
      if (!a.reachable || !b.reachable || a.legIndex !== b.legIndex || a.restaurant.id === b.restaurant.id) continue;
      // Keep the visiting order along the leg and drop pairs no combined route can satisfy:
      // the combined detour is at least the larger single detour, and meal 2 cannot
      // arrive before its single arrival plus the meal-1 dwell.
      if (a.arrivalMs > b.arrivalMs) continue;
      if (Math.max(a.extraSeconds, b.extraSeconds) > judge.limitSeconds) continue;
      if (Math.abs(a.arrivalMs - meal1.targetMs) > judge.toleranceMs + SCREEN_MARGIN_MS) continue;
      if (b.arrivalMs + meal1.dwellMinutes * 60_000 > meal2.windowEndMs + SCREEN_MARGIN_MS) continue;
      const minimumReturnMs = judge.baseReturnMs +
        (Math.max(a.extraSeconds, b.extraSeconds) + (meal1.dwellMinutes + meal2.dwellMinutes) * 60) * 1000;
      if (!returnWithin24Hours(minimumReturnMs, judge)) continue;
      const estimatedSecond = b.arrivalMs + (a.extraSeconds + meal1.dwellMinutes * 60) * 1000;
      choices.push({
        first: a,
        second: b,
        estimate: a.extraSeconds + b.extraSeconds,
        gap: Math.abs(a.arrivalMs - meal1.targetMs) + Math.abs(estimatedSecond - meal2.targetMs),
      });
    }
  }
  choices.sort((left, right) => (
    left.estimate - right.estimate || left.gap - right.gap ||
    compareText(left.first.restaurant.id, right.first.restaurant.id) ||
    compareText(left.second.restaurant.id, right.second.restaurant.id)
  ));
  return choices.slice(0, SAME_LEG_PAIR_EVALUATIONS);
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

export async function recommendRestaurants(
  input: {
    request: RecommendationRequest;
    targets: MealTarget[];
    route: StoredRoute;
    savedRows: unknown[];
  },
  dependencies: RecommendationDependencies,
): Promise<RecommendationResponse> {
  const { request, targets, route } = input;
  const windows = mealWindows(targets);
  const judge: Judge = {
    departureMs: route.departureMs,
    baseReturnMs: route.returnMs,
    toleranceMs: request.toleranceMinutes * 60_000,
    limitSeconds: request.detourLimitMinutes * 60,
  };
  const { restaurants, invalid } = parseSavedRestaurants(input.savedRows);
  const coverage: RecommendationCoverage = {
    savedRestaurants: restaurants.length,
    invalidSaved: invalid,
    alreadyInRoute: 0,
    nearRoute: 0,
    evaluated: 0,
    unreachable: 0,
    notEvaluated: 0,
    providerRequests: 0,
  };
  const base = {
    basis: {
      tripId: request.tripId,
      departureAt: iso(route.departureMs),
      returnAt: iso(route.returnMs),
      pointIds: route.pointIds,
      arrivalAts: route.legs.map((leg) => iso(leg.arrivalMs)),
    },
    settings: {
      mealCount: request.mealCount,
      toleranceMinutes: request.toleranceMinutes,
      detourLimitMinutes: request.detourLimitMinutes,
    },
  };
  const mealShell = (window: MealWindow) => ({
    index: window.index,
    targetAt: iso(window.targetMs),
    windowStartAt: iso(window.windowStartMs),
    windowEndAt: iso(window.windowEndMs),
    dwellMinutes: window.dwellMinutes,
  });
  if (restaurants.length === 0) {
    return {
      status: "NO_SAVED_RESTAURANTS",
      ...base,
      meals: windows.map((window) => ({ ...mealShell(window), candidates: [] })),
      pairs: [],
      coverage,
    };
  }

  const screened = screenCandidates(route, restaurants, targets, request.detourLimitMinutes);
  coverage.alreadyInRoute = screened.alreadyInRoute;
  coverage.nearRoute = screened.nearRoute;
  const perMealLimit = request.mealCount === 1 ? SINGLE_MEAL_EVALUATIONS : TWO_MEAL_EVALUATIONS_PER_MEAL;
  const chosen = screened.perMeal.map((list) => list.slice(0, perMealLimit));

  const singles = new Map<string, SingleEvaluation>();
  for (const list of chosen) {
    for (const candidate of list) {
      const key = singleKey(candidate.restaurant.id, candidate.legIndex);
      if (!singles.has(key)) {
        singles.set(key, { restaurant: candidate.restaurant, legIndex: candidate.legIndex, reachable: false, arrivalMs: 0, extraSeconds: 0 });
      }
    }
  }

  const runner = new ProviderRunner(MAX_PROVIDER_CALLS[request.mealCount], dependencies);
  const abort = () => {
    runner.aborted = true;
  };
  await runPool([...singles.values()], PROVIDER_CONCURRENCY, async (evaluation) => {
    const leg = route.legs[evaluation.legIndex];
    const result = await runner.route([
      routePoint(leg.from),
      restaurantPoint(evaluation.restaurant, windows[0].dwellMinutes),
      routePoint(leg.to),
    ], leg.departureMs);
    if (!result) return;
    const [toRestaurant, fromRestaurant] = result.sections;
    evaluation.reachable = true;
    evaluation.arrivalMs = leg.departureMs + toRestaurant.duration * 1000;
    evaluation.extraSeconds = toRestaurant.duration + fromRestaurant.duration - leg.durationSeconds;
  }, abort);

  const evaluationsByMeal = chosen.map((list) => list.map((candidate) => (
    singles.get(singleKey(candidate.restaurant.id, candidate.legIndex))!
  )));

  const pairResults = new Map<string, PairEvaluation>();
  if (request.mealCount === 2) {
    const choices = sameLegPairChoices(evaluationsByMeal[0], evaluationsByMeal[1], windows, judge);
    await runPool(choices, PROVIDER_CONCURRENCY, async ({ first, second }) => {
      const leg = route.legs[first.legIndex];
      const result = await runner.route([
        routePoint(leg.from),
        restaurantPoint(first.restaurant, windows[0].dwellMinutes),
        restaurantPoint(second.restaurant, windows[1].dwellMinutes),
        routePoint(leg.to),
      ], leg.departureMs);
      const key = `${first.restaurant.id}|${second.restaurant.id}`;
      if (!result) {
        pairResults.set(key, { reachable: false, firstArrivalMs: 0, secondArrivalMs: 0, extraSeconds: 0 });
        return;
      }
      const [s1, s2, s3] = result.sections.map((section) => section.duration);
      const firstArrivalMs = leg.departureMs + s1 * 1000;
      pairResults.set(key, {
        reachable: true,
        firstArrivalMs,
        secondArrivalMs: firstArrivalMs + windows[0].dwellMinutes * 60_000 + s2 * 1000,
        extraSeconds: s1 + s2 + s3 - leg.durationSeconds,
      });
    }, abort);
  }

  const evaluatedIds = new Set<string>();
  const reachableIds = new Set<string>();
  for (const evaluation of singles.values()) {
    evaluatedIds.add(evaluation.restaurant.id);
    if (evaluation.reachable) reachableIds.add(evaluation.restaurant.id);
  }
  coverage.evaluated = evaluatedIds.size;
  coverage.unreachable = [...evaluatedIds].filter((id) => !reachableIds.has(id)).length;
  coverage.notEvaluated = coverage.nearRoute - coverage.evaluated;
  coverage.providerRequests = runner.calls;

  const pairs: Array<RecommendationPair & { gapMs: number }> = [];
  const inPair = [new Set<string>(), new Set<string>()];
  if (request.mealCount === 2) {
    const [meal1, meal2] = windows;
    for (const a of evaluationsByMeal[0]) {
      for (const b of evaluationsByMeal[1]) {
        if (!a.reachable || !b.reachable || a.restaurant.id === b.restaurant.id || a.legIndex > b.legIndex) continue;
        let combined: PairEvaluation | undefined;
        if (a.legIndex < b.legIndex) {
          combined = {
            reachable: true,
            firstArrivalMs: a.arrivalMs,
            secondArrivalMs: b.arrivalMs + (a.extraSeconds + meal1.dwellMinutes * 60) * 1000,
            extraSeconds: a.extraSeconds + b.extraSeconds,
          };
        } else {
          combined = pairResults.get(`${a.restaurant.id}|${b.restaurant.id}`);
        }
        if (!combined?.reachable) continue;
        const returnMs = judge.baseReturnMs +
          (combined.extraSeconds + (meal1.dwellMinutes + meal2.dwellMinutes) * 60) * 1000;
        if (
          !withinWindow(combined.firstArrivalMs, meal1, judge) ||
          !withinWindow(combined.secondArrivalMs, meal2, judge) ||
          combined.extraSeconds > judge.limitSeconds ||
          !returnWithin24Hours(returnMs, judge)
        ) continue;
        inPair[0].add(a.restaurant.id);
        inPair[1].add(b.restaurant.id);
        pairs.push({
          firstSavedPlaceId: a.restaurant.id,
          secondSavedPlaceId: b.restaurant.id,
          firstArrivalAt: iso(combined.firstArrivalMs),
          secondArrivalAt: iso(combined.secondArrivalMs),
          extraDriveSeconds: combined.extraSeconds,
          returnAt: iso(returnMs),
          gapMs: Math.abs(combined.firstArrivalMs - meal1.targetMs) + Math.abs(combined.secondArrivalMs - meal2.targetMs),
        });
      }
    }
    pairs.sort((left, right) => (
      left.extraDriveSeconds - right.extraDriveSeconds || left.gapMs - right.gapMs ||
      compareText(left.firstSavedPlaceId, right.firstSavedPlaceId) ||
      compareText(left.secondSavedPlaceId, right.secondSavedPlaceId)
    ));
  }

  const meals = windows.map((window, mealIndex) => {
    const candidates = evaluationsByMeal[mealIndex].flatMap((evaluation) => {
      if (!evaluation.reachable) return [];
      const single = judgeSingle(evaluation, window, judge);
      if (!single.feasible && !inPair[mealIndex].has(evaluation.restaurant.id)) return [];
      const restaurant = evaluation.restaurant;
      return [{
        candidate: {
          savedPlaceId: restaurant.id,
          savedPlaceRevision: restaurant.revision,
          displayName: restaurant.displayName,
          placeName: restaurant.placeName,
          address: restaurant.address,
          longitude: restaurant.longitude,
          latitude: restaurant.latitude,
          insertion: {
            legIndex: evaluation.legIndex,
            afterPointId: route.pointIds[evaluation.legIndex],
            beforePointId: route.pointIds[evaluation.legIndex + 1],
          },
          single: {
            feasible: single.feasible,
            arrivalAt: iso(evaluation.arrivalMs),
            extraDriveSeconds: evaluation.extraSeconds,
            returnAt: iso(single.returnMs),
            reason: single.reason,
          },
        } satisfies RecommendationCandidate,
        gapMs: Math.abs(evaluation.arrivalMs - window.targetMs),
      }];
    });
    candidates.sort((left, right) => (
      left.candidate.single.extraDriveSeconds - right.candidate.single.extraDriveSeconds ||
      left.gapMs - right.gapMs ||
      compareText(left.candidate.displayName, right.candidate.displayName) ||
      compareText(left.candidate.savedPlaceId, right.candidate.savedPlaceId)
    ));
    return { ...mealShell(window), candidates: candidates.map(({ candidate }) => candidate) };
  });

  return {
    status: "OK",
    ...base,
    meals,
    pairs: pairs.map(({ gapMs: _gapMs, ...pair }) => pair),
    coverage,
  };
}

// ---------------------------------------------------------------------------
// Public error mapping (§3.4). Messages never carry coordinates, names,
// provider messages, URLs or keys.

export type RecommendationFailure = { status: number; code: string; message: string };

export function recommendationFailure(error: unknown): RecommendationFailure {
  const message = error instanceof Error ? error.message : "";
  if (message === "INVALID_RECOMMENDATION_REQUEST" || error instanceof SyntaxError) {
    return { status: 400, code: "RECOMMENDATION_INPUT_INVALID", message: "추천 조건을 확인해 주세요." };
  }
  if (message.includes("AUTH_REQUIRED")) return { status: 401, code: "AUTH_REQUIRED", message: "로그인이 필요합니다." };
  if (message.includes("MEMBERSHIP_REQUIRED")) {
    return { status: 403, code: "MEMBERSHIP_REQUIRED", message: "서비스 이용 권한이 없습니다." };
  }
  if (message === "RECOMMENDATION_ROUTE_STALE") {
    return {
      status: 409,
      code: "RECOMMENDATION_ROUTE_STALE",
      message: "경로가 바뀌었거나 저장된 경로를 찾지 못했습니다. 경로를 다시 계산해 주세요.",
    };
  }
  if (message === "RECOMMENDATION_WAYPOINT_LIMIT") {
    return { status: 422, code: "RECOMMENDATION_WAYPOINT_LIMIT", message: "경유지는 최대 30개까지 추가할 수 있습니다." };
  }
  if (message.includes("API_DAILY_BUDGET_EXHAUSTED")) {
    return { status: 429, code: "RECOMMENDATION_BUDGET_OR_CONFIG", message: "오늘의 무료 API 사용 한도를 모두 사용했습니다." };
  }
  if (message === "PROVIDER_AUTH_FAILED") {
    return { status: 503, code: "RECOMMENDATION_BUDGET_OR_CONFIG", message: "경로 공급자 인증 설정을 확인해 주세요." };
  }
  if (message.includes("API_BUDGET") || message.includes("NOT_CONFIGURED")) {
    return { status: 503, code: "RECOMMENDATION_BUDGET_OR_CONFIG", message: "경로 계산 사용 한도 또는 공급자 설정을 확인해야 합니다." };
  }
  if (["PROVIDER_RATE_LIMITED", "PROVIDER_UNAVAILABLE", "PROVIDER_REQUEST_REJECTED"].includes(message)) {
    return { status: 503, code: "RECOMMENDATION_PROVIDER_TEMPORARY", message: "경로 공급자에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요." };
  }
  if (message === "INVALID_ROUTE_PROVIDER_RESPONSE") {
    return { status: 502, code: "RECOMMENDATION_RESPONSE_INVALID", message: "경로 공급자의 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  return {
    status: message === "RECOMMENDATION_STORAGE_FAILED" || message === "RECOMMENDATION_CALL_CAP_EXCEEDED" ? 500 : 502,
    code: "RECOMMENDATION_FAILED",
    message: "추천을 계산하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  };
}

// Fixed provider-validation label only (never payloads, coordinates or names).
export function recommendationDiagnostic(error: unknown) {
  return routeResponseDiagnostic(error);
}
