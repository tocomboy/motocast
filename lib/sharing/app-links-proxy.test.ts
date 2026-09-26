import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));
import { config } from "@/proxy";

describe("App Links verification is independent of member sessions", () => {
  it("excludes only the exact public certificate endpoint from session refresh", () => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/.well-known/assetlinks.json" })).toBe(false);
  });

  it.each(["/share", "/invite", "/api/shares/resolve", "/api/shares/save",
    "/.well-known/assetlinks.json/other", "/xwell-known/assetlinksXjson"])(
    "preserves the existing session boundary for %s", (url) => {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
    },
  );
});
