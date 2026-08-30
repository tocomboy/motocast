const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const KAKAO_OIDC_SCOPES = ["openid", "profile_nickname", "profile_image"] as const;
export const KAKAO_OIDC_COOKIE = "__Host-motocast_kakao_oidc";
export const KAKAO_OIDC_CALLBACK_PATH = "/functions/v1/kakao-oidc/callback";
export const KAKAO_OIDC_HANDOFF_TTL_MS = 2 * 60 * 1000;
const ATTEMPT_TTL_MS = 5 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type KakaoTokenPayload = {
  idToken: string;
  accessToken: string;
  nonce: string;
  expiresAt: number;
};

type OidcAttempt = {
  state: string;
  nonce: string;
  returnTo: string;
  issuedAt: number;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("OIDC_ENCODING_INVALID");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("OIDC_ENCODING_INVALID");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function configuredSecret(secret: string): Uint8Array {
  const bytes = encoder.encode(secret);
  if (bytes.length < 32) throw new Error("OIDC_STATE_NOT_CONFIGURED");
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    exactArrayBuffer(configuredSecret(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const material = new Uint8Array([
    ...encoder.encode("motocast:kakao-oidc:handoff\0"),
    ...configuredSecret(secret),
  ]);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function allowedOriginsFromEnvironment(value: string | undefined): string[] {
  const origins = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const url = new URL(item);
      if (url.origin !== item || (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1")) {
        throw new Error("OIDC_ORIGIN_NOT_CONFIGURED");
      }
      return url.origin;
    });
  if (origins.length === 0 || new Set(origins).size !== origins.length) {
    throw new Error("OIDC_ORIGIN_NOT_CONFIGURED");
  }
  return origins;
}

export function validatedReturnTo(raw: string | null, allowedOrigins: readonly string[]): URL {
  if (!raw) throw new Error("OIDC_RETURN_TO_INVALID");
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new Error("OIDC_RETURN_TO_INVALID");
  }
  if (
    !allowedOrigins.includes(target.origin) ||
    target.pathname !== "/auth/kakao/callback" ||
    target.search !== "" ||
    target.hash !== "" ||
    target.username !== "" ||
    target.password !== ""
  ) {
    throw new Error("OIDC_RETURN_TO_INVALID");
  }
  return target;
}

export async function createOidcAttempt(
  returnTo: URL,
  secret: string,
  now = Date.now(),
): Promise<{ attempt: OidcAttempt; authorizeNonce: string; cookieValue: string }> {
  const attempt: OidcAttempt = {
    state: randomToken(),
    nonce: randomToken(),
    returnTo: returnTo.toString(),
    issuedAt: now,
  };
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(attempt)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload)));
  return {
    attempt,
    authorizeNonce: await sha256Hex(attempt.nonce),
    cookieValue: `${payload}.${base64UrlEncode(signature)}`,
  };
}

export async function verifyOidcAttempt(
  cookieValue: string | null,
  returnedState: string | null,
  allowedOrigins: readonly string[],
  secret: string,
  now = Date.now(),
): Promise<OidcAttempt> {
  if (!cookieValue || !returnedState || !TOKEN_PATTERN.test(returnedState)) {
    throw new Error("OIDC_STATE_INVALID");
  }
  const parts = cookieValue.split(".");
  if (parts.length !== 2) throw new Error("OIDC_STATE_INVALID");
  const [payload, signature] = parts;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    exactArrayBuffer(base64UrlDecode(signature)),
    encoder.encode(payload),
  );
  if (!valid) throw new Error("OIDC_STATE_INVALID");

  let attempt: OidcAttempt;
  try {
    attempt = JSON.parse(decoder.decode(base64UrlDecode(payload))) as OidcAttempt;
  } catch {
    throw new Error("OIDC_STATE_INVALID");
  }
  if (
    !attempt ||
    !TOKEN_PATTERN.test(attempt.state) ||
    !TOKEN_PATTERN.test(attempt.nonce) ||
    attempt.state !== returnedState ||
    !Number.isSafeInteger(attempt.issuedAt) ||
    attempt.issuedAt > now + 30_000 ||
    now - attempt.issuedAt > ATTEMPT_TTL_MS
  ) {
    throw new Error("OIDC_STATE_INVALID");
  }
  validatedReturnTo(attempt.returnTo, allowedOrigins);
  return attempt;
}

