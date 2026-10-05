import { describe, expect, it } from "vitest";

import { safeErrorCode, safeErrorMessage, safeErrorStatus } from "./http";

it("reports weather storage admission failure without internal capacity details", () => {
  const error = new Error("WEATHER_STORAGE_CAPACITY");
  expect(safeErrorStatus(error)).toBe(503);
  expect(safeErrorMessage(error)).toBe("현재 날씨 정보를 갱신할 수 없습니다. 잠시 후 다시 시도해 주세요.");
});

it("maps the fixed meal dwell refusal to a 400 with update guidance", () => {
  const error = new Error("MEAL_DWELL_FIXED");
  expect(safeErrorStatus(error)).toBe(400);
  expect(safeErrorCode(error)).toBe("MEAL_DWELL_FIXED");
  expect(safeErrorMessage(error)).toBe("식사 시간은 45분으로 바뀌었어요. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.");
});

describe("safe provider errors", () => {
  it.each([
    ["ROUTE_WAYPOINT_ROAD_NOT_FOUND", "경유지"],
    ["ROUTE_ORIGIN_ROAD_NOT_FOUND", "출발지"],
    ["ROUTE_DESTINATION_ROAD_NOT_FOUND", "도착지"],
    ["ROUTE_POINTS_TOO_CLOSE", "너무 가깝습니다"],
    ["ROUTE_ORIGIN_BLOCKED", "출발지"],
    ["ROUTE_DESTINATION_BLOCKED", "도착지"],
    ["ROUTE_WAYPOINT_BLOCKED", "경유지"],
  ])("provides a fixed actionable response for %s", (code, label) => {
    const error = new Error(code);
    expect(safeErrorCode(error)).toBe(code);
    expect(safeErrorStatus(error)).toBe(422);
    expect(safeErrorMessage(error)).toContain(label);
  });

  it.each([
    "ROUTE_WAYPOINT_ROAD_NOT_FOUND: provider-private-body",
    "RESULT_CODE_101",
    "toString",
    "constructor",
  ])("does not reflect or promote an unrecognized error marker: %s", (message) => {
    const error = new Error(message);
    expect(safeErrorCode(error)).toBe("ROUTE_REQUEST_FAILED");
    expect(safeErrorStatus(error)).toBe(502);
    expect(safeErrorMessage(error)).not.toContain(message);
  });
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
    expect(safeErrorCode(error)).toBe("ROUTE_INPUT_INVALID");
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

  it("does not mislabel provider rate or outage failures as no safe route", () => {
    for (const code of ["PROVIDER_RATE_LIMITED", "PROVIDER_UNAVAILABLE"]) {
      expect(safeErrorStatus(new Error(code))).toBe(503);
      expect(safeErrorMessage(new Error(code))).toContain("공급자");
    }
  });

  it("classifies provider authentication as configuration rather than a temporary outage", () => {
    const error = new Error("PROVIDER_AUTH_FAILED");
    expect(safeErrorCode(error)).toBe("ROUTE_BUDGET_OR_CONFIG");
    expect(safeErrorStatus(error)).toBe(503);
    expect(safeErrorMessage(error)).toContain("인증 설정");
    expect(safeErrorMessage(error)).not.toContain("일시적인 문제");
  });

  it("keeps rejected provider requests distinct from temporary outages", () => {
    const rejected = new Error("PROVIDER_REQUEST_REJECTED");
    expect(safeErrorStatus(rejected)).toBe(502);
    expect(safeErrorMessage(rejected)).toContain("공급자");
    expect(safeErrorStatus(new Error("PROVIDER_UNAVAILABLE"))).toBe(503);
  });
});
