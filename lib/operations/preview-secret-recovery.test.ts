import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";

import {
  createRecoveryHandler,
  recoveryPinAad,
  type RecoveryPin,
} from "../../supabase/functions/preview-secret-recovery/handler";

const crypto = webcrypto as unknown as Crypto;
const now = 2_000_000_000_000;
const projectRef = "abcdefghijklmnopqrst";
const supabaseUrl = `https://${projectRef}.supabase.co`;
const functionName = "preview-secret-recovery-f3b3f3d5";
const challenge = Buffer.alloc(32, 7).toString("base64url");
const serviceRole = "synthetic-service-role.jwt.value";
const values = {
  KMA_APIHUB_KEY: "  합성-API-키\n두 번째 줄  ",
  KMA_DAILY_LIMIT: " 0020 \t",
};

let keyPair: CryptoKeyPair;
let wrongKeyPair: CryptoKeyPair;
let pin: RecoveryPin;

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer)).toString("hex");
}

function request(overrides: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  duplex?: "half";
} = {}): Request {
  return new Request(overrides.url ?? `${supabaseUrl}/functions/v1/${functionName}`, {
    method: overrides.method ?? "POST",
    headers: overrides.headers ?? {
      authorization: `Bearer ${serviceRole}`,
      "content-type": "application/json",
    },
    body: overrides.method === "GET" ? undefined : overrides.body ?? JSON.stringify({ challenge }),
    ...(overrides.duplex ? { duplex: overrides.duplex } : {}),
  } as RequestInit);
}

function runtime(environmentOverrides: Record<string, string | undefined> = {}) {
  const environment: Record<string, string | undefined> = {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRole,
    ...values,
    ...environmentOverrides,
  };
  const getEnv = vi.fn((name: string) => environment[name]);
  return { getEnv, now: () => now, crypto };
}

async function decrypt(
  payload: { iv: string; wrappedKey: string; ciphertext: string },
  privateKey: CryptoKey,
  targetPin = pin,
) {
  const key = await crypto.subtle.unwrapKey(
    "raw",
    Buffer.from(payload.wrappedKey, "base64"),
    privateKey,
    { name: "RSA-OAEP" },
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: Buffer.from(payload.iv, "base64"),
    additionalData: recoveryPinAad(targetPin).buffer as ArrayBuffer,
    tagLength: 128,
  }, key, Buffer.from(payload.ciphertext, "base64"));
  return new TextDecoder().decode(plaintext);
}

