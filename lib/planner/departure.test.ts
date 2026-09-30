import { describe, expect, it } from "vitest";

import { isPastDeparture, minimumDeparture, suggestedDeparture } from "./departure";

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

  it.each([
    ["2026-09-17T01:30:00.000Z", "2026-09-17", "10:30"],
    ["2026-09-17T01:30:00.001Z", "2026-09-17", "10:35"],
    ["2026-09-17T01:34:59.999Z", "2026-09-17", "10:35"],
    ["2026-09-17T01:55:00.001Z", "2026-09-17", "11:00"],
    ["2026-09-17T14:59:59.999Z", "2026-09-18", "00:00"],
    ["2026-09-30T14:57:00.000Z", "2026-10-01", "00:00"],
    ["2026-12-31T14:55:00.001Z", "2027-01-01", "00:00"],
    ["2028-02-29T14:58:00.000Z", "2028-03-01", "00:00"],
  ])("suggests the nearest non-past five-minute slot for %s", (instant, date, time) => {
    const now = new Date(instant);
    const suggested = suggestedDeparture(now);
    expect(suggested).toEqual({ date, time });
    expect(isPastDeparture(suggested.date, suggested.time, now)).toBe(false);
  });

  it("keeps future off-grid explicit minutes valid independently of the suggestion", () => {
    const now = new Date("2026-09-17T01:30:00.001Z");
    expect(suggestedDeparture(now).time).toBe("10:35");
    expect(minimumDeparture(now).time).toBe("10:31");
    expect(isPastDeparture("2026-09-17", "10:31", now)).toBe(false);
  });
});
