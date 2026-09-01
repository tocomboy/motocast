import { describe, expect, it, vi } from "vitest";

import { requestKakaoRoute, type KakaoRouteRequest } from "./kakao-provider";
import type { RoutePointRequest } from "./route-request";

function point(id: string, longitude: number, latitude: number): RoutePointRequest {
  return {
    id,
    label: id,
    kakaoPlaceId: id,
    verificationToken: "a".repeat(43),
    name: id,
    address: "테스트 주소",
    roadAddress: null,
    longitude,
    latitude,
    kind: "pass-through",
    dwellMinutes: 0,
    selected: true,
    winding: false,
  };
}

function providerRoute(points: RoutePointRequest[], curve = 0) {
  const sections = points.slice(1).map((to, index) => {
    const from = points[index];
    const middleLongitude = (from.longitude + to.longitude) / 2;
    const middleLatitude = (from.latitude + to.latitude) / 2 + curve;
    return {
      distance: 1000,
      duration: 120,
      roads: [{
        name: "테스트 도로",
        distance: 1000,
        duration: 120,
        vertexes: [from.longitude, from.latitude, middleLongitude, middleLatitude, to.longitude, to.latitude],
      }],
    };
  });
  return {
    result_code: 0,
    summary: {
      distance: sections.length * 1000,
      duration: sections.length * 120,
      origin: { x: points[0].longitude, y: points[0].latitude },
      destination: { x: points.at(-1)!.longitude, y: points.at(-1)!.latitude },
      waypoints: points.slice(1, -1).map((waypoint) => ({ x: waypoint.longitude, y: waypoint.latitude })),
    },
    sections,
  };
}

function request(overrides: Partial<KakaoRouteRequest> = {}): KakaoRouteRequest {
  return {
    origin: point("origin", 127, 37),
    destination: point("destination", 127.2, 37.2),
    waypoints: [],
    departureAt: new Date("2026-08-31T00:00:00.000Z"),
    isFuture: false,
    apiKey: "test-key",
    ...overrides,
  };
}

describe("requestKakaoRoute", () => {
  it.each([
    ["current", false, []],
    ["future", true, []],
    ["split chunk", false, [point("via", 127.1, 37.1)]],
  ] as const)("forces motorcycle safety on every %s provider request", async (_name, isFuture, waypoints) => {
    let requestedUrl: URL | null = null;
    const input = request({ isFuture, waypoints: [...waypoints] });
    const points = [input.origin, ...input.waypoints, input.destination];
    const fetchImpl = vi.fn(async (raw: string | URL | Request) => {
      requestedUrl = new URL(raw instanceof Request ? raw.url : raw.toString());
      return Response.json({ routes: [providerRoute(points)] });
    });

    await requestKakaoRoute(input, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requestedUrl!.pathname).toBe(isFuture ? "/v1/future/directions" : "/v1/directions");
    expect(requestedUrl!.searchParams.get("car_type")).toBe("7");
    expect(requestedUrl!.searchParams.get("avoid")).toBe("motorway");
    expect(requestedUrl!.searchParams.get("roadevent")).toBe("0");
    expect(requestedUrl!.searchParams.get("summary")).toBe("false");
    expect(requestedUrl!.searchParams.get("priority")).toBe("RECOMMEND");
    expect(requestedUrl!.searchParams.has("alternatives")).toBe(false);
    expect(requestedUrl!.searchParams.has("departure_time")).toBe(isFuture);
    expect(requestedUrl!.searchParams.has("waypoints")).toBe(waypoints.length > 0);
  });

  it("ignores additional provider routes and never asks for alternatives", async () => {
    const input = request();
    const points = [input.origin, input.destination];
    let requestedUrl: URL | null = null;
    const fetchImpl = vi.fn(async (raw: string | URL | Request) => {
      requestedUrl = new URL(raw instanceof Request ? raw.url : raw.toString());
      return Response.json({ routes: [providerRoute(points), providerRoute(points, 0.04)] });
    });

    await expect(requestKakaoRoute(input, fetchImpl)).resolves.toMatchObject({ summary: { distance: 1000 } });
    expect(requestedUrl!.searchParams.get("priority")).toBe("RECOMMEND");
    expect(requestedUrl!.searchParams.has("alternatives")).toBe(false);
  });

  it("fails without an unsafe fallback when Kakao is unavailable", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));
    await expect(requestKakaoRoute(request(), fetchImpl)).rejects.toThrow("PROVIDER_UNAVAILABLE");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, "PROVIDER_AUTH_FAILED"],
    [403, "PROVIDER_AUTH_FAILED"],
    [408, "PROVIDER_UNAVAILABLE"],
    [429, "PROVIDER_RATE_LIMITED"],
    [400, "PROVIDER_REQUEST_REJECTED"],
    [422, "PROVIDER_REQUEST_REJECTED"],
    [500, "PROVIDER_UNAVAILABLE"],
  ] as const)("classifies HTTP %s without claiming that no safe route exists", async (status, code) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status }));
    await expect(requestKakaoRoute(request(), fetchImpl)).rejects.toThrow(code);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed successful responses as provider contract failures", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ routes: [{ broken: true }] }));
    await expect(requestKakaoRoute(request(), fetchImpl)).rejects.toThrow("INVALID_ROUTE_PROVIDER_RESPONSE");
  });
});
