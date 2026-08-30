import { describe, expect, it } from "vitest";

import { parseWeatherPoints, parseWeatherRequest } from "./weather-request";

const point = {
  id: "pal-dang",
  label: "팔당역",
  longitude: 127.243,
  latitude: 37.547,
  eta: "2026-08-31T09:00:00+09:00",
};
const now = Date.parse("2026-08-31T07:00:00+09:00");

describe("parseWeatherPoints", () => {
  it("normalizes a strict RFC 3339 ETA", () => {
    expect(parseWeatherPoints({ points: [point] }, now)[0].eta).toBe("2026-08-31T00:00:00.000Z");
  });

  it.each([
    "2026-02-31T09:00:00+09:00",
    "2026-08-31T09:00:00",
  ])("rejects invalid or timezone-less ETA %s", (eta) => {
    expect(() => parseWeatherPoints({ points: [{ ...point, eta }] }, now)).toThrow("INVALID_POINT");
  });

  it("accepts an owned-trip request shape", () => {
    expect(parseWeatherRequest({
      tripId: "f5ef8f03-bf21-4a9b-bf2b-82ce63cfc53e",
      candidateProfile: "balanced",
      points: [point],
    }, now)).toMatchObject({
      tripId: "f5ef8f03-bf21-4a9b-bf2b-82ce63cfc53e",
      candidateProfile: "balanced",
    });
  });

  it.each([
    { tripId: "not-a-uuid", candidateProfile: "balanced" },
    { tripId: null, candidateProfile: "fastest" },
  ])("rejects invalid request metadata %#", (metadata) => {
    expect(() => parseWeatherRequest({ ...metadata, points: [point] }, now)).toThrow(/^INVALID_/);
  });
});
