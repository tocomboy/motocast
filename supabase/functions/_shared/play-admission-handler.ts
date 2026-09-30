import { object, PlayAdmissionError, type PlayChallenge, type PlayPolicy, proofHash, verifyPlayVerdict } from "./play-integrity.ts";

export type PlayAdmissionDependencies = {
  authenticate: (request: Request) => Promise<string>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  policy: () => PlayPolicy;
  decode: (token: string, packageName: string) => Promise<unknown>;
  now: () => number;
};
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
/** Native admission endpoint. Each request independently validates the Kakao user JWT. */
export async function handlePlayAdmission(request: Request, deps: PlayAdmissionDependencies): Promise<Response> {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
  } });
  try {
    if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
    // Web/PWA admission remains invite-only. Origin absence itself grants no privileges.
    if (request.headers.has("origin")) return json({ code: "PLAY_VERIFICATION_FAILED" }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ code: "INVALID_REQUEST" }, 400);
    if (Number(request.headers.get("content-length")) > 32768) return json({ code: "INVALID_REQUEST" }, 413);
    const userId = await deps.authenticate(request);
    if (!uuid(userId)) throw new PlayAdmissionError("PLAY_AUTH_REQUIRED", 401);
    const reader = request.body?.getReader();
    if (!reader) return json({ code: "INVALID_REQUEST" }, 400);
    const pieces: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length; if (size > 32768) return json({ code: "INVALID_REQUEST" }, 413); pieces.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const piece of pieces) { bytes.set(piece, offset); offset += piece.length; }
    let body: Record<string, unknown>;
    try { body = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); }
    catch { return json({ code: "INVALID_REQUEST" }, 400); }
    const policy = deps.policy(); // Misconfiguration is closed even before challenge issuance.
    if (body.action === "begin" && Object.keys(body).length === 1) {
      return json(await deps.rpc("begin_play_admission_internal", { member_id: userId }));
    }
    if (body.action !== "complete" || Object.keys(body).length !== 3 || !uuid(body.challengeId) ||
      typeof body.integrityToken !== "string" || !/^[A-Za-z0-9._-]{1,16384}$/.test(body.integrityToken)) {
      return json({ code: "INVALID_REQUEST" }, 400);
    }
    const tokenHash = await proofHash(body.integrityToken);
    const args = { member_id: userId, attempt_id: body.challengeId, token_hash: tokenHash };
    const challenge = object(await deps.rpc("take_play_admission_internal", args));
    if (typeof challenge.requestHash !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(challenge.requestHash) ||
      typeof challenge.issuedAt !== "number" || typeof challenge.expiresAt !== "number") {
      throw new PlayAdmissionError("PLAY_TEMPORARY", 503);
    }
    const verdict = await deps.decode(body.integrityToken, policy.packageName);
    verifyPlayVerdict(verdict, challenge as PlayChallenge, policy, deps.now());
    await deps.rpc("complete_play_admission_internal", args);
    return json({ status: "active" });
  } catch (error) {
    const failure = error instanceof PlayAdmissionError ? error : new PlayAdmissionError("PLAY_TEMPORARY", 503);
    return json({ code: failure.code }, failure.status);
  }
}
