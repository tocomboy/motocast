import { describe, expect, it } from "vitest";

import { signPlace } from "./place-verification";
import { parseRouteRequest, type RoutePointRequest } from "./route-request";

const secret = "test-secret-with-at-least-thirty-two-bytes";
const fixedNow = () => new Date("2026-08-30T00:00:00.000Z");
const parse = (value: unknown) => parseRouteRequest(value, secret, fixedNow);

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
    const parsed = await parse(input);
    expect(parsed.origin.label).toBe("팔당역");
    expect(parsed.origin.id).toBe("origin");
  });

  it("removes an unselected optional rest from the provider route", async () => {
    const rest = await point({ kind: "optional", selected: false, dwellMinutes: 60, stopRole: "rest" });
    const parsed = await parse(await request([rest]));
    expect(parsed.waypoints).toHaveLength(1);
    expect(parsed.waypoints[0].stopRole).toBe("lunch");
  });

  it("removes any unselected template point while preserving selected order", async () => {
    const disabledWinding = await point({ kakaoPlaceId: "disabled", selected: false, winding: true });
    const selectedVia = await point({ kakaoPlaceId: "selected", winding: true });
    const parsed = await parse(await request([disabledWinding, selectedVia]));
    expect(parsed.waypoints.map((item) => item.kakaoPlaceId)).toEqual(["lunch", "selected"]);
  });

  it("normalizes pass-through dwell to zero", async () => {
    const via = await point({ kind: "pass-through", dwellMinutes: 60 });
    const parsed = await parse(await request([via]));
    expect(parsed.waypoints[1].dwellMinutes).toBe(0);
  });

  it("accepts only zero-dwell pass-through points as winding-only waypoints", async () => {
    const winding = await point({ kakaoPlaceId: "winding", winding: true });
    await expect(parse(await request([winding]))).resolves.toMatchObject({
      waypoints: [expect.objectContaining({ stopRole: "lunch" }), expect.objectContaining({ kakaoPlaceId: "winding", winding: true })],
    });

    const windingLunch = await request();
    windingLunch.waypoints[0].winding = true;
    await expect(parse(windingLunch)).rejects.toThrow("INVALID_WAYPOINTS");

    const windingRest = await point({ kind: "optional", dwellMinutes: 30, stopRole: "rest", winding: true });
    await expect(parse(await request([windingRest]))).rejects.toThrow("INVALID_WAYPOINTS");
  });

  it("rejects more than twenty selected winding points before a provider call", async () => {
    const windingPoints = await Promise.all(Array.from({ length: 21 }, (_, index) => point({
      kakaoPlaceId: `winding-${index}`,
      longitude: 127.1 + index * 0.001,
      winding: true,
    })));
    await expect(parse(await request(windingPoints.slice(0, 20)))).resolves.toMatchObject({
      waypoints: expect.arrayContaining([expect.objectContaining({ kakaoPlaceId: "winding-19" })]),
    });
    await expect(parse(await request(windingPoints))).rejects.toThrow("INVALID_WAYPOINTS");

    windingPoints[20].selected = false;
    await expect(parse(await request(windingPoints))).resolves.toMatchObject({
      waypoints: expect.not.arrayContaining([expect.objectContaining({ kakaoPlaceId: "winding-20" })]),
    });
  });

  it("rejects normalized or timezone-less departure timestamps", async () => {
    const impossible = { ...await request(), departureAt: "2026-02-31T07:30:00+09:00" };
    await expect(parse(impossible)).rejects.toThrow("INVALID_ROUTE_TIME");
    const local = { ...await request(), departureAt: "2026-08-31T07:30:00" };
    await expect(parse(local)).rejects.toThrow("INVALID_ROUTE_TIME");
  });

  it("ignores removed legacy return fields and rejects every client-defined route policy", async () => {
    const withLegacyFields = {
      ...await request(),
      desiredReturnAt: "invalid legacy value",
      hardReturnAt: "invalid legacy value",
    };
    await expect(parse(withLegacyFields)).resolves.not.toHaveProperty("hardReturnAt");
    for (const override of [
      { candidate: "short" }, { priority: "DISTANCE" }, { alternatives: true },
      { car_type: 1 }, { avoid: "none" }, { roadevent: 1 }, { summary: true },
    ]) {
      await expect(parse({ ...await request(), ...override }))
        .rejects.toThrow("CLIENT_ROUTE_POLICY_FORBIDDEN");
    }
  });

  it("requires a v4 planning id for trusted candidate staging", async () => {
    const invalid = { ...await request(), planningId: "client-label" };
    await expect(parse(invalid)).rejects.toThrow("INVALID_PLANNING_ID");
  });

  it("validates the optional target trip identity before provider work", async () => {
    await expect(parse(await request())).resolves.toMatchObject({ tripId: null });
    await expect(parse({
      ...await request(),
      tripId: "f5ef8f03-bf21-4a9b-bf2b-82ce63cfc53e",
    })).resolves.toMatchObject({ tripId: "f5ef8f03-bf21-4a9b-bf2b-82ce63cfc53e" });
    await expect(parse({ ...await request(), tripId: "another-plan" }))
      .rejects.toThrow("INVALID_TRIP_ID");
  });

  it("accepts a late departure without requiring a same-date return boundary", async () => {
    const lateDeparture = {
      ...await request(),
      departureAt: "2026-08-31T23:00:00+09:00",
    };
    await expect(parse(lateDeparture)).resolves.toMatchObject({
      departureAt: "2026-08-31T14:00:00.000Z",
    });
  });

  it("allows no lunch and rejects more than one trusted lunch stop", async () => {
    const missing = await request();
    missing.waypoints = [];
    await expect(parse(missing)).resolves.toMatchObject({ waypoints: [] });
    const duplicate = await request([
      await point({ kakaoPlaceId: "lunch-2", kind: "stop", dwellMinutes: 30, stopRole: "lunch" }),
    ]);
    await expect(parse(duplicate)).rejects.toThrow("INVALID_WAYPOINTS");
  });

  it("rejects a departure before the trusted clock and accepts the exact boundary", async () => {
    const input = await request();
    await expect(parseRouteRequest(input, secret, () => new Date("2026-08-31T00:00:01.000Z")))
      .rejects.toThrow("PAST_DEPARTURE");
    await expect(parseRouteRequest(input, secret, () => new Date("2026-08-30T22:30:00.000Z")))
      .resolves.toMatchObject({ departureAt: "2026-08-30T22:30:00.000Z" });
  });

  it("accepts five ordered rests and rejects a sixth before provider work", async () => {
    const rests = await Promise.all(Array.from({ length: 6 }, (_, index) => point({
      id: `rest-occurrence-${index}`,
      kakaoPlaceId: `rest-${index}`,
      kind: "optional",
      dwellMinutes: 30 + index,
      stopRole: "rest",
    })));
    await expect(parse(await request(rests.slice(0, 5)))).resolves.toMatchObject({
      waypoints: expect.arrayContaining([expect.objectContaining({ id: "rest-occurrence-4", kakaoPlaceId: "rest-4", dwellMinutes: 34 })]),
    });
    await expect(parse(await request(rests))).rejects.toThrow("INVALID_WAYPOINTS");
  });

  it("rejects duplicate selected occurrence ids", async () => {
    const rests = await Promise.all(["rest-a", "rest-b"].map((kakaoPlaceId) => point({
      id: "same-occurrence",
      kakaoPlaceId,
      kind: "optional",
      dwellMinutes: 30,
      stopRole: "rest",
    })));
    await expect(parse(await request(rests))).rejects.toThrow("INVALID_WAYPOINTS");
  });
});
