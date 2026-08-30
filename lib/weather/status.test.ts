import { describe, expect, it } from "vitest";

import type { WeatherTimelineResponse } from "./provider-contract";
import { formatPlannerWeatherStatus } from "./status";

const staleResponse: WeatherTimelineResponse = {
  generatedAt: "2026-08-29T00:00:00.000Z",
  issuedAt: "2026-08-28T23:30:00.000Z",
  validUntil: "2026-08-29T04:00:00.000Z",
  source: "snapshot",
  stale: true,
  staleReason: "KMA_REQUEST_FAILED",
  staleObservedAt: "2026-08-31T03:30:00.000Z",
  forecasts: [],
};

describe("formatPlannerWeatherStatus", () => {
  it("shows the full stored date, multi-day age, provider failure, and expiry together", () => {
    const status = formatPlannerWeatherStatus(staleResponse, "2026-08-31T03:30:00.000Z");
    expect(status.expired).toBe(true);
    expect(status.header).toMatch(/2026.*08.*29/);
    expect(status.header).toContain("2일 3시간 전");
    expect(status.header).toContain("공급자 실패 후 저장본");
    expect(status.header).toContain("만료");
    expect(status.notice).toContain("2일 3시간 전");
    expect(status.notice).toContain("만료");
  });
});
