import { describe, expect, it } from "vitest";

import { inviteTokenFromCookieHeader } from "./invite-cookie";

const token = "a".repeat(43);

describe("inviteTokenFromCookieHeader", () => {
  it("extracts the exact base64url invitation token", () => {
    expect(inviteTokenFromCookieHeader(`other=1; motocast_invite=${token}; theme=dark`)).toBe(token);
  });

  it.each([
    null,
    "",
    "motocast_invite=short",
    `motocast_invite=${"!".repeat(43)}`,
    "motocast_invite=%E0%A4%A",
  ])("rejects absent or malformed cookie input", (header) => {
    expect(inviteTokenFromCookieHeader(header)).toBeNull();
  });
});
