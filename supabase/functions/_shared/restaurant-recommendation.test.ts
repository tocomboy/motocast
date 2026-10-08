import { describe, expect, it, vi } from "vitest";

import fixture from "../../../contracts/android/restaurant-recommendation/fixtures.json";
import { RouteResponseValidationError, type NormalizedKakaoRoute } from "./kakao-route";
import { mealTargets, parseRecommendationRequest } from "./restaurant-recommendation-request";
import {
  prepareStoredRoute,
  recommendationFailure,
  recommendRestaurants,
  recommendRestaurantsV2,
  runPool,
  sharedReadBounds,
  type RecommendationDependencies,
} from "./restaurant-recommendation";
import { parseAvoidedPlaces, parseSharedRestaurantRead, type SharedRestaurantRead } from "./restaurant-candidates";
import type { RouteChunkRequest, RouteOperation } from "./route-orchestration";

// --- Fixture route: straight east-west legs at latitude 37 -----------------

type Point = { id: string; longitude: number; latitude: number; dwell?: number };
const O: Point = { id: "origin", longitude: 127.0, latitude: 37.0 };
const W: Point = { id: "occ-w", longitude: 127.5, latitude: 37.0 };
const D: Point = { id: "destination", longitude: 128.0, latitude: 37.0 };
const DEPARTURE = "2030-01-01T00:00:00.000Z"; // 09:00 Seoul
const FAR_PAST_NOW = Date.parse("2029-12-31T00:00:00.000Z");

function storedPoint(point: Point) {
  return {
    id: point.id, label: `label-${point.id}`, longitude: point.longitude, latitude: point.latitude,
    kind: point.dwell ? "stop" : "pass-through", dwellMinutes: point.dwell ?? 0, selected: true, winding: false,
  };
}

function storedSummary(points: Point[] = [O, W, D], durations: number[] = [7200, 7200], departureAt = DEPARTURE) {
  let cursor = Date.parse(departureAt);
  const legs = durations.map((duration, index) => {
    const from = points[index];
    const to = points[index + 1];
    const vertexes: number[] = [];
    for (let step = 0; step <= 20; step += 1) {
      vertexes.push(
        from.longitude + (to.longitude - from.longitude) * step / 20,
        from.latitude + (to.latitude - from.latitude) * step / 20,
      );
    }
    const leg = {
      from: storedPoint(from), to: storedPoint(to), via: [],
      departureAt: new Date(cursor).toISOString(),
      arrivalAt: new Date(cursor + duration * 1000).toISOString(),
      dwellMinutes: to.dwell ?? 0, distanceMeters: 1000, durationSeconds: duration,
      sections: [{ distance: 1000, duration, roads: [{ name: "fixture", distance: 1000, duration, vertexes }] }],
      providerRequestNumber: 1, forecastTraffic: true,
    };
    cursor += duration * 1000 + (to.dwell ?? 0) * 60_000;
    return leg;
  });
  return {
    safety: { vehicle: "motorcycle", motorwayExcluded: true, fallbackUsed: false },
    candidate: { id: "recommended", label: "추천 경로", estimatedWinding: false },
    totalDistanceMeters: 1000 * legs.length, totalDurationSeconds: 0,
    returnAt: new Date(cursor).toISOString(), legs,
  };
}

type Summary = ReturnType<typeof storedSummary>;

function requestFor(summary: Summary, overrides: Record<string, unknown> = {}) {
  return parseRecommendationRequest({
    tripId: "11111111-1111-4111-8111-111111111111",
    basis: {
      departureAt: summary.legs[0].departureAt,
      returnAt: summary.returnAt,
      pointIds: [summary.legs[0].from.id, ...summary.legs.map((leg) => leg.to.id)],
      arrivalAts: summary.legs.map((leg) => leg.arrivalAt),
    },
    mealCount: 1,
    meals: [{ desiredTime: "12:00", dwellMinutes: 45 }],
    toleranceMinutes: 30,
    ...overrides,
  });
}

let rowNumber = 0;
function restaurant(longitude: number, latitude: number, name = `식당${++rowNumber}`, alias: string | null = null) {
  const id = `00000000-0000-4000-8000-${String(++rowNumber).padStart(12, "0")}`;
  return {
    id, alias, revision: 3,
    place: {
      kakaoPlaceId: `kakao-${id}`, verificationToken: "a".repeat(43), name, address: "공개 주소",
      roadAddress: null, longitude, latitude,
    },
  };
}

// Linear provider model: travel time is proportional to progress along the leg
// plus 90 s/km (40 km/h) of perpendicular offset from the latitude-37 road.
// `overrides` pins exact section durations (or a thrown error) by waypoint IDs.
function harness(summary: Summary, options: {
  now?: number;
  overrides?: Record<string, number[] | Error>;
  consume?: (operation: RouteOperation, call: number) => Promise<number>;
} = {}) {
  const legDuration = new Map(summary.legs.map((leg) => [leg.from.id, leg.durationSeconds]));
  const order: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const requestProvider = vi.fn(async (input: RouteChunkRequest): Promise<NormalizedKakaoRoute> => {
    order.push("provider");
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
    const key = input.waypoints.map((point) => point.id).join("+");
    const pinned = options.overrides?.[key];
    if (pinned instanceof Error) throw pinned;
    const points = [input.origin, ...input.waypoints, input.destination];
    const total = legDuration.get(input.origin.id)!;
    const span = input.destination.longitude - input.origin.longitude;
    const fraction = (point: { longitude: number }) => (point.longitude - input.origin.longitude) / span;
    const offsetKm = (point: { latitude: number }) => Math.abs(point.latitude - 37) * 111.195;
    const durations = pinned ?? points.slice(1).map((to, index) => {
      const from = points[index];
      return Math.round((fraction(to) - fraction(from)) * total + (offsetKm(from) + offsetKm(to)) * 90);
    });
    return {
      summary: { distance: 1, duration: 1, origin: input.origin, destination: input.destination, waypoints: input.waypoints },
      sections: durations.map((duration) => ({ distance: 1, duration, roads: [] })),
    };
  });
  let calls = 0;
  const consumeBudget = vi.fn(async (operation: RouteOperation, _hardLimit: number) => {
    order.push("budget");
    calls += 1;
    return options.consume ? options.consume(operation, calls) : calls;
  });
  const limitFor = vi.fn((operation: RouteOperation) => operation === "future_directions" ? 200 : 100);
  const dependencies: RecommendationDependencies = {
    now: () => options.now ?? FAR_PAST_NOW,
    limitFor,
    consumeBudget,
    requestProvider,
  };
  return { dependencies, requestProvider, consumeBudget, limitFor, order, maxInFlight: () => maxInFlight };
}

async function run(summary: Summary, overrides: Record<string, unknown>, savedRows: unknown[], options: Parameters<typeof harness>[1] = {}) {
  const request = requestFor(summary, overrides);
  const targets = mealTargets(request);
  const route = prepareStoredRoute(request, summary);
  const h = harness(summary, options);
  const result = await recommendRestaurants({ request, targets, route, savedRows }, h.dependencies);
  return { result, ...h };
}

function ids(candidates: Array<{ savedPlaceId: string }>) {
  return candidates.map((candidate) => candidate.savedPlaceId);
}

// --- Stored route basis -------------------------------------------------------

