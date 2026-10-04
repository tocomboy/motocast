import { describe, expect, it } from "vitest";

import fixtures from "../../contracts/android/restaurant-recommendation/fixtures.json";
import type { SavedPlace } from "../places/saved";
import type { EditableWaypoint } from "./ordered-waypoints";
import {
  applyRecommendedMeals,
  buildRecommendationRequest,
  candidateRows,
  defaultRecommendationInput,
  durationLabel,
  extraDriveLabel,
  extraDriveSpoken,
  isDailyBudgetFailure,
  mealTargetAt,
  parseRecommendationResponse,
  readRecommendationFailure,
  recommendationInputError,
  resolveSelection,
  responseMatchesRequest,
  seoulClock,
  toggleSelection,
  withAnd,
  type RecommendationResponse,
} from "./restaurant-recommendation";

const fixtureBody = (id: string) => structuredClone(fixtures.responses.find((response) => response.id === id)!.body) as unknown as Record<string, unknown>;
const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const tripId = "11111111-1111-4111-8111-111111111111";

type Json = Record<string, unknown>;

// Test-only path access into a cloned JSON body ("meals.0.candidates.0.single").
function at(body: unknown, path: string): Json {
  return (path ? path.split(".") : []).reduce<unknown>((node, key) => (node as Json)[key], body) as Json;
}
function set(body: unknown, path: string, value: unknown) {
  const keys = path.split(".");
  at(body, keys.slice(0, -1).join("."))[keys.at(-1)!] = value;
}

type Spec = { key: string; leg: number; feasible: boolean; extra: number; arrival: string; reason?: string };

// 3-leg route origin → w1 → w2 → destination (or `waypointCount` waypoints),
// departing 00:00Z and returning 10:00Z. Return times follow the server rule:
// base return + extra drive + dwell(s).
const BASE_RETURN_MS = Date.parse("2030-01-01T10:00:00.000Z");
const DWELL = [45, 45];
const returnAfter = (extraSeconds: number, dwellMinutes: number) => new Date(BASE_RETURN_MS + (extraSeconds + dwellMinutes * 60) * 1000).toISOString();

function synthetic({ meals, pairs, waypointCount = 2, revision = 2 }: {
  meals: Spec[][];
  pairs: Array<[string, string, number]>;
  waypointCount?: number;
  revision?: number;
}) {
  const pointIds = ["origin", ...Array.from({ length: waypointCount }, (_, index) => `w${index + 1}`), "destination"];
  const targets = ["2030-01-01T03:00:00.000Z", "2030-01-01T09:00:00.000Z"];
  return {
    status: "OK",
    basis: {
      tripId, departureAt: "2030-01-01T00:00:00.000Z", returnAt: "2030-01-01T10:00:00.000Z", pointIds,
      arrivalAts: pointIds.slice(1).map((_, index) => new Date(Date.parse("2030-01-01T00:00:00.000Z") + (index + 1) * 600 / (pointIds.length) * 60_000).toISOString()),
    },
    // The echoed cap is 30 here (server sends 60) so tests prove the UI reads it.
    settings: { mealCount: meals.length, toleranceMinutes: 30, detourLimitMinutes: 30 },
    meals: meals.map((candidates, index) => ({
      index: index + 1,
      targetAt: targets[index],
      windowStartAt: new Date(new Date(targets[index]).getTime() - 30 * 60_000).toISOString(),
      windowEndAt: new Date(new Date(targets[index]).getTime() + 30 * 60_000).toISOString(),
      dwellMinutes: DWELL[index],
      candidates: candidates.map((spec) => ({
        savedPlaceId: id(spec.key),
        savedPlaceRevision: revision,
        displayName: `식당 ${spec.key}`,
        placeName: `원래 ${spec.key}`,
        address: `주소 ${spec.key}`,
        longitude: 127 + Number.parseInt(spec.key, 16) / 100,
        latitude: 37.5,
        insertion: { legIndex: spec.leg, afterPointId: pointIds[spec.leg], beforePointId: pointIds[spec.leg + 1] },
        single: {
          feasible: spec.feasible,
          arrivalAt: spec.arrival,
          extraDriveSeconds: spec.extra,
          returnAt: returnAfter(spec.extra, DWELL[index]),
          reason: spec.feasible ? null : spec.reason ?? "WINDOW",
        },
      })),
    })),
    pairs: pairs.map(([first, second, extra]) => ({
      firstSavedPlaceId: id(first),
      secondSavedPlaceId: id(second),
      firstArrivalAt: "2030-01-01T03:05:00.000Z",
      secondArrivalAt: "2030-01-01T09:10:00.000Z",
      extraDriveSeconds: extra,
      returnAt: returnAfter(extra, DWELL[0] + DWELL[1]),
    })),
    coverage: { savedRestaurants: 6, invalidSaved: 0, alreadyInRoute: 0, nearRoute: 5, evaluated: 5, unreachable: 0, notEvaluated: 0, providerRequests: 9 },
  };
}

