import { describe, expect, it } from "vitest";

import { assertWeatherPointsMatch, weatherPointsFromStoredRoute } from "./weather-route";

const route = {
  candidate: { id: "balanced" },
  legs: [{
    to: { label: "팔당역", longitude: 127.243, latitude: 37.547 },
    arrivalAt: "2026-08-31T09:00:00+09:00",
  }],
};

describe("stored route weather projection", () => {
  it("derives canonical weather points from persisted legs", () => {
    expect(weatherPointsFromStoredRoute(route, "balanced")).toEqual([{
      id: "balanced-0",
      label: "팔당역",
      longitude: 127.243,
      latitude: 37.547,
      eta: "2026-08-31T00:00:00.000Z",
    }]);
  });

  it("rejects a browser point or ETA that differs from the stored route", () => {
    const stored = weatherPointsFromStoredRoute(route, "balanced");
    expect(() => assertWeatherPointsMatch([{ ...stored[0], longitude: 127.5 }], stored)).toThrow("INVALID_WEATHER_ROUTE");
  });
});
