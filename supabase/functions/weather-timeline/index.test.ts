import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { KmaResponseValidationError } from "../_shared/weather-failure";

const mocks = vi.hoisted(() => ({
  requireMember: vi.fn(), consumeBudget: vi.fn(), serviceClient: vi.fn(),
  parseKmaItems: vi.fn(), storedPoints: vi.fn(), snapshotRead: vi.fn(), rpc: vi.fn(),
}));
vi.mock("../_shared/auth.ts", () => ({
  requireMember: mocks.requireMember, consumeBudget: mocks.consumeBudget, serviceClient: mocks.serviceClient,
}));
vi.mock("../_shared/kma-response.ts", () => ({ parseKmaItems: mocks.parseKmaItems }));
vi.mock("../_shared/weather-route.ts", () => ({
  weatherPointsFromStoredRoute: mocks.storedPoints, assertWeatherPointsMatch: vi.fn(),
}));

describe("deployed weather diagnostic boundary", () => {
  let handler: (request: Request) => Promise<Response>;
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
  const fetchMock = vi.fn();
  const point = { id: "fixture-point", label: "fixture", longitude: 127, latitude: 37, eta: "2026-09-05T01:00:00.000Z" };
  const tripId = "11111111-1111-4111-8111-111111111111";
  const request = () => new Request("https://preview.example/functions/v1/weather-timeline", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tripId, candidateProfile: "recommended", points: [point] }),
  });
  beforeAll(async () => {
    vi.stubGlobal("Deno", {
      env: { get: (name: string) => name === "KMA_DAILY_LIMIT" ? "10" : "fixture-private-detail" },
      serve: (callback: typeof handler) => { handler = callback; },
    });
    vi.stubGlobal("fetch", fetchMock);
    await import("./index");
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T00:00:00.000Z"));
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
      maybeSingle: mocks.snapshotRead,
    };
    mocks.requireMember.mockResolvedValue({ user: { id: "fixture-member" }, supabase: {
      from: (table: string) => table === "route_cache"
        ? { ...query, maybeSingle: vi.fn().mockResolvedValue({ data: { summary: {} }, error: null }) }
        : query,
    } });
    mocks.snapshotRead.mockResolvedValue({ data: null, error: null });
    mocks.storedPoints.mockReturnValue([point]);
    mocks.consumeBudget.mockResolvedValue(1);
    mocks.serviceClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ error: null });
    fetchMock.mockResolvedValue(new Response("{}"));
  });
  afterAll(() => {
    vi.useRealTimers();
    errorLog.mockRestore(); warnLog.mockRestore(); vi.unstubAllGlobals();
  });

  it.each(["known", "foreign", "forged"])("keeps %s provider failure private with one budgeted call", async (kind) => {
    const error = kind === "foreign" ? new Error("fixture-private-detail") : new KmaResponseValidationError("MISSING_POP");
    if (kind === "forged") Object.assign(error, { reason: "fixture-private-detail" });
    mocks.parseKmaItems.mockRejectedValue(error);
    const response = await handler(request());
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body).toEqual({ error: "외부 서비스 요청에 실패했습니다. 기존 저장 계획은 유지됩니다." });
    expect(errorLog).toHaveBeenCalledExactlyOnceWith("weather-timeline failed", kind === "foreign" ? "UNKNOWN" : "KMA_INVALID_RESPONSE", kind === "known" ? "MISSING_POP" : "UNKNOWN");
    expect(JSON.stringify({ body, logs: errorLog.mock.calls })).not.toContain("fixture-private-detail");
    expect(mocks.consumeBudget).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.consumeBudget.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([false, true])("redacts stale fallback logs without changing snapshot/public failure semantics %#", async (foreign) => {
    const error = foreign ? new Error("fixture-private-detail") : new KmaResponseValidationError("VALUE_CONTRACT");
    mocks.parseKmaItems.mockRejectedValue(error);
    mocks.snapshotRead.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: {
      id: "fixture-snapshot", issued_at: "2026-09-04T23:30:00.000Z", valid_until: "2026-09-05T02:00:00.000Z",
      created_at: "2026-09-04T23:45:00.000Z", segments: [], stale_observed_at: null, stale_reason: null, stale_failure_kind: null,
    }, error: null });
    const response = await handler(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ source: "snapshot", stale: true, failureKind: foreign ? "request" : "provider", staleReason: "외부 서비스 요청에 실패했습니다. 기존 저장 계획은 유지됩니다." });
    expect(warnLog).toHaveBeenCalledExactlyOnceWith("weather-timeline stale fallback", foreign ? "UNKNOWN" : "KMA_INVALID_RESPONSE", foreign ? "UNKNOWN" : "VALUE_CONTRACT");
    expect(errorLog).not.toHaveBeenCalled();
    expect(JSON.stringify({ body, logs: warnLog.mock.calls, rpc: mocks.rpc.mock.calls })).not.toContain("fixture-private-detail");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0][0]).toBe("mark_weather_snapshot_stale_internal");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("logs foreign RPC budget failure safely and never calls the provider", async () => {
    mocks.consumeBudget.mockRejectedValue(new Error("fixture-private-detail"));
    const response = await handler(request());
    expect(response.status).toBe(502);
    expect(errorLog).toHaveBeenCalledExactlyOnceWith("weather-timeline failed", "UNKNOWN", "UNKNOWN");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("preserves the successful forecast and persistence path without diagnostic logs", async () => {
    mocks.parseKmaItems.mockResolvedValue(["T1H", "POP", "WSD", "SKY", "PTY"].map((category) => ({
      baseDate: "20260905", baseTime: "0830", fcstDate: "20260905", fcstTime: "1000",
      nx: 60, ny: 127, category, fcstValue: "1",
    })));
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ source: "live", stale: false, forecasts: [{
      ...point, model: "ultra", status: "forecast", temperatureC: 1, precipitationProbability: 1, windSpeedMps: 1,
    }] });
    expect(mocks.consumeBudget).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0][0]).toBe("insert_weather_snapshot_internal");
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).not.toHaveBeenCalled();
  });

  it("keeps a fresh snapshot cache hit free of provider calls and writes", async () => {
    mocks.snapshotRead.mockResolvedValueOnce({ data: {
      id: "fixture-snapshot", issued_at: "2026-09-04T23:30:00.000Z", valid_until: "2026-09-05T02:00:00.000Z",
      created_at: "2026-09-04T23:55:00.000Z", segments: [], stale_observed_at: null, stale_reason: null, stale_failure_kind: null,
    }, error: null });
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ source: "cache", stale: false });
    expect(mocks.consumeBudget).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).not.toHaveBeenCalled();
  });
});