export function oidcCookieFromHeader(cookieHeader: string | null): string | null {
  const escaped = KAKAO_OIDC_COOKIE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = (cookieHeader ?? "").match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`))?.[1];
  return value ?? null;
}

export function setOidcCookie(value: string): string {
  return `${KAKAO_OIDC_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ATTEMPT_TTL_MS / 1000}`;
}

export function clearOidcCookie(): string {
  return `${KAKAO_OIDC_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function kakaoAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  attempt: OidcAttempt,
  authorizeNonce: string,
): URL {
  if (!clientId || !redirectUri || !/^[0-9a-f]{64}$/u.test(authorizeNonce)) {
    throw new Error("OIDC_PROVIDER_NOT_CONFIGURED");
  }
  const url = new URL("https://kauth.kakao.com/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", KAKAO_OIDC_SCOPES.join(","));
  url.searchParams.set("state", attempt.state);
  url.searchParams.set("nonce", authorizeNonce);
  return url;
}

export function parseKakaoTokenResponse(value: unknown): { idToken: string; accessToken: string } {
  if (!value || typeof value !== "object") throw new Error("OIDC_PROVIDER_RESPONSE_INVALID");
  const record = value as Record<string, unknown>;
  if (
    typeof record.id_token !== "string" || record.id_token.length < 100 || record.id_token.length > 10_000 ||
    typeof record.access_token !== "string" || record.access_token.length < 10 || record.access_token.length > 10_000
  ) {
    throw new Error("OIDC_PROVIDER_RESPONSE_INVALID");
  }
  return { idToken: record.id_token, accessToken: record.access_token };
}

function validTokenPayload(value: unknown, now: number): KakaoTokenPayload {
  if (!value || typeof value !== "object") throw new Error("OIDC_HANDOFF_INVALID");
  const record = value as Record<string, unknown>;
  if (
    typeof record.idToken !== "string" || record.idToken.length < 100 || record.idToken.length > 10_000 ||
    typeof record.accessToken !== "string" || record.accessToken.length < 10 || record.accessToken.length > 10_000 ||
    typeof record.nonce !== "string" || !TOKEN_PATTERN.test(record.nonce) ||
    typeof record.expiresAt !== "number" || !Number.isSafeInteger(record.expiresAt) ||
    record.expiresAt <= now || record.expiresAt > now + KAKAO_OIDC_HANDOFF_TTL_MS + 30_000
  ) {
    throw new Error("OIDC_HANDOFF_INVALID");
  }
  return record as KakaoTokenPayload;
}

export async function encryptKakaoTokenPayload(payload: KakaoTokenPayload, secret: string): Promise<string> {
  validTokenPayload(payload, Date.now());
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plaintext = encoder.encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode("motocast:kakao-oidc:v1") },
    await encryptionKey(secret),
    plaintext,
  ));
  return base64UrlEncode(new Uint8Array([...iv, ...ciphertext]));
}

export async function decryptKakaoTokenPayload(
  encrypted: string,
  secret: string,
  now = Date.now(),
): Promise<KakaoTokenPayload> {
  const combined = base64UrlDecode(encrypted);
  if (combined.length < 29 || combined.length > 16_384) throw new Error("OIDC_HANDOFF_INVALID");
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode("motocast:kakao-oidc:v1") },
      await encryptionKey(secret),
      ciphertext,
    );
  } catch {
    throw new Error("OIDC_HANDOFF_INVALID");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(decoder.decode(plaintext));
  } catch {
    throw new Error("OIDC_HANDOFF_INVALID");
  }
  return validTokenPayload(payload, now);
}

export function createHandoffToken(): string {
  return randomToken();
}

export function isHandoffToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}
