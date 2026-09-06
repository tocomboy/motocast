import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PREVIEW_PROJECT,
  RecoveryFailure,
  decryptRecoveryPayload,
  recoverPreviewSecrets,
  recoveryPinAad,
  saveRecoveryFile,
  selectLegacyServiceRole,
  selectSecretMetadata,
  validateFunctionRelease,
  validateMetadataUnchanged,
  validatePrivateDirectory,
  validateProject,
  validateRelease,
  validateRecoveredDigests,
  readPrivateFile,
} from "./preview-secret-recovery.mjs";

const encoder = new TextEncoder();
const now = 2_000_000_000_000;
const secretValues = {
  KMA_APIHUB_KEY: "  합성 키\n두 번째 줄  ",
  KMA_DAILY_LIMIT: " 0020\t",
};

async function temporaryDirectory(prefix = "motocast-recovery-test-") {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  await chmod(directory, 0o700);
  return directory;
}

async function sha256Hex(value) {
  return Buffer.from(await webcrypto.subtle.digest("SHA-256", encoder.encode(value))).toString("hex");
}

function privateKeyPem(der) {
  const encoded = Buffer.from(der).toString("base64").match(/.{1,64}/g).join("\n");
  return `-----BEGIN PRIVATE KEY-----\n${encoded}\n-----END PRIVATE KEY-----\n`;
}

async function syntheticFixture() {
  const keyPair = await webcrypto.subtle.generateKey({
    name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256",
  }, true, ["wrapKey", "unwrapKey"]);
  const wrongKeyPair = await webcrypto.subtle.generateKey({
    name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256",
  }, true, ["wrapKey", "unwrapKey"]);
  const challenge = Buffer.alloc(32, 13).toString("base64url");
  const spki = Buffer.from(await webcrypto.subtle.exportKey("spki", keyPair.publicKey));
  const pin = {
    projectRef: PREVIEW_PROJECT.ref,
    supabaseUrl: PREVIEW_PROJECT.supabaseUrl,
    functionName: PREVIEW_PROJECT.functionName,
    buildId: "11111111-1111-4111-8111-111111111111",
    notBefore: now - 1_000,
    expiresAt: now + 60_000,
    recipientSpki: spki.toString("base64"),
    recipientFingerprint: Buffer.from(await webcrypto.subtle.digest("SHA-256", spki)).toString("hex"),
    challengeSha256: await sha256Hex(challenge),
  };
  const aesKey = await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const wrappedKey = await webcrypto.subtle.wrapKey("raw", aesKey, keyPair.publicKey, { name: "RSA-OAEP" });
  const ciphertext = await webcrypto.subtle.encrypt({
    name: "AES-GCM", iv, additionalData: recoveryPinAad(pin), tagLength: 128,
  }, aesKey, encoder.encode(JSON.stringify(secretValues)));
  return {
    keyPair,
    wrongKeyPair,
    challenge,
    pin,
    pem: privateKeyPem(await webcrypto.subtle.exportKey("pkcs8", keyPair.privateKey)),
    wrongPem: privateKeyPem(await webcrypto.subtle.exportKey("pkcs8", wrongKeyPair.privateKey)),
    encrypted: {
      version: 1,
      iv: Buffer.from(iv).toString("base64"),
      wrappedKey: Buffer.from(wrappedKey).toString("base64"),
      ciphertext: Buffer.from(ciphertext).toString("base64"),
    },
  };
}

async function assertCategory(promise, category) {
  await assert.rejects(promise, (error) => error instanceof RecoveryFailure && error.category === category);
}

test("private directory validation enforces Linux owner mode and rejects symlink components", async () => {
  const directory = await temporaryDirectory();
  assert.equal(await validatePrivateDirectory(directory), directory);
  await chmod(directory, 0o755);
  await assertCategory(validatePrivateDirectory(directory), "PRIVATE_DIRECTORY_PERMISSIONS_INVALID");
  await chmod(directory, 0o700);

  const parent = await temporaryDirectory();
  const link = path.join(parent, "linked");
  await symlink(directory, link);
  await assertCategory(validatePrivateDirectory(link), "PRIVATE_PATH_INVALID");

  const sourceFile = path.join(directory, "source.txt");
  const linkedFile = path.join(directory, "linked.txt");
  await writeFile(sourceFile, "synthetic", { mode: 0o600 });
  await symlink(sourceFile, linkedFile);
  await assertCategory(readPrivateFile(linkedFile), "PRIVATE_PATH_INVALID");
});

