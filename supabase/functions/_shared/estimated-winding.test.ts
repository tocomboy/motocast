import { describe, expect, it, vi } from "vitest";

import {
  assertEstimatedWindingAvailable,
  selectEstimatedWindingChunk,
  type BudgetedRoutePool,
} from "./estimated-winding";
import type { NormalizedKakaoRoute } from "./kakao-route";

function route(offset: number): NormalizedKakaoRoute {
  return {
    summary: {
      distance: 1000 + offset,
      duration: 120 + offset,
      origin: { longitude: 127, latitude: 37 },
      destination: { longitude: 127.2, latitude: 37.2 },
      waypoints: [],
    },
    sections: [{
      distance: 1000 + offset,
      duration: 120 + offset,
      roads: [{
        name: "테스트 도로",
        distance: 1000 + offset,
        duration: 120 + offset,
        vertexes: [127, 37, 127.1, 37.1 + offset / 10000, 127.2, 37.2],
      }],
    }],
  };
}

function pool(requestNumber: number, routes: NormalizedKakaoRoute[]): BudgetedRoutePool {
  return { requestNumber, result: routes };
}

describe("selectEstimatedWindingChunk", () => {
  it("selects the curviest distinct recommended alternative without the fastest fallback", async () => {
    const baseline = route(0);
    const gentler = route(10);
    const curvier = route(20);
    const call = vi.fn(async (_priority: string, alternatives: boolean) => (
      alternatives ? pool(2, [baseline, gentler, curvier]) : pool(1, [baseline])
    ));

    const result = await selectEstimatedWindingChunk(call);

    expect(result).toEqual({ selected: { requestNumber: 2, result: curvier }, distinct: true });
    expect(call.mock.calls).toEqual([
      ["RECOMMEND", false],
      ["RECOMMEND", true],
    ]);
  });

  it("tries fastest alternatives only when the recommended pool has no distinct route", async () => {
    const baseline = route(0);
    const fastest = route(30);
    const call = vi.fn(async (priority: string, alternatives: boolean) => {
      if (!alternatives) return pool(1, [baseline]);
      return priority === "RECOMMEND" ? pool(2, [baseline]) : pool(3, [fastest]);
    });

    const result = await selectEstimatedWindingChunk(call);

    expect(result).toEqual({ selected: { requestNumber: 3, result: fastest }, distinct: true });
    expect(call.mock.calls).toEqual([
      ["RECOMMEND", false],
      ["RECOMMEND", true],
      ["TIME", true],
    ]);
  });

  it("reuses the safe baseline for a chunk when neither pool contains a distinct route", async () => {
    const baseline = route(0);
    const call = vi.fn(async (_priority: string, _alternatives: boolean) => pool(4, [baseline]));

    const result = await selectEstimatedWindingChunk(call);

    expect(result).toEqual({ selected: { requestNumber: 4, result: baseline }, distinct: false });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("does not mislabel a geometrically distinct but less-curved route as winding", async () => {
    const curvedBaseline = route(30);
    const straighter = route(0);
    const call = vi.fn(async (_priority: string, alternatives: boolean) => (
      alternatives ? pool(4, [curvedBaseline, straighter]) : pool(3, [curvedBaseline])
    ));

    const result = await selectEstimatedWindingChunk(call);

    expect(result).toEqual({ selected: { requestNumber: 3, result: curvedBaseline }, distinct: false });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("treats a documented no-route fastest response as unavailable but propagates outages", async () => {
    const baseline = route(0);
    const noRoute = vi.fn(async (priority: string, alternatives: boolean) => {
      if (alternatives) throw new Error("SAFE_ROUTE_NOT_FOUND");
      return pool(5, [baseline]);
    });
    await expect(selectEstimatedWindingChunk(noRoute)).resolves.toEqual({
      selected: { requestNumber: 5, result: baseline },
      distinct: false,
    });

    const unavailable = vi.fn(async (_priority: string, alternatives: boolean) => {
      if (alternatives) throw new Error("PROVIDER_UNAVAILABLE");
      return pool(6, [baseline]);
    });
    await expect(selectEstimatedWindingChunk(unavailable)).rejects.toThrow("PROVIDER_UNAVAILABLE");
  });
});

describe("assertEstimatedWindingAvailable", () => {
  it("accepts a multi-chunk route when at least one chunk is genuinely distinct", () => {
    expect(() => assertEstimatedWindingAvailable(true, [false, true, false])).not.toThrow();
  });

  it("requires a custom waypoint when every estimated chunk is the provider baseline", () => {
    expect(() => assertEstimatedWindingAvailable(true, [false, false])).toThrow("WINDING_ROUTE_UNAVAILABLE");
    expect(() => assertEstimatedWindingAvailable(false, [false, false])).not.toThrow();
  });
});
