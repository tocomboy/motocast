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
/**
 * One-shot request from the invite page ("폴더 열기") to open that folder in 즐겨찾기, as
 * `{folderId, userId, savedAt}`: the account that saw the invite owns it, and it lasts 10 minutes.
 */
export const OPEN_FOLDER_STORAGE_KEY = "motocast.favorites.open-folder";
export const OPEN_FOLDER_TTL_MS = 10 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type OpenFolderRequest = { folderId: string; userId: string };

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

/**
 * Runs inline in the document head, before the Next.js runtime reads `window.location`
 * (it would otherwise put the fragment back when it records the first URL). It moves the
 * fragment into a short-lived, non-enumerable property that the invite page takes once.
 */
export const BOOT_CAPTURE_KEY = "__motocastFolderInviteFragment";
export const FOLDER_INVITE_BOOT_SCRIPT = `(function(){try{var l=window.location;if(l.pathname!==${JSON.stringify(INVITE_PATH)}||!l.hash||l.hash==="#")return;var h=l.hash,c=true;try{window.history.replaceState(window.history.state,"",l.pathname+l.search)}catch(e){c=false}Object.defineProperty(window,${JSON.stringify(BOOT_CAPTURE_KEY)},{value:{hash:h,cleaned:c},configurable:true})}catch(e){}})();`;

/** Takes what the boot script captured (once), or captures now when it did not run. */
export function takeInviteCapture(browser: Browser & Record<string, unknown>): InviteCapture {
  const early = browser[BOOT_CAPTURE_KEY] as { hash?: unknown; cleaned?: unknown } | undefined;
  if (early) {
    try { delete browser[BOOT_CAPTURE_KEY]; } catch { /* configurable; nothing else to do */ }
    if (early.cleaned !== true) return { status: "cleanup-failed" };
    const token = typeof early.hash === "string" && early.hash.startsWith("#t=") ? early.hash.slice(3) : "";
    return INVITE_TOKEN_PATTERN.test(token) ? { status: "token", token } : { status: "invalid" };
  }
  return captureInviteFragment(browser);
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

/** Stores "폴더 열기" for the account that saw the invite. Nothing is stored when it cannot be. */
export function saveOpenFolderRequest(storage: () => Storage, request: OpenFolderRequest, now = Date.now()) {
  if (!UUID_PATTERN.test(request.folderId) || !UUID_PATTERN.test(request.userId)) return;
  try {
    storage().setItem(OPEN_FOLDER_STORAGE_KEY, JSON.stringify({ folderId: request.folderId, userId: request.userId, savedAt: now }));
  } catch {
    try { storage().removeItem(OPEN_FOLDER_STORAGE_KEY); } catch { /* the list opens instead */ }
  }
}

/** Reads and removes "폴더 열기" in one step; expired (10 minutes) or malformed values give null. */
export function takeOpenFolderRequest(storage: () => Storage, now = Date.now()): OpenFolderRequest | null {
  let raw: string | null = null;
  try {
    const store = storage();
    raw = store.getItem(OPEN_FOLDER_STORAGE_KEY);
    store.removeItem(OPEN_FOLDER_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let value: unknown = null;
  try { value = JSON.parse(raw); } catch { value = null; }
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const fresh = record &&
    Object.keys(record).sort().join() === "folderId,savedAt,userId" &&
    typeof record.folderId === "string" && UUID_PATTERN.test(record.folderId) &&
    typeof record.userId === "string" && UUID_PATTERN.test(record.userId) &&
    typeof record.savedAt === "number" && Number.isFinite(record.savedAt) &&
    record.savedAt <= now && now - record.savedAt <= OPEN_FOLDER_TTL_MS;
  return fresh ? { folderId: record.folderId as string, userId: record.userId as string } : null;
}
