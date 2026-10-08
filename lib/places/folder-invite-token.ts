import { INVITE_TOKEN_PATTERN } from "./shared-folders";

/**
 * Folder invite token handling (contract §8, SHARE-002 exception approved 2026-10-09).
 *
 * - The link is `/folder-invite#t=<token>`. The fragment is read synchronously on the first run
 *   and removed with `history.replaceState` before any request; if removal fails, nothing is sent.
 * - Only "로그인하고 계속" stores the token, in one fixed sessionStorage key as `{token, savedAt}`.
 *   30 minutes is how long the app accepts the return, not the token lifetime (up to 7 days).
 * - The token never goes into a query, `return_to`, logs or analytics.
 */
export const INVITE_PATH = "/folder-invite";
export const PENDING_INVITE_KEY = "motocast.folder-invite.pending";
export const PENDING_INVITE_TTL_MS = 30 * 60 * 1000;
/** One-shot request from the invite page ("폴더 열기") to open that folder in 즐겨찾기. Holds a folder id only. */
export const OPEN_FOLDER_STORAGE_KEY = "motocast.favorites.open-folder";

export type InviteCapture =
  | { status: "token"; token: string }
  | { status: "invalid" }
  | { status: "none" }
  | { status: "cleanup-failed" };

type Browser = {
  location: Pick<Location, "hash" | "pathname" | "search">;
  history: Pick<History, "replaceState">;
};

/** Moves `#t=<token>` from the address into memory. Runs before any request on the page. */
export function captureInviteFragment(browser: Browser): InviteCapture {
  const hash = browser.location.hash;
  if (!hash || hash === "#") return { status: "none" };
  try {
    browser.history.replaceState(null, "", `${browser.location.pathname}${browser.location.search}`);
  } catch {
    return { status: "cleanup-failed" };
  }
  const token = hash.startsWith("#t=") ? hash.slice(3) : "";
  return INVITE_TOKEN_PATTERN.test(token) ? { status: "token", token } : { status: "invalid" };
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

/** Stores the token for the same-tab login return. `false` means storage failed: nothing was stored. */
export function savePendingInvite(storage: () => Storage, token: string, now = Date.now()): boolean {
  if (!INVITE_TOKEN_PATTERN.test(token)) return false;
  try {
    storage().setItem(PENDING_INVITE_KEY, JSON.stringify({ token, savedAt: now }));
    return true;
  } catch {
    try { storage().removeItem(PENDING_INVITE_KEY); } catch { /* nothing more can be done */ }
    return false;
  }
}

function readPending(storage: Storage, now: number): { token: string } | null {
  const raw = storage.getItem(PENDING_INVITE_KEY);
  if (raw === null) return null;
  let value: unknown = null;
  try { value = JSON.parse(raw); } catch { value = null; }
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const fresh = record &&
    Object.keys(record).sort().join() === "savedAt,token" &&
    typeof record.token === "string" && INVITE_TOKEN_PATTERN.test(record.token) &&
    typeof record.savedAt === "number" && Number.isFinite(record.savedAt) &&
    record.savedAt <= now && now - record.savedAt <= PENDING_INVITE_TTL_MS;
  if (!fresh) {
    // Expired or malformed: removed as soon as it is seen.
    storage.removeItem(PENDING_INVITE_KEY);
    return null;
  }
  return { token: record.token as string };
}

/** Reads and removes the stored token in one step (after login). */
export function consumePendingInvite(storage: () => Storage, now = Date.now()): string | null {
  try {
    const store = storage();
    const pending = readPending(store, now);
    store.removeItem(PENDING_INVITE_KEY);
    return pending?.token ?? null;
  } catch {
    return null;
  }
}

/** Whether a fresh token waits for the login return; expired or malformed values are removed. */
export function hasPendingInvite(storage: () => Storage, now = Date.now()): boolean {
  try {
    return readPending(storage(), now) !== null;
  } catch {
    return false;
  }
}

export function clearPendingInvite(storage: () => Storage) {
  try { storage().removeItem(PENDING_INVITE_KEY); } catch { /* storage unavailable: nothing stored */ }
}
