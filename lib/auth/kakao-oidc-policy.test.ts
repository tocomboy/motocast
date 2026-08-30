import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const loginSource = readFileSync(new URL("../../components/kakao-login-button.tsx", import.meta.url), "utf8");
const callbackSource = readFileSync(new URL("../../components/kakao-oidc-callback.tsx", import.meta.url), "utf8");
const completionSource = readFileSync(new URL("../../app/api/auth/kakao/complete/route.ts", import.meta.url), "utf8");
const configSource = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");

describe("email-free Kakao OIDC source policy", () => {
  it("does not call the hosted Kakao OAuth start path", () => {
    expect(loginSource).not.toContain("signInWithOAuth");
    expect(loginSource).toContain("kakaoOidcStartUrl");
  });

  it("removes the fragment before sending the handoff in a same-origin body", () => {
    expect(callbackSource).toContain("window.history.replaceState");
    expect(callbackSource).toContain('fetch("/api/auth/kakao/complete"');
    expect(callbackSource).toContain("JSON.stringify({ handoff })");
  });

  it("passes both nonce and access token into Supabase ID-token verification", () => {
    expect(completionSource).toContain('provider: "kakao"');
    expect(completionSource).toContain("access_token: oidc.accessToken");
    expect(completionSource).toContain("nonce: oidc.nonce");
  });

  it("marks only the public OIDC function as JWT-exempt", () => {
    expect(configSource).toContain("[functions.kakao-oidc]\nverify_jwt = false");
  });
});
