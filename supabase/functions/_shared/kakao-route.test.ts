import { describe, expect, it } from "vitest";

import { assertKakaoRouteMatchesPoints, assertKakaoSectionsContinuous, normalizeKakaoRoutePayload, normalizeKakaoRoutesPayload, routeRequestDiagnostic, routeResponseDiagnostic, RouteResponseValidationError } from "./kakao-route";
import { safeErrorCode, safeErrorMessage, safeErrorStatus } from "./http";

function payload() {
  return {
    routes: [{
      result_code: 0,
      summary: {
        distance: 12000,
        duration: 1800,
        origin: { x: 127.1, y: 37.5 },
        destination: { x: 127.2, y: 37.6 },
        waypoints: [],
      },
      sections: [{
        distance: 12000,
        duration: 1800,
        roads: [{ name: "지방도", distance: 12000, duration: 1800, vertexes: [127.1, 37.5, 127.2, 37.6] }],
      }],
    }],
  };
}

describe("normalizeKakaoRoutePayload", () => {
  it("formats only bounded request positions and closed context labels", () => {
    expect(routeRequestDiagnostic(new Error("fixture-private-detail"))).toBe("UNKNOWN");
    expect(routeRequestDiagnostic(new RouteResponseValidationError("RESULT_CODE_106"))).toBe("UNKNOWN");
    const context = { operation: "future_directions", fromPointIndex: 0, toPointIndex: 1, destinationRole: "lunch" } as const;
    expect(routeRequestDiagnostic(new RouteResponseValidationError("RESULT_CODE_106", context))).toBe("FUTURE_P0_P1_LUNCH");
    expect(routeRequestDiagnostic(new RouteResponseValidationError("RESULT_CODE_106", {
      operation: "directions", fromPointIndex: 28, toPointIndex: 29, destinationRole: "destination",
    }))).toBe("CURRENT_P28_P29_DESTINATION");
    for (const patch of [
      { operation: "fixture-private-detail" }, { destinationRole: "fixture-private-detail" },
      { fromPointIndex: -1 }, { fromPointIndex: 0.5 }, { fromPointIndex: "0" },
      { toPointIndex: 0 }, { toPointIndex: 30 }, { toPointIndex: 7 },
      { toPointIndex: NaN }, { toPointIndex: Infinity }, { toPointIndex: "1" },
    ]) {
      const error = new RouteResponseValidationError("RESULT_CODE_106");
      Object.assign(error, { requestContext: { ...context, ...patch } });
      expect(routeRequestDiagnostic(error)).toBe("UNKNOWN");
    }
  });

  it.each([
    ["SECTION_DISTANCE_TOTAL", (value: ReturnType<typeof payload>) => { value.routes[0].sections[0].roads[0].distance -= 1; }],
    ["SECTION_DURATION_TOTAL", (value: ReturnType<typeof payload>) => { value.routes[0].sections[0].roads[0].duration -= 1; }],
    ["ROUTE_DISTANCE_TOTAL", (value: ReturnType<typeof payload>) => { value.routes[0].summary.distance += 1; }],
    ["ROUTE_DURATION_TOTAL", (value: ReturnType<typeof payload>) => { value.routes[0].summary.duration += 1; }],
    ["ROAD_VERTEX_SHAPE", (value: ReturnType<typeof payload>) => { value.routes[0].sections[0].roads[0].vertexes.pop(); }],
    ["ROAD_VERTEX_RANGE", (value: ReturnType<typeof payload>) => { value.routes[0].sections[0].roads[0].vertexes[0] = 0; }],
    ["INTEGER_VALUE", (value: ReturnType<typeof payload>) => { value.routes[0].summary.duration = 0.5; }],
    ["SUMMARY_POINT", (value: ReturnType<typeof payload>) => { value.routes[0].summary.origin.x = 0; }],
    ["SECTION_ROADS", (value: ReturnType<typeof payload>) => { value.routes[0].sections[0].roads = []; }],
    ["ROUTE_SECTIONS", (value: ReturnType<typeof payload>) => { value.routes[0].sections = []; }],
    ["RESULT_CODE_UNDOCUMENTED", (value: ReturnType<typeof payload>) => { value.routes[0].result_code = 9999; }],
  ])("classifies %s without changing rejection or public response", (reason, mutate) => {
    const value = payload();
    mutate(value);
    let caught: unknown;
    try { normalizeKakaoRoutePayload(value); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(RouteResponseValidationError);
    expect(routeResponseDiagnostic(caught)).toBe(reason);
    expect(safeErrorCode(caught)).toBe("ROUTE_RESPONSE_INVALID");
    expect(safeErrorStatus(caught)).toBe(502);
    expect(safeErrorMessage(caught)).toBe("경로 공급자의 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  });

  it("never treats a foreign error or a forged reason as a printable diagnostic", () => {
    const privateDetail = "private provider URL/key/body must not be logged";
    expect(routeResponseDiagnostic(new Error(privateDetail))).toBe("UNKNOWN");
    expect(routeResponseDiagnostic({ reason: privateDetail })).toBe("UNKNOWN");
    const forged = new RouteResponseValidationError("JSON_BODY");
    Object.assign(forged, { reason: privateDetail });
    expect(routeResponseDiagnostic(forged)).toBe("UNKNOWN");
    expect(forged.message).toBe("INVALID_ROUTE_PROVIDER_RESPONSE");
  });

  it.each([
    ...[101, 102, 103, 104, 105, 106, 107, 201, 202, 203, 204, 205, 206, 207, 301, 302, 303, 304]
      .map((code) => ({ code, reason: `RESULT_CODE_${code}` })),
    ...[2, -1, 108, 200, 305, 9999, Number.MAX_SAFE_INTEGER]
      .map((code) => ({ code, reason: "RESULT_CODE_UNDOCUMENTED" })),
    ...[undefined, null, "101", "fixture-private-detail", false, {}, [], 1.5, NaN, Infinity]
      .map((code) => ({ code, reason: "RESULT_CODE_SHAPE" })),
  ])("rejects result-code case %# with only its fixed diagnostic", ({ code, reason }) => {
    let caught: unknown;
    try {
      normalizeKakaoRoutePayload({ routes: [{ result_code: code, result_msg: "fixture-private-detail" }] });
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(RouteResponseValidationError);
    expect(routeResponseDiagnostic(caught)).toBe(reason);
    expect(safeErrorStatus(caught)).toBe(502);
    expect(safeErrorCode(caught)).toBe("ROUTE_RESPONSE_INVALID");
    expect(safeErrorMessage(caught)).toBe("경로 공급자의 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    expect(JSON.stringify(caught)).not.toContain("fixture-private-detail");
  });

  it("accepts a complete route with geometry", () => {
    expect(normalizeKakaoRoutePayload(payload()).summary.distance).toBe(12000);
  });

  it("normalizes an extra provider route while the caller keeps one recommendation", () => {
    const value = payload();
    value.routes.push(structuredClone(value.routes[0]));
    expect(normalizeKakaoRoutesPayload(value)).toHaveLength(2);
  });

  it("rejects a route without drawable sections", () => {
    const value = payload();
    value.routes[0].sections = [];
    expect(() => normalizeKakaoRoutePayload(value)).toThrow("INVALID_ROUTE_PROVIDER_RESPONSE");
  });

  it.each([
    {},
    { routes: [] },
    { routes: "not-an-array" },
  ])("rejects a malformed successful response instead of claiming no safe route %#", (value) => {
    expect(() => normalizeKakaoRoutePayload(value)).toThrow("INVALID_ROUTE_PROVIDER_RESPONSE");
  });

  it("maps only Kakao's documented no-directions code to safe-route absence", () => {
    expect(() => normalizeKakaoRoutePayload({ routes: [{ result_code: 1 }] })).toThrow("SAFE_ROUTE_NOT_FOUND");
    expect(() => normalizeKakaoRoutePayload({ routes: [{ result_code: 101 }] })).toThrow("INVALID_ROUTE_PROVIDER_RESPONSE");
    expect(() => normalizeKakaoRoutePayload({ routes: [{ result_code: 9999 }] })).toThrow("INVALID_ROUTE_PROVIDER_RESPONSE");
  });

  it("rejects provider totals that disagree", () => {
    const value = payload();
    value.routes[0].sections[0].roads[0].duration = 1700;
    expect(() => normalizeKakaoRoutePayload(value)).toThrow("INVALID_ROUTE_PROVIDER_RESPONSE");
  });

  it("requires provider sections and geometry to preserve requested points", () => {
    const route = normalizeKakaoRoutePayload(payload());
    expect(() => assertKakaoRouteMatchesPoints(route, [
      { longitude: 127.1, latitude: 37.5 },
      { longitude: 127.2, latitude: 37.6 },
    ])).not.toThrow();
    expect(() => assertKakaoRouteMatchesPoints(route, [
      { longitude: 127.1, latitude: 37.5 },
      { longitude: 127.15, latitude: 37.55 },
      { longitude: 127.2, latitude: 37.6 },
    ])).toThrow("INVALID_ROUTE_PROVIDER_RESPONSE");
  });

  it("accepts normal endpoint snapping but rejects points outside the shared persistence tolerance", () => {
    const route = normalizeKakaoRoutePayload(payload());
    route.summary.origin.longitude = 127.101;
    route.summary.destination.longitude = 127.199;
    expect(() => assertKakaoRouteMatchesPoints(route, [
      { longitude: 127.1, latitude: 37.5 },
      { longitude: 127.2, latitude: 37.6 },
    ])).not.toThrow();

    route.summary.origin.longitude = 127.106;
    expect(() => assertKakaoRouteMatchesPoints(route, [
      { longitude: 127.1, latitude: 37.5 },
      { longitude: 127.2, latitude: 37.6 },
    ])).toThrow("INVALID_ROUTE_PROVIDER_RESPONSE");
  });

  it("rejects a provider summary that substitutes another destination", () => {
    const value = payload();
    value.routes[0].summary.destination.x = 128.2;
    const route = normalizeKakaoRoutePayload(value);
    expect(() => assertKakaoRouteMatchesPoints(route, [
      { longitude: 127.1, latitude: 37.5 },
      { longitude: 127.2, latitude: 37.6 },
    ])).toThrow("INVALID_ROUTE_PROVIDER_RESPONSE");
  });

  it("rejects disconnected roads even when distance and duration totals agree", () => {
    const value = payload();
    value.routes[0].sections[0].roads = [
      { name: "앞 구간", distance: 6000, duration: 900, vertexes: [127.1, 37.5, 127.15, 37.55] },
      { name: "끊긴 구간", distance: 6000, duration: 900, vertexes: [127.18, 37.58, 127.2, 37.6] },
    ];
    expect(() => normalizeKakaoRoutePayload(value)).toThrow("INVALID_ROUTE_PROVIDER_RESPONSE");
  });

  it("rejects a gap introduced only when separately valid provider calls are combined", () => {
    const first = normalizeKakaoRoutePayload(payload()).sections[0];
    const second = structuredClone(first);
    first.roads.at(-1)!.vertexes = [127.1, 37.5, 127.154, 37.554];
    second.roads[0].vertexes = [127.146, 37.546, 127.2, 37.6];
    expect(() => assertKakaoSectionsContinuous([first])).not.toThrow();
    expect(() => assertKakaoSectionsContinuous([second])).not.toThrow();
    expect(() => assertKakaoSectionsContinuous([first, second])).toThrow("INVALID_ROUTE_PROVIDER_RESPONSE");
    try {
      assertKakaoSectionsContinuous([first, second]);
    } catch (error) {
      expect(routeResponseDiagnostic(error)).toBe("SECTION_CONTINUITY");
    }
  });
});
