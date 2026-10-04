import { describe, expect, it, vi } from "vitest";

import fixture from "../../../contracts/android/restaurant-recommendation/fixtures.json";
import { RouteResponseValidationError, type NormalizedKakaoRoute } from "./kakao-route";
import { mealTargets, parseRecommendationRequest } from "./restaurant-recommendation-request";
import {
  prepareStoredRoute,
  recommendationFailure,
  recommendRestaurants,
  runPool,
  type RecommendationDependencies,
} from "./restaurant-recommendation";
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
    meals: [{ desiredTime: "12:00", dwellMinutes: 60 }],
    toleranceMinutes: 30,
    detourLimitMinutes: 30,
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
      mealCount: 2, meals: [{ desiredTime: "10:00", dwellMinutes: 60 }, { desiredTime: "11:00", dwellMinutes: 60 }],
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
      restaurant(127.75, 37.2), // ~22 km off the road > 30/2 km
      restaurant(127.75, 37.13), // ~14.5 km: within 15 km, estimated round trip too long is still allowed to compute
    ];
    const { result, requestProvider } = await run(summary, {}, rows);
    expect(result.coverage).toMatchObject({ savedRestaurants: 4, alreadyInRoute: 2, nearRoute: 1, evaluated: 1, providerRequests: 1 });
    expect(requestProvider).toHaveBeenCalledTimes(1);
    expect(requestProvider.mock.calls[0][0].waypoints[0].id).toBe(rows[3].id);
  });

  it("skips restaurants whose estimated arrival misses the window and legs that cannot reach it", async () => {
    const summary = storedSummary();
    // Target 12:00 Seoul (03:00Z) sits on leg 1; a restaurant passed at 10:00 Seoul is out of range.
    const early = restaurant(127.25, 37.001);
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
      returnAt: "2030-01-01T05:00:00.000Z", reason: null,
    });
    expect(result.meals[0]).toMatchObject({
      windowStartAt: "2030-01-01T02:30:00.000Z", windowEndAt: "2030-01-01T03:30:00.000Z", dwellMinutes: 60,
    });
  });

  it("includes an extra drive exactly at the limit and rejects one second more", async () => {
    const summary = storedSummary();
    const atLimit = restaurant(127.75, 37.002);
    const overLimit = restaurant(127.751, 37.002);
    const overrides = { [atLimit.id]: [3600, 5400], [overLimit.id]: [3600, 5401] };
    const { result } = await run(summary, {}, [atLimit, overLimit], { overrides });
    expect(ids(result.meals[0].candidates)).toEqual([atLimit.id]);
    expect(result.meals[0].candidates[0].single.extraDriveSeconds).toBe(1800);
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
    const summary = storedSummary([O, W, D], [36000, 36000]); // returns 20:00Z
    const atBoundary = restaurant(127.75, 37.001);
    const justUnder = restaurant(127.751, 37.001);
    const overrides = { [atBoundary.id]: [18000, 18600], [justUnder.id]: [18000, 18599] };
    // 00:00 Seoul on Jan 2 is 15:00Z, the middle of leg 1 (10:00Z–20:00Z).
    const { result } = await run(summary, { meals: [{ desiredTime: "00:00", dwellMinutes: 230 }] }, [atBoundary, justUnder], { overrides });
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
  const twoMeals = (first: string, second: string, firstDwell = 60, secondDwell = 60) => ({
    mealCount: 2,
    meals: [{ desiredTime: first, dwellMinutes: firstDwell }, { desiredTime: second, dwellMinutes: secondDwell }],
  });

  it("delays meal 2 by meal 1 extra drive plus dwell across legs and admits a meal-2 stop only valid in the pair", async () => {
    const summary = storedSummary();
    const a = restaurant(127.25, 37.001);
    const b = restaurant(127.75, 37.001);
    const overrides = { [a.id]: [3600, 4200], [b.id]: [3600, 4200] };
    const { result, requestProvider } = await run(summary, twoMeals("10:00", "13:00"), [a, b], { overrides });
    expect(requestProvider).toHaveBeenCalledTimes(2);
    expect(result.pairs).toEqual([{
      firstSavedPlaceId: a.id, secondSavedPlaceId: b.id,
      firstArrivalAt: "2030-01-01T01:00:00.000Z",
      secondArrivalAt: "2030-01-01T04:10:00.000Z", // 03:00 + 600 s + 60 min
      extraDriveSeconds: 1200,
      returnAt: "2030-01-01T06:20:00.000Z", // 04:00 + 1200 s + 2 × 60 min
    }]);
    expect(ids(result.meals[0].candidates)).toEqual([a.id]);
    expect(result.meals[1].candidates).toHaveLength(1);
    expect(result.meals[1].candidates[0]).toMatchObject({
      savedPlaceId: b.id, single: { feasible: false, reason: "WINDOW", arrivalAt: "2030-01-01T03:00:00.000Z" },
    });
  });

  it("applies the detour limit to the pair total even when each stop is within it", async () => {
    const summary = storedSummary();
    const a = restaurant(127.25, 37.001);
    const b = restaurant(127.75, 37.001);
    const overrides = { [a.id]: [3600, 4600], [b.id]: [3600, 4500] }; // 1000 + 900 > 1800
    const { result } = await run(summary, twoMeals("10:00", "13:00"), [a, b], { overrides });
    expect(result.pairs).toEqual([]);
    expect(ids(result.meals[0].candidates)).toEqual([a.id]);
    expect(result.meals[1].candidates).toEqual([]); // partial result: meal 2 has nothing
  });

  it("keeps both meal lists when each is feasible alone but no pair is", async () => {
    const summary = storedSummary();
    const a = restaurant(127.25, 37.001);
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
      secondArrivalAt: "2030-01-01T04:31:40.000Z", // 02:30 + 60 min + 3700 s
      extraDriveSeconds: 200, // 1800 + 3700 + 1900 − 7200
      returnAt: "2030-01-01T06:03:20.000Z", // 04:00 + 200 s + 120 min
    }]);
    expect(result.pairs.some((pair) => pair.firstSavedPlaceId === pair.secondSavedPlaceId)).toBe(false);
    expect(ids(result.meals[1].candidates)).toEqual([b.id]);
    expect(result.coverage.providerRequests).toBe(3);
  });

  it("does not form pairs that reverse the visiting order across legs", async () => {
    // Leg 1 bends back north-west so the meal-2 stop is only near leg 0.
    const bent: Point = { id: "destination", longitude: 127.0, latitude: 37.5 };
    const summary = storedSummary([O, W, bent], [7200, 7200]);
    const a = restaurant(127.25, 37.25); // on leg 1 (lon+lat = 164.5)
    const b = restaurant(127.3, 37.01); // only near leg 0
    const overrides = { [a.id]: [3600, 3700], [b.id]: [4320, 2980] };
    const { result, requestProvider } = await run(
      summary, { ...twoMeals("12:00", "13:00", 170), detourLimitMinutes: 10 }, [a, b], { overrides },
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
      summary, { mealCount: 2, meals: [{ desiredTime: "11:30", dwellMinutes: 60 }, { desiredTime: "13:30", dwellMinutes: 60 }] },
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
    const a = restaurant(127.25, 37.001);
    const b = restaurant(127.75, 37.001);
    const overrides = { [a.id]: [3600, 4200], [b.id]: [3600, 4200] };
    // Leg 0 departs exactly 5 minutes after now (current); leg 1 two hours later (future).
    const now = Date.parse(DEPARTURE) - 5 * 60_000;
    const { requestProvider, consumeBudget, limitFor } = await run(
      summary, { mealCount: 2, meals: [{ desiredTime: "10:00", dwellMinutes: 60 }, { desiredTime: "13:00", dwellMinutes: 60 }] },
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
  const twoMeals = { mealCount: 2, meals: [{ desiredTime: "10:00", dwellMinutes: 60 }, { desiredTime: "13:00", dwellMinutes: 60 }] };
  const first = fixedRow("0003", 127.25, 37.001, "공개 시험 칼국수");
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
      overrides: { [first.id]: [3600, 4600], [second.id]: [3600, 4500] },
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