describe("stored route basis", () => {
  it("accepts the exact stored route and rejects any differing basis as stale", () => {
    const summary = storedSummary();
    expect(prepareStoredRoute(requestFor(summary), summary).pointIds).toEqual(["origin", "occ-w", "destination"]);
    const variants = [
      { departureAt: "2030-01-01T00:01:00.000Z" },
      { returnAt: "2030-01-01T04:00:01.000Z" },
      { pointIds: ["origin", "destination", "occ-w"] },
      { pointIds: ["origin", "destination"] },
      { arrivalAts: ["2030-01-01T02:00:00.000Z", "2030-01-01T04:00:01.000Z"] },
      { arrivalAts: ["2030-01-01T01:59:59.000Z", "2030-01-01T04:00:00.000Z"] },
    ];
    for (const variant of variants) {
      const request = requestFor(summary);
      const changed = { ...request, basis: { ...request.basis, ...variant } };
      expect(() => prepareStoredRoute(changed, summary)).toThrow("RECOMMENDATION_ROUTE_STALE");
    }
  });

  it("rejects a recomputation that changed only an intermediate arrival (dwell) as stale", () => {
    // Same departure, return and point IDs; W now has a 10-minute dwell and leg 0 is 10 minutes faster.
    const before = storedSummary();
    const after = storedSummary([O, { ...W, dwell: 10 }, D], [6600, 7200]);
    expect(after.legs[0].departureAt).toBe(before.legs[0].departureAt);
    expect(after.returnAt).toBe(before.returnAt);
    expect(() => prepareStoredRoute(requestFor(before), after)).toThrow("RECOMMENDATION_ROUTE_STALE");
    expect(() => prepareStoredRoute(requestFor(after), after)).not.toThrow();
  });

  it("compares instants, so an equivalent offset spelling is the same basis", () => {
    const summary = storedSummary();
    const request = requestFor(summary, {
      basis: {
        departureAt: "2030-01-01T09:00:00+09:00", returnAt: "2030-01-01T13:00:00+09:00",
        pointIds: ["origin", "occ-w", "destination"], arrivalAts: ["2030-01-01T11:00:00+09:00", "2030-01-01T13:00:00+09:00"],
      },
    });
    expect(() => prepareStoredRoute(request, summary)).not.toThrow();
  });

  it.each([
    ["missing", null],
    ["other profile", { ...storedSummary(), candidate: { id: "balanced" } }],
    ["broken chain", (() => { const s = storedSummary(); s.legs[1].from.id = "other"; return s; })()],
    ["shared point longitude moved", (() => { const s = storedSummary(); s.legs[1].from.longitude = 127.5001; return s; })()],
    ["shared point latitude moved", (() => { const s = storedSummary(); s.legs[0].to.latitude = 37.0001; return s; })()],
    ["arrival mismatch", (() => { const s = storedSummary(); s.legs[0].arrivalAt = "2030-01-01T02:00:01.000Z"; return s; })()],
    ["return mismatch", (() => { const s = storedSummary(); s.returnAt = "2030-01-01T05:00:00.000Z"; return s; })()],
    ["bad vertex", (() => { const s = storedSummary(); s.legs[0].sections[0].roads[0].vertexes[0] = 200; return s; })()],
  ])("treats a %s stored route as stale", (_name, summary) => {
    const request = requestFor(storedSummary());
    expect(() => prepareStoredRoute(request, summary)).toThrow("RECOMMENDATION_ROUTE_STALE");
  });

  it("enforces the 30-waypoint limit including the requested meals", () => {
    const route = (waypoints: number) => {
      const points: Point[] = [O];
      for (let index = 0; index < waypoints; index += 1) points.push({ id: `w${index}`, longitude: 127 + (index + 1) * 0.01, latitude: 37 });
      points.push({ id: "end", longitude: 127 + (waypoints + 1) * 0.01, latitude: 37 });
      return storedSummary(points, points.slice(1).map(() => 600));
    };
    const twentyNine = route(29);
    expect(() => prepareStoredRoute(requestFor(twentyNine), twentyNine)).not.toThrow();
    const twoMeals = requestFor(twentyNine, {
      mealCount: 2, meals: [{ desiredTime: "10:00", dwellMinutes: 45 }, { desiredTime: "11:00", dwellMinutes: 45 }],
    });
    expect(() => prepareStoredRoute(twoMeals, twentyNine)).toThrow("RECOMMENDATION_WAYPOINT_LIMIT");
    const thirty = route(30);
    expect(() => prepareStoredRoute(requestFor(thirty), thirty)).toThrow("RECOMMENDATION_WAYPOINT_LIMIT");
  });
});

// --- Saved restaurants and pre-screening ---------------------------------------

describe("saved restaurants and pre-screening", () => {
  it("returns NO_SAVED_RESTAURANTS without any budget or provider work", async () => {
    const summary = storedSummary();
    for (const rows of [[], [{ id: "not-a-uuid" }, { ...restaurant(127.75, 37), place: { name: "", longitude: 127, latitude: 37 } }]]) {
      const { result, consumeBudget, requestProvider, limitFor } = await run(summary, {}, rows);
      expect(result.status).toBe("NO_SAVED_RESTAURANTS");
      expect(result.meals).toHaveLength(1);
      expect(result.meals[0]).toMatchObject({ index: 1, targetAt: "2030-01-01T03:00:00.000Z", candidates: [] });
      expect(result.pairs).toEqual([]);
      expect(result.coverage).toEqual({
        savedRestaurants: 0, invalidSaved: rows.length, alreadyInRoute: 0, nearRoute: 0,
        evaluated: 0, unreachable: 0, notEvaluated: 0, providerRequests: 0,
      });
      expect(consumeBudget).not.toHaveBeenCalled();
      expect(requestProvider).not.toHaveBeenCalled();
      expect(limitFor).not.toHaveBeenCalled();
    }
  });

  it("excludes restaurants already on the route (±0.000001°) and far ones without calling the provider", async () => {
    const summary = storedSummary();
    const rows = [
      restaurant(127.5 + 0.000001, 37 - 0.000001), // same as waypoint W
      restaurant(127.0, 37.0), // same as origin
      restaurant(127.75, 37.3), // ~33 km off the road > 60/2 km
      restaurant(127.75, 37.13), // ~14.5 km: within 30 km, so it is computed even though its detour fails
    ];
    const { result, requestProvider } = await run(summary, {}, rows);
    expect(result.coverage).toMatchObject({ savedRestaurants: 4, alreadyInRoute: 2, nearRoute: 1, evaluated: 1, providerRequests: 1 });
    expect(requestProvider).toHaveBeenCalledTimes(1);
    expect(requestProvider.mock.calls[0][0].waypoints[0].id).toBe(rows[3].id);
  });

  it("pre-screens with the fixed 30 km radius (half of the 60-minute cap at 60 km/h)", async () => {
    const summary = storedSummary();
    const kmPerDegreeLatitude = 6371.0088 * Math.PI / 180;
    const inside = restaurant(127.625, 37 + 29.99 / kmPerDegreeLatitude);
    const outside = restaurant(127.65, 37 + 30.01 / kmPerDegreeLatitude);
    const { result, requestProvider } = await run(summary, {}, [inside, outside]);
    expect(result.coverage).toMatchObject({ nearRoute: 1, evaluated: 1, providerRequests: 1 });
    expect(requestProvider.mock.calls.map(([input]) => input.waypoints[0].id)).toEqual([inside.id]);
  });

  it("skips restaurants whose estimated arrival misses the window and legs that cannot reach it", async () => {
    const summary = storedSummary();
    // Target 12:00 Seoul (03:00Z) sits on leg 1; a restaurant passed at 09:24 Seoul is out of range
    // and more than 30 km from leg 1.
    const early = restaurant(127.1, 37.001);
    const onTime = restaurant(127.75, 37.001);
    const { result, requestProvider } = await run(summary, {}, [early, onTime]);
    expect(result.coverage).toMatchObject({ nearRoute: 1, evaluated: 1 });
    expect(requestProvider.mock.calls.map(([input]) => input.waypoints[0].id)).toEqual([onTime.id]);
    expect(requestProvider.mock.calls[0][0].origin.id).toBe("occ-w");
  });
});

