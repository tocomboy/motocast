import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireMember: vi.fn(),
  consumeBudget: vi.fn(),
  serviceClient: vi.fn(),
  storedPoints: vi.fn(),
  assertPoints: vi.fn(),
  snapshotRead: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("../_shared/auth.ts", () => ({
  requireMember: mocks.requireMember,
  consumeBudget: mocks.consumeBudget,
  serviceClient: mocks.serviceClient,
}));
vi.mock("../_shared/weather-route.ts", () => ({
  weatherPointsFromStoredRoute: mocks.storedPoints,
  assertWeatherPointsMatch: mocks.assertPoints,
}));

describe("weather timeline issuance and exact-target selection", () => {
  let handler: (request: Request) => Promise<Response>;
  const fetchMock = vi.fn();
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  const point = {
    id: "recommended-0",
    label: "서울 도착지",
    longitude: 126.978,
    latitude: 37.5665,
    eta: "2026-09-05T03:00:00.000Z",
  };
  const tripId = "11111111-1111-4111-8111-111111111111";
  const request = () => new Request("https://preview.example/functions/v1/weather-timeline", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tripId, candidateProfile: "recommended", points: [point] }),
  });
  const providerItems = (baseTime = "1000", fcstTime = "1200") => [
    { category: "T1H", fcstValue: "22" },
    { category: "POP", fcstValue: "30" },
    { category: "WSD", fcstValue: "2.5" },
    { category: "SKY", fcstValue: "3" },
    { category: "PTY", fcstValue: "0" },
  ].map((item) => ({
    baseDate: "20260905",
    baseTime,
    fcstDate: "20260905",
    fcstTime,
    nx: 60,
    ny: 127,
    ...item,
  }));
  const providerResponse = (items: ReturnType<typeof providerItems>) => new Response(JSON.stringify({
    response: { header: { resultCode: "00" }, body: { items: { item: items } } },
  }));

  beforeAll(async () => {
    vi.stubGlobal("Deno", {
      env: { get: (name: string) => {
        if (name === "KMA_DAILY_LIMIT") return "10";
        if (name === "KMA_APIHUB_KEY") return "fixture-api-key";
        return undefined;
      } },
      serve: (callback: typeof handler) => { handler = callback; },
    });
    vi.stubGlobal("fetch", fetchMock);
    await import("./index");
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T01:45:00.000Z"));

    const snapshotQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: mocks.snapshotRead,
    };
    const routeQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { summary: {} }, error: null }),
    };
    mocks.requireMember.mockResolvedValue({
      user: { id: "fixture-member" },
      supabase: { from: (table: string) => table === "route_cache" ? routeQuery : snapshotQuery },
    });
    mocks.snapshotRead.mockResolvedValue({ data: null, error: null });
    mocks.storedPoints.mockReturnValue([point]);
    mocks.consumeBudget.mockResolvedValue(1);
    mocks.serviceClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ error: null });
  });

  afterAll(() => {
    vi.useRealTimers();
    errorLog.mockRestore();
    vi.unstubAllGlobals();
  });

  it("requests the eligible ultra HH00 base and persists that exact issuance", async () => {
    fetchMock.mockResolvedValue(providerResponse(providerItems()));

    const response = await handler(request());
    const body = await response.json();
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    const expectedIssuedAt = "2026-09-05T01:00:00.000Z";

    expect(response.status).toBe(200);
    expect(requestedUrl.pathname).toContain("/getUltraSrtFcst");
    expect(Object.fromEntries(["base_date", "base_time", "nx", "ny"].map((key) => [key, requestedUrl.searchParams.get(key)]))).toEqual({
      base_date: "20260905",
      base_time: "1000",
      nx: "60",
      ny: "127",
    });
    expect(body).toMatchObject({
      source: "live",
      stale: false,
      issuedAt: expectedIssuedAt,
      forecasts: [{
        ...point,
        status: "forecast",
        model: "ultra",
        issuedAt: expectedIssuedAt,
        temperatureC: 22,
        precipitationProbability: 30,
        windSpeedMps: 2.5,
      }],
    });
    expect(mocks.consumeBudget).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("insert_weather_snapshot_internal", expect.objectContaining({
      target_issued_at: expectedIssuedAt,
      target_segments: [expect.objectContaining({ issuedAt: expectedIssuedAt })],
    }));
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("rejects a response bound to a different base after retaining the consumed budget", async () => {
    fetchMock.mockResolvedValue(providerResponse(providerItems("0900")));

    const response = await handler(request());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "외부 서비스 요청에 실패했습니다. 기존 저장 계획은 유지됩니다." });
    expect(mocks.consumeBudget).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(errorLog.mock.calls[0].slice(0, 3)).toEqual([
      "weather-timeline failed",
      "KMA_INVALID_RESPONSE",
      "BASE_TIME_MISMATCH",
    ]);
  });

  it("rejects an ultra response without the exact target and writes no success snapshot", async () => {
    fetchMock.mockResolvedValue(providerResponse(providerItems("1000", "1300")));

    const response = await handler(request());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "외부 서비스 요청에 실패했습니다. 기존 저장 계획은 유지됩니다." });
    expect(mocks.consumeBudget).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
