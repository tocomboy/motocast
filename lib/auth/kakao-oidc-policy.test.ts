import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const loginSource = readFileSync(new URL("../../components/kakao-login-button.tsx", import.meta.url), "utf8");
const callbackSource = readFileSync(new URL("../../components/kakao-oidc-callback.tsx", import.meta.url), "utf8");
const completionSource = readFileSync(new URL("../../app/api/auth/kakao/complete/route.ts", import.meta.url), "utf8");
const cancelSource = readFileSync(new URL("../../app/api/auth/kakao/cancel/route.ts", import.meta.url), "utf8");
const oidcSource = readFileSync(new URL("./kakao-oidc.ts", import.meta.url), "utf8");
const configSource = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");

describe("email-free Kakao OIDC source policy", () => {
  it("does not call the hosted Kakao OAuth start path", () => {
    expect(loginSource).not.toContain("signInWithOAuth");
    expect(loginSource).toContain('action="/api/auth/kakao/start"');
  });

  it("removes the fragment before sending the handoff in a same-origin body", () => {
    expect(callbackSource).toContain("clearKakaoOidcHandoffFragment(window)");
    expect(callbackSource).toContain('fetch("/api/auth/kakao/complete"');
    expect(callbackSource).toContain("JSON.stringify({ handoff })");
  });

  it("passes both nonce and access token into Supabase ID-token verification", () => {
    expect(completionSource).toContain("signInWithBoundKakaoOidc");
    expect(completionSource).toContain("kakaoOidcBindingFromCookie");
    expect(completionSource).toContain("bindingHash");
  });

  it("clears the app binding through a secure same-origin endpoint", () => {
    expect(cancelSource).toContain("isTrustedSameOriginJsonRequest");
    expect(cancelSource).toContain("KAKAO_OIDC_BINDING_COOKIE_OPTIONS");
    expect(cancelSource).toContain("maxAge: 0");
    expect(oidcSource).toContain("httpOnly: true");
    expect(oidcSource).toContain("secure: true");
    expect(oidcSource).toContain('sameSite: "lax"');
  });

  it("keeps Strict Mode replay attached to one request without client abort", () => {
    expect(callbackSource).toContain("KakaoOidcCallbackLifecycle");
    expect(callbackSource).not.toContain("AbortController");
    expect(callbackSource).toContain("서버에서 이미 시작된 처리는 완료될 수 있습니다");
  });

  it("marks only the public OIDC function as JWT-exempt", () => {
    expect(configSource).toContain("[functions.kakao-oidc]\nverify_jwt = false");
  });
});