// Meal 1: a (leg 0), b (leg 1), c (leg 1, only with e). Meal 2: d (leg 1), e (leg 2, only with a meal 1 choice).
const rich = () => synthetic({
  meals: [
    [
      { key: "a", leg: 0, feasible: true, extra: 300, arrival: "2030-01-01T03:00:00.000Z" },
      { key: "b", leg: 1, feasible: true, extra: 600, arrival: "2030-01-01T03:10:00.000Z" },
      { key: "c", leg: 1, feasible: false, extra: 2000, arrival: "2030-01-01T03:20:00.000Z", reason: "DETOUR" },
    ],
    [
      { key: "d", leg: 1, feasible: true, extra: 400, arrival: "2030-01-01T09:00:00.000Z" },
      { key: "e", leg: 2, feasible: false, extra: 500, arrival: "2030-01-01T08:00:00.000Z" },
    ],
  ],
  pairs: [["a", "d", 700], ["a", "e", 800], ["b", "d", 1100], ["c", "e", 1700]],
});

function savedPlace(response: RecommendationResponse, key: string, change: Partial<SavedPlace> = {}): SavedPlace {
  const candidate = response.meals.flatMap((meal) => meal.candidates).find((item) => item.savedPlaceId === id(key))!;
  return {
    id: candidate.savedPlaceId,
    place: {
      kakaoPlaceId: `kakao-${key}`,
      verificationToken: "v".repeat(43),
      name: candidate.placeName,
      address: candidate.address,
      roadAddress: null,
      longitude: candidate.longitude,
      latitude: candidate.latitude,
      category: "",
      phone: null,
      placeUrl: null,
    },
    alias: null,
    kind: "restaurant",
    province: null,
    starSlot: null,
    revision: candidate.savedPlaceRevision,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...change,
  };
}

const waypoint = (key: string): EditableWaypoint => ({ id: key, role: "waypoint", dwellMinutes: 0, place: null });

