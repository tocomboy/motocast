import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeKakaoRoutePayload, RouteResponseValidationError } from "../_shared/kakao-route";
import type { RouteRequest } from "../_shared/route-request";

const validation = vi.hoisted(() => vi.fn());
const serviceClient = vi.hoisted(() => vi.fn());
const orchestration = vi.hoisted(() => vi.fn());
const stage = vi.hoisted(() => vi.fn());
const consumeBudget = vi.hoisted(() => vi.fn(async () => 1));
vi.mock("../_shared/auth.ts", () => ({
  requireMember: vi.fn(async () => ({ supabase: {}, user: { id: "test-member" } })),
  consumeBudget,
  serviceClient,
}));
vi.mock("../_shared/route-request.ts", () => ({ withValidatedRouteRequest: validation }));
vi.mock("../_shared/route-orchestration.ts", () => ({ orchestrateRecommendedRoute: orchestration }));

function routeInput(): RouteRequest {
  const point = (id: string, longitude: number) => ({
    id, label: id, kakaoPlaceId: id, verificationToken: "a".repeat(43), name: id,
    address: "테스트 주소", roadAddress: null, longitude, latitude: 37,
    kind: "pass-through" as const, dwellMinutes: 0, selected: true, winding: false,
  });
  return {
    planningId: "00000000-0000-4000-8000-000000000001",
    tripId: null,
    origin: point("origin", 127),
    destination: point("destination", 127.1),
    waypoints: [point("waypoint", 127.05)],
    serviceDate: "2030-01-01",
    departureAt: "2030-01-01T00:06:00.000Z",
  };
}

function providerPayload(malformed = false) {
  return {
    routes: [{
      result_code: 0,
      summary: {
        distance: 3000,
        duration: 840,
        origin: { x: 127, y: 37 },
        destination: { x: 127.1, y: 37 },
        waypoints: [{ x: 127.05, y: 37 }],
      },
      sections: [
        {
          distance: 1200,
          duration: 300,
          roads: [{ name: "AB", distance: 1200, duration: malformed ? 299 : 300, vertexes: [127, 37, 127.05, 37] }],
        },
        {
          distance: 1800,
          duration: 420,
          roads: [{ name: "BC", distance: 1800, duration: 420, vertexes: [127.05, 37, 127.1, 37] }],
        },
      ],
    }],
  };
}

