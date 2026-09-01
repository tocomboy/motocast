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

  it("removes any unselected template point while preserving selected order", async () => {
    const disabledWinding = await point({ kakaoPlaceId: "disabled", selected: false, winding: true });
    const selectedVia = await point({ kakaoPlaceId: "selected", winding: true });
    const parsed = await parseRouteRequest(await request([disabledWinding, selectedVia]), secret);
    expect(parsed.waypoints.map((item) => item.kakaoPlaceId)).toEqual(["lunch", "selected"]);
  });

  it("normalizes pass-through dwell to zero", async () => {
    const via = await point({ kind: "pass-through", dwellMinutes: 60 });
    const parsed = await parseRouteRequest(await request([via]), secret);
    expect(parsed.waypoints[1].dwellMinutes).toBe(0);
  });

  it("accepts only zero-dwell pass-through points as winding-only waypoints", async () => {
    const winding = await point({ kakaoPlaceId: "winding", winding: true });
    await expect(parseRouteRequest(await request([winding]), secret)).resolves.toMatchObject({
      waypoints: [expect.objectContaining({ stopRole: "lunch" }), expect.objectContaining({ kakaoPlaceId: "winding", winding: true })],
    });

    const windingLunch = await request();
    windingLunch.waypoints[0].winding = true;
    await expect(parseRouteRequest(windingLunch, secret)).rejects.toThrow("INVALID_WAYPOINTS");

    const windingRest = await point({ kind: "optional", dwellMinutes: 30, stopRole: "rest", winding: true });
    await expect(parseRouteRequest(await request([windingRest]), secret)).rejects.toThrow("INVALID_WAYPOINTS");
  });

  it("rejects normalized or timezone-less departure timestamps", async () => {
    const impossible = { ...await request(), departureAt: "2026-02-31T07:30:00+09:00" };
    await expect(parseRouteRequest(impossible, secret)).rejects.toThrow("INVALID_ROUTE_TIME");
    const local = { ...await request(), departureAt: "2026-08-31T07:30:00" };
    await expect(parseRouteRequest(local, secret)).rejects.toThrow("INVALID_ROUTE_TIME");
  });

  it("ignores removed legacy return fields and rejects every client-defined route policy", async () => {
    const withLegacyFields = {
      ...await request(),
      desiredReturnAt: "invalid legacy value",
      hardReturnAt: "invalid legacy value",
    };
    await expect(parseRouteRequest(withLegacyFields, secret)).resolves.not.toHaveProperty("hardReturnAt");
    for (const override of [
      { candidate: "short" }, { priority: "DISTANCE" }, { alternatives: true },
      { car_type: 1 }, { avoid: "none" }, { roadevent: 1 }, { summary: true },
    ]) {
      await expect(parseRouteRequest({ ...await request(), ...override }, secret))
        .rejects.toThrow("CLIENT_ROUTE_POLICY_FORBIDDEN");
    }
  });

  it("requires a v4 planning id for trusted candidate staging", async () => {
    const invalid = { ...await request(), planningId: "client-label" };
    await expect(parseRouteRequest(invalid, secret)).rejects.toThrow("INVALID_PLANNING_ID");
  });

  it("accepts a late departure without requiring a same-date return boundary", async () => {
    const lateDeparture = {
      ...await request(),
      departureAt: "2026-08-31T23:00:00+09:00",
    };
    await expect(parseRouteRequest(lateDeparture, secret)).resolves.toMatchObject({
      departureAt: "2026-08-31T14:00:00.000Z",
    });
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
