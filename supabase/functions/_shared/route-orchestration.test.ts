import { describe, expect, it, vi } from "vitest";

import type { NormalizedKakaoRoute } from "./kakao-route";
import { orchestrateRecommendedRoute, type RouteChunkRequest, type RouteOperation } from "./route-orchestration";
import type { RoutePointRequest } from "./route-request";

function point(index: number, dwellMinutes = 0): RoutePointRequest {
  return {
    id: `point-${index}`,
    label: `지점 ${index}`,
    kakaoPlaceId: `point-${index}`,
    verificationToken: "a".repeat(43),
    name: `지점 ${index}`,
    address: "테스트 주소",
    roadAddress: null,
    longitude: 127 + index * 0.01,
    latitude: 37 + index * 0.01,
    kind: dwellMinutes > 0 ? "stop" : "pass-through",
    dwellMinutes,
    selected: true,
    winding: dwellMinutes === 0 && index > 0,
  };
}

function providerResult(input: RouteChunkRequest): NormalizedKakaoRoute {
  const points = [input.origin, ...input.waypoints, input.destination];
  const sections = points.slice(1).map((to, index) => {
    const from = points[index];
    return {
      distance: 100,
      duration: 60,
      roads: [{
        name: "검증 도로",
        distance: 100,
        duration: 60,
        vertexes: [from.longitude, from.latitude, to.longitude, to.latitude],
      }],
    };
  });
  return {
    summary: {
      distance: sections.length * 100,
      duration: sections.length * 60,
      origin: { longitude: points[0].longitude, latitude: points[0].latitude },
      destination: { longitude: points.at(-1)!.longitude, latitude: points.at(-1)!.latitude },
      waypoints: points.slice(1, -1).map(({ longitude, latitude }) => ({ longitude, latitude })),
    },
    sections,
  };
}

function dependencies(now: number) {
  let receipt = 0;
  const operations: RouteOperation[] = [];
  const budget = vi.fn(async (operation: RouteOperation, _hardLimit: number) => {
    operations.push(operation);
    receipt += 1;
    return receipt;
  });
  const provider = vi.fn(async (input: RouteChunkRequest) => providerResult(input));
  return {
    operations,
    budget,
    provider,
    value: {
      now: () => now,
      limitFor: (operation: RouteOperation) => operation === "directions" ? 100 : 200,
      consumeBudget: budget,
      requestProvider: provider,
    },
  };
}

describe("orchestrateRecommendedRoute", () => {
  it("preserves ordered stops, dwell and ETA while charging once per split provider call", async () => {
    const departureAt = "2026-09-01T00:04:00.000Z";
    const deps = dependencies(Date.parse("2026-09-01T00:00:00.000Z"));
    const lunch = { ...point(2, 30), stopRole: "lunch" as const };
    const rest = { ...point(5, 15), kind: "optional" as const, stopRole: "rest" as const };
    const points = [point(0), point(1), lunch, point(3), point(4), rest, point(6), point(7), point(8)];

    const result = await orchestrateRecommendedRoute(points, departureAt, deps.value);

    expect(deps.provider).toHaveBeenCalledTimes(3);
    expect(deps.budget).toHaveBeenCalledTimes(3);
    expect(deps.operations).toEqual(["directions", "future_directions", "future_directions"]);
    expect(deps.budget.mock.calls.map(([, limit]) => limit)).toEqual([100, 200, 200]);
    expect(deps.provider.mock.calls.map(([request]) => [
      request.origin.id,
      request.waypoints.map((item) => item.id),
      request.destination.id,
    ])).toEqual([
      ["point-0", ["point-1"], "point-2"],
      ["point-2", ["point-3", "point-4"], "point-5"],
      ["point-5", ["point-6", "point-7"], "point-8"],
    ]);
    expect(result.legs.map((leg) => leg.to.id)).toEqual(points.slice(1).map((item) => item.id));
    expect(result.legs.map((leg) => leg.dwellMinutes)).toEqual([0, 30, 0, 0, 15, 0, 0, 0]);
    expect(result.legs.map((leg) => leg.to.stopRole)).toEqual([
      undefined, "lunch", undefined, undefined, "rest", undefined, undefined, undefined,
    ]);
    expect(result.legs.slice(1).every((leg, index) => {
      const previous = result.legs[index];
      return Date.parse(leg.departureAt) === Date.parse(previous.arrivalAt) + previous.dwellMinutes * 60_000;
    })).toBe(true);
    expect(result.totalDistanceMeters).toBe(800);
    expect(result.totalDurationSeconds).toBe(8 * 60 + 45 * 60);
    expect(result.returnAt).toBe("2026-09-01T00:57:00.000Z");
  });

  it("uses the provider waypoint ceiling without dropping the split boundary", async () => {
    const deps = dependencies(Date.parse("2026-09-01T00:00:00.000Z"));
    const points = Array.from({ length: 8 }, (_, index) => point(index));

    const result = await orchestrateRecommendedRoute(points, "2026-09-01T00:00:00.000Z", deps.value);

    expect(deps.provider).toHaveBeenCalledTimes(2);
    expect(deps.provider.mock.calls[0][0].waypoints).toHaveLength(5);
    expect(deps.provider.mock.calls[0][0].destination.id).toBe("point-6");
    expect(deps.provider.mock.calls[1][0].origin.id).toBe("point-6");
    expect(result.legs.map((leg) => leg.to.id)).toEqual(points.slice(1).map((item) => item.id));
  });

  it("does not retry later chunks after a budgeted provider failure", async () => {
    const deps = dependencies(Date.parse("2026-09-01T00:00:00.000Z"));
    deps.value.requestProvider = vi.fn(async (input: RouteChunkRequest) => {
      if (deps.value.requestProvider.mock.calls.length === 2) throw new Error("PROVIDER_UNAVAILABLE");
      return providerResult(input);
    });
    const points = [point(0), point(1, 10), point(2), point(3, 10), point(4)];

    await expect(orchestrateRecommendedRoute(points, "2026-09-01T00:00:00.000Z", deps.value))
      .rejects.toThrow("PROVIDER_UNAVAILABLE");
    expect(deps.value.requestProvider).toHaveBeenCalledTimes(2);
    expect(deps.budget).toHaveBeenCalledTimes(2);
  });
});
