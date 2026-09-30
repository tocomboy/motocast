import { describe, expect, it, vi } from "vitest";
import { createPlayAdmissionRuntime } from "./play-admission-runtime.ts";
import { type PlayChallenge, proofHash } from "./play-integrity.ts";

type Runtime = Parameters<typeof createPlayAdmissionRuntime>[0];
const urls = {
  preview: "https://lehjmbgfpoemqcwxowbx.supabase.co",
  production: "https://obodvbyzptxeehgpcpkd.supabase.co",
};
const userId = "a1000000-0000-0000-0000-000000000001";
const ids = {
  preview: "b1000000-0000-0000-0000-000000000001",
  production: "b1000000-0000-0000-0000-000000000002",
};
const instant = 1790390000000;
const hashes = { preview: "p".repeat(43), production: "r".repeat(43) };
const certificates = { preview: "c".repeat(43), production: "d".repeat(43) };
const versions = { preview: "4", production: "5" };
function verdict(environment: keyof typeof urls) {
  return { tokenPayloadExternal: {
    requestDetails: { requestPackageName: "dev.motocast.android", requestHash: hashes[environment], timestampMillis: String(instant) },
    appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED", packageName: "dev.motocast.android",
      certificateSha256Digest: [certificates[environment]], versionCode: versions[environment] },
    accountDetails: { appLicensingVerdict: "LICENSED" },
  } };
}
function request(environment: keyof typeof urls, action: "begin" | "complete" = "complete",
  challengeId = ids[environment], url = `${urls[environment]}/functions/v1/play-admission`, headers = {}) {
  return new Request(url, { method: "POST", headers: {
    "content-type": "application/json", authorization: "Bearer test-only-user-session", ...headers,
  }, body: JSON.stringify(action === "begin" ? { action } : { action, challengeId, integrityToken: "test-only-integrity-proof" }) });
}
function fixture(environment: keyof typeof urls) {
  const env: Record<string, string | undefined> = {
    SUPABASE_URL: urls[environment], PLAY_ADMISSION_ENVIRONMENT: environment,
    PLAY_ADMISSION_CERTIFICATES: certificates[environment], PLAY_ADMISSION_VERSIONS: versions[environment],
    PLAY_ADMISSION_PROJECT_ID: `test-${environment}-project`,
    PLAY_ADMISSION_SERVICE_ACCOUNT: `test-only-${environment}-service-account`,
  };
  // Separate maps model each project's existing challenge lookup, not a shared challenge store.
  const challenges = new Map<string, PlayChallenge>([[ids[environment], {
    requestHash: hashes[environment], issuedAt: instant - 1000, expiresAt: instant + 179000,
  }]]);
  const getUser = vi.fn<Runtime["getUser"]>(async () => ({ data: { user: { id: userId, identities: [{ provider: "kakao" }] } }, error: null }));
  const rpc = vi.fn<Runtime["rpc"]>(async (name, args) => {
    if (name === "begin_play_admission_internal") return { data: {
      status: "challenge", challengeId: ids[environment], requestHash: hashes[environment],
    }, error: null };
    const challenge = challenges.get(String(args.attempt_id));
    if (!challenge) return { data: null, error: { message: "PLAY_INVALID_CHALLENGE" } };
    if (name === "complete_play_admission_internal") return { data: { status: "active" }, error: null };
    return { data: challenge, error: null };
  });
  const decode = vi.fn(async () => verdict(environment));
  const decoder = vi.fn<NonNullable<Runtime["decoder"]>>(() => decode);
  const handle = createPlayAdmissionRuntime({ env: name => env[name], getUser, rpc, decoder, now: () => instant });
  return { handle, env, getUser, rpc, decoder, decode, challenges };
}

