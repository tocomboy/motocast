const HANDOFF_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
export const KAKAO_OIDC_BINDING_COOKIE = "__Host-motocast_kakao_binding";
export const KAKAO_OIDC_BINDING_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

export type KakaoOidcPayload = {
  idToken: string;
  accessToken: string;
  nonce: string;
  bindingHash: string;
  expiresAt: number;
};

type KakaoOidcSignIn = (credentials: {
  provider: "kakao";
  token: string;
  access_token: string;
  nonce: string;
}) => Promise<{ error: unknown }>;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

export function createKakaoOidcBrowserBinding(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export function kakaoOidcBindingFromCookie(cookieHeader: string | null): string | null {
  const escaped = KAKAO_OIDC_BINDING_COOKIE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = (cookieHeader ?? "").match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`))?.[1];
  return value && HANDOFF_PATTERN.test(value) ? value : null;
}

export async function kakaoOidcBindingHash(binding: string): Promise<string> {
  if (!HANDOFF_PATTERN.test(binding)) throw new Error("OIDC_BINDING_INVALID");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(binding)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isKakaoOidcHandoff(value: unknown): value is string {
  return typeof value === "string" && HANDOFF_PATTERN.test(value);
}

export function clearKakaoOidcHandoffFragment(browser: {
  history: Pick<History, "replaceState">;
  location: Pick<Location, "pathname" | "search" | "replace">;
}): boolean {
  const cleanPath = `${browser.location.pathname}${browser.location.search}`;
  try {
    browser.history.replaceState(null, "", cleanPath);
    return true;
  } catch {
    try {
      browser.location.replace("/login?error=callback");
    } catch {
      // The caller still fails closed and must not submit the fragment.
    }
    return false;
  }
}

export class KakaoOidcCallbackLifecycle {
  private started = false;
  private settled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  enter(onDelayed: () => void, delayMs: number): boolean {
    this.clearTimer();
    if (!this.settled) this.timer = setTimeout(() => {
      if (!this.settled) onDelayed();
    }, delayMs);
    if (this.started) return false;
    this.started = true;
    return true;
  }

  leave() {
    this.clearTimer();
  }

  complete() {
    this.settled = true;
    this.clearTimer();
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

export function kakaoOidcStartUrl(supabaseUrl: string, applicationOrigin: string, bindingHash: string): string {
  const supabase = new URL(supabaseUrl);
  const application = new URL(applicationOrigin);
  if (
    supabase.pathname !== "/" || supabase.search || supabase.hash ||
    application.pathname !== "/" || application.search || application.hash ||
    (supabase.protocol !== "https:" && supabase.hostname !== "127.0.0.1" && supabase.hostname !== "localhost") ||
    (application.protocol !== "https:" && application.hostname !== "127.0.0.1" && application.hostname !== "localhost") ||
    !HASH_PATTERN.test(bindingHash)
  ) {
    throw new Error("OIDC_CONFIGURATION_INVALID");
  }
  const start = new URL("/functions/v1/kakao-oidc/start", supabase.origin);
  start.searchParams.set("return_to", new URL("/auth/kakao/callback", application.origin).toString());
  start.searchParams.set("binding_hash", bindingHash);
  return start.toString();
}

function parsePayload(value: unknown): KakaoOidcPayload {
  if (!value || typeof value !== "object") throw new Error("OIDC_HANDOFF_INVALID");
  const record = value as Record<string, unknown>;
  if (
    typeof record.idToken !== "string" || record.idToken.length < 100 || record.idToken.length > 10_000 ||
    typeof record.accessToken !== "string" || record.accessToken.length < 10 || record.accessToken.length > 10_000 ||
    typeof record.nonce !== "string" || !HANDOFF_PATTERN.test(record.nonce) ||
    typeof record.bindingHash !== "string" || !HASH_PATTERN.test(record.bindingHash) ||
    typeof record.expiresAt !== "number" || !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= Date.now()
  ) {
    throw new Error("OIDC_HANDOFF_INVALID");
  }
  return record as KakaoOidcPayload;
}

export async function consumeKakaoOidcHandoff(
  supabaseUrl: string,
  publishableKey: string,
  applicationOrigin: string,
  handoff: string,
  bindingHash: string,
  fetcher: typeof fetch = fetch,
): Promise<KakaoOidcPayload> {
  if (!isKakaoOidcHandoff(handoff) || !HASH_PATTERN.test(bindingHash)) throw new Error("OIDC_HANDOFF_INVALID");
  const endpoint = new URL("/functions/v1/kakao-oidc/consume", new URL(supabaseUrl).origin);
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "content-type": "application/json",
      origin: new URL(applicationOrigin).origin,
    },
    body: JSON.stringify({ handoff, bindingHash }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("OIDC_HANDOFF_INVALID");
  const payload = parsePayload(await response.json());
  if (payload.bindingHash !== bindingHash) throw new Error("OIDC_BINDING_INVALID");
  return payload;
}

export async function signInWithBoundKakaoOidc(
  payload: KakaoOidcPayload,
  expectedBindingHash: string,
  signIn: KakaoOidcSignIn,
): Promise<void> {
  if (!HASH_PATTERN.test(expectedBindingHash) || payload.bindingHash !== expectedBindingHash) {
    throw new Error("OIDC_BINDING_INVALID");
  }
  const { error } = await signIn({
    provider: "kakao",
    token: payload.idToken,
    access_token: payload.accessToken,
    nonce: payload.nonce,
  });
  if (error) throw new Error("OIDC_ID_TOKEN_REJECTED");
}
