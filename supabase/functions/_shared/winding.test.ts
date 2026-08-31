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

  it("keeps interior vertices when routes differ outside a coarse sample", () => {
    const baseline = route(Array.from({ length: 52 }, (_, index) => (
      index % 2 === 0 ? 127 + index / 1000 : 37 + index / 1000
    )));
    const alternativeVertexes = baseline.sections![0].roads![0].vertexes.slice();
    alternativeVertexes[2] += 0.0005;
    const alternative = route(alternativeVertexes);

    expect(routeFingerprint(alternative)).not.toBe(routeFingerprint(baseline));
  });

  it("is deterministic for duplicate points and incomplete geometry", () => {
    expect(curvatureScore(route([127, 37, 127, 37, 127.1, 37]))).toBe(0);
    expect(curvatureScore({ summary: { distance: 1, duration: 1 } })).toBe(0);
  });
});
