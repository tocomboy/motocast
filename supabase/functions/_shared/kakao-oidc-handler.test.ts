import { describe, expect, it, vi } from "vitest";

import type { KakaoOidcRequestRuntime } from "./kakao-oidc-handler.ts";
import {
  exchangeKakaoOidcCode,
  handleKakaoOidcRequest,
} from "./kakao-oidc-handler.ts";
import { kakaoOidcProviderConfiguration } from "./kakao-oidc.ts";

const applicationOrigin = "https://preview.example";
const stateSecret = "test-only-secret-that-is-longer-than-thirty-two-bytes";
const bindingHash = "c".repeat(64);
const callbackUri = "https://project.supabase.co/functions/v1/kakao-oidc/callback";

describe("deployed Kakao OIDC request wiring", () => {
  it("uses one trusted HTTPS callback for authorize and token exchange despite internal HTTP requests", async () => {
    const providerFetch: typeof fetch = vi.fn(async () => new Response(JSON.stringify({
      id_token: `header.${"a".repeat(110)}.signature`,
      access_token: "access-token-value",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const persistHandoff = vi.fn(async () => undefined);
    const runtime: KakaoOidcRequestRuntime = {
      verificationEnvironment: () => ({
        allowedOrigins: [applicationOrigin],
        stateSecret,
      }),
      providerCredentials: () => kakaoOidcProviderConfiguration({
        clientId: "client-id",
        clientSecret: "client-secret",
        supabaseUrl: "https://project.supabase.co",
      }),
      exchangeCode: (code, credentials) => exchangeKakaoOidcCode(
        code,
        credentials,
        providerFetch,
      ),
      persistHandoff,
      consume: vi.fn(async () => new Response(null, { status: 204 })),
      now: Date.now,
    };

    const startUrl = new URL("http://project.supabase.co/functions/v1/kakao-oidc/start");
    startUrl.searchParams.set("return_to", `${applicationOrigin}/auth/kakao/callback`);
    startUrl.searchParams.set("binding_hash", bindingHash);
    const startResponse = await handleKakaoOidcRequest(new Request(startUrl), runtime);

    expect(startResponse.status).toBe(302);
    const authorize = new URL(startResponse.headers.get("location") ?? "");
    expect(authorize.origin).toBe("https://kauth.kakao.com");
    expect(authorize.searchParams.get("redirect_uri")).toBe(callbackUri);
    const state = authorize.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const cookie = startResponse.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toBeTruthy();
    const callbackRequest = new Request(
      `http://project.supabase.co/functions/v1/kakao-oidc/callback?state=${state}&code=valid-code`,
      { headers: { cookie: cookie ?? "" } },
    );
    const callbackResponse = await handleKakaoOidcRequest(callbackRequest, runtime);

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toMatch(
      new RegExp(`^${applicationOrigin}/auth/kakao/callback#[A-Za-z0-9_-]{43}$`, "u"),
    );
    expect(providerFetch).toHaveBeenCalledOnce();
    const [tokenUrl, tokenRequest] = vi.mocked(providerFetch).mock.calls[0];
    expect(tokenUrl).toBe("https://kauth.kakao.com/oauth/token");
    const tokenBody = new URLSearchParams(String(tokenRequest?.body));
    expect(tokenBody.get("redirect_uri")).toBe(callbackUri);
    expect(tokenBody.get("code")).toBe("valid-code");
    expect(persistHandoff).toHaveBeenCalledOnce();
  });
});