test("recovery output is owner-only, exclusive, and preserves exact strings", async () => {
  const directory = await temporaryDirectory();
  const destination = await saveRecoveryFile(directory, secretValues);
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(destination, "utf8")), secretValues);
  await assertCategory(saveRecoveryFile(directory, secretValues), "OUTPUT_ALREADY_EXISTS");
});

test("incomplete output reports a fixed cleanup failure when close or unlink cannot complete", async () => {
  const directory = await temporaryDirectory();
  const syntheticHandle = {
    stat: async () => ({ isFile: () => true, uid: process.getuid(), mode: 0o100600 }),
    writeFile: async () => { throw new Error("synthetic private write detail"); },
    sync: async () => {},
    close: async () => { throw new Error("synthetic private close detail"); },
  };
  await assertCategory(saveRecoveryFile(directory, secretValues, {
    openFile: async () => syntheticHandle,
    unlinkFile: async () => { throw new Error("synthetic private unlink detail"); },
  }), "OUTPUT_CLEANUP_FAILED");
});

test("decrypt authenticates ciphertext, private key, and ordered pin metadata", async () => {
  const fixture = await syntheticFixture();
  assert.deepEqual(await decryptRecoveryPayload(fixture.encrypted, fixture.pin, fixture.pem), secretValues);

  const tampered = {
    ...fixture.encrypted,
    ciphertext: Buffer.from(fixture.encrypted.ciphertext, "base64").map((byte, index) =>
      index === 0 ? byte ^ 1 : byte).toString("base64"),
  };
  await assertCategory(decryptRecoveryPayload(tampered, fixture.pin, fixture.pem), "DECRYPTION_FAILED");
  await assertCategory(decryptRecoveryPayload(fixture.encrypted, fixture.pin, fixture.wrongPem), "DECRYPTION_FAILED");
  await assertCategory(decryptRecoveryPayload(
    fixture.encrypted,
    { ...fixture.pin, buildId: "22222222-2222-4222-8222-222222222222" },
    fixture.pem,
  ), "DECRYPTION_FAILED");
});

test("raw UTF-8 digest and metadata drift checks fail closed", async () => {
  const metadata = [
    { name: "KMA_APIHUB_KEY", updated_at: "fixed", value: await sha256Hex(secretValues.KMA_APIHUB_KEY) },
    { name: "KMA_DAILY_LIMIT", updated_at: "fixed", value: await sha256Hex(secretValues.KMA_DAILY_LIMIT) },
  ];
  assert.equal(await validateRecoveredDigests(secretValues, metadata), true);
  await assertCategory(
    validateRecoveredDigests({ ...secretValues, KMA_DAILY_LIMIT: secretValues.KMA_DAILY_LIMIT.trim() }, metadata),
    "SECRET_DIGEST_MISMATCH",
  );
  assert.equal(validateMetadataUnchanged(metadata, structuredClone(metadata)), true);
  assert.throws(
    () => validateMetadataUnchanged(metadata, [{ ...metadata[0], updated_at: "changed" }, metadata[1]]),
    (error) => error instanceof RecoveryFailure && error.category === "SECRET_METADATA_DRIFT",
  );
});

test("release, project, function, secret metadata, and legacy key gates reject drift", () => {
  const release = validateRelease({
    expectedFunction: { id: "33333333-3333-4333-8333-333333333333", version: 7 },
  });
  assert.equal(validateProject({
    id: PREVIEW_PROJECT.ref, name: PREVIEW_PROJECT.name, region: PREVIEW_PROJECT.region,
  }), true);
  assert.equal(validateFunctionRelease({
    id: release.expectedFunction.id,
    version: release.expectedFunction.version,
    verify_jwt: true,
    slug: PREVIEW_PROJECT.functionName,
  }, release), true);
  assert.deepEqual(selectSecretMetadata([
    { name: "KMA_APIHUB_KEY", updated_at: "2026-09-06T00:00:00Z", value: "a".repeat(64) },
    { name: "KMA_DAILY_LIMIT", updated_at: "2026-09-06T00:00:01Z", value: "b".repeat(64) },
  ]).map(({ name }) => name), ["KMA_APIHUB_KEY", "KMA_DAILY_LIMIT"]);
  assert.equal(selectLegacyServiceRole([
    { name: "service_role", api_key: "synthetic.header.signature" },
  ]), "synthetic.header.signature");

  assert.throws(
    () => validateFunctionRelease({
      id: release.expectedFunction.id, version: 8, verify_jwt: true, slug: PREVIEW_PROJECT.functionName,
    }, release),
    (error) => error instanceof RecoveryFailure && error.category === "FUNCTION_RELEASE_MISMATCH",
  );
  assert.throws(
    () => validateProject({ id: PREVIEW_PROJECT.ref, name: PREVIEW_PROJECT.name, region: "foreign" }),
    (error) => error instanceof RecoveryFailure && error.category === "PROJECT_IDENTITY_MISMATCH",
  );
  assert.throws(
    () => selectSecretMetadata([{ name: "KMA_APIHUB_KEY", updated_at: "fixed", value: "a".repeat(64) }]),
    (error) => error instanceof RecoveryFailure && error.category === "SECRET_METADATA_INVALID",
  );
  assert.throws(
    () => selectSecretMetadata([
      { name: "KMA_APIHUB_KEY", updated_at: "fixed", digest: "a".repeat(64) },
      { name: "KMA_DAILY_LIMIT", updated_at: "fixed", digest: "b".repeat(64) },
    ]),
    (error) => error instanceof RecoveryFailure && error.category === "SECRET_METADATA_INVALID",
  );
});