// --- Single-meal judgement ------------------------------------------------------

describe("single meal judgement", () => {
  it("includes arrivals exactly at the window edges and rejects one second outside", async () => {
    const summary = storedSummary();
    const atStart = restaurant(127.625, 37.001);
    const beforeStart = restaurant(127.624, 37.001);
    const atEnd = restaurant(127.875, 37.001);
    const afterEnd = restaurant(127.876, 37.001);
    // Leg 1 departs 02:00Z; window is 02:30Z–03:30Z.
    const overrides = {
      [atStart.id]: [1800, 5400], [beforeStart.id]: [1799, 5401],
      [atEnd.id]: [5400, 1800], [afterEnd.id]: [5401, 1799],
    };
    const { result } = await run(summary, {}, [atStart, beforeStart, atEnd, afterEnd], { overrides });
    expect(ids(result.meals[0].candidates).sort()).toEqual([atStart.id, atEnd.id].sort());
    const start = result.meals[0].candidates.find((candidate) => candidate.savedPlaceId === atStart.id)!;
    expect(start.single).toEqual({
      feasible: true, arrivalAt: "2030-01-01T02:30:00.000Z", extraDriveSeconds: 0,
      returnAt: "2030-01-01T04:45:00.000Z", reason: null,
    });
    expect(result.meals[0]).toMatchObject({
      windowStartAt: "2030-01-01T02:30:00.000Z", windowEndAt: "2030-01-01T03:30:00.000Z", dwellMinutes: 45,
    });
  });

  it("includes an extra drive exactly at the limit and rejects one second more", async () => {
    const summary = storedSummary();
    const atLimit = restaurant(127.75, 37.002);
    const overLimit = restaurant(127.751, 37.002);
    // Fixed 60-minute cap: 3600 s is allowed, 3601 s is a DETOUR.
    const overrides = { [atLimit.id]: [3600, 7200], [overLimit.id]: [3600, 7201] };
    const { result } = await run(summary, {}, [atLimit, overLimit], { overrides });
    expect(ids(result.meals[0].candidates)).toEqual([atLimit.id]);
    expect(result.meals[0].candidates[0].single.extraDriveSeconds).toBe(3600);
    expect(result.settings).toEqual({ mealCount: 1, toleranceMinutes: 30, detourLimitMinutes: 60 });
  });

  it("judges ±60 and ±90 minute meal windows inclusively", async () => {
    const summary = storedSummary();
    const at60 = restaurant(127.99, 37.001);
    const past60 = restaurant(127.991, 37.001);
    const sixty = await run(summary, { toleranceMinutes: 60 }, [at60, past60], {
      overrides: { [at60.id]: [7200, 100], [past60.id]: [7201, 100] }, // ETA 04:00:00 / 04:00:01
    });
    expect(sixty.result.meals[0]).toMatchObject({ windowStartAt: "2030-01-01T02:00:00.000Z", windowEndAt: "2030-01-01T04:00:00.000Z" });
    expect(ids(sixty.result.meals[0].candidates)).toEqual([at60.id]);
    expect(sixty.result.settings.toleranceMinutes).toBe(60);

    const startEdge = restaurant(127.375, 37.001); // leg 0, 01:30Z
    const beforeStart = restaurant(127.376, 37.001);
    const endEdge = restaurant(127.95, 37.001); // leg 1
    const afterEnd = restaurant(127.951, 37.001);
    const ninety = await run(summary, { toleranceMinutes: 90 }, [startEdge, beforeStart, endEdge, afterEnd], {
      overrides: {
        [startEdge.id]: [5400, 1800], [beforeStart.id]: [5399, 1801], // ETA 01:30:00 / 01:29:59
        [endEdge.id]: [9000, 1800], [afterEnd.id]: [9001, 1799], // ETA 04:30:00 / 04:30:01, extra 3600
      },
    });
    expect(ninety.result.meals[0]).toMatchObject({ windowStartAt: "2030-01-01T01:30:00.000Z", windowEndAt: "2030-01-01T04:30:00.000Z" });
    expect(ids(ninety.result.meals[0].candidates).sort()).toEqual([startEdge.id, endEdge.id].sort());
  });

  it("sorts by extra drive, then distance from the target, display name and ID; alias is the display name", async () => {
    const summary = storedSummary();
    const far = restaurant(127.75, 37.001, "가 식당");
    const late = restaurant(127.76, 37.001, "나 식당");
    const exact = restaurant(127.74, 37.001, "다 식당", "별명 식당");
    const tieB = restaurant(127.741, 37.001, "라 식당", "하");
    const tieA = restaurant(127.742, 37.001, "마 식당", "가");
    const overrides = {
      [far.id]: [3600, 3900], [late.id]: [4200, 3100], [exact.id]: [3600, 3700],
      [tieB.id]: [3000, 4300], [tieA.id]: [3000, 4300],
    };
    const { result } = await run(summary, {}, [far, late, exact, tieB, tieA], { overrides });
    expect(ids(result.meals[0].candidates)).toEqual([exact.id, tieA.id, late.id, tieB.id, far.id]);
    expect(result.meals[0].candidates[0]).toMatchObject({
      displayName: "별명 식당", placeName: "다 식당", savedPlaceRevision: 3, address: "공개 주소",
      insertion: { legIndex: 1, afterPointId: "occ-w", beforePointId: "destination" },
    });
  });

  it("excludes a stop whose return reaches 24 hours after departure", async () => {
    const summary = storedSummary([O, W, D], [36000, 47100]); // returns 23:05Z
    const atBoundary = restaurant(127.691, 37.001);
    const justUnder = restaurant(127.692, 37.001);
    const overrides = { [atBoundary.id]: [18000, 29700], [justUnder.id]: [18000, 29699] }; // extra 600 / 599
    // 00:00 Seoul on Jan 2 is 15:00Z, the middle of leg 1 (10:00Z–20:00Z).
    const { result } = await run(summary, { meals: [{ desiredTime: "00:00", dwellMinutes: 45 }] }, [atBoundary, justUnder], { overrides });
    expect(result.meals[0].targetAt).toBe("2030-01-01T15:00:00.000Z");
    expect(ids(result.meals[0].candidates)).toEqual([justUnder.id]);
    expect(result.meals[0].candidates[0].single.returnAt).toBe("2030-01-01T23:59:59.000Z");
  });

  it("drops unreachable candidates only and counts them", async () => {
    const summary = storedSummary();
    const noSafeRoute = restaurant(127.75, 37.001);
    const roadNotFound = restaurant(127.751, 37.001);
    const blocked = restaurant(127.752, 37.001);
    const reachable = restaurant(127.753, 37.001);
    const overrides = {
      [noSafeRoute.id]: new Error("SAFE_ROUTE_NOT_FOUND"),
      [roadNotFound.id]: new RouteResponseValidationError("RESULT_CODE_101"),
      [blocked.id]: new RouteResponseValidationError("RESULT_CODE_107"),
    };
    const { result } = await run(summary, {}, [noSafeRoute, roadNotFound, blocked, reachable], { overrides });
    expect(result.status).toBe("OK");
    expect(ids(result.meals[0].candidates)).toEqual([reachable.id]);
    expect(result.coverage).toMatchObject({ nearRoute: 4, evaluated: 4, unreachable: 3, notEvaluated: 0, providerRequests: 4 });
  });

  it("returns an OK empty result when every evaluated candidate fails the conditions", async () => {
    const summary = storedSummary();
    const slow = restaurant(127.75, 37.001);
    const { result } = await run(summary, {}, [slow], { overrides: { [slow.id]: [3600, 9000] } });
    expect(result.status).toBe("OK");
    expect(result.meals[0].candidates).toEqual([]);
    expect(result.coverage).toMatchObject({ evaluated: 1, providerRequests: 1 });
  });
});

