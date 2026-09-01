import { describe, expect, it } from "vitest";

import { safeErrorCode, safeErrorMessage, safeErrorStatus } from "./http";

describe("safe provider errors", () => {
  it("does not mislabel malformed provider data as user input", () => {
    const error = new Error("INVALID_PLACE_PROVIDER_RESPONSE");
    expect(safeErrorMessage(error)).toContain("공급자");
    expect(safeErrorStatus(error)).toBe(502);
  });

  it("classifies user input and budget exhaustion separately", () => {
    expect(safeErrorStatus(new Error("INVALID_REQUEST"))).toBe(400);
    expect(safeErrorStatus(new Error("API_DAILY_BUDGET_EXHAUSTED"))).toBe(429);
  });

  it("reports an obsolete client route policy as input failure instead of provider outage", () => {
    const error = new Error("CLIENT_ROUTE_POLICY_FORBIDDEN");
    expect(safeErrorStatus(error)).toBe(400);
    expect(safeErrorMessage(error)).toContain("경로 설정");
    expect(safeErrorMessage(error)).not.toContain("공급자");
  });

  it("uses an unprocessable response for the 24-hour service limit", () => {
    const error = new Error("ROUTE_EXCEEDS_24_HOURS");
    expect(safeErrorMessage(error)).toContain("24시간");
    expect(safeErrorStatus(error)).toBe(422);
  });

  it("does not expose an internal provider error as a public code", () => {
    expect(safeErrorCode(new Error("secret internal detail"))).toBe("ROUTE_REQUEST_FAILED");
  });

  it("exposes only bounded actionable route categories", () => {
    expect(safeErrorCode(new Error("PAST_DEPARTURE"))).toBe("ROUTE_INPUT_INVALID");
    expect(safeErrorCode(new Error("SAFE_ROUTE_NOT_FOUND"))).toBe("SAFE_ROUTE_NOT_FOUND");
    expect(safeErrorCode(new Error("PROVIDER_UNAVAILABLE"))).toBe("ROUTE_PROVIDER_TEMPORARY");
    expect(safeErrorCode(new Error("API_DAILY_BUDGET_EXHAUSTED"))).toBe("ROUTE_BUDGET_OR_CONFIG");
    expect(safeErrorCode(new Error("ROUTE_PERSIST_FAILED"))).toBe("ROUTE_SAVE_FAILED");
    expect(safeErrorCode(new Error("INVALID_ROUTE_PROVIDER_RESPONSE"))).toBe("ROUTE_RESPONSE_INVALID");
  });

  it("does not mislabel provider authentication, rate, or outage failures as no safe route", () => {
    for (const code of ["PROVIDER_AUTH_FAILED", "PROVIDER_RATE_LIMITED", "PROVIDER_UNAVAILABLE"]) {
      expect(safeErrorStatus(new Error(code))).toBe(503);
      expect(safeErrorMessage(new Error(code))).toContain("공급자");
    }
  });

  it("keeps rejected provider requests distinct from temporary outages", () => {
    const rejected = new Error("PROVIDER_REQUEST_REJECTED");
    expect(safeErrorStatus(rejected)).toBe(502);
    expect(safeErrorMessage(rejected)).toContain("공급자");
    expect(safeErrorStatus(new Error("PROVIDER_UNAVAILABLE"))).toBe(503);
  });
});
