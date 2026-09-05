import { describe, expect, it } from "vitest";
import { KmaResponseValidationError, kmaResponseDiagnostic } from "./weather-failure";

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

  const forecastItems = (
    model: "ultra" | "short",
    fcstTime: string,
    temperature = "22",
  ) => [
    { category: model === "ultra" ? "T1H" : "TMP", fcstValue: temperature },
    { category: "POP", fcstValue: "30" },
    { category: "WSD", fcstValue: "2.5" },
    { category: "SKY", fcstValue: "3" },
    { category: "PTY", fcstValue: "0" },
  ].map((item) => ({
    baseDate: "20260831",
    baseTime: "1100",
    fcstDate: "20260831",
    fcstTime,
    nx: 60,
    ny: 127,
    ...item,
  }));

  it.each(["ultra", "short"] as const)("identifies every missing required category in %s without accepting it", (model) => {
    const categories = [model === "ultra" ? "T1H" : "TMP", "POP", "WSD", "SKY", "PTY"];
    const reasons = ["MISSING_TEMPERATURE", "MISSING_POP", "MISSING_WSD", "MISSING_SKY", "MISSING_PTY"] as const;
    const items = categories.map((category) => ({
      baseDate: "20260831", baseTime: "1100", fcstDate: "20260831", fcstTime: "1200",
      nx: 60, ny: 127, category, fcstValue: "1",
    }));
    for (const [index, category] of categories.entries()) {
      let error: unknown;
      try { validatedForecastValues(items.filter((item) => item.category !== category), { date: "20260831", time: "1200" }, model); }
      catch (value) { error = value; }
      expect(error).toEqual(new KmaResponseValidationError(reasons[index]));
      expect(kmaResponseDiagnostic(error)).toBe(reasons[index]);
    }
  });

  it("uses ultra-short through the exact six-hour boundary and short immediately after it", () => {
    expect(forecastWindow(new Date(now.getTime() + 6 * 60 * 60_000 - 1), now)).toBe("ultra");
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

  it("keeps the ultra publication gate at the exact KST :45 boundary and requests HH00", () => {
    expect(latestForecastBase("ultra", new Date("2026-08-31T10:44:59.999+09:00"))).toEqual({ date: "20260831", time: "0900" });
    expect(latestForecastBase("ultra", new Date("2026-08-31T10:45:00.000+09:00"))).toEqual({ date: "20260831", time: "1000" });
  });

  it.each([
    ["month", "2026-09-01T00:44:59.999+09:00", { date: "20260831", time: "2300" }],
    ["year", "2027-01-01T00:44:59.999+09:00", { date: "20261231", time: "2300" }],
  ] as const)("rolls the ultra HH00 base across a %s boundary in KST", (_label, instant, expected) => {
    expect(latestForecastBase("ultra", new Date(instant))).toEqual(expected);
  });

  it("selects the existing short-term base and KST target", () => {
    expect(latestForecastBase("short", new Date("2026-08-31T01:00:00+09:00"))).toEqual({ date: "20260830", time: "2300" });
    expect(forecastTarget(new Date("2026-08-31T09:31:00+09:00"))).toEqual({ date: "20260831", time: "1000" });
    expect(issuedAtIso({ date: "20260831", time: "0800" })).toBe("2026-08-30T23:00:00.000Z");
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

    const ultraItems = items.map((item) => item.category === "TMP"
      ? { ...item, category: "T1H" }
      : item);
    expect(validatedForecastValues(ultraItems, { date: "20260831", time: "1200" }, "ultra")).toMatchObject({
      T1H: "22",
      POP: "30",
    });
    expect(() => validatedForecastValues(
      ultraItems.filter((item) => item.category !== "POP"),
      { date: "20260831", time: "1200" },
      "ultra",
    )).toThrow("KMA_INVALID_RESPONSE");
  });

  it("uses only the exact ultra target forecast group", () => {
    const items = [
      ...forecastItems("ultra", "1100", "99"),
      ...forecastItems("ultra", "1200", "22"),
      ...forecastItems("ultra", "1300", "88"),
    ];
    expect(validatedForecastValues(items, { date: "20260831", time: "1200" }, "ultra")).toMatchObject({
      T1H: "22",
      POP: "30",
      WSD: "2.5",
      SKY: "3",
      PTY: "0",
    });
  });

  it("rejects an ultra response that has no exact target group", () => {
    expect(() => validatedForecastValues(
      forecastItems("ultra", "1300"),
      { date: "20260831", time: "1200" },
      "ultra",
    )).toThrow("KMA_FORECAST_NOT_FOUND");
  });

  it("does not fill a missing ultra target value from a neighboring complete group", () => {
    const items = [
      ...forecastItems("ultra", "1100"),
      ...forecastItems("ultra", "1200").filter((item) => item.category !== "WSD"),
    ];
    let error: unknown;
    try {
      validatedForecastValues(items, { date: "20260831", time: "1200" }, "ultra");
    } catch (value) {
      error = value;
    }
    expect(error).toEqual(new KmaResponseValidationError("MISSING_WSD"));
  });

  it("preserves nearest available three-hour group selection for short-term forecasts", () => {
    const items = [
      ...forecastItems("short", "1200", "12"),
      ...forecastItems("short", "1500", "15"),
    ];
    expect(validatedForecastValues(items, { date: "20260831", time: "1400" }, "short")).toMatchObject({
      TMP: "15",
      POP: "30",
    });
  });
});
