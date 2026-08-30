import { describe, expect, it } from "vitest";

import { normalizeKakaoRoutePayload, normalizeKakaoRoutesPayload } from "./kakao-route";

function payload() {
  return {
    routes: [{
      result_code: 0,
      summary: { distance: 12000, duration: 1800 },
      sections: [{
        distance: 12000,
        duration: 1800,
        roads: [{ name: "지방도", distance: 12000, duration: 1800, vertexes: [127.1, 37.5, 127.2, 37.6] }],
      }],
    }],
  };
}

describe("normalizeKakaoRoutePayload", () => {
  it("accepts a complete route with geometry", () => {
    expect(normalizeKakaoRoutePayload(payload()).summary.distance).toBe(12000);
  });

  it("keeps validated alternative routes for winding selection", () => {
    const value = payload();
    value.routes.push(structuredClone(value.routes[0]));
    expect(normalizeKakaoRoutesPayload(value)).toHaveLength(2);
  });

  it("rejects a route without drawable sections", () => {
    const value = payload();
    value.routes[0].sections = [];
    expect(() => normalizeKakaoRoutePayload(value)).toThrow("INVALID_ROUTE_PROVIDER_RESPONSE");
  });

  it("rejects provider totals that disagree", () => {
    const value = payload();
    value.routes[0].sections[0].roads[0].duration = 1700;
    expect(() => normalizeKakaoRoutePayload(value)).toThrow("INVALID_ROUTE_PROVIDER_RESPONSE");
  });
});
