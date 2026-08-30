import { describe, expect, it } from "vitest";

import { parseWeatherPoints } from "./weather-request";

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
});
