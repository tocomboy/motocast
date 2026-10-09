import { describe, expect, it } from "vitest";
import { expiryLabel } from "./shared-folder-format";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = Date.parse("2026-10-09T03:00:00Z");
const labelFor = (ms: number) => expiryLabel(new Date(now + ms).toISOString(), now);
const leftFor = (ms: number) => { const label = labelFor(ms); return label.expired ? "만료됨" : label.left; };

describe("invite expiry left (G11: a new link is \"7일 뒤 만료\")", () => {
  it("rounds whole days up while a day or more is left", () => {
    expect(leftFor(7 * DAY)).toBe("7일");
    expect(leftFor(7 * DAY - MINUTE)).toBe("7일");
    expect(leftFor(6 * DAY + 1)).toBe("7일");
    expect(leftFor(6 * DAY)).toBe("6일");
    expect(leftFor(DAY + MINUTE)).toBe("2일");
    expect(leftFor(DAY)).toBe("1일");
  });

  it("shows hours, rounded up, under a day", () => {
    expect(leftFor(DAY - MINUTE)).toBe("24시간");
    expect(leftFor(23 * HOUR)).toBe("23시간");
    expect(leftFor(5 * HOUR - MINUTE)).toBe("5시간");
    expect(leftFor(MINUTE)).toBe("1시간");
    expect(leftFor(1)).toBe("1시간");
  });

  it("is expired at or past the expiry time (shown as 만료됨, as on Android)", () => {
    expect(labelFor(1).expired).toBe(false);
    expect(leftFor(0)).toBe("만료됨");
    expect(leftFor(-1)).toBe("만료됨");
    expect(leftFor(-HOUR)).toBe("만료됨");
    expect(leftFor(-8 * DAY)).toBe("만료됨");
  });

  it("never shows more than the 7-day lifetime when this clock is behind the server", () => {
    expect(leftFor(7 * DAY + 5 * 1000)).toBe("7일");
  });

  it("keeps the Seoul expiry time", () => {
    expect(expiryLabel("2026-10-16T06:00:00Z", now).at).toBe("10/16 15:00");
  });
});
