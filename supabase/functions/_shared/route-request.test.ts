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
    stopRole: overrides.stopRole,
  };
}

async function request(waypoints: RoutePointRequest[] = []) {
  const lunch = await point({ kakaoPlaceId: "lunch", kind: "stop", dwellMinutes: 60, stopRole: "lunch" });
  return {
    planningId: "123e4567-e89b-42d3-a456-426614174000",
    origin: await point({ kakaoPlaceId: "origin" }),
    destination: await point({ kakaoPlaceId: "destination" }),
    waypoints: [lunch, ...waypoints],
    serviceDate: "2026-08-31",
    departureAt: "2026-08-31T07:30:00+09:00",
    desiredReturnAt: "2026-08-31T17:30:00+09:00",
    hardReturnAt: "2026-08-31T18:30:00+09:00",
    candidate: "balanced" as const,
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
    const rest = await point({ kind: "optional", selected: false, dwellMinutes: 60, stopRole: "rest" });
    const parsed = await parseRouteRequest(await request([rest]), secret);
    expect(parsed.waypoints).toHaveLength(1);
    expect(parsed.waypoints[0].stopRole).toBe("lunch");
  });

  it("normalizes pass-through dwell to zero", async () => {
    const via = await point({ kind: "pass-through", dwellMinutes: 60 });
    const parsed = await parseRouteRequest(await request([via]), secret);
    expect(parsed.waypoints[1].dwellMinutes).toBe(0);
  });

  it("rejects normalized or timezone-less departure timestamps", async () => {
    const impossible = { ...await request(), departureAt: "2026-02-31T07:30:00+09:00" };
    await expect(parseRouteRequest(impossible, secret)).rejects.toThrow("INVALID_ROUTE_TIME");
    const local = { ...await request(), departureAt: "2026-08-31T07:30:00" };
    await expect(parseRouteRequest(local, secret)).rejects.toThrow("INVALID_ROUTE_TIME");
  });

  it("rejects an invalid return boundary and client-defined provider priority", async () => {
    const invalid = { ...await request(), hardReturnAt: "2026-08-31T17:00:00+09:00" };
    await expect(parseRouteRequest(invalid, secret)).rejects.toThrow("INVALID_ROUTE_TIME");
    const legacy = { ...await request(), candidate: undefined, priority: "DISTANCE" };
    await expect(parseRouteRequest(legacy, secret)).rejects.toThrow("INVALID_CANDIDATE");
  });

  it("requires a v4 planning id for trusted candidate staging", async () => {
    const invalid = { ...await request(), planningId: "client-label" };
    await expect(parseRouteRequest(invalid, secret)).rejects.toThrow("INVALID_PLANNING_ID");
  });

  it("rejects an overnight route even when it is under 24 hours", async () => {
    const overnight = {
      ...await request(),
      departureAt: "2026-08-31T23:00:00+09:00",
      desiredReturnAt: "2026-09-01T00:30:00+09:00",
      hardReturnAt: "2026-09-01T01:00:00+09:00",
    };
    await expect(parseRouteRequest(overnight, secret)).rejects.toThrow("INVALID_ROUTE_TIME");
  });

  it("requires exactly one trusted lunch stop", async () => {
    const missing = await request();
    missing.waypoints = [];
    await expect(parseRouteRequest(missing, secret)).rejects.toThrow("INVALID_WAYPOINTS");
    const duplicate = await request([
      await point({ kakaoPlaceId: "lunch-2", kind: "stop", dwellMinutes: 30, stopRole: "lunch" }),
    ]);
    await expect(parseRouteRequest(duplicate, secret)).rejects.toThrow("INVALID_WAYPOINTS");
  });
});
