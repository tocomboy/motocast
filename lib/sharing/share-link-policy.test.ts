import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const shareManagerSource = readFileSync(new URL("../../components/share-manager.tsx", import.meta.url), "utf8");
const publicShareSource = readFileSync(new URL("../../components/public-shared-ride.tsx", import.meta.url), "utf8");
const fixedResolverSource = readFileSync(new URL("../../app/api/shares/resolve/route.ts", import.meta.url), "utf8");

describe("public share token transport", () => {
  it("keeps bearer tokens in the URL fragment and posts them to a fixed resolver path", () => {
    expect(shareManagerSource).toContain("/share#${token}");
    expect(publicShareSource).toContain("window.location.hash.slice(1)");
    expect(publicShareSource).toContain('fetch("/api/shares/resolve"');
    expect(publicShareSource).toContain("body: JSON.stringify({ token })");
    expect(fixedResolverSource).toContain("export async function POST");
  });

  it("does not retain dynamic server routes that place the bearer token in request logs", () => {
    expect(existsSync(new URL("../../app/share/[token]/page.tsx", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../../app/api/shares/[token]/route.ts", import.meta.url))).toBe(false);
  });
});
