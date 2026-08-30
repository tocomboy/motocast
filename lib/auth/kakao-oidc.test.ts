import { describe, expect, it, vi } from "vitest";

import {
  consumeKakaoOidcHandoff,
  isKakaoOidcHandoff,
  kakaoOidcStartUrl,
} from "./kakao-oidc";

const handoff = "a".repeat(43);
const nonce = "b".repeat(43);

describe("Kakao OIDC application boundary", () => {
  it("builds only the fixed Supabase start and application callback paths", () => {
    const result = new URL(kakaoOidcStartUrl("https://project.supabase.co", "https://motocast.example"));
    expect(result.origin).toBe("https://project.supabase.co");
    expect(result.pathname).toBe("/functions/v1/kakao-oidc/start");
    expect(result.searchParams.get("return_to")).toBe("https://motocast.example/auth/kakao/callback");
    expect(() => kakaoOidcStartUrl("https://project.supabase.co/path", "https://motocast.example")).toThrow();
  });

  it("validates the exact 32-byte base64url handoff shape", () => {
    expect(isKakaoOidcHandoff(handoff)).toBe(true);
    expect(isKakaoOidcHandoff("a".repeat(42))).toBe(false);
    expect(isKakaoOidcHandoff(`${"a".repeat(42)}!`)).toBe(false);
  });

  it("consumes through the fixed Edge endpoint without exposing tokens in the URL", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      idToken: `header.${"a".repeat(110)}.signature`,
      accessToken: "access-token-value",
      nonce,
      expiresAt: Date.now() + 60_000,
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const payload = await consumeKakaoOidcHandoff(
      "https://project.supabase.co",
      "public-key",
      "https://motocast.example",
      handoff,
      fetcher,
    );
    expect(payload.nonce).toBe(nonce);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://project.supabase.co/functions/v1/kakao-oidc/consume");
    expect(String(url)).not.toContain(handoff);
    expect(init?.body).toBe(JSON.stringify({ handoff }));
    expect(init?.headers).toMatchObject({ origin: "https://motocast.example" });
  });

  it("rejects failed, malformed, and expired handoff responses", async () => {
    const failed = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 400 }));
    await expect(consumeKakaoOidcHandoff(
      "https://project.supabase.co", "public-key", "https://motocast.example", handoff, failed,
    )).rejects.toThrow("OIDC_HANDOFF_INVALID");

    const expired = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      idToken: `header.${"a".repeat(110)}.signature`,
      accessToken: "access-token-value",
      nonce,
      expiresAt: Date.now() - 1,
    }), { status: 200 }));
    await expect(consumeKakaoOidcHandoff(
      "https://project.supabase.co", "public-key", "https://motocast.example", handoff, expired,
    )).rejects.toThrow("OIDC_HANDOFF_INVALID");
  });
});
