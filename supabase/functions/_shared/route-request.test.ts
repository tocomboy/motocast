import { describe, expect, it } from "vitest";

import { signPlace } from "./place-verification";
import { parseRouteRequest, type RoutePointRequest } from "./route-request";

const secret = "test-secret-with-at-least-thirty-two-bytes";

async function point(overrides: Partial<RoutePointRequest> = {}): Promise<RoutePointRequest> {
  const place = {
    kakaoPlaceId: overrides.kakaoPlaceId ?? "123",
    name: overrides.name ?? "팔당역",
    address: overrides.address ?? "경기 남양주시 와부읍 팔당리",
    roadAddress: overrides.roadAddress ?? "경기 남양주시 경강로 2227",
    latitude: overrides.latitude ?? 37.547,
    longitude: overrides.longitude ?? 127.243,
  };
  return {
    ...place,
    id: overrides.id ?? place.kakaoPlaceId,
    label: overrides.label ?? place.name,
    kind: overrides.kind ?? "pass-through",
    verificationToken: await signPlace(place, secret),
    dwellMinutes: overrides.dwellMinutes ?? 0,
    selected: overrides.selected ?? true,
    winding: overrides.winding ?? false,
  };
}

async function request(waypoints: RoutePointRequest[] = []) {
  return {
    origin: await point({ kakaoPlaceId: "origin" }),
    destination: await point({ kakaoPlaceId: "destination" }),
    waypoints,
    departureAt: "2026-08-31T07:30:00+09:00",
    priority: "RECOMMEND" as const,
  };
}

describe("parseRouteRequest", () => {
  it("uses the signed provider name and identity instead of forged display fields", async () => {
    const input = await request();
    input.origin.label = "부산역";
    input.origin.id = "forged-id";
    const parsed = await parseRouteRequest(input, secret);
    expect(parsed.origin.label).toBe("팔당역");
    expect(parsed.origin.id).toBe("origin");
  });

  it("removes an unselected optional rest from the provider route", async () => {
    const rest = await point({ kind: "optional", selected: false, dwellMinutes: 60 });
    const parsed = await parseRouteRequest(await request([rest]), secret);
    expect(parsed.waypoints).toEqual([]);
  });

  it("normalizes pass-through dwell to zero", async () => {
    const via = await point({ kind: "pass-through", dwellMinutes: 60 });
    const parsed = await parseRouteRequest(await request([via]), secret);
    expect(parsed.waypoints[0].dwellMinutes).toBe(0);
  });

  it("rejects normalized or timezone-less departure timestamps", async () => {
    const impossible = { ...await request(), departureAt: "2026-02-31T07:30:00+09:00" };
    await expect(parseRouteRequest(impossible, secret)).rejects.toThrow("INVALID_DEPARTURE");
    const local = { ...await request(), departureAt: "2026-08-31T07:30:00" };
    await expect(parseRouteRequest(local, secret)).rejects.toThrow("INVALID_DEPARTURE");
  });
});
