export type RecoveryPin = {
  projectRef: string;
  supabaseUrl: string;
  functionName: string;
  buildId: string;
  notBefore: number;
  expiresAt: number;
  recipientSpki: string;
  recipientFingerprint: string;
  challengeSha256: string;
  serviceRoleBinding: string;
};

type RecoveryRuntime = {
  getEnv: (name: string) => string | undefined;
  now?: () => number;
  crypto?: Crypto;
};

const TARGET_NAMES = ["KMA_APIHUB_KEY", "KMA_DAILY_LIMIT"] as const;
const MAX_BODY_BYTES = 512;
const MAX_LIFETIME_MS = 6 * 60 * 60 * 1_000;
const CLOCK_MARGIN_MS = 60_000;
const SAFE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

class RecoveryRequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function fail(status: number, code: string): never {
  throw new RecoveryRequestError(status, code);
}

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), { status, headers: SAFE_HEADERS });
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail(500, "RECOVERY_CONFIGURATION_INVALID");
  }
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    fail(500, "RECOVERY_CONFIGURATION_INVALID");
  }
}

function encodeBase64(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validHexSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validatePinShape(pin: RecoveryPin): void {
  if (!pin || typeof pin !== "object" || !exactKeys(pin, [
    "projectRef",
    "supabaseUrl",
    "functionName",
    "buildId",
    "notBefore",
    "expiresAt",
    "recipientSpki",
    "recipientFingerprint",
    "challengeSha256",
    "serviceRoleBinding",
  ])) fail(500, "RECOVERY_CONFIGURATION_INVALID");

  if (
    !/^[a-z]{20}$/.test(pin.projectRef) ||
    pin.supabaseUrl !== `https://${pin.projectRef}.supabase.co` ||
    pin.functionName !== "preview-secret-recovery-147b2d57" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(pin.buildId) ||
    !Number.isSafeInteger(pin.notBefore) ||
    !Number.isSafeInteger(pin.expiresAt) ||
    pin.expiresAt <= pin.notBefore ||
    pin.expiresAt - pin.notBefore > MAX_LIFETIME_MS + CLOCK_MARGIN_MS ||
    typeof pin.recipientSpki !== "string" ||
    !validHexSha256(pin.recipientFingerprint) ||
    !validHexSha256(pin.challengeSha256) ||
    !validHexSha256(pin.serviceRoleBinding)
  ) fail(500, "RECOVERY_CONFIGURATION_INVALID");
}

export function recoveryPinAad(pin: RecoveryPin): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    projectRef: pin.projectRef,
    supabaseUrl: pin.supabaseUrl,
    functionName: pin.functionName,
    buildId: pin.buildId,
    notBefore: pin.notBefore,
    expiresAt: pin.expiresAt,
    recipientSpki: pin.recipientSpki,
    recipientFingerprint: pin.recipientFingerprint,
    challengeSha256: pin.challengeSha256,
    serviceRoleBinding: pin.serviceRoleBinding,
  }));
}

async function readBoundedBody(request: Request): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    fail(413, "RECOVERY_REQUEST_TOO_LARGE");
  }
  if (!request.body) fail(400, "RECOVERY_REQUEST_INVALID");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      fail(413, "RECOVERY_REQUEST_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(400, "RECOVERY_REQUEST_INVALID");
  }
}

function parseChallenge(bodyText: string): string {
  let value: unknown;
  try {
    value = JSON.parse(bodyText);
  } catch {
    fail(400, "RECOVERY_REQUEST_INVALID");
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !exactKeys(value, ["challenge"])) {
    fail(400, "RECOVERY_REQUEST_INVALID");
  }
  const challenge = (value as { challenge?: unknown }).challenge;
  if (typeof challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    fail(400, "RECOVERY_REQUEST_INVALID");
  }
  try {
    const decoded = challenge.replace(/-/g, "+").replace(/_/g, "/") + "=";
    if (decodeBase64(decoded).length !== 32) fail(400, "RECOVERY_REQUEST_INVALID");
  } catch (error) {
    if (error instanceof RecoveryRequestError && error.status === 400) throw error;
    fail(400, "RECOVERY_REQUEST_INVALID");
  }
  if (bodyText !== JSON.stringify({ challenge })) fail(400, "RECOVERY_REQUEST_INVALID");
  return challenge;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index % left.length] ?? 0) ^ (right[index % right.length] ?? 0);
  }
  return difference === 0;
}

