import { describe, expect, it } from "vitest";

import { parseSafeRouteResponse, ProviderContractError } from "./provider-contract";

const point = (id: string) => ({
  id,
  label: id,
  latitude: 37.5,
  longitude: 127.1,
  kind: "pass-through",
  dwellMinutes: 0,
  selected: true,
});

function response() {
  return {
    safety: { vehicle: "motorcycle", motorwayExcluded: true, fallbackUsed: false },
    totalDistanceMeters: 12000,
    totalDurationSeconds: 1800,
    returnAt: "2026-08-31T00:30:00.000Z",
    legs: [
      {
        from: point("origin"),
        to: point("destination"),
        via: [],
        departureAt: "2026-08-31T00:00:00.000Z",
        arrivalAt: "2026-08-31T00:30:00.000Z",
        dwellMinutes: 0,
        distanceMeters: 12000,
        durationSeconds: 1800,
        sections: [
          {
            distance: 12000,
            duration: 1800,
            roads: [{ name: "지방도", distance: 12000, duration: 1800, vertexes: [127.1, 37.5, 127.2, 37.6] }],
          },
        ],
        forecastTraffic: true,
      },
    ],
  };
}

describe("parseSafeRouteResponse", () => {
  it("accepts an explicitly motorcycle-safe response", () => {
    expect(parseSafeRouteResponse(response()).safety).toEqual({
      vehicle: "motorcycle",
      motorwayExcluded: true,
      fallbackUsed: false,
    });
  });

  it.each([
    ["passenger car", { vehicle: "car", motorwayExcluded: true, fallbackUsed: false }],
    ["motorway allowed", { vehicle: "motorcycle", motorwayExcluded: false, fallbackUsed: false }],
    ["fallback used", { vehicle: "motorcycle", motorwayExcluded: true, fallbackUsed: true }],
  ])("rejects unsafe evidence: %s", (_label, safety) => {
    expect(() => parseSafeRouteResponse({ ...response(), safety })).toThrowError(
      new ProviderContractError("UNSAFE_ROUTE_RESPONSE"),
    );
  });

  it("rejects empty route legs instead of treating them as success", () => {
    expect(() => parseSafeRouteResponse({ ...response(), legs: [] })).toThrowError(
      new ProviderContractError("INVALID_ROUTE_LEGS"),
    );
  });

  it("rejects malformed geometry", () => {
    const value = response();
    value.legs[0].sections[0].roads[0].vertexes = [127.1, 37.5, Number.NaN, 37.6];
    expect(() => parseSafeRouteResponse(value)).toThrowError(
      new ProviderContractError("INVALID_ROUTE_GEOMETRY"),
    );
  });
});
