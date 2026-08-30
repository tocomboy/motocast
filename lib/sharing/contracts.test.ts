import { describe, expect, it } from "vitest";

import { parseSharedRideSnapshot } from "./contracts";

const origin = { id: "origin", label: "출발", longitude: 127, latitude: 37, kind: "pass-through", dwellMinutes: 0, selected: true };
const destination = { id: "destination", label: "복귀", longitude: 127.2, latitude: 37.2, kind: "pass-through", dwellMinutes: 0, selected: true };

function route(id: "balanced" | "winding" | "short", middle: number) {
  return {
    candidate: { id, label: id === "winding" ? "와인딩" : id, estimatedWinding: false },
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
  schemaVersion: 1,
  trip: {
    title: "당일 라이딩",
    serviceDate: "2026-08-31",
    departureAt: "2026-08-31T00:00:00.000Z",
    desiredReturnAt: "2026-08-31T08:00:00.000Z",
    hardReturnAt: "2026-08-31T09:00:00.000Z",
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
  it("accepts a complete immutable snapshot with three safe routes", () => {
    expect(parseSharedRideSnapshot(snapshot)).toMatchObject({ schemaVersion: 1, weather: null });
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
  });
});
