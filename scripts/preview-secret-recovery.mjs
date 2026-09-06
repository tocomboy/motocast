#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPrivateKey, createPublicKey, timingSafeEqual, webcrypto } from "node:crypto";

export const PREVIEW_PROJECT = Object.freeze({
  ref: "lehjmbgfpoemqcwxowbx",
  name: "MOTOCAST_Preview",
  region: "ap-northeast-2",
  supabaseUrl: "https://lehjmbgfpoemqcwxowbx.supabase.co",
  functionName: "preview-secret-recovery-147b2d57",
});

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET_NAMES = ["KMA_APIHUB_KEY", "KMA_DAILY_LIMIT"];
const MAX_FILE_BYTES = 64 * 1024;
const MAX_MANAGEMENT_BYTES = 256 * 1024;
const MAX_RECOVERY_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_LIFETIME_MS = 6 * 60 * 60 * 1_000;
const CLOCK_MARGIN_MS = 60_000;
const RECOVERY_HANDLER_CODES = new Set([
  "RECOVERY_CONFIGURATION_INVALID",
  "RECOVERY_WINDOW_INACTIVE",
  "RECOVERY_WINDOW_EXPIRED",
  "RECOVERY_PROJECT_MISMATCH",
  "RECOVERY_ORIGIN_REJECTED",
  "RECOVERY_METHOD_NOT_ALLOWED",
  "RECOVERY_CONTENT_TYPE_INVALID",
  "RECOVERY_REQUEST_TOO_LARGE",
  "RECOVERY_REQUEST_INVALID",
  "RECOVERY_CHALLENGE_INVALID",
  "RECOVERY_AUTHORIZATION_INVALID",
  "RECOVERY_TARGET_MISSING",
  "RECOVERY_INTERNAL_FAILURE",
]);

export class RecoveryFailure extends Error {
  constructor(category, details = {}) {
    super(category);
    this.name = "RecoveryFailure";
    this.category = category;
    this.httpStatus = details.httpStatus;
    this.handlerCode = details.handlerCode;
  }
}

function reject(category) {
  throw new RecoveryFailure(category);
}

function exactKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

async function assertNoSymlinkComponents(absolutePath) {
  const parsed = path.parse(absolutePath);
  const components = absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const component of components) {
    current = path.join(current, component);
    let information;
    try {
      information = await lstat(current);
    } catch {
      reject("PRIVATE_PATH_INVALID");
    }
    if (information.isSymbolicLink()) reject("PRIVATE_PATH_INVALID");
  }
}

export async function validatePrivateDirectory(directory, options = {}) {
  if (process.platform !== "linux" || typeof process.getuid !== "function") {
    reject("PRIVATE_PLATFORM_UNSUPPORTED");
  }
  if (typeof directory !== "string" || directory.length === 0 || directory.includes("\0")) {
    reject("PRIVATE_PATH_INVALID");
  }
  if (!path.isAbsolute(directory) || path.normalize(directory) !== directory) reject("PRIVATE_PATH_INVALID");
  const absolutePath = path.resolve(directory);
  await assertNoSymlinkComponents(absolutePath);
  let canonicalPath;
  let information;
  try {
    canonicalPath = await realpath(absolutePath);
    information = await stat(canonicalPath);
  } catch {
    reject("PRIVATE_PATH_INVALID");
  }
  if (canonicalPath !== absolutePath || !information.isDirectory()) reject("PRIVATE_PATH_INVALID");
  if (information.uid !== process.getuid() || (information.mode & 0o777) !== 0o700) {
    reject("PRIVATE_DIRECTORY_PERMISSIONS_INVALID");
  }
  const workspaceRoot = path.resolve(options.workspaceRoot ?? REPOSITORY_ROOT);
  if (isInside(canonicalPath, workspaceRoot)) {
    reject("PRIVATE_PATH_INSIDE_REPOSITORY");
  }
  return canonicalPath;
}

