import { describe, expect, it, vi } from "vitest";

import {
  handleKakaoOidcCallback,
  type KakaoOidcCallbackRuntime,
} from "./kakao-oidc-callback.ts";
import { createOidcAttempt, validatedReturnTo } from "./kakao-oidc.ts";

const firstOrigin = "https://motocast.example";
const initiatingOrigin = "https://preview.example";
const stateSecret = "test-only-secret-that-is-longer-than-thirty-two-bytes";
const bindingHash = "c".repeat(64);

async function callbackFixture(query: string) {
  const now = Date.now();
  const returnTo = validatedReturnTo(
    `${initiatingOrigin}/auth/kakao/callback`,
    [firstOrigin, initiatingOrigin],
  );
  const created = await createOidcAttempt(returnTo, bindingHash, stateSecret, now);
  const request = new Request(
    `https://project.supabase.co/functions/v1/kakao-oidc/callback?state=${created.attempt.state}&${query}`,
    { headers: { cookie: `__Host-motocast_kakao_oidc=${created.cookieValue}` } },
  );
  const runtime: KakaoOidcCallbackRuntime = {
    verificationEnvironment: () => ({
      allowedOrigins: [firstOrigin, initiatingOrigin],
      stateSecret,
    }),
    providerCredentials: () => ({ clientId: "client-id", clientSecret: "client-secret" }),
    exchangeCode: vi.fn().mockResolvedValue({
      idToken: `header.${"a".repeat(110)}.signature`,
      accessToken: "access-token-value",
    }),
    persistHandoff: vi.fn().mockResolvedValue(undefined),
    now: () => now,
  };
  return { request, runtime };
}

function expectInitiatingOriginFailure(response: Response) {
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(`${initiatingOrigin}/auth/kakao/callback?error=callback`);
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
}

describe("Kakao OIDC callback handler", () => {
  it("returns provider rejection to the authenticated second origin", async () => {
    const { request, runtime } = await callbackFixture("error=access_denied");
    const response = await handleKakaoOidcCallback(request, runtime);
    expectInitiatingOriginFailure(response);
    expect(runtime.exchangeCode).not.toHaveBeenCalled();
    expect(runtime.persistHandoff).not.toHaveBeenCalled();
  });

  it("returns provider configuration and exchange failures to the initiating origin", async () => {
    const missing = await callbackFixture("code=valid-code");
    missing.runtime.providerCredentials = () => { throw new Error("OIDC_PROVIDER_NOT_CONFIGURED"); };
    expectInitiatingOriginFailure(await handleKakaoOidcCallback(missing.request, missing.runtime));

    const exchange = await callbackFixture("code=valid-code");
    exchange.runtime.exchangeCode = vi.fn().mockRejectedValue(new Error("OIDC_PROVIDER_EXCHANGE_FAILED"));
    expectInitiatingOriginFailure(await handleKakaoOidcCallback(exchange.request, exchange.runtime));
  });

  it("returns handoff persistence failure to the initiating origin", async () => {
    const { request, runtime } = await callbackFixture("code=valid-code");
    runtime.persistHandoff = vi.fn().mockRejectedValue(new Error("OIDC_HANDOFF_PERSISTENCE_FAILED"));
    expectInitiatingOriginFailure(await handleKakaoOidcCallback(request, runtime));
  });

  it("does not guess an application origin for an unauthenticated attempt", async () => {
    const { request, runtime } = await callbackFixture("code=valid-code");
    const tampered = new Request(request.url, {
      headers: { cookie: "__Host-motocast_kakao_oidc=tampered" },
    });
    const response = await handleKakaoOidcCallback(tampered, runtime);
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(runtime.exchangeCode).not.toHaveBeenCalled();
    expect(runtime.persistHandoff).not.toHaveBeenCalled();
  });
});
