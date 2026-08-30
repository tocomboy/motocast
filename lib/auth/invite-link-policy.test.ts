import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const managerSource = readFileSync(new URL("../../components/invite-manager.tsx", import.meta.url), "utf8");
const consumerSource = readFileSync(new URL("../../components/invite-fragment-consumer.tsx", import.meta.url), "utf8");
const acceptSource = readFileSync(new URL("../../app/api/invites/accept/route.ts", import.meta.url), "utf8");

describe("invitation token transport", () => {
  it("keeps the bearer token in the fragment and posts it to a fixed no-store endpoint", () => {
    expect(managerSource).toContain("/invite#${invite.invite_token}");
    expect(consumerSource).toContain("window.location.hash.slice(1)");
    expect(consumerSource).toContain("window.history.replaceState");
    expect(consumerSource).toContain('fetch("/api/invites/accept"');
    expect(acceptSource).toContain('httpOnly: true');
    expect(acceptSource).toContain('"cache-control": "private, no-store, max-age=0"');
  });

  it("does not retain a dynamic server route with the token in the request path", () => {
    expect(existsSync(new URL("../../app/invite/[token]/route.ts", import.meta.url))).toBe(false);
  });
});