// --- Two meals ------------------------------------------------------------------

describe("two meal combinations", () => {
  const twoMeals = (first: string, second: string, firstDwell = 45, secondDwell = 45) => ({
    mealCount: 2,
    meals: [{ desiredTime: first, dwellMinutes: firstDwell }, { desiredTime: second, dwellMinutes: secondDwell }],
  });

  it("delays meal 2 by meal 1 extra drive plus dwell across legs and admits a meal-2 stop only valid in the pair", async () => {
    const summary = storedSummary();
    const a = restaurant(127.1, 37.001);
    const b = restaurant(127.75, 37.001);
    const overrides = { [a.id]: [3600, 4200], [b.id]: [3600, 4200] };
    const { result, requestProvider } = await run(summary, twoMeals("10:00", "13:00"), [a, b], { overrides });
    expect(requestProvider).toHaveBeenCalledTimes(2);
    expect(result.pairs).toEqual([{
      firstSavedPlaceId: a.id, secondSavedPlaceId: b.id,
      firstArrivalAt: "2030-01-01T01:00:00.000Z",
      secondArrivalAt: "2030-01-01T03:55:00.000Z", // 03:00 + 600 s + 45 min
      extraDriveSeconds: 1200,
      returnAt: "2030-01-01T05:50:00.000Z", // 04:00 + 1200 s + 2 × 45 min
    }]);
    expect(ids(result.meals[0].candidates)).toEqual([a.id]);
    expect(result.meals[1].candidates).toHaveLength(1);
    expect(result.meals[1].candidates[0]).toMatchObject({
      savedPlaceId: b.id, single: { feasible: false, reason: "WINDOW", arrivalAt: "2030-01-01T03:00:00.000Z" },
    });
  });

  it("applies the 60-minute cap to the pair total even when each stop is within it", async () => {
    const summary = storedSummary();
    const a = restaurant(127.1, 37.001);
    const b = restaurant(127.75, 37.001);
    // 2000 + 1700 = 3700 > 3600; meal 2 would arrive 02:50 + 2000 s + 45 min = 04:08:20 (in window).
    const overrides = { [a.id]: [3600, 5600], [b.id]: [3000, 5900] };
    const { result } = await run(summary, twoMeals("10:00", "13:00"), [a, b], { overrides });
    expect(result.pairs).toEqual([]);
    expect(ids(result.meals[0].candidates)).toEqual([a.id]);
    expect(result.meals[1].candidates).toEqual([]); // partial result: meal 2 has nothing
  });

  it("includes a pair whose total extra drive is exactly the 60-minute cap", async () => {
    const summary = storedSummary();
    const a = restaurant(127.1, 37.001);
    const b = restaurant(127.75, 37.001);
    const overrides = { [a.id]: [3600, 5600], [b.id]: [3000, 5800] }; // 2000 + 1600 = 3600
    const { result } = await run(summary, twoMeals("10:00", "13:00"), [a, b], { overrides });
    expect(result.pairs).toEqual([{
      firstSavedPlaceId: a.id, secondSavedPlaceId: b.id,
      firstArrivalAt: "2030-01-01T01:00:00.000Z",
      secondArrivalAt: "2030-01-01T04:08:20.000Z",
      extraDriveSeconds: 3600,
      returnAt: "2030-01-01T06:30:00.000Z", // 04:00 + 3600 s + 2 × 45 min
    }]);
    expect(result.meals[1].candidates[0]).toMatchObject({ savedPlaceId: b.id, single: { feasible: false, reason: "WINDOW" } });
  });

  it("keeps both meal lists when each is feasible alone but no pair is", async () => {
    const summary = storedSummary();
    const a = restaurant(127.1, 37.001);
    const b = restaurant(127.75, 37.001);
    const overrides = { [a.id]: [3600, 4200], [b.id]: [3600, 3700] };
    const { result } = await run(summary, twoMeals("10:00", "12:00"), [a, b], { overrides });
    expect(ids(result.meals[0].candidates)).toEqual([a.id]);
    expect(ids(result.meals[1].candidates)).toEqual([b.id]);
    expect(result.meals[1].candidates[0].single.feasible).toBe(true);
    expect(result.pairs).toEqual([]);
  });

  it("computes a same-leg pair with one ordered A→R1→R2→B call and never pairs a restaurant with itself", async () => {
    const summary = storedSummary();
    const a = restaurant(127.625, 37.001);
    const b = restaurant(127.875, 37.001);
    const overrides = {
      [a.id]: [1800, 5500], [b.id]: [5400, 1900],
      [`${a.id}+${b.id}`]: [1800, 3700, 1900],
    };
    const { result, requestProvider } = await run(summary, twoMeals("11:30", "13:30"), [a, b], { overrides });
    const comboCalls = requestProvider.mock.calls.filter(([input]) => input.waypoints.length === 2);
    expect(comboCalls).toHaveLength(1);
    expect(comboCalls[0][0]).toMatchObject({ origin: { id: "occ-w" }, destination: { id: "destination" } });
    expect(comboCalls[0][0].waypoints.map((point) => point.id)).toEqual([a.id, b.id]);
    expect(comboCalls[0][0].departureAt.toISOString()).toBe("2030-01-01T02:00:00.000Z");
    expect(result.pairs).toEqual([{
      firstSavedPlaceId: a.id, secondSavedPlaceId: b.id,
      firstArrivalAt: "2030-01-01T02:30:00.000Z",
      secondArrivalAt: "2030-01-01T04:16:40.000Z", // 02:30 + 45 min + 3700 s
      extraDriveSeconds: 200, // 1800 + 3700 + 1900 − 7200
      returnAt: "2030-01-01T05:33:20.000Z", // 04:00 + 200 s + 90 min
    }]);
    expect(result.pairs.some((pair) => pair.firstSavedPlaceId === pair.secondSavedPlaceId)).toBe(false);
    expect(ids(result.meals[1].candidates)).toEqual([b.id]);
    expect(result.coverage.providerRequests).toBe(3);
  });

  it("does not form pairs that reverse the visiting order across legs", async () => {
    // Leg 1 turns north so the meal-2 stop is only within 30 km of leg 0.
    const north: Point = { id: "destination", longitude: 127.5, latitude: 37.8 };
    const summary = storedSummary([O, W, north], [7200, 7200]);
    const a = restaurant(127.5, 37.4); // on leg 1, passed at 03:00Z
    const b = restaurant(127.45, 37.001); // leg 0 (passed 01:48Z) is its closest leg
    // Paired as if in order, meal 2 would arrive 02:46:40 + 100 s + 45 min = 03:33:20 (inside its window)
    // with 100 + 2900 s of extra driving (within the cap).
    const overrides = { [a.id]: [3600, 3700], [b.id]: [10000, 100] };
    const { result, requestProvider } = await run(
      summary, twoMeals("12:00", "13:00"), [a, b], { overrides },
    );
    expect(requestProvider.mock.calls.map(([input]) => input.origin.id).sort()).toEqual(["occ-w", "origin"]);
    expect(result.meals[1].candidates).toEqual([]);
    expect(result.pairs).toEqual([]);
    expect(ids(result.meals[0].candidates)).toEqual([a.id]);
  });
});

