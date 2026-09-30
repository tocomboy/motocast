import { describe, expect, it, vi } from "vitest";
import { handlePlayAdmission, type PlayAdmissionDependencies } from "./play-admission-handler.ts";
import { googlePlayDecoder, PlayAdmissionError, playPolicy, proofHash, verifyPlayVerdict } from "./play-integrity.ts";

const userId = "a1000000-0000-0000-0000-000000000001";
const challengeId = "b1000000-0000-0000-0000-000000000001";
const instant = 1790390000000;
const certificate = "c".repeat(43);
const challenge = { requestHash: "r".repeat(43), issuedAt: instant - 1000, expiresAt: instant + 179000 };
const policy = playPolicy(certificate, "4");
function verdict() { return { tokenPayloadExternal: {
  requestDetails: { requestPackageName: policy.packageName, requestHash: challenge.requestHash, timestampMillis: String(instant) },
  appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED", packageName: policy.packageName, certificateSha256Digest: [certificate], versionCode: "4" },
  accountDetails: { appLicensingVerdict: "LICENSED" },
} }; }
const request = (body: unknown = { action: "complete", challengeId, integrityToken: "test-only-integrity-proof" }, headers = {}) =>
  new Request("https://example.test/functions/v1/play-admission", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
function dependencies(): PlayAdmissionDependencies {
  return { authenticate: vi.fn(async () => userId), policy: () => policy, now: () => instant,
    rpc: vi.fn(async (name) => name === "begin_play_admission_internal" ? { status: "challenge", challengeId, requestHash: challenge.requestHash } : challenge),
    decode: vi.fn(async () => verdict()) };
}
describe("Play admission proof", () => {
  it("accepts licensed recognized approved build with a fresh exact challenge", () => {
    expect(() => verifyPlayVerdict(verdict(), challenge, policy, instant)).not.toThrow();
  });
  it.each([
    ["requestDetails", "requestPackageName", "dev.motocast.android.preview"],
    ["requestDetails", "requestHash", "foreign-user-or-environment"],
    ["requestDetails", "timestampMillis", String(instant - 180001)],
    ["requestDetails", "timestampMillis", String(instant + 5001)],
    ["requestDetails", "timestampMillis", instant],
    ["appIntegrity", "appRecognitionVerdict", "UNRECOGNIZED_VERSION"],
    ["appIntegrity", "appRecognitionVerdict", "UNEVALUATED"],
    ["appIntegrity", "packageName", "other.app"],
    ["appIntegrity", "versionCode", "3"],
    ["appIntegrity", "certificateSha256Digest", []],
    ["appIntegrity", "certificateSha256Digest", ["foreign-certificate"]],
    ["appIntegrity", "certificateSha256Digest", [certificate, "foreign-certificate"]],
    ["accountDetails", "appLicensingVerdict", "UNLICENSED"],
    ["accountDetails", "appLicensingVerdict", "UNEVALUATED"],
  ])("rejects invalid %s.%s", (section, field, value) => {
    const payload = verdict();
    (payload.tokenPayloadExternal as unknown as Record<string, Record<string, unknown>>)[section as string][field as string] = value;
    expect(() => verifyPlayVerdict(payload, challenge, policy, instant)).toThrow("PLAY_VERIFICATION_FAILED");
  });
  it.each([null, {}, [], { tokenPayloadExternal: {} }])("rejects malformed payload %#", value => {
    expect(() => verifyPlayVerdict(value, challenge, policy, instant)).toThrow("PLAY_VERIFICATION_FAILED");
  });
  it("rejects expiry at the exact deadline and proof before this challenge", () => {
    expect(() => verifyPlayVerdict(verdict(), challenge, policy, challenge.expiresAt)).toThrow();
    const old = verdict(); old.tokenPayloadExternal.requestDetails.timestampMillis = String(challenge.issuedAt - 5001);
    expect(() => verifyPlayVerdict(old, challenge, policy, instant)).toThrow();
  });
  it("requires explicit certificate and version allowlists", () => {
    for (const [certs, codes] of [[undefined, "4"], [certificate, ""], ["bad", "4"], [certificate, "0"], [certificate, "2100000001"]]) {
      expect(() => playPolicy(certs, codes)).toThrow("PLAY_NOT_CONFIGURED");
    }
  });
});
describe("production admission handler", () => {
  it("binds both storage calls to authenticated identity and proof hash, never client identity", async () => {
    const deps = dependencies(); const response = await handlePlayAdmission(request(), deps);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: "active" });
    const args = { member_id: userId, attempt_id: challengeId, token_hash: await proofHash("test-only-integrity-proof") };
    expect(deps.rpc).toHaveBeenNthCalledWith(1, "take_play_admission_internal", args);
    expect(deps.rpc).toHaveBeenNthCalledWith(2, "complete_play_admission_internal", args);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("begins a bounded challenge without decoding or creating membership", async () => {
    const deps = dependencies(); const response = await handlePlayAdmission(request({ action: "begin" }), deps);
    expect(response.status).toBe(200); expect(deps.rpc).toHaveBeenCalledExactlyOnceWith("begin_play_admission_internal", { member_id: userId });
    expect(deps.decode).not.toHaveBeenCalled();
  });
  it.each(["UNLICENSED", "UNEVALUATED"])("does not enroll an invalid proof %s", async status => {
    const deps = dependencies(); const payload = verdict(); payload.tokenPayloadExternal.accountDetails.appLicensingVerdict = status;
    deps.decode = vi.fn(async () => payload);
    expect((await handlePlayAdmission(request(), deps)).status).toBe(403);
    expect(deps.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["PLAY_INVALID_CHALLENGE", "PLAY_MEMBERSHIP_REVOKED", "PLAY_RATE_LIMITED"])("rejects %s before Google call", async code => {
    const deps = dependencies(); deps.rpc = vi.fn(async () => { throw new PlayAdmissionError(code, code === "PLAY_RATE_LIMITED" ? 429 : 403); });
    const response = await handlePlayAdmission(request(), deps);
    expect(response.status).toBe(code === "PLAY_RATE_LIMITED" ? 429 : 403); expect(deps.decode).not.toHaveBeenCalled();
  });
  it("does not enroll when Google fails or proof expires during decode", async () => {
    for (const decode of [async () => { throw new Error("private-provider-error"); }, async () => verdict()]) {
      const deps = dependencies(); deps.decode = decode; deps.now = () => challenge.expiresAt;
      const response = await handlePlayAdmission(request(), deps);
      expect(response.status).toBeGreaterThanOrEqual(400); expect(await response.text()).not.toContain("private-provider-error");
      expect(deps.rpc).toHaveBeenCalledTimes(1);
    }
  });
  it("does not report success on uncertain persistence", async () => {
    const deps = dependencies(); deps.rpc = vi.fn(async name => {
      if (name === "complete_play_admission_internal") throw new Error("SQL internal credentials"); return challenge;
    });
    const response = await handlePlayAdmission(request(), deps);
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ code: "PLAY_TEMPORARY" });
  });
  it("blocks browsers, identity injection, malformed and oversized proof before RPC", async () => {
    for (const req of [request({ action: "begin" }, { origin: "https://motocast.test" }),
      request({ action: "begin", userId }), request({ action: "complete", challengeId, integrityToken: "x".repeat(33000) })]) {
      const deps = dependencies(); expect((await handlePlayAdmission(req, deps)).status).toBeGreaterThanOrEqual(400);
      expect(deps.rpc).not.toHaveBeenCalled(); expect(deps.decode).not.toHaveBeenCalled();
    }
  });
  it("auth failure cannot issue any challenge", async () => {
    const deps = dependencies(); deps.authenticate = async () => { throw new PlayAdmissionError("PLAY_AUTH_REQUIRED", 401); };
    expect((await handlePlayAdmission(request({ action: "begin" }), deps)).status).toBe(401);
    expect(deps.rpc).not.toHaveBeenCalled();
  });
});
describe("Google decoder transport", () => {
  it("keeps provider errors, oversized responses and timeouts closed without retry", async () => {
    const key = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" }, true, ["sign", "verify"]);
    const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", key.privateKey));
    const account = JSON.stringify({ project_id: "motocast-play-2026", client_email: "verifier@motocast-play-2026.iam.gserviceaccount.com",
      private_key: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...bytes))}\n-----END PRIVATE KEY-----` }); // gitleaks:allow -- generated ephemeral RSA test key, no stored credential
    for (const failure of [
      () => Response.json({ privateDetail: "sensitive-provider-error" }, { status: 403 }),
      () => new Response("not-json", { headers: { "content-type": "application/json" } }),
      () => new Response("x".repeat(65537), { headers: { "content-type": "application/json" } }),
      () => new Response("{}", { status: 302, headers: { location: "https://foreign.test", "content-type": "application/json" } }),
      () => { throw new DOMException("sensitive-provider-error", "TimeoutError"); },
    ]) {
      const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).includes("oauth2")
        ? Response.json({ access_token: "test-only-bearer", token_type: "Bearer", expires_in: 3600 }) : failure());
      const deps = dependencies(); deps.decode = googlePlayDecoder(account, "motocast-play-2026", fetcher, () => instant);
      const response = await handlePlayAdmission(request(), deps);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ code: "PLAY_TEMPORARY" });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(deps.rpc).toHaveBeenCalledTimes(1);
    }
  });
  it("refuses foreign service accounts before any network call", () => {
    expect(() => googlePlayDecoder(JSON.stringify({ project_id: "foreign", client_email: "x@foreign.iam.gserviceaccount.com", private_key: "x" }), "motocast-play-2026")).toThrow("PLAY_NOT_CONFIGURED");
  });
  it("signs only for Google Play, bounds requests, reuses OAuth token but never verdicts", async () => {
    const key = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" }, true, ["sign", "verify"]);
    const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", key.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...bytes))}\n-----END PRIVATE KEY-----`; // gitleaks:allow -- generated ephemeral RSA test key, no stored credential
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error"); expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (String(url).includes("oauth2")) {
        const assertion = new URLSearchParams(String(init?.body)).get("assertion")!;
        const claims = JSON.parse(atob(assertion.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));
        expect(claims.scope).toBe("https://www.googleapis.com/auth/playintegrity");
        expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
        expect(claims.exp - claims.iat).toBe(300);
        return Response.json({ access_token: "test-only-bearer", token_type: "Bearer", expires_in: 3600 });
      }
      expect(url).toBe("https://playintegrity.googleapis.com/v1/dev.motocast.android:decodeIntegrityToken");
      expect(init?.headers).toMatchObject({ authorization: "Bearer test-only-bearer" });
      return Response.json(verdict());
    });
    const decode = googlePlayDecoder(JSON.stringify({ project_id: "motocast-play-2026", client_email: "verifier@motocast-play-2026.iam.gserviceaccount.com", private_key: pem }), "motocast-play-2026", fetcher, () => instant);
    expect(await decode("proof-a", policy.packageName)).toEqual(verdict());
    expect(await decode("proof-b", policy.packageName)).toEqual(verdict());
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
