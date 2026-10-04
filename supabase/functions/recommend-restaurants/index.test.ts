import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireMember: vi.fn(), consumeBudget: vi.fn() }));
vi.mock("../_shared/auth.ts", () => auth);

// --- Stored route fixture: O(127,37) → W(127.5,37) → D(128,37), 2 h per leg -----

type Point = { id: string; longitude: number; latitude: number };
const points: Point[] = [
  { id: "origin-kakao", longitude: 127, latitude: 37 },
  { id: "occurrence-w", longitude: 127.5, latitude: 37 },
  { id: "destination-kakao", longitude: 128, latitude: 37 },
];
const DEPARTURE_MS = Date.parse("2030-01-01T00:00:00.000Z"); // 09:00 Seoul
const LEG_SECONDS = 7200;

function storedSummary(legPoints: Point[] = points, dwells: number[] = []) {
  let cursor = DEPARTURE_MS;
  const stored = (point: Point) => ({
    id: point.id, label: `label-${point.id}`, longitude: point.longitude, latitude: point.latitude,
    kind: "pass-through", dwellMinutes: 0, selected: true, winding: false,
  });
  const legs = legPoints.slice(1).map((to, index) => {
    const from = legPoints[index];
    const dwell = dwells[index + 1] ?? 0;
    const leg = {
      from: { ...stored(from), dwellMinutes: dwells[index] ?? 0 }, to: { ...stored(to), dwellMinutes: dwell }, via: [],
      departureAt: new Date(cursor).toISOString(), arrivalAt: new Date(cursor + LEG_SECONDS * 1000).toISOString(),
      dwellMinutes: dwell, distanceMeters: 1000, durationSeconds: LEG_SECONDS,
      sections: [{ distance: 1000, duration: LEG_SECONDS, roads: [{
        name: "fixture", distance: 1000, duration: LEG_SECONDS,
        vertexes: [from.longitude, from.latitude, (from.longitude + to.longitude) / 2, (from.latitude + to.latitude) / 2, to.longitude, to.latitude],
      }] }],
      providerRequestNumber: 1, forecastTraffic: true,
    };
    cursor += LEG_SECONDS * 1000 + dwell * 60_000;
    return leg;
  });
  return {
    safety: { vehicle: "motorcycle", motorwayExcluded: true, fallbackUsed: false },
    candidate: { id: "recommended", label: "추천 경로", estimatedWinding: false },
    totalDistanceMeters: 1000, totalDurationSeconds: 0, returnAt: new Date(cursor).toISOString(), legs,
  };
}

const TRIP_ID = "11111111-1111-4111-8111-111111111111";
const SECRET_NAME = "fixture-secret-restaurant-name";
const SECRET_ALIAS = "fixture-secret-alias";
const SECRET_LONGITUDE = 127.7512345;
const SECRET_LATITUDE = 37.0012345;

function savedRow(id: string, longitude = SECRET_LONGITUDE, latitude = SECRET_LATITUDE, alias: string | null = SECRET_ALIAS) {
  return {
    id, alias, revision: 4,
    place: {
      kakaoPlaceId: `kakao-${id}`, verificationToken: "a".repeat(43), name: SECRET_NAME, address: "fixture-secret-address",
      roadAddress: null, longitude, latitude,
    },
  };
}
const ROW_ID = "22222222-2222-4222-8222-222222222222";

function basisOf(summary: ReturnType<typeof storedSummary>) {
  return {
    departureAt: summary.legs[0].departureAt,
    returnAt: summary.returnAt,
    pointIds: [summary.legs[0].from.id, ...summary.legs.map((leg) => leg.to.id)],
    arrivalAts: summary.legs.map((leg) => leg.arrivalAt),
  };
}

