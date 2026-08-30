import { describe, expect, it } from "vitest";

import { assertWithinHardReturn } from "./route-deadline";

describe("assertWithinHardReturn", () => {
  it("accepts the exact hard return boundary", () => {
    expect(() => assertWithinHardReturn(
      "2026-08-31T18:30:00+09:00",
      "2026-08-31T18:30:00+09:00",
    )).not.toThrow();
  });

  it("rejects a candidate even one second after the hard return", () => {
    expect(() => assertWithinHardReturn(
      "2026-08-31T18:30:01+09:00",
      "2026-08-31T18:30:00+09:00",
    )).toThrow("ROUTE_EXCEEDS_HARD_RETURN");
  });
});
