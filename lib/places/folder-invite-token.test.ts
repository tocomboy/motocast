import { describe, expect, it, vi } from "vitest";
import {
  BOOT_CAPTURE_KEY,
  captureInviteFragment,
  clearPendingInvite,
  consumePendingInvite,
  hasPendingInvite,
  PENDING_INVITE_KEY,
  PENDING_INVITE_TTL_MS,
  savePendingInvite,
  FOLDER_INVITE_BOOT_SCRIPT,
  takeInviteCapture,
} from "./folder-invite-token";

const TOKEN = "A".repeat(20) + "-_" + "b".repeat(21);
const browser = (hash: string, replaceState = vi.fn()) => ({
  location: { hash, pathname: "/folder-invite", search: "" },
  history: { replaceState },
});
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
}

describe("invite fragment capture", () => {
  it("moves the token into memory and removes it from the address", () => {
    const replaceState = vi.fn();
    expect(captureInviteFragment(browser(`#t=${TOKEN}`, replaceState))).toEqual({ status: "token", token: TOKEN });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/folder-invite");
  });

  it("returns no token when the address cannot be cleaned", () => {
    const replaceState = vi.fn(() => { throw new Error("SecurityError"); });
    expect(captureInviteFragment(browser(`#t=${TOKEN}`, replaceState))).toEqual({ status: "cleanup-failed" });
  });

  it("removes a malformed fragment without keeping it", () => {
    const replaceState = vi.fn();
    expect(captureInviteFragment(browser("#t=short", replaceState))).toEqual({ status: "invalid" });
    expect(captureInviteFragment(browser(`#${TOKEN}`, replaceState))).toEqual({ status: "invalid" });
    expect(replaceState).toHaveBeenCalledTimes(2);
  });

  it("leaves an address without a fragment alone", () => {
    const replaceState = vi.fn();
    expect(captureInviteFragment(browser("", replaceState))).toEqual({ status: "none" });
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe("login return storage", () => {
  it("stores {token, savedAt} under one fixed key and reads it once", () => {
    const storage = memoryStorage();
    expect(savePendingInvite(() => storage, TOKEN, 1_000)).toBe(true);
    expect(JSON.parse(storage.values.get(PENDING_INVITE_KEY)!)).toEqual({ token: TOKEN, savedAt: 1_000 });
    expect(consumePendingInvite(() => storage, 2_000)).toBe(TOKEN);
    expect(storage.values.has(PENDING_INVITE_KEY)).toBe(false);
    expect(consumePendingInvite(() => storage, 2_000)).toBeNull();
  });

  it("drops a value older than 30 minutes or malformed as soon as it is seen", () => {
    const storage = memoryStorage();
    savePendingInvite(() => storage, TOKEN, 0);
    expect(hasPendingInvite(() => storage, PENDING_INVITE_TTL_MS)).toBe(true);
    expect(hasPendingInvite(() => storage, PENDING_INVITE_TTL_MS + 1)).toBe(false);
    expect(storage.values.has(PENDING_INVITE_KEY)).toBe(false);
    for (const raw of ["not json", JSON.stringify({ token: "x", savedAt: 0 }), JSON.stringify({ token: TOKEN, savedAt: 0, extra: 1 }), JSON.stringify({ token: TOKEN, savedAt: 10 })]) {
      storage.values.set(PENDING_INVITE_KEY, raw);
      expect(consumePendingInvite(() => storage, 5)).toBeNull();
      expect(storage.values.has(PENDING_INVITE_KEY)).toBe(false);
    }
  });

  it("reports a storage failure instead of pretending it saved", () => {
    const throwing = { getItem: vi.fn(), setItem: vi.fn(() => { throw new Error("QuotaExceededError"); }), removeItem: vi.fn() };
    expect(savePendingInvite(() => throwing, TOKEN)).toBe(false);
    expect(savePendingInvite(() => { throw new Error("SecurityError"); }, TOKEN)).toBe(false);
    expect(consumePendingInvite(() => { throw new Error("SecurityError"); })).toBeNull();
    expect(() => clearPendingInvite(() => { throw new Error("SecurityError"); })).not.toThrow();
  });

  it("never stores a malformed token", () => {
    const storage = memoryStorage();
    expect(savePendingInvite(() => storage, "short")).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe("boot capture before the app runtime", () => {
  const run = (hash: string, replaceThrows = false) => {
    const win: Record<string, unknown> & { location: { hash: string; pathname: string; search: string }; history: { state: null; replaceState: (s: unknown, t: string, url: string) => void } } = {
      location: { hash, pathname: "/folder-invite", search: "" },
      history: { state: null, replaceState: (_s, _t, url) => { if (replaceThrows) throw new Error("SecurityError"); win.location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : ""; } },
    };
    new Function("window", FOLDER_INVITE_BOOT_SCRIPT)(win);
    return win;
  };

  it("removes the fragment and hands the token to the page once", () => {
    const win = run(`#t=${TOKEN}`);
    expect(win.location.hash).toBe("");
    expect(Object.keys(win)).not.toContain(BOOT_CAPTURE_KEY);
    expect(takeInviteCapture(win as never)).toEqual({ status: "token", token: TOKEN });
    expect(win[BOOT_CAPTURE_KEY]).toBeUndefined();
    expect(takeInviteCapture(win as never)).toEqual({ status: "none" });
  });

  it("reports a failed removal so the page sends nothing", () => {
    const win = run(`#t=${TOKEN}`, true);
    expect(takeInviteCapture(win as never)).toEqual({ status: "cleanup-failed" });
  });

  it("ignores other pages", () => {
    const win = run(`#t=${TOKEN}`);
    const other = { ...win, location: { hash: `#t=${TOKEN}`, pathname: "/share", search: "" } };
    new Function("window", FOLDER_INVITE_BOOT_SCRIPT)(other);
    expect(other.location.hash).toBe(`#t=${TOKEN}`);
  });
});
