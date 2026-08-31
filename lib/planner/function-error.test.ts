import { describe, expect, it } from "vitest";

import { plannerFunctionErrorCode, windingUnavailableNotice } from "./function-error";

describe("plannerFunctionErrorCode", () => {
  it("accepts only the public winding-unavailable code from an Edge response", async () => {
    const context = Response.json({
      error: "서로 다른 와인딩 경로가 없습니다.",
      code: "WINDING_ROUTE_UNAVAILABLE",
    }, { status: 422 });
    await expect(plannerFunctionErrorCode({ context })).resolves.toBe("WINDING_ROUTE_UNAVAILABLE");
  });

  it.each([
    null,
    new Error("WINDING_ROUTE_UNAVAILABLE"),
    { context: { code: "WINDING_ROUTE_UNAVAILABLE" } },
    { context: Response.json({ code: "ROUTE_REQUEST_FAILED" }, { status: 502 }) },
    { context: new Response("not-json", { status: 502 }) },
  ])("does not expose unknown or malformed function errors %#", async (error) => {
    await expect(plannerFunctionErrorCode(error)).resolves.toBeNull();
  });

  it("keeps incomplete and stale-live route states explicit", () => {
    expect(windingUnavailableNotice(false)).toContain("세 후보를 다시 계산");
    expect(windingUnavailableNotice(true)).toContain("이전 실제 경로를 유지");
  });
});
