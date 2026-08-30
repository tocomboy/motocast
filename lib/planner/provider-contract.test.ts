import { describe, expect, it } from "vitest";

import { parseSafeRouteResponse, ProviderContractError } from "./provider-contract";
import { buildSafeRouteResponse } from "../../supabase/functions/_shared/route-response";

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
  return buildSafeRouteResponse({
    candidate: { id: "balanced", label: "균형", estimatedWinding: false },
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
        providerRequestNumber: 1,
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
  });
}

describe("parseSafeRouteResponse", () => {
  it("accepts an explicitly motorcycle-safe response", () => {
    expect(parseSafeRouteResponse(response()).safety).toEqual({
      vehicle: "motorcycle",
      motorwayExcluded: true,
      fallbackUsed: false,
    });
  });

  it("requires estimated winding routes to be labeled honestly", () => {
    expect(() => parseSafeRouteResponse({
      ...response(),
      candidate: { id: "winding", label: "와인딩", estimatedWinding: true },
    })).toThrowError(new ProviderContractError("INVALID_ROUTE_CANDIDATE"));
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

  it("rejects odd geometry coordinate pairs", () => {
    const value = response();
    value.legs[0].sections[0].roads[0].vertexes = [127.1, 37.5, 127.2];
    expect(() => parseSafeRouteResponse(value)).toThrowError(
      new ProviderContractError("INVALID_ROUTE_GEOMETRY"),
    );
  });

  it("rejects discontinuous leg time and endpoint sequences", () => {
    const value = response();
    const destination = point("destination");
    value.legs[0].to = { ...point("middle"), dwellMinutes: 10 };
    value.legs[0].dwellMinutes = 10;
    value.legs.push({
      ...value.legs[0],
      from: point("different-middle"),
      to: destination,
      departureAt: "2026-08-31T00:20:00.000Z",
      arrivalAt: "2026-08-31T00:30:00.000Z",
      dwellMinutes: 0,
      durationSeconds: 600,
      distanceMeters: 4000,
      sections: [{
        distance: 4000,
        duration: 600,
        roads: [{ name: "지방도", distance: 4000, duration: 600, vertexes: [127.1, 37.5, 127.2, 37.6] }],
      }],
    });
    value.totalDistanceMeters = 16000;
    value.totalDurationSeconds = 3000;
    expect(() => parseSafeRouteResponse(value)).toThrowError(
      new ProviderContractError("DISCONTINUOUS_ROUTE_LEGS"),
    );
  });

  it("rejects totals that do not match the accepted legs", () => {
    expect(() => parseSafeRouteResponse({ ...response(), totalDurationSeconds: 60 })).toThrowError(
      new ProviderContractError("INVALID_ROUTE_TOTALS"),
    );
  });

  it("rejects a leg whose timestamps hide a longer provider duration", () => {
    const value = response();
    value.legs[0].arrivalAt = "2026-08-31T00:01:00.000Z";
    value.returnAt = value.legs[0].arrivalAt;
    expect(() => parseSafeRouteResponse(value)).toThrowError(
      new ProviderContractError("INVALID_ROUTE_TOTALS"),
    );
  });

  it("rejects an empty successful geometry", () => {
    const value = response();
    value.legs[0].sections = [];
    expect(() => parseSafeRouteResponse(value)).toThrowError(
      new ProviderContractError("INVALID_ROUTE_GEOMETRY"),
    );
  });

  it("rejects section and road totals that disagree with the leg", () => {
    const value = response();
    value.legs[0].sections[0].roads[0].distance = 11000;
    expect(() => parseSafeRouteResponse(value)).toThrowError(
      new ProviderContractError("INVALID_ROUTE_TOTALS"),
    );
  });
});