describe("recommendation response parser", () => {
  it.each(fixtures.responses.map((response) => [response.id, response.body] as const))("accepts the contract fixture %s unchanged", (_name, body) => {
    expect(parseRecommendationResponse(structuredClone(body))).toEqual(body);
  });

  it("targets contract 3.x: fixed 60-minute cap, 30/60/90 window and 45-minute meals", () => {
    // Major 3 is the fixed 45-minute meal contract; patch releases keep the wire format.
    expect(fixtures.contractVersion).toMatch(/^3\.\d+\.\d+$/);
    for (const { body } of fixtures.responses) {
      const parsed = parseRecommendationResponse(structuredClone(body));
      expect(parsed.settings.detourLimitMinutes).toBe(60);
      expect([30, 60, 90]).toContain(parsed.settings.toleranceMinutes);
      expect(parsed.meals.every((meal) => meal.dwellMinutes === 45)).toBe(true);
    }
  });

  it("rejects a meal dwell other than the fixed 45 minutes", () => {
    const body = fixtureBody("ok-no-result");
    set(body, "meals.0.dwellMinutes", 60);
    expect(() => parseRecommendationResponse(body)).toThrow();
  });

  it("normalizes offset timestamps to UTC instants", () => {
    const body = fixtureBody("ok-one-meal");
    (body.basis as Record<string, unknown>).departureAt = "2030-01-01T09:00:00+09:00";
    expect(parseRecommendationResponse(body).basis.departureAt).toBe("2030-01-01T00:00:00.000Z");
  });

  const c0 = "meals.0.candidates.0";
  const mutations: Array<[string, (body: Json) => void]> = [
    ["non-object body", () => undefined],
    ["unknown status", (body) => set(body, "status", "PARTIAL")],
    ["invalid trip id", (body) => set(body, "basis.tripId", "trip")],
    ["single point basis", (body) => set(body, "basis.pointIds", ["origin"])],
    ["return before departure", (body) => set(body, "basis.returnAt", "2029-12-31T00:00:00.000Z")],
    ["loose timestamp", (body) => set(body, "meals.0.targetAt", "2030-01-01 03:00")],
    ["meal count mismatch", (body) => set(body, "settings.mealCount", 2)],
    ["meal index out of order", (body) => set(body, "meals.0.index", 2)],
    ["window not target ± tolerance", (body) => set(body, "meals.0.windowEndAt", "2030-01-01T03:31:00.000Z")],
    ["tolerance out of range", (body) => set(body, "settings.toleranceMinutes", 3)],
    ["tolerance not a 30-minute choice", (body) => set(body, "settings.toleranceMinutes", 45)],
    ["insertion not matching basis", (body) => set(body, `${c0}.insertion.afterPointId`, "origin")],
    ["insertion beyond last leg", (body) => set(body, `${c0}.insertion.legIndex`, 2)],
    ["feasible with a reason", (body) => set(body, `${c0}.single.reason`, "WINDOW")],
    ["infeasible without reason or pair", (body) => { set(body, `${c0}.single.feasible`, false); set(body, `${c0}.single.reason`, "WINDOW"); }],
    ["unknown reason", (body) => { set(body, `${c0}.single.feasible`, false); set(body, `${c0}.single.reason`, "CLOSED"); }],
    ["fractional extra drive", (body) => set(body, `${c0}.single.extraDriveSeconds`, 1.5)],
    ["coordinate outside Korea", (body) => set(body, `${c0}.longitude`, 140)],
    ["blank name", (body) => set(body, `${c0}.displayName`, " ")],
    ["missing address", (body) => { delete at(body, c0).address; }],
    ["revision zero", (body) => set(body, `${c0}.savedPlaceRevision`, 0)],
    ["duplicate candidate", (body) => set(body, "meals.0.candidates.1.savedPlaceId", at(body, c0).savedPlaceId)],
    ["pair in a one-meal response", (body) => set(body, "pairs", fixtureBody("ok-two-meals-pair").pairs)],
    ["negative coverage", (body) => set(body, "coverage.nearRoute", -1)],
    ["coverage missing", (body) => { delete body.coverage; }],
  ];

  it.each(mutations)("rejects %s instead of showing a result", (_name, mutate) => {
    const body = fixtureBody("ok-one-meal");
    const value = _name === "non-object body" ? "OK" : body;
    mutate(body);
    expect(() => parseRecommendationResponse(value)).toThrow();
  });

  const d0 = "meals.0.candidates.0.single";
  const verdicts: Array<[string, (body: Json) => void]> = [
    ["feasible arrival outside the window", (body) => set(body, `${d0}.arrivalAt`, "2030-01-01T03:31:00.000Z")],
    ["feasible extra drive over the echoed 60-minute cap", (body) => { set(body, `${d0}.extraDriveSeconds`, 3601); set(body, `${d0}.returnAt`, "2030-01-01T06:00:01.000Z"); }],
    ["return not base + extra + dwell", (body) => set(body, `${d0}.returnAt`, "2030-01-01T05:10:00.000Z")],
    ["reason that is not the violated rule", (body) => { set(body, `${d0}.feasible`, false); set(body, `${d0}.reason`, "DETOUR"); set(body, `${d0}.arrivalAt`, "2030-01-01T04:00:00.000Z"); }],
    ["return-24h reason without a 24h return", (body) => { set(body, `${d0}.feasible`, false); set(body, `${d0}.reason`, "RETURN_24H"); }],
    ["arrival list shorter than the legs", (body) => set(body, "basis.arrivalAts", ["2030-01-01T02:00:00.000Z"])],
    ["arrivals not increasing", (body) => set(body, "basis.arrivalAts", ["2030-01-01T02:00:00.000Z", "2030-01-01T02:00:00.000Z"])],
    ["arrival after the return", (body) => set(body, "basis.arrivalAts", ["2030-01-01T02:00:00.000Z", "2030-01-01T04:00:01.000Z"])],
    ["missing arrival list", (body) => { delete at(body, "basis").arrivalAts; }],
  ];

  it.each(verdicts)("rejects a candidate or basis with %s", (_name, mutate) => {
    const body = fixtureBody("ok-one-meal");
    expect(() => parseRecommendationResponse(structuredClone(body))).not.toThrow();
    mutate(body);
    expect(() => parseRecommendationResponse(body)).toThrow();
  });

  it("judges single verdicts with inclusive window/limit bounds and a strict 24-hour return", () => {
    const one = (arrival: string, extra: number, baseReturn = "2030-01-01T10:00:00.000Z") => {
      const body = synthetic({ meals: [[{ key: "a", leg: 0, feasible: true, extra, arrival }]], pairs: [] });
      set(body, "basis.returnAt", baseReturn);
      set(body, "meals.0.candidates.0.single.returnAt", new Date(Date.parse(baseReturn) + (extra + 45 * 60) * 1000).toISOString());
      return body;
    };
    expect(() => parseRecommendationResponse(one("2030-01-01T03:30:00.000Z", 1800))).not.toThrow();
    expect(() => parseRecommendationResponse(one("2030-01-01T02:30:00.000Z", 1800))).not.toThrow();
    expect(() => parseRecommendationResponse(one("2030-01-01T03:30:01.000Z", 1800))).toThrow();
    expect(() => parseRecommendationResponse(one("2030-01-01T03:30:00.000Z", 1801))).toThrow();
    // Departure 00:00Z with a 45-minute meal: base return 23:14 returns at 23:59, 23:15 at exactly 24h.
    expect(() => parseRecommendationResponse(one("2030-01-01T03:00:00.000Z", 0, "2030-01-01T23:14:00.000Z"))).not.toThrow();
    expect(() => parseRecommendationResponse(one("2030-01-01T03:00:00.000Z", 0, "2030-01-01T23:15:00.000Z"))).toThrow();
    // Listed infeasible candidates (pair members) must carry the first violated rule.
    const response = parseRecommendationResponse(rich());
    expect(response.meals[0].candidates.find((item) => item.savedPlaceId === id("c"))?.single.reason).toBe("DETOUR");
    expect(response.meals[1].candidates.find((item) => item.savedPlaceId === id("e"))?.single.reason).toBe("WINDOW");
    const wrongReason = rich();
    set(wrongReason, "meals.1.candidates.1.single.reason", "DETOUR");
    expect(() => parseRecommendationResponse(wrongReason)).toThrow();
  });

  it.each([
    ["first arrival outside meal 1's window", (pair: Json) => { pair.firstArrivalAt = "2030-01-01T03:31:00.000Z"; }],
    ["second arrival outside meal 2's window", (pair: Json) => { pair.secondArrivalAt = "2030-01-01T08:29:00.000Z"; }],
    ["combined extra drive over the limit", (pair: Json) => { pair.extraDriveSeconds = 1801; pair.returnAt = returnAfter(1801, 90); }],
    ["return not base + extra + both dwells", (pair: Json) => { pair.returnAt = returnAfter(700, 45); }],
    ["same restaurant twice", (pair: Json) => { pair.secondSavedPlaceId = pair.firstSavedPlaceId; }],
  ])("rejects a pair with %s", (_name, mutate) => {
    expect(() => parseRecommendationResponse(rich())).not.toThrow();
    const body = rich();
    mutate(body.pairs[0] as unknown as Json);
    expect(() => parseRecommendationResponse(body)).toThrow();
  });

  it("rejects a pair whose return is 24 hours or more after departure", () => {
    const body = synthetic({
      meals: [[{ key: "a", leg: 0, feasible: true, extra: 0, arrival: "2030-01-01T03:00:00.000Z" }], [{ key: "d", leg: 1, feasible: true, extra: 0, arrival: "2030-01-01T09:00:00.000Z" }]],
      pairs: [["a", "d", 0]],
    });
    expect(() => parseRecommendationResponse(body)).not.toThrow();
    // Base return 22:30: each meal alone returns 23:15, both together exactly 24h.
    const at = (base: string) => {
      const next = structuredClone(body);
      const plus = (minutes: number) => new Date(Date.parse(base) + minutes * 60_000).toISOString();
      set(next, "basis.returnAt", base);
      set(next, "meals.0.candidates.0.single.returnAt", plus(45));
      set(next, "meals.1.candidates.0.single.returnAt", plus(45));
      set(next, "pairs.0.returnAt", plus(90));
      return next;
    };
    expect(() => parseRecommendationResponse(at("2030-01-01T22:29:00.000Z"))).not.toThrow();
    expect(() => parseRecommendationResponse(at("2030-01-01T22:30:00.000Z"))).toThrow();
  });

  it("rejects pairs that are unknown, reversed or duplicated", () => {
    const unknown = fixtureBody("ok-two-meals-pair");
    set(unknown, "pairs.0.secondSavedPlaceId", id("ff"));
    expect(() => parseRecommendationResponse(unknown)).toThrow();
    const reversed = rich();
    reversed.pairs.push({ ...reversed.pairs[0], firstSavedPlaceId: id("b"), secondSavedPlaceId: id("d") });
    expect(() => parseRecommendationResponse(reversed)).toThrow();
    const backwards = synthetic({
      meals: [[{ key: "a", leg: 2, feasible: true, extra: 1, arrival: "2030-01-01T03:00:00.000Z" }], [{ key: "d", leg: 0, feasible: true, extra: 1, arrival: "2030-01-01T09:00:00.000Z" }]],
      pairs: [["a", "d", 2]],
    });
    expect(() => parseRecommendationResponse(backwards)).toThrow();
  });

  it("rejects candidates in a no-saved-restaurants response", () => {
    const body = fixtureBody("no-saved-restaurants");
    set(body, "meals.0.candidates", at(fixtureBody("ok-one-meal"), "meals.0").candidates);
    expect(() => parseRecommendationResponse(body)).toThrow();
    const calls = fixtureBody("no-saved-restaurants");
    set(calls, "coverage.providerRequests", 1);
    expect(() => parseRecommendationResponse(calls)).toThrow();
  });

  it("binds a response to the exact request basis and settings", () => {
    const response = parseRecommendationResponse(fixtureBody("ok-one-meal"));
    const request = {
      tripId,
      basis: {
        departureAt: "2030-01-01T09:00:00+09:00", returnAt: "2030-01-01T04:00:00.000Z", pointIds: ["origin", "occ-w", "destination"],
        arrivalAts: ["2030-01-01T11:00:00+09:00", "2030-01-01T04:00:00.000Z"],
      },
      mealCount: 1 as const,
      meals: [{ desiredTime: "12:00", dwellMinutes: 45 }],
      toleranceMinutes: 30 as const,
    };
    expect(responseMatchesRequest(response, request)).toBe(true);
    expect(responseMatchesRequest(response, { ...request, basis: { ...request.basis, pointIds: ["origin", "destination"] } })).toBe(false);
    expect(responseMatchesRequest(response, { ...request, tripId: "22222222-2222-4222-8222-222222222222" })).toBe(false);
    expect(responseMatchesRequest(response, { ...request, meals: [{ desiredTime: "12:00", dwellMinutes: 60 }] })).toBe(false);
    expect(responseMatchesRequest(response, { ...request, toleranceMinutes: 60 })).toBe(false);
    // Same IDs but a recalculated route whose middle arrival changed.
    expect(responseMatchesRequest(response, { ...request, basis: { ...request.basis, arrivalAts: ["2030-01-01T02:10:00.000Z", "2030-01-01T04:00:00.000Z"] } })).toBe(false);
  });

  it("rejects a response whose meal target or window is not the requested one", () => {
    const request = {
      tripId,
      basis: { departureAt: "2030-01-01T00:00:00.000Z", returnAt: "2030-01-01T04:00:00.000Z", pointIds: ["origin", "occ-w", "destination"], arrivalAts: ["2030-01-01T02:00:00.000Z", "2030-01-01T04:00:00.000Z"] },
      mealCount: 1 as const,
      meals: [{ desiredTime: "12:00", dwellMinutes: 45 }],
      toleranceMinutes: 30 as const,
    };
    const empty = fixtureBody("ok-no-result");
    expect(responseMatchesRequest(parseRecommendationResponse(empty), request)).toBe(true);
    // Another time of day.
    expect(responseMatchesRequest(parseRecommendationResponse(empty), { ...request, meals: [{ desiredTime: "12:30", dwellMinutes: 45 }] })).toBe(false);
    // Same wall-clock time on the next day (window shifted consistently).
    const nextDay = fixtureBody("ok-no-result");
    for (const key of ["targetAt", "windowStartAt", "windowEndAt"]) {
      set(nextDay, `meals.0.${key}`, new Date(Date.parse(at(nextDay, "meals.0")[key] as string) + 24 * 60 * 60_000).toISOString());
    }
    expect(responseMatchesRequest(parseRecommendationResponse(nextDay), request)).toBe(false);
    // Target right but window narrower than the requested tolerance is a format error already.
    const narrow = fixtureBody("ok-no-result");
    set(narrow, "meals.0.windowEndAt", "2030-01-01T03:20:00.000Z");
    expect(() => parseRecommendationResponse(narrow)).toThrow();
  });
});

