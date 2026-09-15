import { describe, expect, it } from "vitest";

import { readRouteFailureCode, routeFailureNotice } from "./route-failure";

describe("route failure presentation", () => {
  it("reads only allowlisted categories from an Edge response", async () => {
    await expect(readRouteFailureCode({ context: new Response(JSON.stringify({ code: "SAFE_ROUTE_NOT_FOUND" })) }))
      .resolves.toBe("SAFE_ROUTE_NOT_FOUND");
    await expect(readRouteFailureCode({ context: new Response(JSON.stringify({ code: "SECRET_DETAIL" })) }))
      .resolves.toBe("ROUTE_REQUEST_FAILED");
  });

  it("keeps an old route explicitly stale while giving the next action", () => {
    const notice = routeFailureNotice("SAFE_ROUTE_NOT_FOUND", true);
    expect(notice).toContain("경유지나 휴식지를 조정");
    expect(notice).toContain("참고용");
  });
});