export async function readPrivateFile(filename, options = {}) {
  const maximumBytes = options.maximumBytes ?? MAX_FILE_BYTES;
  let before;
  let handle;
  try {
    await assertNoSymlinkComponents(path.resolve(filename));
    before = await lstat(filename);
    if (!before.isFile() || before.isSymbolicLink()) reject("PRIVATE_FILE_INVALID");
    if (before.uid !== process.getuid() || (before.mode & 0o777) !== 0o600) {
      reject("PRIVATE_FILE_PERMISSIONS_INVALID");
    }
    handle = await open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.uid !== process.getuid() || (opened.mode & 0o777) !== 0o600) {
      reject("PRIVATE_FILE_INVALID");
    }
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size > maximumBytes) {
      reject("PRIVATE_FILE_INVALID");
    }
    return await handle.readFile("utf8");
  } catch (error) {
    if (error instanceof RecoveryFailure) throw error;
    reject("PRIVATE_FILE_INVALID");
  } finally {
    await handle?.close().catch(() => {});
  }
}

function validHexSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function validateRecoveryPin(value, now = Date.now()) {
  const keys = [
    "projectRef", "supabaseUrl", "functionName", "buildId", "notBefore", "expiresAt",
    "recipientSpki", "recipientFingerprint", "challengeSha256", "serviceRoleBinding",
  ];
  if (!value || typeof value !== "object" || Array.isArray(value) || !exactKeys(value, keys)) {
    reject("PIN_INVALID");
  }
  if (
    value.projectRef !== PREVIEW_PROJECT.ref ||
    value.supabaseUrl !== PREVIEW_PROJECT.supabaseUrl ||
    value.functionName !== PREVIEW_PROJECT.functionName ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.buildId) ||
    !Number.isSafeInteger(value.notBefore) ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= value.notBefore ||
    value.expiresAt - value.notBefore > MAX_LIFETIME_MS + CLOCK_MARGIN_MS ||
    typeof value.recipientSpki !== "string" ||
    !validHexSha256(value.recipientFingerprint) ||
    !validHexSha256(value.challengeSha256) ||
    !validHexSha256(value.serviceRoleBinding) ||
    !Number.isSafeInteger(now) ||
    now + CLOCK_MARGIN_MS < value.notBefore ||
    now >= value.expiresAt
  ) reject("PIN_INVALID");
  return value;
}

export function recoveryPinAad(pin) {
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

function decodeCanonicalBase64(value, category = "CIPHERTEXT_INVALID") {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    reject(category);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) reject(category);
  return bytes;
}

function decodePemPrivateKey(pem) {
  if (typeof pem !== "string") reject("PRIVATE_KEY_INVALID");
  const match = /^-----BEGIN PRIVATE KEY-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END PRIVATE KEY-----\r?\n?$/.exec(pem);
  if (!match) reject("PRIVATE_KEY_INVALID");
  return decodeCanonicalBase64(match[1].replace(/\r?\n/g, ""), "PRIVATE_KEY_INVALID");
}

export function validateChallenge(challenge, pin) {
  if (typeof challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) reject("CHALLENGE_INVALID");
  const padded = challenge.replace(/-/g, "+").replace(/_/g, "/") + "=";
  if (decodeCanonicalBase64(padded, "CHALLENGE_INVALID").length !== 32) reject("CHALLENGE_INVALID");
  return webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(challenge)).then((digest) => {
    if (Buffer.from(digest).toString("hex") !== pin.challengeSha256) reject("CHALLENGE_INVALID");
    return challenge;
  });
}

