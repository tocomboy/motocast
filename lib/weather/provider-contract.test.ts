import { describe, expect, it } from "vitest";

import { parseWeatherTimelineResponse, WeatherContractError } from "./provider-contract";

const response = {
  generatedAt: "2026-08-31T00:00:00.000Z",
  issuedAt: "2026-08-30T23:30:00.000Z",
  validUntil: "2026-08-31T02:00:00.000Z",
  source: "live",
  stale: false,
  forecasts: [{
    id: "balanced-0",
    label: "팔당역",
    longitude: 127.243,
    latitude: 37.547,
    eta: "2026-08-31T01:00:00.000Z",
    status: "forecast",
    model: "ultra",
    issuedAt: "2026-08-30T23:30:00.000Z",
    condition: "clear",
    temperatureC: 22,
    precipitationProbability: null,
    windSpeedMps: 1.2,
  }],
};

describe("parseWeatherTimelineResponse", () => {
  it("accepts a live forecast", () => {
    expect(parseWeatherTimelineResponse(response)).toMatchObject({ source: "live", stale: false });
    expect(parseWeatherTimelineResponse({ ...response, source: "cache" })).toMatchObject({ source: "cache", stale: false });
  });

  it("accepts an explicitly stale immutable snapshot", () => {
    expect(parseWeatherTimelineResponse({
      ...response,
      source: "snapshot",
      stale: true,
      staleReason: "기상청 요청에 실패했습니다.",
      failureKind: "provider",
      staleObservedAt: "2026-08-31T00:05:00.000Z",
    }).stale).toBe(true);
  });

  it.each([
    { ...response, source: "snapshot", stale: false },
    { ...response, validUntil: undefined },
    { ...response, source: "snapshot", stale: true, staleReason: "실패", failureKind: "provider", staleObservedAt: undefined },
    { ...response, forecasts: [...response.forecasts, response.forecasts[0]] },
    { ...response, forecasts: [{ ...response.forecasts[0], condition: "storm" }] },
  ])("rejects an unsafe response %#", (value) => {
    expect(() => parseWeatherTimelineResponse(value)).toThrow(WeatherContractError);
  });
});
