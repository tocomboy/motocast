import { describe, expect, it } from "vitest";

import {
  curvatureScore,
  routeFingerprint,
  selectEstimatedWindingRoute,
  type RouteGeometry,
} from "./winding";

function route(vertexes: number[]): RouteGeometry {
  return {
    summary: { distance: 10000, duration: 1200 },
    sections: [{ roads: [{ vertexes }] }],
  };
}

const straight = route([127, 37, 127.05, 37, 127.1, 37, 127.15, 37]);
const curved = route([127, 37, 127.03, 37.02, 127.01, 37.05, 127.05, 37.07, 127.03, 37.1]);

describe("winding heuristic", () => {
  it("scores repeated direction changes above a straight line", () => {
    expect(curvatureScore(curved)).toBeGreaterThan(curvatureScore(straight));
  });

  it("selects the curvier distinct alternative", () => {
    expect(selectEstimatedWindingRoute([straight, curved], new Set())).toBe(curved);
  });

  it("does not relabel an excluded balanced route as winding", () => {
    const excluded = new Set([routeFingerprint(curved)]);
    expect(selectEstimatedWindingRoute([curved], excluded)).toBeNull();
  });

  it("is deterministic for duplicate points and incomplete geometry", () => {
    expect(curvatureScore(route([127, 37, 127, 37, 127.1, 37]))).toBe(0);
    expect(curvatureScore({ summary: { distance: 1, duration: 1 } })).toBe(0);
  });
});