describe("deployed Play admission runtime environment boundary", () => {
  it.each(["preview", "production"] as const)("executes begin and complete with the exact %s mapping and local configuration", async environment => {
    const runtime = fixture(environment);
    const begin = await runtime.handle(request(environment, "begin"));
    expect(begin.status).toBe(200);
    expect(await begin.json()).toEqual({ status: "challenge", challengeId: ids[environment], requestHash: hashes[environment] });
    expect(runtime.rpc).toHaveBeenCalledExactlyOnceWith("begin_play_admission_internal", { member_id: userId });
    expect(runtime.decoder).not.toHaveBeenCalled();
    const complete = await runtime.handle(request(environment));
    expect(complete.status).toBe(200);
    expect(await complete.json()).toEqual({ status: "active" });
    expect(runtime.getUser).toHaveBeenCalledTimes(2);
    expect(runtime.decoder).toHaveBeenCalledExactlyOnceWith(`test-only-${environment}-service-account`, `test-${environment}-project`);
    expect(runtime.decode).toHaveBeenCalledExactlyOnceWith("test-only-integrity-proof", "dev.motocast.android");
    const args = { member_id: userId, attempt_id: ids[environment], token_hash: await proofHash("test-only-integrity-proof") };
    expect(runtime.rpc).toHaveBeenNthCalledWith(2, "take_play_admission_internal", args);
    expect(runtime.rpc).toHaveBeenNthCalledWith(3, "complete_play_admission_internal", args);
  });

  it.each([
    [undefined, urls.preview], [undefined, urls.production], ["", urls.production], ["staging", urls.production],
    ["Production", urls.production], ["production ", urls.production],
    ["preview", urls.production], ["production", urls.preview], ["production", undefined],
    ["production", "https://unknown.supabase.co"], ["production", `${urls.production}.foreign.test`],
    ["production", `${urls.production}/`], ["production", `${urls.production}/functions/v1/play-admission`],
    ["production", `${urls.production}?environment=production`], ["production", `${urls.production}#production`],
    ["production", "http://obodvbyzptxeehgpcpkd.supabase.co"],
    ["production", "https://obodvbyzptxeehgpcpkd.supabase.co:443"],
    ["production", "https://obodvbyzptxeehgpcpkd.supabase.co@foreign.test"],
    ["production", "https://foreign.test@obodvbyzptxeehgpcpkd.supabase.co"],
    ["preview", `${urls.preview}/`], ["preview", `${urls.preview}.foreign.test`],
  ])("denies configuration %# before authentication, storage or decoding", async (environment, url) => {
    const runtime = fixture("production");
    runtime.env.PLAY_ADMISSION_ENVIRONMENT = environment;
    runtime.env.SUPABASE_URL = url;
    for (const action of ["begin", "complete"] as const) {
      const response = await runtime.handle(request("production", action));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ code: "PLAY_NOT_CONFIGURED" });
    }
    expect(runtime.getUser).not.toHaveBeenCalled();
    expect(runtime.rpc).not.toHaveBeenCalled();
    expect(runtime.decoder).not.toHaveBeenCalled();
    expect(runtime.decode).not.toHaveBeenCalled();
  });

  it.each(["preview", "production"] as const)("ignores request URL and environment headers in the trusted %s runtime", async environment => {
    const runtime = fixture(environment);
    const foreign = environment === "preview" ? "production" : "preview";
    const response = await runtime.handle(request(environment, "complete", ids[environment],
      `${urls[foreign]}/functions/v1/play-admission?environment=${foreign}`, {
        host: `${foreign}.foreign.test`, "x-forwarded-host": new URL(urls[foreign]).host,
        "x-forwarded-proto": "http", "x-play-admission-environment": foreign,
        "play-admission-environment": foreign,
      }));
    expect(response.status).toBe(200);
    expect(runtime.decoder).toHaveBeenCalledExactlyOnceWith(`test-only-${environment}-service-account`, `test-${environment}-project`);
    expect(runtime.rpc).toHaveBeenLastCalledWith("complete_play_admission_internal", expect.objectContaining({ attempt_id: ids[environment] }));
  });

  it("cannot repair missing server configuration using a Production request or header", async () => {
    const runtime = fixture("production");
    delete runtime.env.PLAY_ADMISSION_ENVIRONMENT;
    const response = await runtime.handle(request("production", "begin", ids.production, undefined,
      { "x-play-admission-environment": "production", "play-admission-environment": "production" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "PLAY_NOT_CONFIGURED" });
    expect(runtime.getUser).not.toHaveBeenCalled();
    expect(runtime.rpc).not.toHaveBeenCalled();
    expect(runtime.decoder).not.toHaveBeenCalled();
  });

  it.each(["PLAY_ADMISSION_CERTIFICATES", "PLAY_ADMISSION_VERSIONS"])("does not fall back to another project's %s", async name => {
    const runtime = fixture("production");
    delete runtime.env[name];
    const response = await runtime.handle(request("production", "begin"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "PLAY_NOT_CONFIGURED" });
    expect(runtime.rpc).not.toHaveBeenCalled();
    expect(runtime.decoder).not.toHaveBeenCalled();
  });

  it("rejects a Preview-only version under Production's own allowlist", async () => {
    const runtime = fixture("production");
    const payload = verdict("production");
    payload.tokenPayloadExternal.appIntegrity.versionCode = versions.preview;
    runtime.decode.mockResolvedValue(payload);
    const response = await runtime.handle(request("production"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "PLAY_VERIFICATION_FAILED" });
    expect(runtime.rpc).toHaveBeenCalledTimes(1);
    expect(runtime.rpc).toHaveBeenCalledWith("take_play_admission_internal", expect.any(Object));
  });

  it.each(["preview", "production"] as const)("rejects a foreign challenge in the %s project before provider work", async environment => {
    const local = fixture(environment);
    const foreign = environment === "preview" ? "production" : "preview";
    const source = fixture(foreign);
    const issued = await source.handle(request(foreign, "begin"));
    const challenge = await issued.json();
    const response = await local.handle(request(environment, "complete", challenge.challengeId));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "PLAY_INVALID_CHALLENGE" });
    expect(local.rpc).toHaveBeenCalledTimes(1);
    expect(local.decoder).not.toHaveBeenCalled();
    expect(local.decode).not.toHaveBeenCalled();
  });

  it("never completes a foreign proof even when its challenge ID exists locally", async () => {
    const runtime = fixture("production");
    const payload = verdict("production");
    // Keep certificate/version valid to isolate the existing project-local random request hash binding.
    payload.tokenPayloadExternal.requestDetails.requestHash = hashes.preview;
    runtime.decode.mockResolvedValue(payload);
    const response = await runtime.handle(request("production"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "PLAY_VERIFICATION_FAILED" });
    expect(runtime.rpc).toHaveBeenCalledTimes(1);
    expect(runtime.rpc).toHaveBeenCalledWith("take_play_admission_internal", expect.any(Object));
  });

  it("retains web Origin denial before trusted authentication", async () => {
    const runtime = fixture("production");
    const response = await runtime.handle(request("production", "begin", ids.production, undefined, { origin: "https://motocast.test" }));
    expect(response.status).toBe(403);
    expect(runtime.getUser).not.toHaveBeenCalled();
    expect(runtime.rpc).not.toHaveBeenCalled();
    expect(runtime.decoder).not.toHaveBeenCalled();
  });

  it.each([null, { id: userId, identities: [{ provider: "google" }] }])("retains trusted Kakao identity denial %#", async user => {
    const runtime = fixture("production");
    runtime.getUser.mockResolvedValue({ data: { user }, error: null });
    const response = await runtime.handle(request("production", "begin"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "PLAY_AUTH_REQUIRED" });
    expect(runtime.rpc).not.toHaveBeenCalled();
    expect(runtime.decoder).not.toHaveBeenCalled();
  });

  it.each([["PLAY_MEMBERSHIP_REVOKED", 403], ["PLAY_RATE_LIMITED", 429]] as const)("preserves %s storage denial before provider work", async (code, status) => {
    const runtime = fixture("production");
    runtime.rpc.mockResolvedValue({ data: null, error: { message: code } });
    const response = await runtime.handle(request("production"));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code });
    expect(runtime.rpc).toHaveBeenCalledTimes(1);
    expect(runtime.decoder).not.toHaveBeenCalled();
  });
});