describe("request building and pre-request checks", () => {
  const route = {
    returnAt: "2030-01-01T04:00:00.000Z",
    segments: [
      { from: { id: "origin-kakao" }, to: { id: "occ-1" }, departureAt: "2030-01-01T00:00:00.000Z", arrivalAt: "2030-01-01T01:30:00.000Z" },
      { from: { id: "occ-1" }, to: { id: "destination-kakao" }, departureAt: "2030-01-01T02:00:00.000Z", arrivalAt: "2030-01-01T04:00:00.000Z" },
    ],
  };

  it("sends the displayed route basis and only the chosen number of meals", () => {
    expect(buildRecommendationRequest(tripId, route, defaultRecommendationInput)).toEqual({
      tripId,
      basis: {
        departureAt: "2030-01-01T00:00:00.000Z", returnAt: "2030-01-01T04:00:00.000Z", pointIds: ["origin-kakao", "occ-1", "destination-kakao"],
        arrivalAts: ["2030-01-01T01:30:00.000Z", "2030-01-01T04:00:00.000Z"],
      },
      mealCount: 1,
      meals: [{ desiredTime: "12:00", dwellMinutes: 45 }],
      toleranceMinutes: 30,
    });
    expect(buildRecommendationRequest(tripId, route, defaultRecommendationInput)).not.toHaveProperty("detourLimitMinutes");
    expect(buildRecommendationRequest(tripId, route, { ...defaultRecommendationInput, mealCount: 2 })?.meals).toEqual([
      { desiredTime: "12:00", dwellMinutes: 45 }, { desiredTime: "18:00", dwellMinutes: 45 },
    ]);
    expect(buildRecommendationRequest(tripId, { ...route, segments: [{ ...route.segments[0], departureAt: undefined }] }, defaultRecommendationInput)).toBeNull();
    expect(buildRecommendationRequest(tripId, { ...route, segments: [route.segments[0], { ...route.segments[1], arrivalAt: undefined }] }, defaultRecommendationInput)).toBeNull();
  });

  it("matches the server target rule: first Seoul time at or after departure − tolerance", () => {
    for (const request of fixtures.requests.filter((item) => "expected" in item && item.expected)) {
      const input = request.input as { basis: { departureAt: string }; meals: Array<{ desiredTime: string }>; toleranceMinutes: number };
      const expected = (request as { expected: { targets: Array<{ targetAt: string }> } }).expected.targets;
      input.meals.forEach((meal, index) => {
        expect(mealTargetAt(input.basis.departureAt, input.toleranceMinutes, meal.desiredTime)?.toISOString()).toBe(expected[index].targetAt);
      });
    }
    // 09:00 KST departure, ±30: 08:30 is still today; 08:29 rolls to tomorrow.
    expect(mealTargetAt("2030-01-01T00:00:00.000Z", 30, "08:30")?.toISOString()).toBe("2029-12-31T23:30:00.000Z");
    expect(mealTargetAt("2030-01-01T00:00:00.000Z", 30, "08:25")?.toISOString()).toBe("2030-01-01T23:25:00.000Z");
  });

  it("blocks a second meal that is not later than the first, and the 30-waypoint limit", () => {
    const departure = "2030-01-01T00:00:00.000Z"; // 09:00 KST
    const two = (first: string, second: string) => ({ ...defaultRecommendationInput, mealCount: 2 as const, meals: [{ desiredTime: first }, { desiredTime: second }] as typeof defaultRecommendationInput.meals });
    expect(recommendationInputError(two("12:00", "18:00"), departure, 0)).toBeNull();
    expect(recommendationInputError(two("12:00", "12:00"), departure, 0)).toBe("식사 2의 원하는 식사 시간은 식사 1보다 늦어야 해요.");
    expect(recommendationInputError(two("12:00", "08:45"), departure, 0)).toBe("식사 2의 원하는 식사 시간은 식사 1보다 늦어야 해요.");
    // 11:00 falls today before 12:00; 08:00 is before departure − 30, so it means tomorrow.
    expect(recommendationInputError(two("12:00", "11:00"), departure, 0)).toBe("식사 2의 원하는 식사 시간은 식사 1보다 늦어야 해요.");
    expect(recommendationInputError(two("12:00", "08:00"), departure, 0)).toBeNull();
    expect(recommendationInputError(defaultRecommendationInput, departure, 29)).toBeNull();
    expect(recommendationInputError(two("12:00", "18:00"), departure, 29)).toBe("경유지가 30개를 넘어 식당을 추가할 수 없어요.");
    expect(recommendationInputError({ ...defaultRecommendationInput, toleranceMinutes: 45 as unknown as 30 }, departure, 0)).toBe("원하는 식사 시간 허용 범위를 골라 주세요.");
    expect(recommendationInputError({ ...defaultRecommendationInput, toleranceMinutes: 90 }, departure, 0)).toBeNull();
  });
});

