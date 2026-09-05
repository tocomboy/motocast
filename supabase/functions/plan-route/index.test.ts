import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { RouteResponseValidationError } from "../_shared/kakao-route";

const validation = vi.hoisted(() => vi.fn());
const serviceClient = vi.hoisted(() => vi.fn());
vi.mock("../_shared/auth.ts", () => ({
  requireMember: vi.fn(async () => ({ supabase: {}, user: { id: "test-member" } })),
  consumeBudget: vi.fn(),
  serviceClient,
}));
vi.mock("../_shared/route-request.ts", () => ({ withValidatedRouteRequest: validation }));

describe("deployed plan-route diagnostic boundary", () => {
  let handler: (request: Request) => Promise<Response>;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  beforeAll(async () => {
    vi.stubGlobal("Deno", {
      env: { get: () => "test-verification-value" },
      serve: (callback: typeof handler) => { handler = callback; },
    });
    await import("./index");
  });
  beforeEach(() => { vi.clearAllMocks(); });
  afterAll(() => { log.mockRestore(); vi.unstubAllGlobals(); });

  it.each(["known", "foreign", "forged"])("logs only fixed codes for a %s error", async (kind) => {
    const privateDetail = "fixture-private-provider-detail";
    const error = kind === "foreign" ? new Error(privateDetail) : new RouteResponseValidationError("SECTION_DURATION_TOTAL");
    if (kind === "forged") Object.assign(error, { reason: privateDetail });
    validation.mockRejectedValue(error);
    const response = await handler(new Request("https://preview.example/functions/v1/plan-route", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    const body = await response.json();
    const expectedCode = kind === "foreign" ? "ROUTE_REQUEST_FAILED" : "ROUTE_RESPONSE_INVALID";
    expect(response.status).toBe(502);
    expect(Object.keys(body).sort()).toEqual(["code", "error"]);
    expect(body.code).toBe(expectedCode);
    expect(log).toHaveBeenCalledExactlyOnceWith("plan-route failed", expectedCode, kind === "known" ? "SECTION_DURATION_TOTAL" : "UNKNOWN");
    expect(JSON.stringify({ body, log: log.mock.calls })).not.toContain(privateDetail);
    expect(serviceClient).not.toHaveBeenCalled();
  });
});