async function sha256(runtimeCrypto: Crypto, value: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return new Uint8Array(await runtimeCrypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer));
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function computeServiceRoleBinding(
  runtimeCrypto: Crypto,
  challenge: string,
  pin: RecoveryPin,
  bearerJwt: string,
): Promise<Uint8Array> {
  const challengeBytes = decodeBase64(challenge.replace(/-/g, "+").replace(/_/g, "/") + "=");
  const key = await runtimeCrypto.subtle.importKey(
    "raw",
    challengeBytes.slice().buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = new TextEncoder().encode(JSON.stringify([
    "motocast-preview-recovery-service-role-v1",
    pin.projectRef,
    pin.functionName,
    pin.buildId,
    bearerJwt,
  ]));
  return new Uint8Array(await runtimeCrypto.subtle.sign(
    "HMAC",
    key,
    message.buffer as ArrayBuffer,
  ));
}

async function validateRecipient(runtimeCrypto: Crypto, pin: RecoveryPin): Promise<CryptoKey> {
  const spki = decodeBase64(pin.recipientSpki);
  const fingerprint = bytesToHex(await sha256(runtimeCrypto, spki));
  if (fingerprint !== pin.recipientFingerprint) fail(500, "RECOVERY_CONFIGURATION_INVALID");
  try {
    const key = await runtimeCrypto.subtle.importKey(
      "spki",
      spki.slice().buffer as ArrayBuffer,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["wrapKey"],
    );
    const algorithm = key.algorithm as RsaHashedKeyAlgorithm;
    if (algorithm.modulusLength !== 3072 || algorithm.publicExponent.length !== 3 ||
        algorithm.publicExponent[0] !== 1 || algorithm.publicExponent[1] !== 0 ||
        algorithm.publicExponent[2] !== 1) fail(500, "RECOVERY_CONFIGURATION_INVALID");
    return key;
  } catch {
    fail(500, "RECOVERY_CONFIGURATION_INVALID");
  }
}

function validateRequestUrl(request: Request, pin: RecoveryPin): void {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    fail(403, "RECOVERY_PROJECT_MISMATCH");
  }
  const allowedPaths = [
    `/functions/v1/${pin.functionName}`,
    `/${pin.functionName}`,
  ];
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.hostname !== `${pin.projectRef}.supabase.co` ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !allowedPaths.includes(url.pathname) ||
    url.search !== "" ||
    url.hash !== ""
  ) fail(403, "RECOVERY_PROJECT_MISMATCH");
}

function validateRecoveryWindow(pin: RecoveryPin, now: () => number): void {
  const currentTime = now();
  if (!Number.isSafeInteger(currentTime) || currentTime + CLOCK_MARGIN_MS < pin.notBefore) {
    fail(403, "RECOVERY_WINDOW_INACTIVE");
  }
  if (currentTime >= pin.expiresAt) fail(403, "RECOVERY_WINDOW_EXPIRED");
}

export function createRecoveryHandler(pin: RecoveryPin, runtime: RecoveryRuntime) {
  return async (request: Request): Promise<Response> => {
    try {
      validatePinShape(pin);
      const runtimeCrypto = runtime.crypto ?? globalThis.crypto;
      if (!runtimeCrypto?.subtle) fail(500, "RECOVERY_CONFIGURATION_INVALID");

      const now = runtime.now ?? Date.now;
      validateRecoveryWindow(pin, now);
      validateRequestUrl(request, pin);
      if (request.headers.has("origin")) fail(403, "RECOVERY_ORIGIN_REJECTED");
      if (request.method !== "POST") fail(405, "RECOVERY_METHOD_NOT_ALLOWED");
      if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
        fail(415, "RECOVERY_CONTENT_TYPE_INVALID");
      }

      const challenge = parseChallenge(await readBoundedBody(request));
      const challengeDigest = bytesToHex(await sha256(runtimeCrypto, challenge));
      if (challengeDigest !== pin.challengeSha256) fail(403, "RECOVERY_CHALLENGE_INVALID");

      const configuredUrl = runtime.getEnv("SUPABASE_URL");
      if (configuredUrl !== pin.supabaseUrl) fail(500, "RECOVERY_CONFIGURATION_INVALID");
      const authorization = request.headers.get("authorization");
      const presented = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
      const presentedBinding = await computeServiceRoleBinding(runtimeCrypto, challenge, pin, presented);
      if (!authorization || presented.length === 0 ||
          !constantTimeEqual(presentedBinding, hexToBytes(pin.serviceRoleBinding))) {
        fail(401, "RECOVERY_AUTHORIZATION_INVALID");
      }

      const recipient = await validateRecipient(runtimeCrypto, pin);
      validateRecoveryWindow(pin, now);
      const apiHubKey = runtime.getEnv(TARGET_NAMES[0]);
      const dailyLimit = runtime.getEnv(TARGET_NAMES[1]);
      if (typeof apiHubKey !== "string" || typeof dailyLimit !== "string") {
        fail(500, "RECOVERY_TARGET_MISSING");
      }

      const key = await runtimeCrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
      const iv = runtimeCrypto.getRandomValues(new Uint8Array(12));
      const plaintext = new TextEncoder().encode(JSON.stringify({
        KMA_APIHUB_KEY: apiHubKey,
        KMA_DAILY_LIMIT: dailyLimit,
      }));
      const [wrappedKey, ciphertext] = await Promise.all([
        runtimeCrypto.subtle.wrapKey("raw", key, recipient, { name: "RSA-OAEP" }),
        runtimeCrypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv: iv.slice().buffer as ArrayBuffer,
            additionalData: recoveryPinAad(pin).buffer as ArrayBuffer,
            tagLength: 128,
          },
          key,
          plaintext,
        ),
      ]);
      const responseBody = JSON.stringify({
        version: 1,
        iv: encodeBase64(iv),
        wrappedKey: encodeBase64(wrappedKey),
        ciphertext: encodeBase64(ciphertext),
      });
      validateRecoveryWindow(pin, now);
      return new Response(responseBody, { status: 200, headers: SAFE_HEADERS });
    } catch (error) {
      if (error instanceof RecoveryRequestError) return jsonError(error.status, error.code);
      return jsonError(500, "RECOVERY_INTERNAL_FAILURE");
    }
  };
}
