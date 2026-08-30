import { describe, expect, it } from "vitest";

import { isSupabaseAuthCookieName, supabaseAuthCookieNames } from "./session-cookies";

describe("supabaseAuthCookieNames", () => {
  it("finds base and chunked Supabase auth cookies only", () => {
    expect(supabaseAuthCookieNames(
      "motocast_invite=invite; sb-obodvbyzptxeehgpcpkd-auth-token.0=a; theme=dark; sb-obodvbyzptxeehgpcpkd-auth-token.1=b",
    )).toEqual([
      "sb-obodvbyzptxeehgpcpkd-auth-token.0",
      "sb-obodvbyzptxeehgpcpkd-auth-token.1",
    ]);
  });

  it("does not select unrelated cookies", () => {
    expect(supabaseAuthCookieNames("motocast_invite=x; session=y")).toEqual([]);
  });

  it("recognizes a newly issued auth cookie name even when it was absent from the request", () => {
    expect(isSupabaseAuthCookieName("sb-obodvbyzptxeehgpcpkd-auth-token")).toBe(true);
    expect(isSupabaseAuthCookieName("motocast_invite")).toBe(false);
  });
});
