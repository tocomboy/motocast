/** AUTH-007: a client claim or installer name is never admission evidence. */
export class PlayAdmissionError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}
export type PlayPolicy = { packageName: string; certificates: string[]; versions: string[] };
export type PlayChallenge = { requestHash: string; issuedAt: number; expiresAt: number };
type RecordValue = Record<string, unknown>;
const denied = () => { throw new PlayAdmissionError("PLAY_VERIFICATION_FAILED", 403); };
const unavailable = () => { throw new PlayAdmissionError("PLAY_TEMPORARY", 503); };
export function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return denied();
  return value as RecordValue;
}
export function playPolicy(certificates: string | undefined, versions: string | undefined): PlayPolicy {
  const certs = certificates?.split(",") ?? [];
  const codes = versions?.split(",") ?? [];
  if (!certs.length || !codes.length || certs.some(x => !/^[A-Za-z0-9_-]{43}$/.test(x)) ||
    codes.some(x => !/^[1-9][0-9]{0,9}$/.test(x) || Number(x) > 2100000000)) {
    throw new PlayAdmissionError("PLAY_NOT_CONFIGURED", 503);
  }
  return { packageName: "dev.motocast.android", certificates: certs, versions: codes };
}
export function verifyPlayVerdict(payload: unknown, challenge: PlayChallenge, policy: PlayPolicy, now: number) {
  const body = object(object(payload).tokenPayloadExternal);
  const request = object(body.requestDetails);
  const app = object(body.appIntegrity);
  const account = object(body.accountDetails);
  const stamp = typeof request.timestampMillis === "string" && /^[0-9]{1,16}$/.test(request.timestampMillis)
    ? Number(request.timestampMillis) : NaN;
  if (!Number.isSafeInteger(stamp) || !Number.isFinite(now) ||
    !Number.isSafeInteger(challenge.issuedAt) || !Number.isSafeInteger(challenge.expiresAt) ||
    challenge.expiresAt <= now || challenge.issuedAt > now || challenge.expiresAt - challenge.issuedAt > 180000 ||
    stamp < challenge.issuedAt - 5000 || stamp > now + 5000 || now - stamp > 180000 ||
    request.requestPackageName !== policy.packageName || request.requestHash !== challenge.requestHash ||
    app.appRecognitionVerdict !== "PLAY_RECOGNIZED" || app.packageName !== policy.packageName ||
    typeof app.versionCode !== "string" || !policy.versions.includes(app.versionCode) ||
    !Array.isArray(app.certificateSha256Digest) || app.certificateSha256Digest.length === 0 ||
    !app.certificateSha256Digest.every(x => typeof x === "string" && policy.certificates.includes(x)) ||
    account.appLicensingVerdict !== "LICENSED") denied();
  // Do not introduce a device/strong-integrity eligibility policy without a product decision.
}
function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
export async function proofHash(token: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
/** Fixed Google endpoints, bounded requests, no redirects, response/error/token logging. */
export function googlePlayDecoder(serviceAccountJson: string, projectId: string, fetcher: typeof fetch = fetch,
  now: () => number = Date.now) {
  let account: RecordValue;
  try { account = object(JSON.parse(serviceAccountJson)); } catch { throw new PlayAdmissionError("PLAY_NOT_CONFIGURED", 503); }
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId) || account.project_id !== projectId ||
    typeof account.client_email !== "string" || !account.client_email.endsWith(`@${projectId}.iam.gserviceaccount.com`) ||
    !/^[a-zA-Z0-9@._-]+$/.test(account.client_email) || typeof account.private_key !== "string") {
    throw new PlayAdmissionError("PLAY_NOT_CONFIGURED", 503);
  }
  const email = account.client_email;
  const pem = account.private_key;
  let cached: { token: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;
  async function post(url: string, body: string, headers: Record<string, string>) {
    try {
      const response = await fetcher(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(5000), headers, body });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json")) return unavailable();
      if (Number(response.headers.get("content-length")) > 65536) return unavailable();
      const reader = response.body?.getReader();
      if (!reader) return unavailable();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.length; if (size > 65536) return unavailable(); chunks.push(value);
        }
      } finally { await reader.cancel(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } catch { return unavailable(); }
  }
  async function accessToken(): Promise<string> {
    if (cached && cached.expiresAt > now() + 60000) return cached.token;
    if (pending) return pending;
    pending = (async () => {
      try {
        const keyBytes = Uint8Array.from(atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "")), c => c.charCodeAt(0));
        const key = await crypto.subtle.importKey("pkcs8", keyBytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
        const issued = Math.floor(now() / 1000);
        const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
        const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: email,
          scope: "https://www.googleapis.com/auth/playintegrity", aud: "https://oauth2.googleapis.com/token", iat: issued, exp: issued + 300 })}`;
        const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
        const result = object(await post("https://oauth2.googleapis.com/token", new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64url(new Uint8Array(signature))}`,
        }).toString(), { "content-type": "application/x-www-form-urlencoded" }));
        if (typeof result.access_token !== "string" || !/^[\x21-\x7e]{1,8192}$/.test(result.access_token) ||
          result.token_type !== "Bearer" || typeof result.expires_in !== "number" || !Number.isInteger(result.expires_in) ||
          result.expires_in < 1 || result.expires_in > 3600) return unavailable();
        cached = { token: result.access_token, expiresAt: issued * 1000 + result.expires_in * 1000 };
        return cached.token;
      } catch { return unavailable(); }
    })();
    try { return await pending; } finally { pending = undefined; }
  }
  return async (token: string, packageName: string) => {
    if (packageName !== "dev.motocast.android") return denied();
    const bearer = await accessToken();
    return await post(`https://playintegrity.googleapis.com/v1/${packageName}:decodeIntegrityToken`,
      JSON.stringify({ integrity_token: token }), { "content-type": "application/json", authorization: `Bearer ${bearer}` });
  };
}
