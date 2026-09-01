import { describe, expect, expectTypeOf, it } from "vitest";

import { parseSharedRideSnapshot, type SharedPlace, type SharedRideSnapshot } from "./contracts";

const origin = { id: "origin", label: "출발", longitude: 127, latitude: 37, kind: "pass-through", dwellMinutes: 0, selected: true };
const destination = { id: "destination", label: "복귀", longitude: 127.2, latitude: 37.2, kind: "pass-through", dwellMinutes: 0, selected: true };

function route(id: "recommended" | "balanced" | "winding" | "short", middle: number) {
  return {
    candidate: { id, label: id === "recommended" ? "추천 경로" : id === "winding" ? "와인딩" : id, estimatedWinding: false },
    safety: { vehicle: "motorcycle", motorwayExcluded: true, fallbackUsed: false },
    totalDistanceMeters: 10000,
    totalDurationSeconds: 600,
    returnAt: "2026-08-31T00:10:00.000Z",
    legs: [{
      from: origin,
      to: destination,
      via: [],
      departureAt: "2026-08-31T00:00:00.000Z",
      arrivalAt: "2026-08-31T00:10:00.000Z",
      dwellMinutes: 0,
      distanceMeters: 10000,
      durationSeconds: 600,
      forecastTraffic: false,
      sections: [{
        distance: 10000,
        duration: 600,
        roads: [{ name: "도로", distance: 10000, duration: 600, vertexes: [127, 37, middle, 37.1, 127.2, 37.2] }],
      }],
    }],
  };
}

const snapshot = {
  schemaVersion: 2,
  trip: {
    title: "당일 라이딩",
    serviceDate: "2026-08-31",
    departureAt: "2026-08-31T00:00:00.000Z",
    origin,
    destination,
    lunchStop: { id: "lunch", label: "점심", longitude: 127.1, latitude: 37.1 },
    dinnerStop: null,
    selectedProfile: "balanced",
  },
  waypoints: [{ position: 0, id: "lunch", label: "점심", longitude: 127.1, latitude: 37.1, kind: "stop", dwellMinutes: 60, selected: true, winding: false }],
  routes: [
    { profile: "balanced", route: route("balanced", 127.05) },
    { profile: "winding", route: route("winding", 127.1) },
    { profile: "short", route: route("short", 127.15) },
  ],
  weather: null,
};