// --- Provider budget, caps, concurrency and failures -----------------------------

describe("provider execution", () => {
  const nearRow = (index: number) => restaurant(127.7 + index * 0.01, 37.001 + index * 0.0001);

  it("evaluates at most six one-meal candidates, four at a time, budgeting before every call", async () => {
    const summary = storedSummary();
    const rows = Array.from({ length: 10 }, (_, index) => nearRow(index));
    const { result, requestProvider, consumeBudget, order, maxInFlight } = await run(summary, {}, rows);
    expect(requestProvider).toHaveBeenCalledTimes(6);
    expect(consumeBudget).toHaveBeenCalledTimes(6);
    expect(maxInFlight()).toBe(4);
    expect(result.coverage).toMatchObject({ nearRoute: 10, evaluated: 6, notEvaluated: 4, providerRequests: 6 });
    // Every provider call is preceded by its own budget receipt.
    let unspentReceipts = 0;
    for (const step of order) {
      if (step === "budget") {
        unspentReceipts += 1;
      } else {
        expect(unspentReceipts).toBeGreaterThan(0);
        unspentReceipts -= 1;
      }
    }
  });

  it("caps a two-meal request at 5 + 5 single and 4 same-leg pair calls", async () => {
    const summary = storedSummary();
    const firsts = Array.from({ length: 6 }, (_, index) => restaurant(127.625 + index * 0.002, 37.03 + index * 0.004));
    const seconds = Array.from({ length: 6 }, (_, index) => restaurant(127.875 + index * 0.002, 37.002 + index * 0.002));
    const { result, requestProvider, consumeBudget } = await run(
      summary, { mealCount: 2, meals: [{ desiredTime: "11:30", dwellMinutes: 45 }, { desiredTime: "13:30", dwellMinutes: 45 }] },
      [...firsts, ...seconds],
    );
    expect(requestProvider).toHaveBeenCalledTimes(14);
    expect(consumeBudget).toHaveBeenCalledTimes(14);
    const combos = requestProvider.mock.calls.filter(([input]) => input.waypoints.length === 2);
    expect(combos).toHaveLength(4);
    const firstIds = new Set(firsts.map((row) => row.id));
    for (const [input] of combos) {
      expect(firstIds.has(input.waypoints[0].id)).toBe(true);
      expect(firstIds.has(input.waypoints[1].id)).toBe(false);
    }
    expect(result.coverage.providerRequests).toBe(14);
  });

  it("selects current or future endpoints per leg departure using the same five-minute rule", async () => {
    const summary = storedSummary();
    const a = restaurant(127.1, 37.001);
    const b = restaurant(127.75, 37.001);
    const overrides = { [a.id]: [3600, 4200], [b.id]: [3600, 4200] };
    // Leg 0 departs exactly 5 minutes after now (current); leg 1 two hours later (future).
    const now = Date.parse(DEPARTURE) - 5 * 60_000;
    const { requestProvider, consumeBudget, limitFor } = await run(
      summary, { mealCount: 2, meals: [{ desiredTime: "10:00", dwellMinutes: 45 }, { desiredTime: "13:00", dwellMinutes: 45 }] },
      [a, b], { overrides, now },
    );
    const byOrigin = Object.fromEntries(requestProvider.mock.calls.map(([input]) => [input.origin.id, input.isFuture]));
    expect(byOrigin).toEqual({ origin: false, "occ-w": true });
    expect(consumeBudget.mock.calls.map(([operation, limit]) => `${operation}:${limit}`).sort())
      .toEqual(["directions:100", "future_directions:200"]);
    expect(limitFor).toHaveBeenCalledTimes(2);
  });

  it("stops starting calls after budget exhaustion and fails the whole request", async () => {
    const summary = storedSummary();
    const rows = Array.from({ length: 6 }, (_, index) => nearRow(index));
    const pending: Array<{ resolve: (value: number) => void; reject: (error: Error) => void }> = [];
    const request = requestFor(summary);
    const h = harness(summary, {
      consume: () => new Promise<number>((resolve, reject) => pending.push({ resolve, reject })),
    });
    const outcome = recommendRestaurants(
      { request, targets: mealTargets(request), route: prepareStoredRoute(request, summary), savedRows: rows },
      h.dependencies,
    ).catch((error: Error) => error);
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    pending[0].reject(new Error("API_DAILY_BUDGET_EXHAUSTED"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    pending.slice(1).forEach((entry, index) => entry.resolve(index + 2));
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("API_DAILY_BUDGET_EXHAUSTED");
    expect(h.consumeBudget).toHaveBeenCalledTimes(4);
    expect(h.requestProvider).not.toHaveBeenCalled();
    expect(recommendationFailure(error)).toMatchObject({ status: 429, code: "RECOMMENDATION_BUDGET_OR_CONFIG" });
  });

  it.each([
    [new Error("PROVIDER_UNAVAILABLE"), 503, "RECOMMENDATION_PROVIDER_TEMPORARY"],
    [new Error("PROVIDER_AUTH_FAILED"), 503, "RECOMMENDATION_BUDGET_OR_CONFIG"],
    [new RouteResponseValidationError("SECTION_DURATION_TOTAL"), 502, "RECOMMENDATION_RESPONSE_INVALID"],
  ])("fails the whole request on a fatal provider error (%s)", async (fatal, status, code) => {
    const summary = storedSummary();
    const rows = Array.from({ length: 6 }, (_, index) => nearRow(index));
    const outcome = await run(summary, {}, rows, { overrides: { [rows[0].id]: fatal } }).catch((error: Error) => error);
    expect(outcome).toBe(fatal);
    expect(recommendationFailure(outcome)).toMatchObject({ status, code });
  });

  it("treats a missing budget configuration as fatal before spending budget", async () => {
    const summary = storedSummary();
    const request = requestFor(summary);
    const h = harness(summary);
    h.limitFor.mockImplementation(() => { throw new Error("API_BUDGET_NOT_CONFIGURED"); });
    const error = await recommendRestaurants(
      { request, targets: mealTargets(request), route: prepareStoredRoute(request, summary), savedRows: [nearRow(0)] },
      h.dependencies,
    ).catch((caught: Error) => caught);
    expect(recommendationFailure(error)).toMatchObject({ status: 503, code: "RECOMMENDATION_BUDGET_OR_CONFIG" });
    expect(h.consumeBudget).not.toHaveBeenCalled();
    expect(h.requestProvider).not.toHaveBeenCalled();
  });

  it("stops a lane whose budget receipt completes right after another lane's fatal provider error is caught", async () => {
    const summary = storedSummary();
    const rows = [restaurant(127.75, 37.001), restaurant(127.76, 37.002)];
    const request = requestFor(summary);
    let releaseSecondReceipt!: (receipt: number) => void;
    let rejectFirstProvider!: (error: Error) => void;
    let firstProviderStarted!: () => void;
    let secondReceiptRequested!: () => void;
    const providerStarted = new Promise<void>((resolve) => { firstProviderStarted = resolve; });
    const receiptRequested = new Promise<void>((resolve) => { secondReceiptRequested = resolve; });
    const consumeBudget = vi.fn((_operation: RouteOperation, _limit: number) => {
      if (consumeBudget.mock.calls.length === 1) return Promise.resolve(1);
      secondReceiptRequested();
      return new Promise<number>((resolve) => { releaseSecondReceipt = resolve; });
    });
    const requestProvider = vi.fn((_input: RouteChunkRequest) => new Promise<NormalizedKakaoRoute>((_resolve, reject) => {
      rejectFirstProvider = reject;
      firstProviderStarted();
    }));
    const outcome = recommendRestaurants(
      { request, targets: mealTargets(request), route: prepareStoredRoute(request, summary), savedRows: rows },
      { now: () => FAR_PAST_NOW, limitFor: () => 200, consumeBudget, requestProvider },
    ).catch((error: Error) => error);
    await Promise.all([providerStarted, receiptRequested]);
    // The second receipt is released synchronously at the moment the runner first
    // inspects the fatal error, i.e. inside the catch that observes it.
    const fatal = new Error("PROVIDER_UNAVAILABLE");
    let inspected = false;
    Object.defineProperty(fatal, "message", {
      get() {
        if (!inspected) {
          inspected = true;
          releaseSecondReceipt(2);
        }
        return "PROVIDER_UNAVAILABLE";
      },
    });
    rejectFirstProvider(fatal);
    expect(await outcome).toBe(fatal);
    expect(inspected).toBe(true);
    expect(consumeBudget).toHaveBeenCalledTimes(2);
    expect(requestProvider).toHaveBeenCalledTimes(1);
  });

  it("runPool never starts a new item after the first failure", async () => {
    const started: number[] = [];
    const error = await runPool([1, 2, 3, 4, 5, 6], 2, async (item) => {
      started.push(item);
      await new Promise((resolve) => setTimeout(resolve, item === 1 ? 1 : 5));
      if (item === 1) throw new Error("fatal");
    }).catch((caught: Error) => caught);
    expect((error as Error).message).toBe("fatal");
    expect(started).toEqual([1, 2]);
  });
});

describe("public error mapping", () => {
  it.each([
    ["INVALID_RECOMMENDATION_REQUEST", 400, "RECOMMENDATION_INPUT_INVALID"],
    ["AUTH_REQUIRED", 401, "AUTH_REQUIRED"],
    ["MEMBERSHIP_REQUIRED", 403, "MEMBERSHIP_REQUIRED"],
    ["RECOMMENDATION_ROUTE_STALE", 409, "RECOMMENDATION_ROUTE_STALE"],
    ["RECOMMENDATION_WAYPOINT_LIMIT", 422, "RECOMMENDATION_WAYPOINT_LIMIT"],
    ["API_DAILY_BUDGET_EXHAUSTED", 429, "RECOMMENDATION_BUDGET_OR_CONFIG"],
    ["PROVIDER_NOT_CONFIGURED", 503, "RECOMMENDATION_BUDGET_OR_CONFIG"],
    ["PROVIDER_RATE_LIMITED", 503, "RECOMMENDATION_PROVIDER_TEMPORARY"],
    ["INVALID_ROUTE_PROVIDER_RESPONSE", 502, "RECOMMENDATION_RESPONSE_INVALID"],
    ["RECOMMENDATION_STORAGE_FAILED", 500, "RECOMMENDATION_FAILED"],
    ["MEAL_DWELL_FIXED", 400, "MEAL_DWELL_FIXED"],
    ["fixture-private-detail 127.1 37.5", 502, "RECOMMENDATION_FAILED"],
  ])("maps %s to %i %s with a fixed Korean message", (message, status, code) => {
    const failure = recommendationFailure(new Error(message));
    expect(failure).toMatchObject({ status, code });
    expect(failure.message).toMatch(/[가-힣]/);
    expect(failure.message).not.toContain("fixture-private-detail");
    expect(failure.message).not.toMatch(/\d+\.\d+/);
  });
});

// --- Shared Android response examples are real outputs of these scenarios ------

describe("shared Android response fixtures", () => {
  const fixedRow = (suffix: string, longitude: number, latitude: number, name: string, alias: string | null = null) => ({
    id: `00000000-0000-4000-8000-0000000a${suffix}`, alias, revision: 2,
    place: {
      kakaoPlaceId: `fixture-${suffix}`, verificationToken: "a".repeat(43), name, address: "공개 시험 주소",
      roadAddress: suffix === "0001" ? "공개 시험 도로명 주소" : null, longitude, latitude,
    },
  });
  const twoMeals = { mealCount: 2, meals: [{ desiredTime: "10:00", dwellMinutes: 45 }, { desiredTime: "13:00", dwellMinutes: 45 }] };
  const first = fixedRow("0003", 127.1, 37.001, "공개 시험 칼국수");
  const second = fixedRow("0004", 127.75, 37.001, "공개 시험 막국수", "저녁 후보");
  const scenarios: Record<string, () => ReturnType<typeof run>> = {
    "ok-one-meal": () => {
      const rows = [
        fixedRow("0001", 127.75, 37.001, "공개 시험 국밥", "단골 국밥"),
        fixedRow("0002", 127.8, 37.002, "공개 시험 분식"),
        fixedRow("0005", 127.5, 37.0, "경로 위 식당"),
        fixedRow("0006", 127.75, 37.3, "먼 식당"),
      ];
      return run(storedSummary(), {}, rows, { overrides: { [rows[0].id]: [3600, 4140], [rows[1].id]: [3960, 3840] } });
    },
    "ok-two-meals-pair": () => run(storedSummary(), twoMeals, [first, second], {
      overrides: { [first.id]: [3600, 4200], [second.id]: [3600, 4200] },
    }),
    "ok-partial": () => run(storedSummary(), twoMeals, [first, second], {
      overrides: { [first.id]: [3600, 5600], [second.id]: [3000, 5900] },
    }),
    "ok-no-result": () => run(storedSummary(), {}, [fixedRow("0007", 127.75, 37.001, "공개 시험 백반")], {
      overrides: { "00000000-0000-4000-8000-0000000a0007": [3600, 9000] },
    }),
    "no-saved-restaurants": () => run(storedSummary(), {}, []),
  };

  it.each(Object.keys(scenarios))("%s matches the published example", async (id) => {
    const { result } = await scenarios[id]();
    const example = (fixture.responses as Array<{ id: string; status: number; body: unknown }>).find((item) => item.id === id);
    expect(example?.status).toBe(200);
    expect(result).toEqual(example?.body);
  });
});

describe("fixed 45-minute meal dwell", () => {
  it("returns the update guidance with a fixed code for an outdated meal dwell", () => {
    expect(recommendationFailure(new Error("MEAL_DWELL_FIXED"))).toEqual({
      status: 400, code: "MEAL_DWELL_FIXED", message: "식사 시간은 45분으로 바뀌었어요. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.",
    });
  });
});

// --- Contract v2: shared folders and avoided places (issue #124 contract §7) ---

describe("contract v2 candidates", () => {
  const FOLDER_A = "aaaaaaaa-0000-4000-8000-000000000001";
  const FOLDER_B = "aaaaaaaa-0000-4000-8000-000000000002";
  const METERS_PER_LATITUDE_DEGREE = 111_195.08;
  const twoMeals = { mealCount: 2, meals: [{ desiredTime: "11:30", dwellMinutes: 45 }, { desiredTime: "13:30", dwellMinutes: 45 }] };

  function sharedRow(folderId: string, longitude: number, latitude: number, kakaoPlaceId?: string) {
    const id = `00000000-0000-4000-a000-${String(++rowNumber).padStart(12, "0")}`;
    return {
      id, folder_id: folderId, alias: null, revision: 5, created_at: "2026-10-09T00:00:00+00:00",
      place: {
        kakaoPlaceId: kakaoPlaceId ?? `kakao-${id}`, verificationToken: "a".repeat(43), name: `공유식당${rowNumber}`,
        address: "공개 주소", roadAddress: null, longitude, latitude,
      },
    };
  }
  const avoidedRow = (kakaoPlaceId: string, longitude: number, latitude: number) => ({
    id: `00000000-0000-4000-b000-${String(++rowNumber).padStart(12, "0")}`,
    place: { kakaoPlaceId, verificationToken: "a".repeat(43), name: "기피", address: "공개 주소", roadAddress: null, longitude, latitude },
  });
  const read = (rows: unknown[], overrides: Record<string, unknown> = {}): SharedRestaurantRead => (
    parseSharedRestaurantRead({ rows, truncated: false, enabledTotal: rows.length, disabledFolders: 0, ...overrides })
  );

  async function runV2(
    overrides: Record<string, unknown>,
    savedRows: unknown[],
    shared: SharedRestaurantRead,
    avoidedRows: unknown[] = [],
    options: Parameters<typeof harness>[1] = {},
  ) {
    const summary = storedSummary();
    const request = requestFor(summary, { ...overrides, contractVersion: 2 });
    const h = harness(summary, options);
    const result = await recommendRestaurantsV2({
      request, targets: mealTargets(request), route: prepareStoredRoute(request, summary),
      savedRows, avoided: parseAvoidedPlaces(avoidedRows), shared,
    }, h.dependencies);
    return { result, ...h };
  }
  const evaluatedIds = (requestProvider: ReturnType<typeof harness>["requestProvider"]) => (
    [...new Set(requestProvider.mock.calls.flatMap(([input]) => input.waypoints.map((point) => point.id)))].sort()
  );

  it("merges mine and enabled shared restaurants by exact kakaoPlaceId: mine first, then the earliest shared row", async () => {
    const mine = restaurant(127.75, 37.001);
    const s1 = sharedRow(FOLDER_A, 127.76, 37.002);
    const sameAsMine = sharedRow(FOLDER_B, 127.7505, 37.0012, mine.place.kakaoPlaceId);
    const sameAsS1 = sharedRow(FOLDER_B, 127.7605, 37.0021, s1.place.kakaoPlaceId);
    const { result, requestProvider } = await runV2({}, [mine], read([s1, sameAsMine, sameAsS1], { disabledFolders: 1 }));

    expect(result.contractVersion).toBe(2);
    expect(result.status).toBe("OK");
    expect(evaluatedIds(requestProvider)).toEqual([mine.id, s1.id].sort());
    const candidates = result.meals[0].candidates;
    expect(candidates.map((candidate) => [candidate.source, candidate.otherFolderIds])).toEqual([
      [{ type: "saved", id: mine.id, revision: 3 }, [FOLDER_B]],
      [{ type: "shared", id: s1.id, revision: 5, folderId: FOLDER_A }, [FOLDER_B]],
    ]);
    expect(Object.keys(candidates[0])).toEqual([
      "source", "displayName", "placeName", "address", "longitude", "latitude", "insertion", "single", "otherFolderIds",
    ]);
    // The representative keeps its own snapshot, not the merged duplicate one.
    expect(candidates[0]).toMatchObject({ longitude: 127.75, latitude: 37.001 });
    expect(result.coverage).toEqual({
      savedRestaurants: 1, invalidSaved: 0, alreadyInRoute: 0, nearRoute: 2, evaluated: 2, unreachable: 0,
      notEvaluated: 0, providerRequests: 2,
      sharedRestaurants: 3, duplicateMerged: 2, avoidedExcluded: 0, disabledFolders: 1, sharedReadTruncated: false,
    });
  });

  it("excludes avoided POIs by exact ID only, and avoided map points by ID or within 30 m", async () => {
    const byId = restaurant(127.75, 37.001);
    const sameSpotOtherPoi = restaurant(127.7, 37.001);
    const inside = sharedRow(FOLDER_A, 127.8, 37.001 + 29 / METERS_PER_LATITUDE_DEGREE);
    const outside = sharedRow(FOLDER_A, 127.85, 37.001 + 31 / METERS_PER_LATITUDE_DEGREE);
    const mapPointById = sharedRow(FOLDER_B, 127.65, 37.005, "map:37.0050000:127.6500000");
    const { result, requestProvider } = await runV2({}, [byId, sameSpotOtherPoi], read([inside, outside, mapPointById]), [
      avoidedRow(byId.place.kakaoPlaceId, 127.0, 33.0),
      avoidedRow("kakao-some-other-poi", 127.7, 37.001),
      avoidedRow("map:37.0010000:127.8000000", 127.8, 37.001),
      avoidedRow("map:37.0010000:127.8500000", 127.85, 37.001),
      avoidedRow("map:37.0050000:127.6500000", 127.0, 33.0),
    ]);
    expect(evaluatedIds(requestProvider)).toEqual([sameSpotOtherPoi.id, outside.id].sort());
    expect(result.coverage).toMatchObject({ savedRestaurants: 2, sharedRestaurants: 3, avoidedExcluded: 3, nearRoute: 2 });
  });

  it("reports ALL_EXCLUDED without any budget or provider work when every read candidate is avoided", async () => {
    const mine = restaurant(127.75, 37.001);
    const shared = sharedRow(FOLDER_A, 127.8, 37.001);
    const { result, requestProvider, consumeBudget, limitFor } = await runV2({}, [mine], read([shared], { enabledTotal: 4 }), [
      avoidedRow(mine.place.kakaoPlaceId, 127.75, 37.001),
      avoidedRow(shared.place.kakaoPlaceId, 127.8, 37.001),
    ]);
    expect(result.status).toBe("ALL_EXCLUDED");
    expect(result.meals[0].candidates).toEqual([]);
    expect(result.pairs).toEqual([]);
    expect(result.coverage).toMatchObject({ avoidedExcluded: 2, nearRoute: 0, providerRequests: 0, sharedReadTruncated: false });
    expect(requestProvider).not.toHaveBeenCalled();
    expect(consumeBudget).not.toHaveBeenCalled();
    expect(limitFor).not.toHaveBeenCalled();
  });

  it("answers OK with no candidates instead of ALL_EXCLUDED when the shared read was truncated", async () => {
    // 2,000 read rows (1,000 per folder) all sit on one avoided map point; more rows exist past the read.
    const rows = Array.from({ length: 2000 }, (_, index) => sharedRow(index < 1000 ? FOLDER_A : FOLDER_B, 127.8, 37.001));
    const { result, requestProvider, consumeBudget } = await runV2({}, [], read(rows, { truncated: true, enabledTotal: 2400 }), [
      avoidedRow("map:37.0010000:127.8000000", 127.8, 37.001),
    ]);
    expect(result.status).toBe("OK");
    expect(result.meals[0].candidates).toEqual([]);
    expect(result.coverage).toMatchObject({ sharedRestaurants: 2000, avoidedExcluded: 2000, providerRequests: 0, sharedReadTruncated: true });
    expect(requestProvider).not.toHaveBeenCalled();
    expect(consumeBudget).not.toHaveBeenCalled();
  });

  it("returns NO_SAVED_RESTAURANTS only when I have no restaurant and enabled folders hold none", async () => {
    const none = await runV2({}, [], read([], { enabledTotal: 0, disabledFolders: 2 }));
    expect(none.result.status).toBe("NO_SAVED_RESTAURANTS");
    expect(none.result.coverage).toMatchObject({ savedRestaurants: 0, sharedRestaurants: 0, disabledFolders: 2, providerRequests: 0 });
    expect(none.consumeBudget).not.toHaveBeenCalled();

    // Enabled folders hold restaurants, but none inside the route box: an ordinary empty OK.
    const far = await runV2({}, [], read([], { enabledTotal: 3 }));
    expect(far.result.status).toBe("OK");
    expect(far.result.coverage).toMatchObject({ nearRoute: 0, providerRequests: 0 });
    expect(far.requestProvider).not.toHaveBeenCalled();
  });

  it("keeps one budgeted runner and the six-call cap over the combined pool", async () => {
    const mine = Array.from({ length: 5 }, (_, index) => restaurant(127.7 + index * 0.01, 37.001 + index * 0.0001));
    const shared = Array.from({ length: 5 }, (_, index) => sharedRow(FOLDER_A, 127.705 + index * 0.01, 37.0012 + index * 0.0001));
    const { result, requestProvider, consumeBudget } = await runV2({}, mine, read(shared));
    expect(requestProvider).toHaveBeenCalledTimes(6);
    expect(consumeBudget).toHaveBeenCalledTimes(6);
    expect(result.coverage).toMatchObject({ nearRoute: 10, evaluated: 6, notEvaluated: 4, providerRequests: 6 });
  });

  it("keeps the 14-call two-meal cap and names pair members by source", async () => {
    const firsts = Array.from({ length: 6 }, (_, index) => (
      index % 2 === 0
        ? restaurant(127.625 + index * 0.002, 37.03 + index * 0.004)
        : sharedRow(FOLDER_A, 127.625 + index * 0.002, 37.03 + index * 0.004)
    ));
    const seconds = Array.from({ length: 6 }, (_, index) => (
      index % 2 === 0
        ? sharedRow(FOLDER_B, 127.875 + index * 0.002, 37.002 + index * 0.002)
        : restaurant(127.875 + index * 0.002, 37.002 + index * 0.002)
    ));
    const mineRows = [...firsts, ...seconds].filter((row) => !("folder_id" in row));
    const sharedRows = [...firsts, ...seconds].filter((row) => "folder_id" in row);
    const { result, requestProvider, consumeBudget } = await runV2(twoMeals, mineRows, read(sharedRows));
    expect(requestProvider).toHaveBeenCalledTimes(14);
    expect(consumeBudget).toHaveBeenCalledTimes(14);
    expect(result.pairs.length).toBeGreaterThan(0);
    const listed = new Set(result.meals.flatMap((meal) => meal.candidates.map((candidate) => JSON.stringify(candidate.source))));
    for (const pair of result.pairs) {
      expect(Object.keys(pair)).toEqual(["first", "second", "firstArrivalAt", "secondArrivalAt", "extraDriveSeconds", "returnAt"]);
      expect(listed.has(JSON.stringify(pair.first))).toBe(true);
      expect(listed.has(JSON.stringify(pair.second))).toBe(true);
    }
  });

  it("stops starting calls after budget exhaustion over the combined pool", async () => {
    const summary = storedSummary();
    const mine = Array.from({ length: 3 }, (_, index) => restaurant(127.7 + index * 0.01, 37.001));
    const shared = Array.from({ length: 3 }, (_, index) => sharedRow(FOLDER_A, 127.705 + index * 0.01, 37.001));
    const request = requestFor(summary, { contractVersion: 2 });
    const pending: Array<{ resolve: (value: number) => void; reject: (error: Error) => void }> = [];
    const h = harness(summary, { consume: () => new Promise<number>((resolve, reject) => pending.push({ resolve, reject })) });
    const outcome = recommendRestaurantsV2({
      request, targets: mealTargets(request), route: prepareStoredRoute(request, summary),
      savedRows: mine, avoided: [], shared: read(shared),
    }, h.dependencies).catch((error: Error) => error);
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    pending[0].reject(new Error("API_DAILY_BUDGET_EXHAUSTED"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    pending.slice(1).forEach((entry, index) => entry.resolve(index + 2));
    expect(((await outcome) as Error).message).toBe("API_DAILY_BUDGET_EXHAUSTED");
    expect(h.consumeBudget).toHaveBeenCalledTimes(4);
    expect(h.requestProvider).not.toHaveBeenCalled();
  });

  it("fails the whole request on a fatal provider error for a shared candidate", async () => {
    const shared = Array.from({ length: 6 }, (_, index) => sharedRow(FOLDER_A, 127.7 + index * 0.01, 37.001 + index * 0.0001));
    const fatal = new Error("PROVIDER_UNAVAILABLE");
    const outcome = await runV2({}, [], read(shared), [], { overrides: { [shared[0].id]: fatal } }).catch((error: Error) => error);
    expect(outcome).toBe(fatal);
  });

  it("v1 also excludes avoided places, keeps its response shape, and counts only the remaining restaurants", async () => {
    const summary = storedSummary();
    const avoidedMine = restaurant(127.75, 37.001);
    const kept = restaurant(127.76, 37.002);
    const request = requestFor(summary);
    const avoided = parseAvoidedPlaces([avoidedRow(avoidedMine.place.kakaoPlaceId, 127.75, 37.001)]);
    const h = harness(summary);
    const result = await recommendRestaurants({
      request, targets: mealTargets(request), route: prepareStoredRoute(request, summary),
      savedRows: [avoidedMine, kept], avoided,
    }, h.dependencies);
    expect(Object.keys(result)).toEqual(["status", "basis", "settings", "meals", "pairs", "coverage"]);
    expect(Object.keys(result.coverage)).toEqual([
      "savedRestaurants", "invalidSaved", "alreadyInRoute", "nearRoute", "evaluated", "unreachable", "notEvaluated", "providerRequests",
    ]);
    expect(Object.keys(result.meals[0].candidates[0])).toEqual([
      "savedPlaceId", "savedPlaceRevision", "displayName", "placeName", "address", "longitude", "latitude", "insertion", "single",
    ]);
    expect(ids(result.meals[0].candidates)).toEqual([kept.id]);
    expect(result.coverage).toMatchObject({ savedRestaurants: 1, nearRoute: 1, providerRequests: 1 });

    const allAvoided = harness(summary);
    const none = await recommendRestaurants({
      request, targets: mealTargets(request), route: prepareStoredRoute(request, summary),
      savedRows: [avoidedMine], avoided,
    }, allAvoided.dependencies);
    expect(none.status).toBe("NO_SAVED_RESTAURANTS");
    expect(none.coverage).toMatchObject({ savedRestaurants: 0, providerRequests: 0 });
    expect(allAvoided.consumeBudget).not.toHaveBeenCalled();
    expect(allAvoided.requestProvider).not.toHaveBeenCalled();
  });

  it("reads shared restaurants inside the whole route widened by the 30 km pre-screen padding", () => {
    const summary = storedSummary();
    const bounds = sharedReadBounds(prepareStoredRoute(requestFor(summary), summary));
    const latitudePad = 30 / 110 + 0.001;
    const longitudePad = 30 / (111.32 * Math.cos(39 * Math.PI / 180)) + 0.001;
    expect(bounds.minLatitude).toBeCloseTo(37 - latitudePad, 9);
    expect(bounds.maxLatitude).toBeCloseTo(37 + latitudePad, 9);
    expect(bounds.minLongitude).toBeCloseTo(127 - longitudePad, 9);
    expect(bounds.maxLongitude).toBeCloseTo(128 + longitudePad, 9);
    // A restaurant 29.9 km off the route still lies inside the read box.
    expect(37 + 29.9 / 111.195).toBeLessThan(bounds.maxLatitude);
  });
});