describe("failure classification", () => {
  const httpError = (status: number, body: unknown) => ({ context: new Response(JSON.stringify(body), { status }) });

  it("reads only allowlisted codes and keeps the HTTP status", async () => {
    await expect(readRecommendationFailure(httpError(409, { code: "RECOMMENDATION_ROUTE_STALE", error: "x" }))).resolves.toEqual({ code: "RECOMMENDATION_ROUTE_STALE", status: 409 });
    await expect(readRecommendationFailure(httpError(500, { code: "PRIVATE_DETAIL" }))).resolves.toEqual({ code: "RECOMMENDATION_FAILED", status: 500 });
    await expect(readRecommendationFailure(new Error("CLIENT_REQUEST_TIMEOUT"))).resolves.toEqual({ code: "CLIENT_REQUEST_TIMEOUT", status: null });
    await expect(readRecommendationFailure({})).resolves.toEqual({ code: "RECOMMENDATION_FAILED", status: null });
  });

  it("treats only the exhausted daily budget (429) as close-first", async () => {
    expect(isDailyBudgetFailure(await readRecommendationFailure(httpError(429, { code: "RECOMMENDATION_BUDGET_OR_CONFIG" })))).toBe(true);
    expect(isDailyBudgetFailure(await readRecommendationFailure(httpError(503, { code: "RECOMMENDATION_BUDGET_OR_CONFIG" })))).toBe(false);
    expect(isDailyBudgetFailure(await readRecommendationFailure(httpError(503, { code: "RECOMMENDATION_PROVIDER_TEMPORARY" })))).toBe(false);
  });
});

