import { describe, expect, it } from "vitest";

import {
  allowedOriginsFromEnvironment,
  authenticatedOidcReturnTo,
  createHandoffToken,
  createOidcAttempt,
  decryptKakaoTokenPayload,
  encryptKakaoTokenPayload,
  isHandoffToken,
  kakaoAuthorizeUrl,
  KAKAO_OIDC_SCOPES,
  kakaoOidcProviderConfiguration,
  parseKakaoTokenResponse,
  validatedReturnTo,
  verifyOidcAttempt,
} from "./kakao-oidc.ts";

const secret = "test-only-secret-that-is-longer-than-thirty-two-bytes";
const origin = "https://motocast.example";
const bindingHash = "c".repeat(64);

describe("email-free Kakao OIDC Edge boundary", () => {
it("uses the trusted Supabase URL for the provider callback instead of an internal HTTP request URL", () => {
  const internalRequest = new Request("http://project.supabase.co/functions/v1/kakao-oidc/start");
  const provider = kakaoOidcProviderConfiguration({
    clientId: "client-id",
    clientSecret: "client-secret",
    supabaseUrl: "https://project.supabase.co",
  });

  expect(new URL(internalRequest.url).protocol).toBe("http:");
  expect(provider.callbackUri).toBe("https://project.supabase.co/functions/v1/kakao-oidc/callback");
});

it("rejects unsafe or malformed provider callback configuration", () => {
  for (const input of [
    { clientId: undefined, clientSecret: "client-secret", supabaseUrl: "https://project.supabase.co" },
    { clientId: "client-id", clientSecret: undefined, supabaseUrl: "https://project.supabase.co" },
    { clientId: "client-id", clientSecret: "client-secret", supabaseUrl: undefined },
    { clientId: "client-id", clientSecret: "client-secret", supabaseUrl: "http://project.supabase.co" },
    { clientId: "client-id", clientSecret: "client-secret", supabaseUrl: "https://user:password@project.supabase.co" },
    { clientId: "client-id", clientSecret: "client-secret", supabaseUrl: "https://project.supabase.co/path" },
    { clientId: "client-id", clientSecret: "client-secret", supabaseUrl: "https://project.supabase.co/?redirect=attacker" },
  ]) {
    expect(() => kakaoOidcProviderConfiguration(input)).toThrow("OIDC_PROVIDER_NOT_CONFIGURED");
  }
});

it("builds an email-free and nonce-bound authorize request", async () => {
  const returnTo = validatedReturnTo(`${origin}/auth/kakao/callback`, [origin]);
  const created = await createOidcAttempt(returnTo, bindingHash, secret, 1_000_000);
  const authorize = kakaoAuthorizeUrl("client-id", "https://project.supabase.co/functions/v1/kakao-oidc/callback", created.attempt, created.authorizeNonce);

  expect(authorize.hostname).toBe("kauth.kakao.com");
  expect(authorize.searchParams.get("scope")).toBe(KAKAO_OIDC_SCOPES.join(","));
  expect(authorize.search).not.toContain("account_email");
  expect(authorize.searchParams.get("nonce")).toMatch(/^[0-9a-f]{64}$/);
  expect(authorize.searchParams.get("state")).toBe(created.attempt.state);
});

it("rejects attempt tampering, mismatch, expiry, and open redirects", async () => {
  const returnTo = validatedReturnTo(`${origin}/auth/kakao/callback`, [origin]);
  const created = await createOidcAttempt(returnTo, bindingHash, secret, 1_000_000);
  const valid = await verifyOidcAttempt(created.cookieValue, created.attempt.state, [origin], secret, 1_001_000);
  expect(valid.nonce).toBe(created.attempt.nonce);

  for (const action of [
    () => verifyOidcAttempt(`${created.cookieValue}x`, created.attempt.state, [origin], secret, 1_001_000),
    () => verifyOidcAttempt(created.cookieValue, createHandoffToken(), [origin], secret, 1_001_000),
    () => verifyOidcAttempt(created.cookieValue, created.attempt.state, [origin], secret, 1_400_001),
  ]) {
    let rejected = false;
    try {
      await action();
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("invalid attempt accepted");
  }

  for (const target of [
    "https://attacker.example/auth/kakao/callback",
    `${origin}/auth/kakao/callback?next=https://attacker.example`,
    `${origin}/other`,
  ]) {
    let rejected = false;
    try {
      validatedReturnTo(target, [origin]);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("unsafe return target accepted");
  }
});

it("recovers only an authenticated initiating origin for callback cleanup", async () => {
  const previewOrigin = "https://preview.example";
  const returnTo = validatedReturnTo(`${previewOrigin}/auth/kakao/callback`, [origin, previewOrigin]);
  const created = await createOidcAttempt(returnTo, bindingHash, secret, 1_000_000);

  await expect(authenticatedOidcReturnTo(
    created.cookieValue,
    [origin, previewOrigin],
    secret,
  )).resolves.toEqual(returnTo);
  await expect(authenticatedOidcReturnTo(
    `${created.cookieValue}x`,
    [origin, previewOrigin],
    secret,
  )).rejects.toThrow("OIDC_STATE_INVALID");
});

it("authenticates encrypted handoff ciphertext and expiry", async () => {
  const now = Date.now();
  const payload = {
    idToken: `header.${"a".repeat(110)}.signature`,
    accessToken: "access-token-value",
    nonce: createHandoffToken(),
    bindingHash,
    expiresAt: now + 60_000,
  };
  const encrypted = await encryptKakaoTokenPayload(payload, secret);
  const decrypted = await decryptKakaoTokenPayload(encrypted, secret, now + 1_000);
  expect(decrypted).toEqual(payload);

  const replacement = encrypted.endsWith("A") ? "B" : "A";
  let tamperRejected = false;
  try {
    await decryptKakaoTokenPayload(`${encrypted.slice(0, -1)}${replacement}`, secret, now + 1_000);
  } catch {
    tamperRejected = true;
  }
  if (!tamperRejected) throw new Error("tampered ciphertext accepted");

  let expiryRejected = false;
  try {
    await decryptKakaoTokenPayload(encrypted, secret, now + 60_001);
  } catch {
    expiryRejected = true;
  }
  if (!expiryRejected) throw new Error("expired payload accepted");
});

it("fails provider payload and environment parsing closed", () => {
  const parsed = parseKakaoTokenResponse({
    id_token: `header.${"a".repeat(110)}.signature`,
    access_token: "access-token-value",
  });
  expect(parsed.idToken).toBeTruthy();
  expect(parsed.accessToken).toBeTruthy();
  expect(isHandoffToken(createHandoffToken())).toBe(true);
  expect(isHandoffToken("short")).toBe(false);
  const origins = allowedOriginsFromEnvironment(`${origin},https://preview.example`);
  expect(origins).toHaveLength(2);

  for (const invalid of [undefined, "", `${origin}/path`, `${origin},${origin}`]) {
    let rejected = false;
    try {
      allowedOriginsFromEnvironment(invalid);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("invalid origins accepted");
  }
});
});
