import { describe, expect, it } from "vitest";

import { isPastDeparture, minimumDeparture } from "./departure";

describe("departure boundaries", () => {
  it("rounds the browser minimum up to the next Seoul minute", () => {
    expect(minimumDeparture(new Date("2026-09-01T03:04:00.000Z"))).toEqual({ date: "2026-09-01", time: "12:04" });
    expect(minimumDeparture(new Date("2026-09-01T03:04:00.001Z"))).toEqual({ date: "2026-09-01", time: "12:05" });
  });

  it("rejects stale minutes while accepting the exact current instant and future dates", () => {
    const now = new Date("2026-09-01T03:04:00.000Z");
    expect(isPastDeparture("2026-09-01", "12:03", now)).toBe(true);
    expect(isPastDeparture("2026-09-01", "12:04", now)).toBe(false);
    expect(isPastDeparture("2026-09-02", "00:00", now)).toBe(false);
  });

  it("uses the Seoul day across UTC midnight boundaries", () => {
    expect(minimumDeparture(new Date("2026-08-31T15:00:01.000Z"))).toEqual({ date: "2026-09-01", time: "00:01" });
  });
});