test("full client flow uses only pinned reads and one recovery POST before exclusive save", async () => {
  const fixture = await syntheticFixture();
  const directory = await temporaryDirectory();
  const home = await temporaryDirectory("motocast-recovery-home-");
  const tokenDirectory = path.join(home, ".supabase");
  await mkdir(tokenDirectory, { mode: 0o700 });
  const release = { expectedFunction: { id: "33333333-3333-4333-8333-333333333333", version: 7 } };
  const privateFiles = {
    "pin.json": JSON.stringify(fixture.pin),
    "private-key.pem": fixture.pem,
    "challenge.txt": fixture.challenge,
    "release.json": JSON.stringify(release),
  };
  await Promise.all(Object.entries(privateFiles).map(async ([name, contents]) => {
    const filename = path.join(directory, name);
    await writeFile(filename, contents, { mode: 0o600 });
    await chmod(filename, 0o600);
  }));
  const tokenFile = path.join(tokenDirectory, "access-token");
  await writeFile(tokenFile, "synthetic-management-token\n", { mode: 0o600 });
  await chmod(tokenFile, 0o600);

  const metadata = [
    { name: "KMA_APIHUB_KEY", updated_at: "fixed-a", value: await sha256Hex(secretValues.KMA_APIHUB_KEY) },
    { name: "KMA_DAILY_LIMIT", updated_at: "fixed-b", value: await sha256Hex(secretValues.KMA_DAILY_LIMIT) },
    { name: "UNRELATED", updated_at: "fixed-c", value: "0".repeat(64) },
  ];
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const value = String(url).includes("/functions/v1/")
      ? fixture.encrypted
      : String(url).endsWith(`/functions/${PREVIEW_PROJECT.functionName}`)
        ? { id: release.expectedFunction.id, version: 7, verify_jwt: true, slug: PREVIEW_PROJECT.functionName }
        : String(url).endsWith("/secrets")
          ? metadata
          : String(url).endsWith("/api-keys")
            ? [{ name: "service_role", api_key: "synthetic.header.signature" }]
            : { id: PREVIEW_PROJECT.ref, name: PREVIEW_PROJECT.name, region: PREVIEW_PROJECT.region };
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  };

  const receipt = await recoverPreviewSecrets(directory, {
    fetchImpl, homeDirectory: home, now: () => now,
  });
  assert.deepEqual(receipt, {
    ok: true,
    projectBound: true,
    functionReleaseBound: true,
    jwtVerified: true,
    metadataStable: true,
    ciphertextAuthenticated: true,
    digestsMatched: true,
    fileSaved: true,
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, "recovery.json"), "utf8")), secretValues);
  assert.equal(calls.filter(({ init }) => init.method === "POST").length, 1);
  assert.equal(calls.every(({ init }) => init.redirect === "manual"), true);
  assert.equal(calls.length, 8);
  const post = calls.find(({ init }) => init.method === "POST");
  assert.equal(post.url, `${PREVIEW_PROJECT.supabaseUrl}/functions/v1/${PREVIEW_PROJECT.functionName}`);
  assert.deepEqual(JSON.parse(post.init.body), { challenge: fixture.challenge });
  assert.equal(post.init.headers.authorization, "Bearer synthetic.header.signature");
  assert.equal(post.init.headers.apikey, "synthetic.header.signature");
  assert.equal(calls.filter(({ init }) => init.method === "GET").every(
    ({ init }) => init.headers["user-agent"] === "motocast-bounded-fixture/1.0",
  ), true);
});
