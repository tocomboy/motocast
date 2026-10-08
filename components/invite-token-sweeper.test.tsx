import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/lib/supabase/browser", () => ({ getBrowserSupabase: () => null }));

import { InviteTokenSweeper } from "./invite-token-sweeper";

const KEY = "motocast.folder-invite.pending";
const TOKEN = "T".repeat(43);
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function visit(r: ReactTestRenderer | null, path: string) {
  mocks.pathname = path;
  if (!r) { let made!: ReactTestRenderer; await act(async () => { made = create(<InviteTokenSweeper />); }); return made; }
  await act(async () => r.update(<InviteTokenSweeper />));
  return r;
}

describe("InviteTokenSweeper (contract §8 deletion points)", () => {
  it("V3-9: re-checks the 30-minute limit on in-app navigation, not only on the first page", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
    values.set(KEY, JSON.stringify({ token: TOKEN, savedAt: Date.now() }));
    const r = await visit(null, "/");
    expect(values.has(KEY)).toBe(true);
    vi.setSystemTime(new Date("2026-10-09T00:31:00Z"));
    await visit(r, "/updates");
    expect(values.has(KEY)).toBe(false);
  });

  it("V3-9: leaving the login screen for anything but the login removes the stored token", async () => {
    values.set(KEY, JSON.stringify({ token: TOKEN, savedAt: Date.now() }));
    let r = await visit(null, "/login");
    await visit(r, "/");
    expect(values.has(KEY)).toBe(false);
    await act(async () => r.unmount());

    for (const next of ["/auth/kakao/callback", "/folder-invite"]) {
      values.set(KEY, JSON.stringify({ token: TOKEN, savedAt: Date.now() }));
      r = await visit(null, "/login");
      await visit(r, next);
      expect(values.has(KEY)).toBe(true);
      await act(async () => r.unmount());
    }
  });
});
