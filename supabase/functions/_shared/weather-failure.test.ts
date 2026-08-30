import { describe, expect, it } from "vitest";

import { weatherFailureKind } from "./weather-failure";

describe("weatherFailureKind", () => {
  it.each([
    ["KMA_REQUEST_FAILED", "provider"],
    ["KMA_FORECAST_NOT_FOUND", "provider"],
    ["API_DAILY_BUDGET_EXHAUSTED", "budget"],
    ["API_BUDGET_NOT_CONFIGURED", "configuration"],
    ["API_BUDGET_ACCOUNTING_FAILED", "persistence"],
    ["PROVIDER_NOT_CONFIGURED", "configuration"],
    ["WEATHER_PERSIST_FAILED", "persistence"],
    ["INVALID_WEATHER_ROUTE", "request"],
  ] as const)("maps %s to the safe %s category", (code, expected) => {
    expect(weatherFailureKind(new Error(code))).toBe(expected);
  });
});
