import { describe, expect, it } from "vitest";

import type { WeatherTimelineResponse } from "./provider-contract";
import { formatPlannerWeatherStatus, isFreshWeatherForSharing } from "./status";

const staleResponse: WeatherTimelineResponse = {
  generatedAt: "2026-08-29T00:00:00.000Z",
  issuedAt: "2026-08-28T23:30:00.000Z",
  validUntil: "2026-08-29T04:00:00.000Z",
  source: "snapshot",
  stale: true,
  staleReason: "KMA_REQUEST_FAILED",
  failureKind: "provider",
  staleObservedAt: "2026-08-31T03:30:00.000Z",
  forecasts: [],
};

describe("formatPlannerWeatherStatus", () => {
  it.each([
    ["2026-08-29T03:59:59.999Z", false],
    ["2026-08-29T04:00:00.000Z", true],
    ["2026-08-29T04:00:00.001Z", true],
  ] as const)("aligns expiry text with the share cutoff at %s", (referenceTime, expired) => {
    for (const stale of [false, true]) {
      const response = { ...staleResponse, stale };
      const status = formatPlannerWeatherStatus(response, referenceTime);
      expect(status.expired).toBe(expired);
      expect(status.header.includes("만료")).toBe(expired);
      expect(status.notice.includes("만료")).toBe(expired);
      expect(isFreshWeatherForSharing(response, referenceTime)).toBe(!stale && !expired);
    }
  });

  it("shows the full stored date, multi-day age, provider failure, and expiry together", () => {
    const status = formatPlannerWeatherStatus(staleResponse, "2026-08-31T03:30:00.000Z");
    expect(status.expired).toBe(true);
    expect(status.header).toMatch(/2026.*08.*29/);
    expect(status.header).toContain("2일 3시간 전");
    expect(status.header).toContain("기상청 공급자 오류 후 저장본");
    expect(status.header).toContain("만료");
    expect(status.notice).toContain("2일 3시간 전");
    expect(status.notice).toContain("만료");
  });

  it("uses the current clock for age and expiry instead of the stale observation time", () => {
    const beforeExpiry = formatPlannerWeatherStatus({
      ...staleResponse,
      generatedAt: "2026-08-31T02:00:00.000Z",
      validUntil: "2026-08-31T04:00:00.000Z",
      staleObservedAt: "2026-08-31T03:30:00.000Z",
    }, "2026-08-31T03:30:00.000Z");
    const afterExpiry = formatPlannerWeatherStatus({
      ...staleResponse,
      generatedAt: "2026-08-31T02:00:00.000Z",
      validUntil: "2026-08-31T04:00:00.000Z",
      staleObservedAt: "2026-08-31T03:30:00.000Z",
    }, "2026-08-31T04:30:00.000Z");
    expect(beforeExpiry.expired).toBe(false);
    expect(afterExpiry.expired).toBe(true);
    expect(afterExpiry.header).toContain("2시간 30분 전");
    expect(afterExpiry.header).toContain("12:30 실패 확인");
  });

  it("distinguishes budget, configuration, and persistence fallbacks", () => {
    expect(formatPlannerWeatherStatus({ ...staleResponse, failureKind: "budget" }, staleResponse.staleObservedAt!).notice).toContain("무료 API 한도 소진");
    expect(formatPlannerWeatherStatus({ ...staleResponse, failureKind: "configuration" }, staleResponse.staleObservedAt!).notice).toContain("날씨 설정 오류");
    expect(formatPlannerWeatherStatus({ ...staleResponse, failureKind: "persistence" }, staleResponse.staleObservedAt!).notice).toContain("날씨 저장 처리 오류");
  });
});

describe("isFreshWeatherForSharing", () => {
  it("accepts only a non-stale snapshot whose validity is strictly in the future", () => {
    expect(isFreshWeatherForSharing({ ...staleResponse, stale: false }, "2026-08-29T03:59:59.999Z")).toBe(true);
    expect(isFreshWeatherForSharing({ ...staleResponse, stale: false }, staleResponse.validUntil)).toBe(false);
    expect(isFreshWeatherForSharing({ ...staleResponse, stale: false }, "2026-08-29T04:00:00.001Z")).toBe(false);
    expect(isFreshWeatherForSharing(staleResponse, "2026-08-29T03:00:00.000Z")).toBe(false);
  });
});