// Recomputed elsewhere: W gained a 10-minute dwell and leg 0 became 10 minutes faster,
// so departure, return and point IDs are identical but the leg-0 arrival differs.
function recomputedWithDwell() {
  const recomputed = storedSummary(points, [0, 10, 0]);
  const shortened = LEG_SECONDS - 600;
  recomputed.legs[0].arrivalAt = new Date(DEPARTURE_MS + shortened * 1000).toISOString();
  recomputed.legs[0].durationSeconds = shortened;
  recomputed.legs[0].sections[0].duration = shortened;
  recomputed.legs[0].sections[0].roads[0].duration = shortened;
  recomputed.legs[1].departureAt = new Date(DEPARTURE_MS + LEG_SECONDS * 1000).toISOString();
  recomputed.legs[1].arrivalAt = new Date(DEPARTURE_MS + 2 * LEG_SECONDS * 1000).toISOString();
  recomputed.returnAt = recomputed.legs[1].arrivalAt;
  return recomputed;
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    tripId: TRIP_ID,
    basis: basisOf(storedSummary()),
    mealCount: 1,
    meals: [{ desiredTime: "12:00", dwellMinutes: 60 }],
    toleranceMinutes: 30,
    ...overrides,
  };
}

// --- Member JWT client stub (owner RLS reads only) ------------------------------

type Store = { trip: unknown; cache: unknown; saved: unknown[]; savedError?: unknown };
type Query = { table: string; filters: Array<[string, unknown]> };

function memberClient(store: Store, queries: Query[]) {
  return {
    from(table: string) {
      const entry: Query = { table, filters: [] };
      queries.push(entry);
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { entry.filters.push([column, value]); return query; },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: table === "trips" ? store.trip : store.cache, error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({
          data: store.savedError ? null : store.saved, error: store.savedError ?? null,
        }).then(resolve, reject),
      };
      return query;
    },
  };
}

// --- Kakao provider stub: builds a valid response for whatever points were requested

function point(param: string | null) {
  const [longitude, latitude] = String(param).split(",").map(Number);
  return { x: longitude, y: latitude };
}

function kakaoPayload(url: URL, sectionDurations?: number[]) {
  const origin = point(url.searchParams.get("origin"));
  const destination = point(url.searchParams.get("destination"));
  const waypoints = (url.searchParams.get("waypoints") ?? "").split("|").filter(Boolean).map(point);
  const all = [origin, ...waypoints, destination];
  // Linear model: progress along the leg plus 90 s/km of offset from latitude 37.
  const span = destination.x - origin.x;
  const offset = (p: { y: number }) => Math.abs(p.y - 37) * 111.195 * 90;
  const durations = sectionDurations ?? all.slice(1).map((to, index) => Math.round(
    (to.x - all[index].x) / span * LEG_SECONDS + offset(all[index]) + offset(to),
  ));
  const sections = durations.map((duration, index) => ({
    distance: 1000, duration,
    roads: [{ name: "fixture", distance: 1000, duration, vertexes: [all[index].x, all[index].y, all[index + 1].x, all[index + 1].y] }],
  }));
  return {
    trans_id: "fixture",
    routes: [{
      result_code: 0, result_msg: "ok",
      summary: { origin, destination, waypoints, distance: 1000 * sections.length, duration: durations.reduce((a, b) => a + b, 0) },
      sections,
    }],
  };
}

