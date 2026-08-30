import { describe, expect, it } from "vitest";

import { safeErrorMessage, safeErrorStatus } from "./http";

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

  it("uses an unprocessable response for a hard-return exclusion", () => {
    const error = new Error("ROUTE_EXCEEDS_HARD_RETURN");
    expect(safeErrorMessage(error)).toContain("최종 복귀");
    expect(safeErrorStatus(error)).toBe(422);
  });
});