describe("deployed plan-route diagnostic boundary", () => {
  let handler: (request: Request) => Promise<Response>;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2029-12-31T23:00:00.000Z"));
  beforeAll(async () => {
    vi.stubGlobal("Deno", {
      env: { get: (name: string) => name.endsWith("DAILY_LIMIT") ? "200" : "test-verification-value" },
      serve: (callback: typeof handler) => { handler = callback; },
    });
    await import("./index");
  });
  beforeEach(() => { vi.clearAllMocks(); });
  afterAll(() => { log.mockRestore(); now.mockRestore(); vi.unstubAllGlobals(); });

  it.each(["known", "foreign", "forged"])("logs only fixed codes for a %s error", async (kind) => {
    const privateDetail = "fixture-private-provider-detail";
    const error = kind === "foreign" ? new Error(privateDetail) : new RouteResponseValidationError("SECTION_DURATION_TOTAL");
    if (kind === "forged") Object.assign(error, { reason: privateDetail });
    validation.mockRejectedValue(error);
    const response = await handler(new Request("https://preview.example/functions/v1/plan-route", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    const body = await response.json();
    const expectedCode = kind === "foreign" ? "ROUTE_REQUEST_FAILED" : "ROUTE_RESPONSE_INVALID";
    expect(response.status).toBe(502);
    expect(Object.keys(body).sort()).toEqual(["code", "error"]);
    expect(body.code).toBe(expectedCode);
    expect(log).toHaveBeenCalledExactlyOnceWith("plan-route failed", expectedCode, kind === "known" ? "SECTION_DURATION_TOTAL" : "UNKNOWN", "UNKNOWN");
    expect(JSON.stringify({ body, log: log.mock.calls })).not.toContain(privateDetail);
    expect(serviceClient).not.toHaveBeenCalled();
  });

  it.each([
    { code: 101, reason: "RESULT_CODE_101" },
    { code: 104, reason: "RESULT_CODE_104" },
    { code: 107, reason: "RESULT_CODE_107" },
    { code: 9999, reason: "RESULT_CODE_UNDOCUMENTED" },
    { code: "fixture-private-detail", reason: "RESULT_CODE_SHAPE" },
  ])("keeps parsed result-code case %# server-only", async ({ code, reason }) => {
    validation.mockImplementation(async () => normalizeKakaoRoutePayload({
      routes: [{ result_code: code, result_msg: "fixture-private-detail" }],
    }));
    const response = await handler(new Request("https://preview.example/functions/v1/plan-route", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body).toEqual({ code: "ROUTE_RESPONSE_INVALID", error: "경로 공급자의 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    expect(log).toHaveBeenCalledExactlyOnceWith("plan-route failed", "ROUTE_RESPONSE_INVALID", reason, "UNKNOWN");
    expect(JSON.stringify({ body, log: log.mock.calls })).not.toContain("fixture-private-detail");
    expect(serviceClient).not.toHaveBeenCalled();
  });

  it.each([false, true])("keeps request context server-only and closes forged context %#", async (forged) => {
    const error = new RouteResponseValidationError("RESULT_CODE_106", {
      operation: "future_directions", fromPointIndex: 1, toPointIndex: 3, destinationRole: "rest",
    });
    if (forged) Object.assign(error, { requestContext: { destinationRole: "fixture-private-detail" } });
    validation.mockRejectedValue(error);
    const response = await handler(new Request("https://preview.example/functions/v1/plan-route", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body).toEqual({ code: "ROUTE_RESPONSE_INVALID", error: "경로 공급자의 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    expect(log).toHaveBeenCalledExactlyOnceWith("plan-route failed", "ROUTE_RESPONSE_INVALID", "RESULT_CODE_106", forged ? "UNKNOWN" : "FUTURE_P1_P3_REST");
    expect(JSON.stringify({ body, log: log.mock.calls })).not.toContain("fixture-private-detail");
    expect(serviceClient).not.toHaveBeenCalled();
  });

  it("stages a successfully allocated route through the production handler", async () => {
    const input = routeInput();
    const actual = await vi.importActual<typeof import("../_shared/route-orchestration")>("../_shared/route-orchestration");
    validation.mockImplementation(async (_body: unknown, _secret: string, work: (value: RouteRequest) => Promise<unknown>) => work(input));
    orchestration.mockImplementation(actual.orchestrateRecommendedRoute);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(providerPayload())));
    stage.mockResolvedValue({ error: null });
    serviceClient.mockReturnValue({ rpc: stage });
    const response = await handler(new Request("https://preview.example/functions/v1/plan-route", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.totalDurationSeconds).toBe(840);
    expect(body.legs.map((leg: { durationSeconds: number }) => leg.durationSeconds)).toEqual([350, 490]);
    expect(stage).toHaveBeenCalledTimes(1);
    expect(stage.mock.calls[0][1].staged_route.legs.map((leg: { durationSeconds: number }) => leg.durationSeconds)).toEqual([350, 490]);
    expect(consumeBudget).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("returns the unchanged public failure and does not stage a malformed route", async () => {
    const input = routeInput();
    const actual = await vi.importActual<typeof import("../_shared/route-orchestration")>("../_shared/route-orchestration");
    validation.mockImplementation(async (_body: unknown, _secret: string, work: (value: RouteRequest) => Promise<unknown>) => work(input));
    orchestration.mockImplementation(actual.orchestrateRecommendedRoute);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(providerPayload(true))));
    serviceClient.mockReturnValue({ rpc: stage });
    const response = await handler(new Request("https://preview.example/functions/v1/plan-route", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      code: "ROUTE_RESPONSE_INVALID",
      error: "경로 공급자의 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    });
    expect(stage).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledExactlyOnceWith("plan-route failed", "ROUTE_RESPONSE_INVALID", "SECTION_DURATION_TOTAL", "FUTURE_P0_P2_DESTINATION");
  });
});
