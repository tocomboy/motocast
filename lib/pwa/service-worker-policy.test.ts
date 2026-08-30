import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

describe("service worker privacy policy", () => {
  it("does not intercept public share, API, authentication, invitation, or admin routes", () => {
    for (const prefix of ["/share", "/api/", "/auth/", "/invite", "/admin/", "/login"]) {
      expect(source).toContain(`"${prefix}"`);
    }
    expect(source).toContain("sensitivePath");
  });

  it("does not cache private or no-store responses and rotates the old cache", () => {
    expect(source).toContain("no-store|private");
    expect(source).toContain('CACHE_NAME = "motocast-shell-v4"');
    expect(source).not.toContain('const SHELL = ["/",');
    expect(source).not.toContain('caches.match("/")');
  });
});