describe("candidate selection", () => {
  it("one meal: feasible rows are selectable, toggling clears", () => {
    const response = parseRecommendationResponse(fixtureBody("ok-one-meal"));
    const rows = candidateRows(response, {}, 1);
    expect(rows.map((row) => [row.candidate.displayName, row.selectable, row.reason])).toEqual([["단골 국밥", true, null], ["공개 시험 분식", true, null]]);
    const chosen = toggleSelection(response, {}, 1, rows[1].candidate.savedPlaceId);
    expect(resolveSelection(response, chosen)).toMatchObject({ extraDriveSeconds: 600, returnAt: "2030-01-01T04:55:00.000Z" });
    expect(toggleSelection(response, chosen, 1, rows[1].candidate.savedPlaceId)).toEqual({});
    expect(resolveSelection(response, {})).toBeNull();
  });

  it("two meals: a meal-2 row that needs meal 1 is blocked until a pairing meal-1 row is chosen", () => {
    const response = parseRecommendationResponse(fixtureBody("ok-two-meals-pair"));
    const [evening] = candidateRows(response, {}, 2);
    expect(evening).toMatchObject({ selectable: false, reason: "식사 1 식당을 함께 골라야 가능해요" });
    expect(toggleSelection(response, {}, 2, evening.candidate.savedPlaceId)).toEqual({});
    const lunch = toggleSelection(response, {}, 1, id("a0003"));
    const [paired] = candidateRows(response, lunch, 2);
    expect(paired).toMatchObject({ selectable: true, combined: true, arrivalAt: "2030-01-01T03:55:00.000Z", extraDriveSeconds: 1200 });
    const both = toggleSelection(response, lunch, 2, paired.candidate.savedPlaceId);
    expect(resolveSelection(response, both)).toMatchObject({ extraDriveSeconds: 1200, returnAt: "2030-01-01T05:50:00.000Z" });
    expect(resolveSelection(response, both)?.items.map((item) => [item.mealIndex, item.dwellMinutes])).toEqual([[1, 45], [2, 45]]);
    // Clearing meal 1 leaves a meal-2 choice that is not valid alone.
    const orphan = toggleSelection(response, both, 1, id("a0003"));
    expect(orphan).toEqual({ 2: paired.candidate.savedPlaceId });
    expect(resolveSelection(response, orphan)).toBeNull();
    expect(candidateRows(response, orphan, 2)[0]).toMatchObject({ selected: true, selectable: false });
  });

  it("two meals: rows without a pair for the other choice show why they are blocked, in sorted position", () => {
    const response = parseRecommendationResponse(rich());
    expect(candidateRows(response, {}, 1).map((row) => [row.candidate.displayName, row.selectable, row.reason])).toEqual([
      ["식당 a", true, null], ["식당 b", true, null], ["식당 c", false, "식사 2 식당을 함께 골라야 가능해요"],
    ]);
    const withB = { 1: id("b") };
    expect(candidateRows(response, withB, 2).map((row) => [row.candidate.displayName, row.selectable, row.reason, row.extraDriveSeconds])).toEqual([
      ["식당 d", true, null, 1100], ["식당 e", false, "식사 1과 함께 가면 시간이 맞지 않거나 주행이 30분 넘게 늘어나요", 500],
    ]);
    expect(toggleSelection(response, withB, 2, id("e"))).toEqual(withB);
    const withE = { 2: id("e") };
    expect(candidateRows(response, withE, 1).map((row) => [row.candidate.displayName, row.selectable, row.reason])).toEqual([
      ["식당 a", true, null], ["식당 b", false, "식사 2와 함께 가면 시간이 맞지 않거나 주행이 30분 넘게 늘어나요"], ["식당 c", true, null],
    ]);
    expect(resolveSelection(response, { 1: id("c"), 2: id("e") })?.extraDriveSeconds).toBe(1700);
    expect(resolveSelection(response, { 1: id("b"), 2: id("e") })).toBeNull();
    expect(resolveSelection(response, { 1: id("ff") })).toBeNull();
  });

  it("partial result: the meal with candidates can be chosen alone", () => {
    const response = parseRecommendationResponse(fixtureBody("ok-partial"));
    expect(candidateRows(response, {}, 2)).toEqual([]);
    const lunch = candidateRows(response, {}, 1)[0];
    expect(lunch.selectable).toBe(true);
    expect(resolveSelection(response, { 1: lunch.candidate.savedPlaceId })?.items).toHaveLength(1);
  });

  it("picks 과/와 for meal numbers and quoted names", () => {
    expect(withAnd("식사 1")).toBe("식사 1과");
    expect(withAnd("식사 2")).toBe("식사 2와");
    expect(withAnd("신북 숯불닭갈비")).toBe("신북 숯불닭갈비와");
    expect(withAnd("단골 국밥")).toBe("단골 국밥과");
  });

  it("formats Seoul wall clock and signed extra drive", () => {
    expect(seoulClock("2030-01-01T03:06:00.000Z")).toBe("12:06");
    expect(extraDriveLabel(540)).toBe("주행 +9분");
    expect(extraDriveLabel(1320, true)).toBe("두 곳 합계 주행 +22분");
    // Traffic-model differences can make the detour zero or negative; the sign is kept.
    expect(extraDriveLabel(20)).toBe("주행 ±0분");
    expect(extraDriveLabel(-180)).toBe("주행 −3분");
    expect(extraDriveSpoken(720)).toBe("추가 주행 12분");
    expect(extraDriveSpoken(20)).toBe("추가 주행 0분");
    expect(extraDriveSpoken(-180)).toBe("주행 3분 줄어듦");
    expect(extraDriveSpoken(1320, true)).toBe("두 곳 합계 추가 주행 22분");
    expect(durationLabel(60)).toBe("1시간");
    expect(durationLabel(30)).toBe("30분");
    expect(durationLabel(90)).toBe("1시간 30분");
  });
});