export async function validateServiceRoleBinding(pin, challenge, bearerJwt, cryptoImpl = webcrypto) {
  if (typeof bearerJwt !== "string" || bearerJwt.length === 0) reject("SERVICE_ROLE_BINDING_MISMATCH");
  const challengeBytes = decodeCanonicalBase64(
    challenge.replace(/-/g, "+").replace(/_/g, "/") + "=",
    "SERVICE_ROLE_BINDING_MISMATCH",
  );
  try {
    const key = await cryptoImpl.subtle.importKey(
      "raw",
      challengeBytes,
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
    const actual = Buffer.from(await cryptoImpl.subtle.sign("HMAC", key, message));
    const expected = Buffer.from(pin.serviceRoleBinding, "hex");
    if (expected.length !== 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      reject("SERVICE_ROLE_BINDING_MISMATCH");
    }
    return true;
  } catch (error) {
    if (error instanceof RecoveryFailure) throw error;
    reject("SERVICE_ROLE_BINDING_MISMATCH");
  }
}

export async function decryptRecoveryPayload(responseValue, pin, privateKeyPem, cryptoImpl = webcrypto) {
  if (!responseValue || typeof responseValue !== "object" || Array.isArray(responseValue) ||
      !exactKeys(responseValue, ["version", "iv", "wrappedKey", "ciphertext"]) || responseValue.version !== 1) {
    reject("CIPHERTEXT_INVALID");
  }
  const iv = decodeCanonicalBase64(responseValue.iv);
  const wrappedKey = decodeCanonicalBase64(responseValue.wrappedKey);
  const ciphertext = decodeCanonicalBase64(responseValue.ciphertext);
  if (iv.length !== 12 || ciphertext.length < 17) reject("CIPHERTEXT_INVALID");

  try {
    const privateKey = await cryptoImpl.subtle.importKey(
      "pkcs8",
      decodePemPrivateKey(privateKeyPem),
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["unwrapKey"],
    );
    const aesKey = await cryptoImpl.subtle.unwrapKey(
      "raw",
      wrappedKey,
      privateKey,
      { name: "RSA-OAEP" },
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const plaintextBytes = await cryptoImpl.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: recoveryPinAad(pin), tagLength: 128 },
      aesKey,
      ciphertext,
    );
    const plaintext = new TextDecoder("utf-8", { fatal: true }).decode(plaintextBytes);
    const parsed = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        !exactKeys(parsed, TARGET_NAMES) || TARGET_NAMES.some((name) => typeof parsed[name] !== "string") ||
        JSON.stringify(parsed) !== plaintext) reject("PLAINTEXT_INVALID");
    return parsed;
  } catch (error) {
    if (error instanceof RecoveryFailure) throw error;
    reject("DECRYPTION_FAILED");
  }
}

export function validateRelease(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !exactKeys(value, ["expectedFunction"])) {
    reject("RELEASE_PIN_MISSING_OR_INVALID");
  }
  const expected = value.expectedFunction;
  if (!expected || typeof expected !== "object" || Array.isArray(expected) ||
      !exactKeys(expected, ["id", "version"]) || typeof expected.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(expected.id) ||
      !Number.isSafeInteger(expected.version) || expected.version < 1) {
    reject("RELEASE_PIN_MISSING_OR_INVALID");
  }
  return value;
}

export function validateProject(value) {
  if (!value || typeof value !== "object" ||
      (value.id !== PREVIEW_PROJECT.ref && value.ref !== PREVIEW_PROJECT.ref) ||
      value.name !== PREVIEW_PROJECT.name || value.region !== PREVIEW_PROJECT.region) {
    reject("PROJECT_IDENTITY_MISMATCH");
  }
  return true;
}

export function validateFunctionRelease(value, release) {
  if (!value || typeof value !== "object" || value.id !== release.expectedFunction.id ||
      value.version !== release.expectedFunction.version || value.verify_jwt !== true ||
      (value.slug !== PREVIEW_PROJECT.functionName && value.name !== PREVIEW_PROJECT.functionName)) {
    reject("FUNCTION_RELEASE_MISMATCH");
  }
  return true;
}

export function selectSecretMetadata(value) {
  if (!Array.isArray(value)) reject("SECRET_METADATA_INVALID");
  return TARGET_NAMES.map((name) => {
    const matches = value.filter((entry) => entry && typeof entry === "object" && entry.name === name);
    if (matches.length !== 1 || !validHexSha256(matches[0].value)) reject("SECRET_METADATA_INVALID");
    return { name, updated_at: matches[0].updated_at ?? null, value: matches[0].value };
  });
}

export function selectLegacyServiceRole(value) {
  if (!Array.isArray(value)) reject("SERVICE_ROLE_UNAVAILABLE");
  const matches = value.filter((entry) => entry && typeof entry === "object" &&
    entry.name === "service_role" && (entry.type === undefined || entry.type === "legacy") &&
    typeof entry.api_key === "string" && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(entry.api_key));
  if (matches.length !== 1) reject("SERVICE_ROLE_UNAVAILABLE");
  return matches[0].api_key;
}

export async function validateRecipientKey(pin, privateKeyPem, cryptoImpl = webcrypto) {
  try {
    const spki = decodeCanonicalBase64(pin.recipientSpki, "RECIPIENT_KEY_INVALID");
    const fingerprint = await cryptoImpl.subtle.digest("SHA-256", spki);
    if (Buffer.from(fingerprint).toString("hex") !== pin.recipientFingerprint) {
      reject("RECIPIENT_KEY_INVALID");
    }
    await cryptoImpl.subtle.importKey(
      "pkcs8",
      decodePemPrivateKey(privateKeyPem),
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["unwrapKey"],
    );
    const privateKey = createPrivateKey(privateKeyPem);
    const publicKey = createPublicKey(privateKey);
    const details = publicKey.asymmetricKeyDetails;
    if (publicKey.asymmetricKeyType !== "rsa" || details?.modulusLength !== 3072 ||
        details?.publicExponent !== 65537n || !publicKey.export({ type: "spki", format: "der" }).equals(spki)) {
      reject("RECIPIENT_KEY_INVALID");
    }
    return true;
  } catch (error) {
    if (error instanceof RecoveryFailure) throw error;
    reject("RECIPIENT_KEY_INVALID");
  }
}

