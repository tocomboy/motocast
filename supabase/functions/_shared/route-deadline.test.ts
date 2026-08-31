import { describe, expect, it } from "vitest";

import { assertRideUnder24Hours, legacyScheduleBoundary } from "./route-deadline";

describe("assertRideUnder24Hours", () => {
  it("allows a route to return after midnight", () => {
    expect(() => assertRideUnder24Hours(
      "2026-08-31T23:00:00+09:00",
      "2026-09-01T01:00:00+09:00",
    )).not.toThrow();
  });

  it("rejects a candidate at the 24-hour service limit", () => {
    expect(() => assertRideUnder24Hours(
      "2026-08-31T07:30:00+09:00",
      "2026-09-01T07:30:00+09:00",
    )).toThrow("ROUTE_EXCEEDS_24_HOURS");
  });

  it("creates an undisplayed same-day value only for legacy persistence", () => {
    expect(legacyScheduleBoundary("2026-08-31T23:00:00+09:00")).toBe("2026-08-31T14:59:59.999Z");
  });
});
