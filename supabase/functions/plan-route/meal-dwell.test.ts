import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { signPlace } from "../_shared/place-verification";

// Real request validation and error mapping; only membership, budget, storage and
// route orchestration (the provider boundary) are observed.
const auth = vi.hoisted(() => ({ requireMember: vi.fn(), consumeBudget: vi.fn(), serviceClient: vi.fn() }));
const orchestration = vi.hoisted(() => vi.fn());
vi.mock("../_shared/auth.ts", () => auth);
vi.mock("../_shared/route-orchestration.ts", () => ({ orchestrateRecommendedRoute: orchestration }));

const secret = "fixture-signing-secret-for-unit-tests-only";
const MESSAGE = "식사 시간은 45분으로 바뀌었어요. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.";

async function point(id: string, longitude: number, extra: Record<string, unknown> = {}) {
  const place = { kakaoPlaceId: id, name: `장소 ${id}`, address: "공개 시험 주소", roadAddress: null, longitude, latitude: 37.5 };
  return {
    ...place, id, label: place.name, verificationToken: await signPlace(place, secret),
    kind: "pass-through", dwellMinutes: 0, selected: true, winding: false, ...extra,
  };
}

async function body(waypoints: unknown[]) {
  return {
    planningId: "123e4567-e89b-42d3-a456-426614174000",
    tripId: null,
    origin: await point("origin", 127.0),
    destination: await point("destination", 127.2),
    waypoints,
    serviceDate: "2030-01-01",
    departureAt: "2030-01-01T09:00:00+09:00",
  };
}

const stop = (stopRole: string, dwellMinutes: number) => point(`${stopRole}-1`, 127.1, { kind: "stop", dwellMinutes, stopRole });

describe("plan-route fixed 45-minute meal dwell", () => {
  let handler: (request: Request) => Promise<Response>;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const call = async (waypoints: unknown[]) => handler(new Request("https://fixture/functions/v1/plan-route", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await body(waypoints)),
  }));

  beforeAll(async () => {
    vi.stubGlobal("Deno", {
      env: { get: (name: string) => name === "PLACE_VERIFICATION_SECRET" ? secret : name.endsWith("DAILY_LIMIT") ? "100" : "fixture-provider-key" },
      serve: (callback: typeof handler) => { handler = callback; },
    });
    await import("./index");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireMember.mockResolvedValue({ supabase: {}, user: { id: "fixture-member" } });
    // Stop right after validation: reaching orchestration proves the request was accepted.
    orchestration.mockRejectedValue(new Error("PROVIDER_UNAVAILABLE"));
  });
  afterAll(() => { log.mockRestore(); vi.unstubAllGlobals(); });

  it.each([["meal", 44], ["meal", 46], ["meal", 60], ["lunch", 60], ["dinner", 60]])(
    "refuses a %s dwell of %i minutes with update guidance and no budget, provider or storage work", async (role, dwell) => {
      const response = await call([await stop(role, dwell)]);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: MESSAGE, code: "MEAL_DWELL_FIXED" });
      expect(orchestration).not.toHaveBeenCalled();
      expect(auth.consumeBudget).not.toHaveBeenCalled();
      expect(auth.serviceClient).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledExactlyOnceWith("plan-route failed", "MEAL_DWELL_FIXED", "UNKNOWN", "UNKNOWN");
    },
  );

  it.each([
    ["a 45-minute meal", [["meal", 45]]],
    ["a 45-minute lunch and dinner", [["lunch", 45], ["dinner", 45]]],
    ["a 45-minute meal with 30- and 60-minute rests", [["meal", 45], ["rest", 30], ["rest", 60]]],
  ])("accepts %s and proceeds to route calculation", async (_name, stops) => {
    const waypoints = await Promise.all((stops as Array<[string, number]>).map(([role, dwell], index) => point(
      `${role}-${index}`, 127.05 + index * 0.01,
      { kind: role === "rest" ? "optional" : "stop", dwellMinutes: dwell, stopRole: role },
    )));
    const response = await call(waypoints);
    expect(orchestration).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(503);
  });
});