describe("recommend-restaurants handler", () => {
  let handler: (request: Request) => Promise<Response>;
  const fetchMock = vi.fn();
  const env = new Map<string, string>();
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  const infoLog = vi.spyOn(console, "info").mockImplementation(() => {});
  const now = vi.spyOn(Date, "now");
  let store: Store;
  let queries: Query[];

  const call = (payload: unknown, init: { method?: string; origin?: string; raw?: string } = {}) => handler(new Request(
    "https://fixture/functions/v1/recommend-restaurants",
    {
      method: init.method ?? "POST",
      headers: { "content-type": "application/json", ...(init.origin ? { origin: init.origin } : {}) },
      ...(init.method === "GET" || init.method === "OPTIONS" ? {} : { body: init.raw ?? JSON.stringify(payload) }),
    },
  ));
  const logs = () => JSON.stringify([errorLog.mock.calls, infoLog.mock.calls]);
  const expectNoProviderWork = () => {
    expect(auth.consumeBudget).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  };

  beforeAll(async () => {
    vi.stubGlobal("Deno", { env: { get: (key: string) => env.get(key) }, serve: (fn: typeof handler) => { handler = fn; } });
    vi.stubGlobal("fetch", fetchMock);
    await import("./index");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    env.clear();
    env.set("KAKAO_REST_API_KEY", "fixture-provider-key");
    env.set("KAKAO_FUTURE_DAILY_LIMIT", "200");
    env.set("KAKAO_CURRENT_DAILY_LIMIT", "100");
    now.mockReturnValue(Date.parse("2029-12-31T00:00:00.000Z"));
    store = { trip: { id: TRIP_ID }, cache: { summary: storedSummary() }, saved: [savedRow(ROW_ID)] };
    queries = [];
    auth.requireMember.mockImplementation(async () => ({ supabase: memberClient(store, queries), user: { id: "fixture-member" } }));
    let receipt = 0;
    auth.consumeBudget.mockImplementation(async () => ++receipt);
    fetchMock.mockImplementation(async (url: URL) => new Response(JSON.stringify(kakaoPayload(url))));
  });
  afterAll(() => {
    errorLog.mockRestore(); infoLog.mockRestore(); now.mockRestore(); vi.unstubAllGlobals();
  });

  it("recommends a saved restaurant through one budgeted motorcycle-policy future call", async () => {
    const response = await call(body());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe("OK");
    expect(result.settings).toEqual({ mealCount: 1, toleranceMinutes: 30, detourLimitMinutes: 60 });
    expect(result.meals[0].candidates).toHaveLength(1);
    expect(result.meals[0].candidates[0]).toMatchObject({
      savedPlaceId: ROW_ID, savedPlaceRevision: 4, displayName: SECRET_ALIAS, placeName: SECRET_NAME,
      insertion: { legIndex: 1, afterPointId: "occurrence-w", beforePointId: "destination-kakao" },
      single: { feasible: true, reason: null },
    });
    expect(result.coverage).toMatchObject({ savedRestaurants: 1, nearRoute: 1, evaluated: 1, providerRequests: 1 });

    expect(auth.consumeBudget).toHaveBeenCalledExactlyOnceWith("fixture-member", "kakao", "future_directions", 200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(auth.consumeBudget.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe("https://apis-navi.kakaomobility.com/v1/future/directions");
    expect(url.searchParams.get("car_type")).toBe("7");
    expect(url.searchParams.get("avoid")).toBe("motorway");
    expect(url.searchParams.get("priority")).toBe("RECOMMEND");
    expect(url.searchParams.has("alternatives")).toBe(false);
    expect(url.searchParams.get("departure_time")).toBe("203001011100"); // leg 1 departs 11:00 Seoul
    expect(url.searchParams.get("origin")).toMatch(/^127\.5,37,/);
    expect(url.searchParams.get("waypoints")).toMatch(/^127\.7512345,37\.0012345,/);
    expect(url.searchParams.get("destination")).toMatch(/^128,37,/);
    expect((init.headers as Record<string, string>).Authorization).toBe("KakaoAK fixture-provider-key");

    expect(queries.find((query) => query.table === "route_cache")?.filters).toEqual([["trip_id", TRIP_ID], ["profile", "recommended"]]);
    expect(queries.find((query) => query.table === "saved_places")?.filters).toEqual([["owner_id", "fixture-member"], ["kind", "restaurant"]]);
    expect(infoLog).toHaveBeenCalledTimes(1);
    expect(logs()).not.toMatch(/fixture-secret|127\.75|37\.001|fixture-provider-key/);
  });

  it("uses the current endpoint and budget when the leg departs within five minutes", async () => {
    now.mockReturnValue(DEPARTURE_MS + LEG_SECONDS * 1000 - 4 * 60_000);
    const response = await call(body());
    expect(response.status).toBe(200);
    expect(auth.consumeBudget).toHaveBeenCalledExactlyOnceWith("fixture-member", "kakao", "directions", 100);
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.pathname).toBe("/v1/directions");
    expect(url.searchParams.has("departure_time")).toBe(false);
  });

  it.each([
    ["extra key", body({ limit: 6 })],
    ["meal mismatch", body({ mealCount: 2 })],
    ["unsupported tolerance", body({ toleranceMinutes: 45 })],
    ["a client detour limit (removed in contract 2.0.0)", body({ detourLimitMinutes: 60 })],
  ])("rejects %s before any storage, budget or provider work", async (_name, payload) => {
    const response = await call(payload);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "추천 조건을 확인해 주세요.", code: "RECOMMENDATION_INPUT_INVALID" });
    expect(queries).toEqual([]);
    expectNoProviderWork();
  });

  it("rejects a malformed JSON body as invalid input", async () => {
    const response = await call(null, { raw: "{not json" });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("RECOMMENDATION_INPUT_INVALID");
    expectNoProviderWork();
  });

  it.each([
    ["changed basis", () => body({ basis: { ...body().basis, pointIds: ["origin-kakao", "destination-kakao", "occurrence-w"] } })],
    ["no stored route", () => { store.cache = null; return body(); }],
    ["no owned trip", () => { store.trip = null; return body(); }],
    ["malformed stored route", () => { store.cache = { summary: { candidate: { id: "recommended" }, legs: "x" } }; return body(); }],
    ["intermediate arrival changed with the same departure, return and IDs", () => {
      const recomputed = recomputedWithDwell();
      expect(basisOf(recomputed)).toMatchObject({ departureAt: body().basis.departureAt, returnAt: body().basis.returnAt, pointIds: body().basis.pointIds });
      store.cache = { summary: recomputed };
      return body();
    }],
    ["shared point coordinates moved", () => {
      const moved = storedSummary();
      moved.legs[1].from.longitude = 127.5001;
      store.cache = { summary: moved };
      return body();
    }],
  ])("returns 409 stale for %s with zero provider calls", async (_name, prepare) => {
    const response = await call(prepare());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("RECOMMENDATION_ROUTE_STALE");
    expectNoProviderWork();
  });

  it("accepts the recomputed route once the screen sends its new arrivals, echoing them in UTC", async () => {
    const recomputed = recomputedWithDwell();
    store.cache = { summary: recomputed };
    const response = await call(body({ basis: basisOf(recomputed) }));
    expect(response.status).toBe(200);
    expect((await response.json()).basis.arrivalAts).toEqual(["2030-01-01T01:50:00.000Z", "2030-01-01T04:00:00.000Z"]);
  });

  it("rejects more than 30 waypoints with zero provider calls", async () => {
    const many: Point[] = [points[0]];
    for (let index = 1; index <= 29; index += 1) many.push({ id: `w${index}`, longitude: 127 + index * 0.01, latitude: 37 });
    many.push({ id: "end", longitude: 127.5, latitude: 37 });
    const summary = storedSummary(many);
    store.cache = { summary };
    const response = await call(body({
      basis: basisOf(summary),
      mealCount: 2, meals: [{ desiredTime: "10:00", dwellMinutes: 60 }, { desiredTime: "18:00", dwellMinutes: 60 }],
    }));
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("RECOMMENDATION_WAYPOINT_LIMIT");
    expectNoProviderWork();
  });

  it("returns NO_SAVED_RESTAURANTS without budget or provider work, even before provider configuration", async () => {
    store.saved = [];
    env.delete("KAKAO_REST_API_KEY");
    const response = await call(body());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe("NO_SAVED_RESTAURANTS");
    expect(result.meals[0].candidates).toEqual([]);
    expect(result.coverage.providerRequests).toBe(0);
    expectNoProviderWork();
  });

  it("fails with 429 when the daily budget is exhausted and makes no provider call", async () => {
    auth.consumeBudget.mockRejectedValue(new Error("API_DAILY_BUDGET_EXHAUSTED fixture-private-db-detail"));
    const response = await call(body());
    expect(response.status).toBe(429);
    const result = await response.json();
    expect(result).toEqual({ error: "오늘의 무료 API 사용 한도를 모두 사용했습니다.", code: "RECOMMENDATION_BUDGET_OR_CONFIG" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledExactlyOnceWith("recommend-restaurants failed", "RECOMMENDATION_BUDGET_OR_CONFIG", "UNKNOWN");
    expect(logs()).not.toContain("fixture-private-db-detail");
  });

  it("fails with 503 before spending budget when the provider key is missing", async () => {
    env.delete("KAKAO_REST_API_KEY");
    const response = await call(body());
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("RECOMMENDATION_BUDGET_OR_CONFIG");
    expectNoProviderWork();
  });

  it.each([
    ["temporary outage", () => new Response("fixture-private-provider-body", { status: 503 }), 503, "RECOMMENDATION_PROVIDER_TEMPORARY", "UNKNOWN"],
    ["auth failure", () => new Response("fixture-private-provider-body", { status: 401 }), 503, "RECOMMENDATION_BUDGET_OR_CONFIG", "UNKNOWN"],
    ["malformed response", () => new Response(JSON.stringify({ routes: [{ result_code: "fixture-private-provider-body" }] })), 502, "RECOMMENDATION_RESPONSE_INVALID", "RESULT_CODE_SHAPE"],
  ])("fails the whole request on provider %s without leaking details", async (_name, reply, status, code, reason) => {
    fetchMock.mockImplementation(async () => reply());
    const response = await call(body());
    expect(response.status).toBe(status);
    const result = await response.json();
    expect(Object.keys(result).sort()).toEqual(["code", "error"]);
    expect(result.code).toBe(code);
    expect(errorLog).toHaveBeenCalledExactlyOnceWith("recommend-restaurants failed", code, reason);
    expect(JSON.stringify(result) + logs()).not.toMatch(/fixture-private|fixture-secret|127\.75/);
    expect(auth.consumeBudget).toHaveBeenCalledTimes(1);
  });

  it("drops a candidate whose point the provider cannot reach and still answers 200", async () => {
    const other = "33333333-3333-4333-8333-333333333333";
    store.saved = [savedRow(ROW_ID), savedRow(other, 127.76, 37.001, null)];
    fetchMock.mockImplementation(async (url: URL) => (
      url.searchParams.get("waypoints")?.startsWith("127.7512345")
        ? new Response(JSON.stringify({ routes: [{ result_code: 101, result_msg: "fixture-private-provider-body" }] }))
        : new Response(JSON.stringify(kakaoPayload(url)))
    ));
    const response = await call(body());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.meals[0].candidates.map((candidate: { savedPlaceId: string }) => candidate.savedPlaceId)).toEqual([other]);
    expect(result.coverage).toMatchObject({ evaluated: 2, unreachable: 1, providerRequests: 2 });
    expect(auth.consumeBudget).toHaveBeenCalledTimes(2);
    expect(logs()).not.toMatch(/fixture-private|fixture-secret/);
  });

  it("reports storage read failures as RECOMMENDATION_FAILED", async () => {
    store.savedError = { message: "fixture-private-db-detail" };
    const response = await call(body());
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("RECOMMENDATION_FAILED");
    expect(logs()).not.toContain("fixture-private-db-detail");
    expectNoProviderWork();
  });

  it.each([
    ["AUTH_REQUIRED", 401],
    ["MEMBERSHIP_REQUIRED", 403],
  ])("keeps the member boundary for %s", async (code, status) => {
    auth.requireMember.mockRejectedValue(new Error(code));
    const response = await call(body());
    expect(response.status).toBe(status);
    expect((await response.json()).code).toBe(code);
    expectNoProviderWork();
  });

  it("enforces origin, preflight and method rules before membership", async () => {
    expect((await call(body(), { origin: "https://foreign.invalid" })).status).toBe(403);
    expect((await call(null, { method: "OPTIONS", origin: "http://localhost:3000" })).status).toBe(204);
    expect((await call(null, { method: "GET" })).status).toBe(405);
    expect(auth.requireMember).not.toHaveBeenCalled();
  });
});
