import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { KakaoRouteRequest } from "../_shared/kakao-provider";
import { signPlace } from "../_shared/place-verification";

// The fixed 45-minute meal dwell applies only where a client authors a new course.
// A journey reads its course from the owned trip or the immutable share and only
// checks that the request matches it, so older 60-minute meals must keep working.
const auth = vi.hoisted(() => ({
  requireMember: vi.fn(), consumeBudget: vi.fn(), serviceClient: vi.fn(), authenticatedClient: vi.fn(),
}));
const provider = vi.hoisted(() => vi.fn());
vi.mock("../_shared/auth.ts", () => auth);
vi.mock("../_shared/kakao-provider.ts", () => ({ requestKakaoRoute: provider }));

const secret = "fixture-signing-secret-for-unit-tests-only";
const NOW = Date.parse("2030-01-01T00:00:00.000Z");
const LEG_SECONDS = 600;

async function coursePoint(id: string, longitude: number, extra: Record<string, unknown> = {}) {
  const place = { kakaoPlaceId: id, name: `장소 ${id}`, address: "공개 시험 주소", roadAddress: null, longitude, latitude: 37.5 };
  return {
    ...place, id, label: place.name, verificationToken: await signPlace(place, secret),
    kind: "pass-through", dwellMinutes: 0, selected: true, winding: false, ...extra,
  };
}

async function storedCourse(stops: Array<[string, number]>) {
  const points = await Promise.all(stops.map(([stopRole, dwellMinutes], index) => coursePoint(
    `${stopRole}-${index}`, 127.01 + index * 0.01,
    { kind: stopRole === "rest" ? "optional" : "stop", dwellMinutes, stopRole },
  )));
  return { origin: await coursePoint("origin", 127.0), points, destination: await coursePoint("destination", 127.1) };
}

type Course = Awaited<ReturnType<typeof storedCourse>>;

function journeyRequest(course: Course, source: Record<string, unknown>) {
  const ordered = [course.origin, ...course.points, course.destination];
  return {
    schemaVersion: 1, journeyId: crypto.randomUUID(), requestId: crypto.randomUUID(), routeRevision: 0, source,
    course: ordered.map(({ id, longitude, latitude, dwellMinutes }) => ({ id, longitude, latitude, dwellMinutes })),
    position: { longitude: 127.0, latitude: 37.5, accuracyMeters: 10, observedAt: NOW },
    progress: { currentIndex: 0, phase: "ARRIVED", arrivedAt: NOW, skippedIndices: [] },
  };
}

function providerRoute(input: KakaoRouteRequest) {
  const points = [input.origin, ...input.waypoints, input.destination];
  const sections = points.slice(1).map((to, index) => ({
    distance: 100, duration: LEG_SECONDS,
    roads: [{ name: "fixture", distance: 100, duration: LEG_SECONDS, vertexes: [points[index].longitude, points[index].latitude, to.longitude, to.latitude] }],
  }));
  return {
    summary: { distance: 100 * sections.length, duration: LEG_SECONDS * sections.length, origin: points[0], destination: points.at(-1)!, waypoints: points.slice(1, -1) },
    sections,
  };
}

describe("journey-route keeps stored meal dwell compatibility", () => {
  let handler: (request: Request) => Promise<Response>;
  let course: Course;
  const env: Record<string, string> = {
    JOURNEY_WEATHER_ENABLED: "true", PLACE_VERIFICATION_SECRET: secret, KAKAO_REST_API_KEY: "fixture-provider-key",
    KAKAO_FUTURE_DAILY_LIMIT: "100", KAKAO_CURRENT_DAILY_LIMIT: "100",
  };
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const now = vi.spyOn(Date, "now");
  const call = (payload: unknown) => handler(new Request("https://fixture/functions/v1/journey-route", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  }));

  beforeAll(async () => {
    vi.stubGlobal("Deno", { env: { get: (name: string) => env[name] }, serve: (callback: typeof handler) => { handler = callback; } });
    await import("./index");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    now.mockReturnValue(NOW);
    const ownedTrips = {
      select: () => ownedTrips, eq: () => ownedTrips,
      maybeSingle: async () => ({ data: { reusable_course: course }, error: null }),
    };
    auth.requireMember.mockResolvedValue({
      user: { id: "fixture-member" },
      supabase: {
        from: () => ownedTrips,
        rpc: async (name: string) => ({ data: name === "get_shared_course" ? course : null, error: null }),
      },
    });
    auth.consumeBudget.mockResolvedValue(1);
    provider.mockImplementation(async (input: KakaoRouteRequest) => providerRoute(input));
  });
  afterAll(() => { info.mockRestore(); now.mockRestore(); vi.unstubAllGlobals(); });

  it.each([
    ["owned trip", { kind: "owned", tripId: "11111111-1111-4111-8111-111111111111" }, [["meal", 60]]],
    ["immutable share", { kind: "shared", token: "a".repeat(43) }, [["meal", 60]]],
    ["owned trip with legacy lunch and dinner", { kind: "owned", tripId: "11111111-1111-4111-8111-111111111111" }, [["lunch", 60], ["dinner", 90]]],
    ["immutable share with a 45-minute meal and a rest", { kind: "shared", token: "a".repeat(43) }, [["meal", 45], ["rest", 30]]],
  ])("routes a stored %s with its original meal dwell", async (_name, source, stops) => {
    course = await storedCourse(stops as Array<[string, number]>);
    const response = await call(journeyRequest(course, source));
    expect(response.status).toBe(200);
    // Each chunk ends at a stop; the next departs after that stop's stored dwell.
    const departures = provider.mock.calls.map(([input]) => (input as KakaoRouteRequest).departureAt.getTime());
    let expected = NOW;
    const expectedDepartures = [NOW];
    for (const [, dwell] of stops as Array<[string, number]>) {
      expected += LEG_SECONDS * 1000 + dwell * 60_000;
      expectedDepartures.push(expected);
    }
    expect(departures).toEqual(expectedDepartures);
    expect(auth.consumeBudget).toHaveBeenCalledTimes(expectedDepartures.length);
  });

  it("still rejects a request whose meal dwell differs from the stored course", async () => {
    course = await storedCourse([["meal", 60]]);
    const request = journeyRequest(course, { kind: "owned", tripId: "11111111-1111-4111-8111-111111111111" });
    request.course[1].dwellMinutes = 45;
    const response = await call(request);
    expect(response.status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
    expect(auth.consumeBudget).not.toHaveBeenCalled();
  });
});
