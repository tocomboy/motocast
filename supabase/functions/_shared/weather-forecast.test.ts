import { describe, expect, it } from "vitest";

import {
  conditionFrom,
  forecastTarget,
  forecastWindow,
  gridFromCoordinates,
  issuedAtIso,
  latestForecastBase,
  validatedForecastValues,
} from "./weather-forecast";

describe("weather forecast boundaries", () => {
  const now = new Date("2026-08-31T00:00:00.000Z");

  it("uses ultra-short through the exact six-hour boundary", () => {
    expect(forecastWindow(new Date(now.getTime() + 6 * 60 * 60_000), now)).toBe("ultra");
    expect(forecastWindow(new Date(now.getTime() + 6 * 60 * 60_000 + 1), now)).toBe("short");
  });

  it("uses short-term through the exact five-day boundary without a later provider call", () => {
    expect(forecastWindow(new Date(now.getTime() + 5 * 24 * 60 * 60_000), now)).toBe("short");
    expect(forecastWindow(new Date(now.getTime() + 5 * 24 * 60 * 60_000 + 1), now)).toBe("outside-window");
  });

  it("maps a known Seoul coordinate to the KMA grid", () => {
    expect(gridFromCoordinates(37.5665, 126.978)).toEqual({ nx: 60, ny: 127 });
  });

  it("selects valid KST bases and targets", () => {
    expect(latestForecastBase("ultra", new Date("2026-08-31T00:44:00+09:00"))).toEqual({ date: "20260830", time: "2330" });
    expect(latestForecastBase("short", new Date("2026-08-31T01:00:00+09:00"))).toEqual({ date: "20260830", time: "2300" });
    expect(forecastTarget(new Date("2026-08-31T09:31:00+09:00"))).toEqual({ date: "20260831", time: "1000" });
    expect(issuedAtIso({ date: "20260831", time: "0830" })).toBe("2026-08-30T23:30:00.000Z");
  });

  it("derives a non-color weather condition", () => {
    expect(conditionFrom({ PTY: "1", SKY: "1" })).toBe("rain");
    expect(conditionFrom({ PTY: "0", SKY: "4" })).toBe("cloudy");
  });

  it("requires every displayed value in the selected forecast time", () => {
    const base = {
      baseDate: "20260831",
      baseTime: "1100",
      fcstDate: "20260831",
      fcstTime: "1200",
      nx: 60,
      ny: 127,
    };
    const items = [
      { ...base, category: "TMP", fcstValue: "22" },
      { ...base, category: "POP", fcstValue: "30" },
      { ...base, category: "WSD", fcstValue: "2.5" },
      { ...base, category: "SKY", fcstValue: "3" },
      { ...base, category: "PTY", fcstValue: "0" },
    ];
    expect(validatedForecastValues(items, { date: "20260831", time: "1200" }, "short")).toMatchObject({
      TMP: "22",
      POP: "30",
      WSD: "2.5",
      SKY: "3",
      PTY: "0",
    });
    expect(() => validatedForecastValues(
      items.filter((item) => item.category !== "WSD"),
      { date: "20260831", time: "1200" },
      "short",
    )).toThrow("KMA_INVALID_RESPONSE");
  });
});