export async function validateRecoveredDigests(secrets, metadata, cryptoImpl = webcrypto) {
  for (const { name, value } of metadata) {
    const actual = await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(secrets[name]));
    if (Buffer.from(actual).toString("hex") !== value) reject("SECRET_DIGEST_MISMATCH");
  }
  return true;
}

export function validateMetadataUnchanged(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) reject("SECRET_METADATA_DRIFT");
  return true;
}

async function readBoundedJsonBody(response, maximumBytes, category) {
  if (!response?.body) reject(category);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      reject(category);
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks.map((value) => Buffer.from(value)), length);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    reject(category);
  }
}

async function requestJson(fetchImpl, url, init, maximumBytes, category) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    reject(category);
  }
  if (response.status < 200 || response.status >= 300) reject(category);
  return readBoundedJsonBody(response, maximumBytes, category);
}

async function requestRecoveryJson(fetchImpl, url, init) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    reject("RECOVERY_REQUEST_FAILED");
  }
  if (response.status >= 200 && response.status < 300) {
    return readBoundedJsonBody(response, MAX_RECOVERY_BYTES, "RECOVERY_REQUEST_FAILED");
  }

  let handlerCode = "UNKNOWN";
  try {
    const body = await readBoundedJsonBody(response, MAX_RECOVERY_BYTES, "RECOVERY_REQUEST_FAILED");
    if (body && typeof body === "object" && !Array.isArray(body) && exactKeys(body, ["error"]) &&
        RECOVERY_HANDLER_CODES.has(body.error)) handlerCode = body.error;
  } catch {
    // The diagnostic remains fixed and does not expose malformed or oversized response data.
  }
  throw new RecoveryFailure("RECOVERY_REQUEST_FAILED", {
    httpStatus: Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
      ? response.status
      : null,
    handlerCode,
  });
}

async function managementRead(fetchImpl, token, suffix) {
  const url = `https://api.supabase.com/v1/projects/${PREVIEW_PROJECT.ref}${suffix}`;
  return requestJson(fetchImpl, url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "user-agent": "motocast-bounded-fixture/1.0",
    },
  }, MAX_MANAGEMENT_BYTES, "MANAGEMENT_READ_FAILED");
}

