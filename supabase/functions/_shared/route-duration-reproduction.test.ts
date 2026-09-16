import { describe, expect, it, vi } from "vitest";

import { parseSafeRecommendedRoute } from "../../../lib/planner/provider-contract";
import { requestKakaoRoute } from "./kakao-provider";
import { orchestrateRecommendedRoute, type RouteChunkRequest, type RouteOperation } from "./route-orchestration";
import type { RoutePointRequest } from "./route-request";
import { buildSafeRouteResponse } from "./route-response";

function point(id: "A" | "B" | "C", longitude: number, latitude: number): RoutePointRequest {
  return {
    id,
    label: id,
    kakaoPlaceId: id,
    verificationToken: "a".repeat(43),
    name: `합성 지점 ${id}`,
    address: "합성 테스트 주소",
    roadAddress: null,
    longitude,
    latitude,
    kind: "pass-through",
    dwellMinutes: 0,
    selected: true,
    winding: id !== "A",
  };
}

describe("observed route duration mismatch reproduction", () => {
  it("uses the provider summary duration for one successful future route", async () => {
    const points = [
      point("A", 127, 37),
      point("B", 127.05, 37.05),
      point("C", 127.1, 37.1),
    ];
    const sections = [
      {
        distance: 1200,
        duration: 300,
        roads: [{
          name: "합성 도로 AB",
          distance: 1200,
          duration: 300,
          vertexes: [127, 37, 127.05, 37.05],
        }],
      },
      {
        distance: 1800,
        duration: 420,
        roads: [{
          name: "합성 도로 BC",
          distance: 1800,
          duration: 420,
          vertexes: [127.05, 37.05, 127.1, 37.1],
        }],
      },
    ];
    let requestedUrl: URL | null = null;
    const fetchImpl = vi.fn(async (raw: string | URL | Request) => {
      requestedUrl = new URL(raw instanceof Request ? raw.url : raw.toString());
      return Response.json({
        routes: [{
          result_code: 0,
          summary: {
            distance: 3000,
            duration: 840,
            origin: { x: 127, y: 37 },
            destination: { x: 127.1, y: 37.1 },
            waypoints: [{ x: 127.05, y: 37.05 }],
          },
          sections,
        }],
      });
    });
    const budget = vi.fn(async (_operation: RouteOperation, _hardLimit: number) => 1);
    const provider = vi.fn(async (input: RouteChunkRequest) => requestKakaoRoute(
      { ...input, apiKey: "synthetic-test-key" },
      fetchImpl,
    ));
    const result = await orchestrateRecommendedRoute(
      points,
      "2026-09-01T00:06:00.000Z",
      {
        now: () => Date.parse("2026-09-01T00:00:00.000Z"),
        limitFor: () => 200,
        consumeBudget: budget,
        requestProvider: provider,
      },
    );

    expect(result.totalDurationSeconds).toBe(840);
    expect(result.legs.map((leg) => leg.durationSeconds)).toEqual([350, 490]);
    expect(result.legs.map((leg) => leg.arrivalAt)).toEqual([
      "2026-09-01T00:11:50.000Z",
      "2026-09-01T00:20:00.000Z",
    ]);
    const safeRoute = buildSafeRouteResponse({
      candidate: { id: "recommended", label: "추천 경로", estimatedWinding: false },
      ...result,
    });
    expect(parseSafeRecommendedRoute(safeRoute).legs.map((leg) => leg.durationSeconds)).toEqual([350, 490]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requestedUrl!.pathname).toBe("/v1/future/directions");
    expect(requestedUrl!.searchParams.has("waypoints")).toBe(true);
    expect(budget).toHaveBeenCalledExactlyOnceWith("future_directions", 200);
  });
});
