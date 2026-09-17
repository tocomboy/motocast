import { describe, expect, it } from "vitest";

import { formatRideDuration, formatSummaryDeparture } from "./display";

describe("planner display formatting", () => {
  it("formats elapsed minutes without losing hours", () => {
    expect(formatRideDuration(140)).toBe("2시간 20분");
    expect(formatRideDuration(60)).toBe("1시간");
    expect(formatRideDuration(29.1)).toBe("30분");
  });

  it("formats departure using the Seoul calendar", () => {
    expect(formatSummaryDeparture("2026-09-20T09:00:00+09:00")).toBe("9월 20일 · 09:00 출발");
    expect(formatSummaryDeparture("2026-09-20T00:00:00+09:00")).toBe("9월 20일 · 00:00 출발");
  });
});