export async function saveRecoveryFile(directory, secrets, fileOperations = {}) {
  const destination = path.join(directory, "recovery.json");
  const openOutput = fileOperations.openFile ?? open;
  const unlinkOutput = fileOperations.unlinkFile ?? unlink;
  let handle;
  let created = false;
  let complete = false;
  let failure;
  try {
    await assertNoSymlinkComponents(path.resolve(directory));
    const directoryInformation = await stat(directory);
    if (!directoryInformation.isDirectory() || directoryInformation.uid !== process.getuid() ||
        (directoryInformation.mode & 0o777) !== 0o700) reject("PRIVATE_DIRECTORY_PERMISSIONS_INVALID");
    handle = await openOutput(
      destination,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    created = true;
    const information = await handle.stat();
    if (!information.isFile() || information.uid !== process.getuid() || (information.mode & 0o777) !== 0o600) {
      reject("OUTPUT_FILE_INVALID");
    }
    await handle.writeFile(`${JSON.stringify(secrets)}\n`, "utf8");
    await handle.sync();
    complete = true;
  } catch (error) {
    failure = error instanceof RecoveryFailure
      ? error
      : new RecoveryFailure(error?.code === "EEXIST" ? "OUTPUT_ALREADY_EXISTS" : "OUTPUT_WRITE_FAILED");
  }

  let closeFailed = false;
  if (handle) {
    try {
      await handle.close();
    } catch {
      closeFailed = true;
    }
  }
  if (failure && created && !complete) {
    let unlinkFailed = false;
    try {
      await unlinkOutput(destination);
    } catch {
      unlinkFailed = true;
    }
    if (closeFailed || unlinkFailed) reject("OUTPUT_CLEANUP_FAILED");
  }
  if (closeFailed) reject("OUTPUT_CLOSE_FAILED");
  if (failure) throw failure;
  return destination;
}

export async function recoverPreviewSecrets(privateDirectory, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") reject("NETWORK_UNAVAILABLE");
  const directory = await validatePrivateDirectory(privateDirectory, dependencies);
  const [pinText, privateKeyPem, challengeText, releaseText] = await Promise.all([
    readPrivateFile(path.join(directory, "pin.json")),
    readPrivateFile(path.join(directory, "private-key.pem")),
    readPrivateFile(path.join(directory, "challenge.txt")),
    readPrivateFile(path.join(directory, "release.json")),
  ]);
  let pin;
  let release;
  try {
    pin = validateRecoveryPin(JSON.parse(pinText), (dependencies.now ?? Date.now)());
    release = validateRelease(JSON.parse(releaseText));
  } catch (error) {
    if (error instanceof RecoveryFailure) throw error;
    reject("PRIVATE_INPUT_INVALID");
  }
  const challenge = await validateChallenge(challengeText, pin);
  await validateRecipientKey(pin, privateKeyPem);

  const tokenPath = path.join(dependencies.homeDirectory ?? homedir(), ".supabase", "access-token");
  const managementToken = (await readPrivateFile(tokenPath, { maximumBytes: 16 * 1024 })).trim();
  if (managementToken.length === 0 || /\s/.test(managementToken)) reject("MANAGEMENT_TOKEN_INVALID");

  const [projectBefore, functionBefore, secretsBeforeRaw, apiKeys] = await Promise.all([
    managementRead(fetchImpl, managementToken, ""),
    managementRead(fetchImpl, managementToken, `/functions/${PREVIEW_PROJECT.functionName}`),
    managementRead(fetchImpl, managementToken, "/secrets"),
    managementRead(fetchImpl, managementToken, "/api-keys"),
  ]);
  validateProject(projectBefore);
  validateFunctionRelease(functionBefore, release);
  const secretsBefore = selectSecretMetadata(secretsBeforeRaw);
  const serviceRole = selectLegacyServiceRole(apiKeys);

  await validateServiceRoleBinding(pin, challenge, serviceRole);
  const encrypted = await requestRecoveryJson(fetchImpl,
    `${PREVIEW_PROJECT.supabaseUrl}/functions/v1/${PREVIEW_PROJECT.functionName}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceRole}`,
        apikey: serviceRole,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ challenge }),
    },
  );
  const recovered = await decryptRecoveryPayload(encrypted, pin, privateKeyPem);
  await validateRecoveredDigests(recovered, secretsBefore);

  const [projectAfter, functionAfter, secretsAfterRaw] = await Promise.all([
    managementRead(fetchImpl, managementToken, ""),
    managementRead(fetchImpl, managementToken, `/functions/${PREVIEW_PROJECT.functionName}`),
    managementRead(fetchImpl, managementToken, "/secrets"),
  ]);
  validateProject(projectAfter);
  validateFunctionRelease(functionAfter, release);
  validateMetadataUnchanged(secretsBefore, selectSecretMetadata(secretsAfterRaw));
  await saveRecoveryFile(directory, recovered);

  return Object.freeze({
    ok: true,
    projectBound: true,
    functionReleaseBound: true,
    jwtVerified: true,
    metadataStable: true,
    ciphertextAuthenticated: true,
    digestsMatched: true,
    fileSaved: true,
  });
}

async function main(argv) {
  if (argv.length !== 2 || argv[0] !== "recover") reject("USAGE_INVALID");
  return recoverPreviewSecrets(argv[1]);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(
    (receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`),
    (error) => {
      const category = error instanceof RecoveryFailure ? error.category : "INTERNAL_FAILURE";
      const receipt = { ok: false, category };
      if (error instanceof RecoveryFailure && category === "RECOVERY_REQUEST_FAILED") {
        receipt.httpStatus = Number.isInteger(error.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599
          ? error.httpStatus
          : null;
        receipt.handlerCode = RECOVERY_HANDLER_CODES.has(error.handlerCode) ? error.handlerCode : "UNKNOWN";
      }
      process.stderr.write(`${JSON.stringify(receipt)}\n`);
      process.exitCode = 1;
    },
  );
}