describe("confirming recommended meals", () => {
  let counter = 0;
  const base = (response: RecommendationResponse, selection: Record<number, string>, extra: Partial<Parameters<typeof applyRecommendedMeals>[0]> = {}) => applyRecommendedMeals({
    originId: "origin",
    destinationId: "destination",
    waypoints: [waypoint("w1"), waypoint("w2")],
    savedPlacesReady: true,
    response,
    selection,
    createId: () => `new-${++counter}`,
    ...extra,
    savedPlaces: extra.savedPlaces ?? ["a", "b", "c", "d", "e"].map((key) => savedPlace(response, key)),
  });
  const order = (result: ReturnType<typeof applyRecommendedMeals>) => result.ok ? result.waypoints.map((item) => item.place?.kakaoPlaceId ?? item.id) : result.reason;

  it("inserts after the leg's start point: first leg, different legs, last leg", () => {
    const response = parseRecommendationResponse(rich());
    expect(order(base(response, { 1: id("a") }))).toEqual(["kakao-a", "w1", "w2"]);
    expect(order(base(response, { 2: id("d") }))).toEqual(["w1", "kakao-d", "w2"]);
    expect(order(base(response, { 1: id("a"), 2: id("e") }))).toEqual(["kakao-a", "w1", "w2", "kakao-e"]);
  });

  it("puts meal 1 before meal 2 on the same leg with new meal occurrences", () => {
    const response = parseRecommendationResponse(rich());
    const result = base(response, { 1: id("b"), 2: id("d") });
    expect(order(result)).toEqual(["w1", "kakao-b", "kakao-d", "w2"]);
    if (!result.ok) throw new Error("expected success");
    expect(result.added).toBe(2);
    const [, first, second] = result.waypoints;
    expect(first).toMatchObject({ role: "meal", dwellMinutes: 45, place: savedPlace(response, "b").place });
    expect(second).toMatchObject({ role: "meal", dwellMinutes: 45 });
    expect(new Set(result.waypoints.map((item) => item.id)).size).toBe(4);
    expect(first.id).toMatch(/^new-/);
  });

  it("adds nothing when the current route no longer matches the result", () => {
    const response = parseRecommendationResponse(rich());
    expect(order(base(response, { 2: id("d") }, { waypoints: [waypoint("w2"), waypoint("w1")] }))).toBe("ROUTE_CHANGED");
    expect(order(base(response, { 2: id("d") }, { waypoints: [waypoint("w1")] }))).toBe("ROUTE_CHANGED");
    expect(order(base(response, { 1: id("a") }, { originId: "other-origin" }))).toBe("ROUTE_CHANGED");
  });

  it("adds nothing when a saved restaurant was deleted, edited or moved", () => {
    const response = parseRecommendationResponse(rich());
    const others = ["b", "c", "d", "e"].map((key) => savedPlace(response, key));
    expect(order(base(response, { 1: id("a") }, { savedPlaces: others }))).toBe("SAVED_PLACE_CHANGED");
    expect(order(base(response, { 1: id("a") }, { savedPlaces: [savedPlace(response, "a", { revision: 3 }), ...others] }))).toBe("SAVED_PLACE_CHANGED");
    const moved = savedPlace(response, "a");
    moved.place = { ...moved.place, latitude: 37.6 };
    expect(order(base(response, { 1: id("a") }, { savedPlaces: [moved, ...others] }))).toBe("SAVED_PLACE_CHANGED");
    expect(order(base(response, { 1: id("a") }, { savedPlacesReady: false }))).toBe("SAVED_PLACE_CHANGED");
  });

  it("adds nothing for an invalid selection or beyond the 30-waypoint limit", () => {
    const response = parseRecommendationResponse(rich());
    expect(order(base(response, { 2: id("e") }))).toBe("SELECTION");
    expect(order(base(response, {}))).toBe("SELECTION");
    const crowded = parseRecommendationResponse(synthetic({
      waypointCount: 29,
      meals: [[{ key: "a", leg: 0, feasible: true, extra: 1, arrival: "2030-01-01T03:00:00.000Z" }], [{ key: "d", leg: 29, feasible: true, extra: 1, arrival: "2030-01-01T09:00:00.000Z" }]],
      pairs: [["a", "d", 2]],
    }));
    const points = Array.from({ length: 29 }, (_, index) => waypoint(`w${index + 1}`));
    const places = [savedPlace(crowded, "a"), savedPlace(crowded, "d")];
    expect(order(base(crowded, { 1: id("a") }, { waypoints: points, savedPlaces: places }))).toHaveLength(30);
    expect(order(base(crowded, { 1: id("a"), 2: id("d") }, { waypoints: points, savedPlaces: places }))).toBe("LIMIT");
  });
});
