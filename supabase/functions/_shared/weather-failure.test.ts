import { describe, expect, it } from "vitest";

import { KmaResponseValidationError, kmaResponseDiagnostic, safeWeatherDiagnosticCode, weatherFailureKind } from "./weather-failure";

describe("bounded weather diagnostics", () => {
  it.each([
    "JSON_BODY", "OBJECT_SHAPE", "ITEM_SHAPE", "BASE_BINDING", "CATEGORY_SHAPE",
    "FORECAST_IDENTITY", "VALUE_CONTRACT", "GRID_BINDING", "DUPLICATE_IDENTITY",
    "MISSING_TEMPERATURE", "MISSING_POP", "MISSING_WSD", "MISSING_SKY", "MISSING_PTY",
  ] as const)("keeps %s server-only with the original error message", (reason) => {
    const error = new KmaResponseValidationError(reason);
    expect(error.message).toBe("KMA_INVALID_RESPONSE");
    expect(kmaResponseDiagnostic(error)).toBe(reason);
    expect(safeWeatherDiagnosticCode(error)).toBe("KMA_INVALID_RESPONSE");
    expect(weatherFailureKind(error)).toBe("provider");
  });

  it("rejects foreign and forged diagnostic values", () => {
    const error = new KmaResponseValidationError("JSON_BODY");
    Object.assign(error, { reason: "fixture-private-detail" });
    for (const value of [error, new Error("JSON_BODY"), { reason: "JSON_BODY" }, null]) {
      expect(kmaResponseDiagnostic(value)).toBe("UNKNOWN");
    }
  });

  it.each(["AUTH_REQUIRED", "API_DAILY_BUDGET_EXHAUSTED", "WEATHER_PERSIST_FAILED", "KMA_HTTP_STATUS_403", "KMA_RESULT_CODE_03", "KMA_RESULT_CODE_UNKNOWN"])("allows bounded code %s", (code) => {
    expect(safeWeatherDiagnosticCode(new Error(code))).toBe(code);
  });

  it.each(["fixture-private-detail", "KMA_HTTP_STATUS_999", "KMA_HTTP_STATUS_403 private", "KMA_RESULT_CODE_private", "KMA_RESULT_CODE_003", "API_DAILY_BUDGET_EXHAUSTED private"])("redacts foreign error %#", (message) => {
    expect(safeWeatherDiagnosticCode(new Error(message))).toBe("UNKNOWN");
  });
});

describe("weatherFailureKind", () => {
  it.each([
    ["KMA_REQUEST_FAILED", "provider"],
    ["KMA_INVALID_RESPONSE", "provider"],
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