describe("parseSharedRideSnapshot", () => {
  it("models lunch nullability by schema version", () => {
    expectTypeOf<Extract<SharedRideSnapshot, { schemaVersion: 1 }>["trip"]["lunchStop"]>()
      .toEqualTypeOf<SharedPlace>();
    expectTypeOf<Extract<SharedRideSnapshot, { schemaVersion: 2 }>["trip"]["lunchStop"]>()
      .toEqualTypeOf<SharedPlace>();
    expectTypeOf<Extract<SharedRideSnapshot, { schemaVersion: 3 }>["trip"]["lunchStop"]>()
      .toEqualTypeOf<SharedPlace | null>();
  });

  it("accepts a schema version 3 snapshot with exactly one recommended route", () => {
    const current = {
      schemaVersion: 3,
      trip: {
        title: snapshot.trip.title,
        serviceDate: snapshot.trip.serviceDate,
        departureAt: snapshot.trip.departureAt,
        origin: snapshot.trip.origin,
        destination: snapshot.trip.destination,
        lunchStop: snapshot.trip.lunchStop,
        dinnerStop: null,
      },
      waypoints: snapshot.waypoints,
      route: route("recommended", 127.1),
      weather: null,
    };
    expect(parseSharedRideSnapshot(current)).toMatchObject({
      schemaVersion: 3,
      route: { candidate: { id: "recommended", label: "추천 경로" } },
    });
    expect(() => parseSharedRideSnapshot({ ...current, routes: snapshot.routes })).toThrow("INVALID_SHARE_SNAPSHOT");
    expect(() => parseSharedRideSnapshot({ ...current, route: route("balanced", 127.1) })).toThrow("INVALID_RECOMMENDED_ROUTE_RESPONSE");

    expect(parseSharedRideSnapshot({
      ...current,
      trip: { ...current.trip, lunchStop: null },
      waypoints: [],
    })).toMatchObject({ schemaVersion: 3, trip: { lunchStop: null }, waypoints: [] });

    const matchingWeather = {
      source: "kma",
      issuedAt: "2026-08-30T23:30:00.000Z",
      retrievedAt: "2026-08-30T23:35:00.000Z",
      validUntil: "2026-08-31T02:00:00.000Z",
      stale: false,
      staleObservedAt: null,
      staleReason: null,
      failureKind: null,
      segments: [{
        id: "recommended-0", label: destination.label,
        longitude: destination.longitude, latitude: destination.latitude,
        eta: "2026-08-31T00:10:00.000Z", status: "forecast", model: "ultra",
        issuedAt: "2026-08-30T23:30:00.000Z", condition: "clear",
        temperatureC: 20, precipitationProbability: 0, windSpeedMps: 1,
      }],
    };
    expect(() => parseSharedRideSnapshot({ ...current, weather: matchingWeather })).not.toThrow();
    expect(() => parseSharedRideSnapshot({
      ...current,
      weather: { ...matchingWeather, segments: [{ ...matchingWeather.segments[0], id: "balanced-0" }] },
    })).toThrow("INVALID_SHARE_SNAPSHOT");
    expect(() => parseSharedRideSnapshot({
      ...current,
      weather: { ...matchingWeather, segments: [{ ...matchingWeather.segments[0], longitude: 128 }] },
    })).toThrow("INVALID_SHARE_SNAPSHOT");
  });

  it("keeps lunch required for historical schema versions", () => {
    for (const schemaVersion of [1, 2] as const) {
      expect(() => parseSharedRideSnapshot({
        ...snapshot,
        schemaVersion,
        trip: {
          ...snapshot.trip,
          ...(schemaVersion === 1 ? {
            desiredReturnAt: "2026-08-31T08:00:00.000Z",
            hardReturnAt: "2026-08-31T09:00:00.000Z",
          } : {}),
          lunchStop: null,
        },
      })).toThrow("INVALID_SHARE_SNAPSHOT");
    }
  });

  it("accepts a complete immutable snapshot with three safe routes", () => {
    expect(parseSharedRideSnapshot(snapshot)).toMatchObject({ schemaVersion: 2, weather: null });
  });

  it("keeps previously emitted schema version 1 snapshots readable", () => {
    const legacy = {
      ...snapshot,
      schemaVersion: 1,
      trip: {
        ...snapshot.trip,
        desiredReturnAt: "2026-08-31T08:00:00.000Z",
        hardReturnAt: "2026-08-31T09:00:00.000Z",
      },
      waypoints: [{ position: 0, label: "점심", longitude: 127.1, latitude: 37.1, kind: "stop", dwellMinutes: 60, selected: true, winding: false }],
      weather: {
        source: "kma",
        issuedAt: "2026-08-30T23:30:00.000Z",
        retrievedAt: "2026-08-30T23:35:00.000Z",
        candidateProfile: "balanced",
        segments: [{
          id: "balanced-0",
          label: "복귀",
          longitude: 127.2,
          latitude: 37.2,
          eta: "2026-08-31T00:10:00.000Z",
          status: "forecast",
          model: "ultra",
          issuedAt: "2026-08-30T23:30:00.000Z",
          condition: "clear",
          temperatureC: 22,
          precipitationProbability: 0,
          windSpeedMps: 1.2,
        }],
      },
    };
    expect(parseSharedRideSnapshot(legacy)).toMatchObject({
      schemaVersion: 1,
      trip: { desiredReturnAt: "2026-08-31T08:00:00.000Z" },
      waypoints: [{ id: "waypoint-0" }],
      weather: {
        retrievedAt: "2026-08-30T23:35:00.000Z",
        validUntil: "2026-08-30T23:35:00.000Z",
        stale: false,
        failureKind: null,
      },
    });
  });

  it("keeps a version 1 snapshot without weather readable", () => {
    expect(parseSharedRideSnapshot({
      ...snapshot,
      schemaVersion: 1,
      trip: {
        ...snapshot.trip,
        desiredReturnAt: "2026-08-31T08:00:00.000Z",
        hardReturnAt: "2026-08-31T09:00:00.000Z",
      },
      waypoints: [{ position: 0, label: "점심", longitude: 127.1, latitude: 37.1, kind: "stop", dwellMinutes: 60, selected: true, winding: false }],
      weather: null,
    })).toMatchObject({ schemaVersion: 1, weather: null, waypoints: [{ id: "waypoint-0" }] });
  });

  it("rejects string-coerced schema versions", () => {
    expect(() => parseSharedRideSnapshot({ ...snapshot, schemaVersion: "1" })).toThrow("INVALID_SHARE_SNAPSHOT");
    expect(() => parseSharedRideSnapshot({ ...snapshot, schemaVersion: "2" })).toThrow("INVALID_SHARE_SNAPSHOT");
  });

  it("rejects coerced waypoint positions in both current and legacy snapshots", () => {
    for (const schemaVersion of [1, 2] as const) {
      for (const position of [null, "", "0"]) {
        expect(() => parseSharedRideSnapshot({
          ...snapshot,
          schemaVersion,
          trip: schemaVersion === 1 ? {
            ...snapshot.trip,
            desiredReturnAt: "2026-08-31T08:00:00.000Z",
            hardReturnAt: "2026-08-31T09:00:00.000Z",
          } : snapshot.trip,
          waypoints: [{ ...snapshot.waypoints[0], position }],
        })).toThrow("INVALID_SHARE_SNAPSHOT");
      }
    }
  });

  it("rejects internal place verification material from a public snapshot", () => {
    expect(() => parseSharedRideSnapshot({
      ...snapshot,
      trip: { ...snapshot.trip, origin: { ...snapshot.trip.origin, verificationToken: "a".repeat(43) } },
    })).toThrow("INVALID_SHARE_SNAPSHOT");
  });

  it("accepts the DB snapshot weather whitelist and preserves model/window fields", () => {
    const withWeather = {
      ...snapshot,
      weather: {
        source: "kma",
        issuedAt: "2026-08-30T23:30:00.000Z",
        retrievedAt: "2026-08-30T23:35:00.000Z",
        validUntil: "2026-08-31T02:00:00.000Z",
        stale: true,
        staleObservedAt: "2026-08-30T23:40:00.000Z",
        staleReason: "기상청 요청에 실패했습니다.",
        failureKind: "provider",
        candidateProfile: "balanced",
        segments: [{
          id: "balanced-0",
          label: "복귀",
          longitude: 127.2,
          latitude: 37.2,
          eta: "2026-08-31T00:10:00.000Z",
          status: "forecast",
          model: "ultra",
          issuedAt: "2026-08-30T23:30:00.000Z",
          condition: "clear",
          temperatureC: 22,
          precipitationProbability: 0,
          windSpeedMps: 1.2,
        }],
      },
    };
    expect(parseSharedRideSnapshot(withWeather).weather?.segments[0]).toMatchObject({
      id: "balanced-0",
      model: "ultra",
      condition: "clear",
    });
    expect(parseSharedRideSnapshot(withWeather).weather).toMatchObject({ stale: true, staleReason: "기상청 요청에 실패했습니다.", failureKind: "provider" });
    const legacy = structuredClone(withWeather);
    delete (legacy.weather as Record<string, unknown>).failureKind;
    expect(parseSharedRideSnapshot(legacy).weather).toMatchObject({ stale: true, failureKind: null });
  });
});
