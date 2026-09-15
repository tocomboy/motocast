import { describe, expect, it, vi } from "vitest";

import {
  clearKakaoOidcHandoffFragment,
  createKakaoOidcBrowserBinding,
  consumeKakaoOidcHandoff,
  isKakaoOidcHandoff,
  kakaoOidcBindingFromCookie,
  kakaoOidcBindingHash,
  kakaoOidcStartUrl,
  KakaoOidcCallbackLifecycle,
  signInWithBoundKakaoOidc,
} from "./kakao-oidc";

const handoff = "a".repeat(43);
const nonce = "b".repeat(43);
const bindingHash = "c".repeat(64);

describe("Kakao OIDC application boundary", () => {
  it("builds only the fixed Supabase start and application callback paths", () => {
    const result = new URL(kakaoOidcStartUrl(
      "https://project.supabase.co",
      "https://motocast.example",
      bindingHash,
    ));
    expect(result.origin).toBe("https://project.supabase.co");
    expect(result.pathname).toBe("/functions/v1/kakao-oidc/start");
    expect(result.searchParams.get("return_to")).toBe("https://motocast.example/auth/kakao/callback");
    expect(result.searchParams.get("binding_hash")).toBe(bindingHash);
    expect(() => kakaoOidcStartUrl(
      "https://project.supabase.co/path",
      "https://motocast.example",
      bindingHash,
    )).toThrow();
  });

  it("creates and hashes an HttpOnly-cookie-compatible browser binding", async () => {
    const binding = createKakaoOidcBrowserBinding();
    expect(binding).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await kakaoOidcBindingHash(binding)).toMatch(/^[0-9a-f]{64}$/);
    expect(kakaoOidcBindingFromCookie(`other=x; __Host-motocast_kakao_binding=${binding}`)).toBe(binding);
    expect(kakaoOidcBindingFromCookie("__Host-motocast_kakao_binding=short")).toBeNull();
  });

  it("validates the exact 32-byte base64url handoff shape", () => {
    expect(isKakaoOidcHandoff(handoff)).toBe(true);
    expect(isKakaoOidcHandoff("a".repeat(42))).toBe(false);
    expect(isKakaoOidcHandoff(`${"a".repeat(42)}!`)).toBe(false);
  });

  it("never submits a handoff when fragment removal fails", () => {
    const replace = vi.fn();
    const cleared = clearKakaoOidcHandoffFragment({
      history: { replaceState: vi.fn(() => { throw new Error("blocked"); }) },
      location: { pathname: "/auth/kakao/callback", search: "", replace },
    });
    expect(cleared).toBe(false);
    expect(replace).toHaveBeenCalledWith("/login?error=callback");
  });

  it("keeps one callback request alive through Strict Mode effect replay", () => {
    vi.useFakeTimers();
    const delayed = vi.fn();
    const lifecycle = new KakaoOidcCallbackLifecycle();
    expect(lifecycle.enter(delayed, 10_000)).toBe(true);
    expect(lifecycle.isAttached()).toBe(true);
    lifecycle.leave();
    expect(lifecycle.isAttached()).toBe(false);
    expect(lifecycle.enter(delayed, 10_000)).toBe(false);
    expect(lifecycle.isAttached()).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(delayed).toHaveBeenCalledTimes(1);
    lifecycle.complete();
    lifecycle.leave();
    expect(lifecycle.isAttached()).toBe(false);
    vi.useRealTimers();
  });

  it("does not allow a late callback response to navigate after the screen detaches", () => {
    const lifecycle = new KakaoOidcCallbackLifecycle();
    const navigate = vi.fn();
    lifecycle.enter(vi.fn(), 10_000);
    lifecycle.leave();
    if (lifecycle.isAttached()) navigate("/");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("consumes through the fixed Edge endpoint without exposing tokens in the URL", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      idToken: `header.${"a".repeat(110)}.signature`,
      accessToken: "access-token-value",
      nonce,
      bindingHash,
      expiresAt: Date.now() + 60_000,
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const payload = await consumeKakaoOidcHandoff(
      "https://project.supabase.co",
      "public-key",
      "https://motocast.example",
      handoff,
      bindingHash,
      fetcher,
    );
    expect(payload.nonce).toBe(nonce);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://project.supabase.co/functions/v1/kakao-oidc/consume");
    expect(String(url)).not.toContain(handoff);
    expect(init?.body).toBe(JSON.stringify({ handoff, bindingHash }));
    expect(init?.headers).toMatchObject({ origin: "https://motocast.example" });

    const signIn = vi.fn().mockResolvedValue({ error: null });
    await expect(signInWithBoundKakaoOidc(payload, bindingHash, signIn)).resolves.toBeUndefined();
    expect(signIn).toHaveBeenCalledWith({
      provider: "kakao",
      token: payload.idToken,
      access_token: payload.accessToken,
      nonce: payload.nonce,
    });
  });

  it("rejects failed, malformed, and expired handoff responses", async () => {
    const failed = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 400 }));
    await expect(consumeKakaoOidcHandoff(
      "https://project.supabase.co", "public-key", "https://motocast.example", handoff, bindingHash, failed,
    )).rejects.toThrow("OIDC_HANDOFF_INVALID");

    const expired = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      idToken: `header.${"a".repeat(110)}.signature`,
      accessToken: "access-token-value",
      nonce,
      bindingHash,
      expiresAt: Date.now() - 1,
    }), { status: 200 }));
    await expect(consumeKakaoOidcHandoff(
      "https://project.supabase.co", "public-key", "https://motocast.example", handoff, bindingHash, expired,
    )).rejects.toThrow("OIDC_HANDOFF_INVALID");
  });

  it("rejects a handoff created for a different initiating browser", async () => {
    const foreign = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      idToken: `header.${"a".repeat(110)}.signature`,
      accessToken: "access-token-value",
      nonce,
      bindingHash: "d".repeat(64),
      expiresAt: Date.now() + 60_000,
    }), { status: 200 }));

    await expect(consumeKakaoOidcHandoff(
      "https://project.supabase.co", "public-key", "https://motocast.example", handoff, bindingHash, foreign,
    )).rejects.toThrow("OIDC_BINDING_INVALID");

    const signIn = vi.fn().mockResolvedValue({ error: null });
    await expect(signInWithBoundKakaoOidc({
      idToken: `header.${"a".repeat(110)}.signature`,
      accessToken: "access-token-value",
      nonce,
      bindingHash: "d".repeat(64),
      expiresAt: Date.now() + 60_000,
    }, bindingHash, signIn)).rejects.toThrow("OIDC_BINDING_INVALID");
    expect(signIn).not.toHaveBeenCalled();
  });
});