beforeAll(async () => {
  keyPair = await crypto.subtle.generateKey({
    name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256",
  }, true, ["wrapKey", "unwrapKey"]);
  wrongKeyPair = await crypto.subtle.generateKey({
    name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256",
  }, true, ["wrapKey", "unwrapKey"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
  pin = {
    projectRef,
    supabaseUrl,
    functionName,
    buildId: "11111111-1111-4111-8111-111111111111",
    notBefore: now - 1_000,
    expiresAt: now + 60_000,
    recipientSpki: Buffer.from(spki).toString("base64"),
    recipientFingerprint: await sha256Hex(spki),
    challengeSha256: await sha256Hex(challenge),
  };
});

afterAll(() => vi.unstubAllGlobals());

describe("Preview secret recovery handler", () => {
  it("exports exactly two strings and preserves Unicode and whitespace through authenticated encryption", async () => {
    const testRuntime = runtime();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await createRecoveryHandler(pin, testRuntime)(request());
    const payload = await response.json() as { version: number; iv: string; wrappedKey: string; ciphertext: string };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(Object.keys(payload)).toEqual(["version", "iv", "wrappedKey", "ciphertext"]);
    expect(payload.version).toBe(1);
    expect(Buffer.from(payload.iv, "base64")).toHaveLength(12);
    expect(JSON.parse(await decrypt(payload, keyPair.privateKey))).toEqual(values);
    expect(testRuntime.getEnv.mock.calls.map(([name]) => name)).toEqual([
      "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "KMA_APIHUB_KEY", "KMA_DAILY_LIMIT",
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toContain(serviceRole);
    expect(JSON.stringify(payload)).not.toContain(challenge);
    expect(JSON.stringify(payload)).not.toContain(values.KMA_APIHUB_KEY);
    expect(JSON.stringify(payload)).not.toContain(values.KMA_DAILY_LIMIT);
  });

  it.each([
    ["missing", undefined],
    ["anonymous", "Bearer synthetic-anon.jwt.value"],
    ["foreign user", "Bearer synthetic-user.jwt.value"],
    ["wrong scheme", `Basic ${serviceRole}`],
    ["extra bearer bytes", `Bearer ${serviceRole}x`],
  ])("rejects %s authorization before reading target values", async (_label, authorization) => {
    const testRuntime = runtime();
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (authorization) headers.authorization = authorization;
    const response = await createRecoveryHandler(pin, testRuntime)(request({ headers }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "RECOVERY_AUTHORIZATION_INVALID" });
    expect(testRuntime.getEnv.mock.calls.map(([name]) => name)).toEqual([
      "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    ]);
  });

  it.each([
    ["foreign project URL", { url: `https://zzzzzzzzzzzzzzzzzzzz.supabase.co/functions/v1/${functionName}` }, 403],
    ["foreign runtime function", { url: `http://${projectRef}.supabase.co/${functionName}-foreign` }, 403],
    ["missing runtime function", { url: `http://${projectRef}.supabase.co/` }, 403],
    ["additional runtime path", { url: `http://${projectRef}.supabase.co/${functionName}/extra` }, 403],
    ["query string", { url: `${supabaseUrl}/functions/v1/${functionName}?recipient=foreign` }, 403],
    ["Origin", { headers: { authorization: `Bearer ${serviceRole}`, "content-type": "application/json", origin: supabaseUrl } }, 403],
    ["null Origin", { headers: { authorization: `Bearer ${serviceRole}`, "content-type": "application/json", origin: "null" } }, 403],
    ["wrong method", { method: "GET" }, 405],
    ["wrong content type", { headers: { authorization: `Bearer ${serviceRole}`, "content-type": "text/plain" } }, 415],
    ["unknown field", { body: JSON.stringify({ challenge, recipient: "override" }) }, 400],
    ["oversized streamed body", { body: "x".repeat(513) }, 413],
  ])("rejects %s without reading secrets", async (_label, override, status) => {
    const testRuntime = runtime();
    const response = await createRecoveryHandler(pin, testRuntime)(request(override));
    expect(response.status).toBe(status);
    expect(testRuntime.getEnv).not.toHaveBeenCalled();
  });

  it("rejects a challenge whose exact UTF-8 digest is not pinned", async () => {
    const testRuntime = runtime();
    const otherChallenge = Buffer.alloc(32, 8).toString("base64url");
    const response = await createRecoveryHandler(pin, testRuntime)(request({
      body: JSON.stringify({ challenge: otherChallenge }),
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "RECOVERY_CHALLENGE_INVALID" });
    expect(testRuntime.getEnv).not.toHaveBeenCalled();
  });

  it("accepts the observed internal HTTP ingress only on the pinned host and full gateway path", async () => {
    const response = await createRecoveryHandler(pin, runtime())(request({
      url: `http://${pin.projectRef}.supabase.co/functions/v1/${functionName}`,
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).version).toBe(1);
  });

  it("routes the documented runtime path to service-role encryption and anonymous authentication", async () => {
    const runtimeUrl = `http://${pin.projectRef}.supabase.co/${functionName}`;
    const serviceResponse = await createRecoveryHandler(pin, runtime())(request({ url: runtimeUrl }));
    const payload = await serviceResponse.json() as {
      version: number;
      iv: string;
      wrappedKey: string;
      ciphertext: string;
    };
    expect(serviceResponse.status).toBe(200);
    expect(Object.keys(payload)).toEqual(["version", "iv", "wrappedKey", "ciphertext"]);
    expect(JSON.parse(await decrypt(payload, keyPair.privateKey))).toEqual(values);

    const anonymousRuntime = runtime();
    const anonymousResponse = await createRecoveryHandler(pin, anonymousRuntime)(request({
      url: runtimeUrl,
      headers: { "content-type": "application/json" },
    }));
    expect(anonymousResponse.status).toBe(401);
    expect(await anonymousResponse.json()).toEqual({ error: "RECOVERY_AUTHORIZATION_INVALID" });
    expect(anonymousRuntime.getEnv.mock.calls.map(([name]) => name)).toEqual([
      "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    ]);
  });

  it.each([
    ["before the clock margin", { now: () => pin.notBefore - 60_001 }, "RECOVERY_WINDOW_INACTIVE"],
    ["at expiry", { now: () => pin.expiresAt }, "RECOVERY_WINDOW_EXPIRED"],
  ])("rejects %s", async (_label, clock, code) => {
    const response = await createRecoveryHandler(pin, { ...runtime(), ...clock })(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: code });
  });

  it("rechecks expiry after a delayed request body before reading either target", async () => {
    let currentTime = now;
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    const testRuntime = { ...runtime(), now: () => currentTime };
    const responsePromise = createRecoveryHandler(pin, testRuntime)(request({
      body: stream.readable,
      duplex: "half",
    }));

    await Promise.resolve();
    currentTime = pin.expiresAt;
    await writer.write(new TextEncoder().encode(JSON.stringify({ challenge })));
    await writer.close();

    const response = await responsePromise;
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "RECOVERY_WINDOW_EXPIRED" });
    expect(testRuntime.getEnv.mock.calls.map(([name]) => name)).toEqual([
      "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    ]);
  });

  it("rechecks expiry after encryption and returns no ciphertext", async () => {
    let currentTime = now;
    const subtle = new Proxy(crypto.subtle, {
      get(target, property) {
        if (property === "encrypt") {
          return async (...args: Parameters<SubtleCrypto["encrypt"]>) => {
            const ciphertext = await target.encrypt(...args);
            currentTime = pin.expiresAt;
            return ciphertext;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const delayedCrypto = {
      subtle,
      getRandomValues: crypto.getRandomValues.bind(crypto),
      randomUUID: crypto.randomUUID.bind(crypto),
    } as Crypto;
    const testRuntime = { ...runtime(), now: () => currentTime, crypto: delayedCrypto };

    const response = await createRecoveryHandler(pin, testRuntime)(request());
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "RECOVERY_WINDOW_EXPIRED" });
    expect(body).not.toHaveProperty("ciphertext");
    expect(testRuntime.getEnv.mock.calls.map(([name]) => name)).toEqual([
      "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "KMA_APIHUB_KEY", "KMA_DAILY_LIMIT",
    ]);
  });

  it("rejects an overlong configured window and noncanonical request JSON", async () => {
    const overlongPin = { ...pin, expiresAt: pin.notBefore + 6 * 60 * 60 * 1_000 + 60_001 };
    const invalidPinResponse = await createRecoveryHandler(overlongPin, runtime())(request());
    expect(invalidPinResponse.status).toBe(500);
    expect(await invalidPinResponse.json()).toEqual({ error: "RECOVERY_CONFIGURATION_INVALID" });

    const bodyResponse = await createRecoveryHandler(pin, runtime())(request({
      body: ` {"challenge":"${challenge}"}`,
    }));
    expect(bodyResponse.status).toBe(400);
    expect(await bodyResponse.json()).toEqual({ error: "RECOVERY_REQUEST_INVALID" });
  });

  it("rejects configured project drift and missing target values with fixed failures", async () => {
    const projectRuntime = runtime({ SUPABASE_URL: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co" });
    const projectResponse = await createRecoveryHandler(pin, projectRuntime)(request());
    expect(projectResponse.status).toBe(500);
    expect(await projectResponse.json()).toEqual({ error: "RECOVERY_CONFIGURATION_INVALID" });

    const missingRuntime = runtime({ KMA_APIHUB_KEY: undefined });
    const missingResponse = await createRecoveryHandler(pin, missingRuntime)(request());
    expect(missingResponse.status).toBe(500);
    expect(await missingResponse.json()).toEqual({ error: "RECOVERY_TARGET_MISSING" });
  });

  it("rejects recipient fingerprint drift and keeps exception details out of output and logs", async () => {
    const logSpies = ["log", "error", "warn", "info"].map((method) =>
      vi.spyOn(console, method as "log").mockImplementation(() => {}));
    const badPin = { ...pin, recipientFingerprint: "0".repeat(64) };
    const response = await createRecoveryHandler(badPin, runtime())(request());
    const body = await response.text();
    expect(response.status).toBe(500);
    expect(body).toBe('{"error":"RECOVERY_CONFIGURATION_INVALID"}');
    expect(body).not.toContain(values.KMA_APIHUB_KEY);
    expect(logSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    logSpies.forEach((spy) => spy.mockRestore());
  });

  it("authenticates pin metadata and rejects ciphertext tampering or another private key", async () => {
    const response = await createRecoveryHandler(pin, runtime())(request());
    const payload = await response.json() as { iv: string; wrappedKey: string; ciphertext: string };
    const tamperedBytes = Buffer.from(payload.ciphertext, "base64");
    tamperedBytes[0] ^= 1;
    const tampered = { ...payload, ciphertext: tamperedBytes.toString("base64") };
    await expect(decrypt(tampered, keyPair.privateKey)).rejects.toThrow();
    await expect(decrypt(payload, wrongKeyPair.privateKey)).rejects.toThrow();
    await expect(decrypt(payload, keyPair.privateKey, { ...pin, buildId: "22222222-2222-4222-8222-222222222222" }))
      .rejects.toThrow();
  });
});
