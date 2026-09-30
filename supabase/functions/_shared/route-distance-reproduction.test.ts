import { describe, expect, it, vi } from "vitest";

import { parseSafeRecommendedRoute } from "../../../lib/planner/provider-contract";
import { safeErrorCode, safeErrorMessage, safeErrorStatus } from "./http";
import { requestKakaoRoute } from "./kakao-provider";
import { routeRequestDiagnostic, routeResponseDiagnostic } from "./kakao-route";
import { orchestrateRecommendedRoute, type RouteChunkRequest } from "./route-orchestration";
import type { RoutePointRequest } from "./route-request";
import { buildSafeRouteResponse } from "./route-response";

const points: RoutePointRequest[] = [
  { id: "A", longitude: 127, latitude: 37 },
  { id: "B", longitude: 127.05, latitude: 37.05 },
  { id: "C", longitude: 127.1, latitude: 37.1 },
].map((point) => ({
  ...point,
  label: point.id,
  name: `합성 지점 ${point.id}`,
  kakaoPlaceId: point.id,
  verificationToken: "a".repeat(43),
  address: "합성 테스트 주소",
  roadAddress: null,
  kind: "pass-through",
  dwellMinutes: 0,
  selected: true,
  winding: point.id !== "A",
}));

function providerRoute(delta: number) {
  return {
    result_code: 0,
    summary: {
      distance: 3000 + delta,
      duration: 720,
      origin: { x: 127, y: 37 },
      destination: { x: 127.1, y: 37.1 },
      waypoints: [{ x: 127.05, y: 37.05 }],
    },
    sections: [
      { distance: 1200, duration: 300, roads: [{ name: "합성 도로 AB", distance: 1200, duration: 300, vertexes: [127, 37, 127.05, 37.05] }] },
      { distance: 1800, duration: 420, roads: [{ name: "합성 도로 BC", distance: 1800, duration: 420, vertexes: [127.05, 37.05, 127.1, 37.1] }] },
    ],
  };
}

function execute(route: unknown) {
  const fetchImpl = vi.fn(async () => Response.json({ routes: [route] }));
  const budget = vi.fn(async () => 1);
  const provider = vi.fn(async (input: RouteChunkRequest) => requestKakaoRoute({ ...input, apiKey: "synthetic-test-key" }, fetchImpl));
  const result = orchestrateRecommendedRoute(points, "2026-09-01T00:06:00.000Z", {
    now: () => Date.parse("2026-09-01T00:00:00.000Z"),
    limitFor: () => 200,
    consumeBudget: budget,
    requestProvider: provider,
  });
  return { result, fetchImpl, budget, provider };
}

describe("synthetic provider adapter and orchestration distance contract", () => {
  it.each([1, -1, 700, -700])("accepts supplier distance mismatch %i with consistent published distances", async (delta) => {
    const run = execute(providerRoute(delta));
    const result = await run.result;
    expect(result.totalDistanceMeters).toBe(3000);
    expect(result.legs.map((leg) => leg.distanceMeters)).toEqual([1200, 1800]);
    const response = buildSafeRouteResponse({ candidate: { id: "recommended", label: "추천 경로", estimatedWinding: false }, ...result });
    const published = parseSafeRecommendedRoute(response);
    expect(published.totalDistanceMeters).toBe(3000);
    expect(published.legs.map((leg) => leg.distanceMeters)).toEqual([1200, 1800]);
    expect(run.provider).toHaveBeenCalledTimes(1);
    expect(run.fetchImpl).toHaveBeenCalledTimes(1);
    expect(run.budget).toHaveBeenCalledExactlyOnceWith("future_directions", 200);
    expect(run.budget.mock.invocationCallOrder[0]).toBeLessThan(run.provider.mock.invocationCallOrder[0]);
  });

  it.each([
    [101, "ROUTE_WAYPOINT_ROAD_NOT_FOUND", 422],
    [102, "ROUTE_ORIGIN_ROAD_NOT_FOUND", 422],
    [103, "ROUTE_DESTINATION_ROAD_NOT_FOUND", 422],
    [104, "ROUTE_POINTS_TOO_CLOSE", 422],
    [105, "ROUTE_ORIGIN_BLOCKED", 422],
    [106, "ROUTE_DESTINATION_BLOCKED", 422],
    [107, "ROUTE_WAYPOINT_BLOCKED", 422],
    [9999, "ROUTE_RESPONSE_INVALID", 502],
  ])("retains bounded diagnostics and no retry for result %i", async (resultCode, publicCode, status) => {
    const run = execute({ result_code: resultCode, result_msg: "fixture-private-provider-body" });
    const error = await run.result.then(() => null, (error: unknown) => error);
    expect(safeErrorCode(error)).toBe(publicCode);
    expect(safeErrorStatus(error)).toBe(status);
    expect(routeResponseDiagnostic(error)).toBe(resultCode === 9999 ? "RESULT_CODE_UNDOCUMENTED" : `RESULT_CODE_${resultCode}`);
    expect(routeRequestDiagnostic(error)).toBe("FUTURE_P0_P2_DESTINATION");
    expect(safeErrorMessage(error)).not.toContain("fixture-private-provider-body");
    expect(JSON.stringify(error)).not.toContain("fixture-private-provider-body");
    expect(run.fetchImpl).toHaveBeenCalledTimes(1);
    expect(run.provider).toHaveBeenCalledTimes(1);
    expect(run.budget).toHaveBeenCalledExactlyOnceWith("future_directions", 200);
    expect(run.budget.mock.invocationCallOrder[0]).toBeLessThan(run.provider.mock.invocationCallOrder[0]);
  });
});
