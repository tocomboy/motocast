import { consumeBudget, requireMember } from "../_shared/auth.ts";
import {
  type ForecastModel,
  forecastTarget,
  issuedAtIso,
  latestForecastBase,
  validatedForecastValues,
} from "../_shared/weather-forecast.ts";
import {
  safeKmaBindingDiagnostic,
  summarizeKmaBinding,
} from "../_shared/kma-binding-diagnostic.ts";
import {
  kmaResponseDiagnostic,
  safeWeatherDiagnosticCode,
} from "../_shared/weather-failure.ts";
import {
  type KmaResponseIdentity,
  parseKmaItems,
} from "../_shared/kma-response.ts";

const TAG = "KMA_BINDING_PROBE_V1" as const;
const EXPECTED_SUPABASE_URL = "https://lehjmbgfpoemqcwxowbx.supabase.co";
const MAX_PROVIDER_CALLS = 2;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SCANNED_ITEMS = 1000;
const PROVIDER_TIMEOUT_MS = 8_000;

type ProbeConfig = {
  memberHash: string;
  capabilityHash: string;
  expiresAt: string;
  grid: { nx: number; ny: number };
};

const PROBE_CONFIG: ProbeConfig = {
  memberHash:
    "a6ba3a6a5c1324ea22748f610127cab2ba8fef08ac8f1a1dabcb0db5edca0a13",
  capabilityHash:
    "9559b1e71b072b52e1f4cdda1c606f9183a63aab22c5cf207a2634fc39cb1649",
  expiresAt: "2026-09-05T12:59:00.382Z",
  grid: { nx: 60, ny: 127 },
};

type ReturnedIssuance =
  | { date: string; time: string; deltaMinutes: number }
  | { identity: "INVALID" };

type ParserResult =
  | { status: "PASS" }
  | { status: "FAIL"; code: string; reason: string };

type ProbeResult = {
  model: ForecastModel;
  requested: { date: string; time: string };
  returnedIssuances: ReturnedIssuance[];
  binding: string;
  parser: ParserResult;
};

type StopReason =
  | "METHOD_NOT_ALLOWED"
  | "QUERY_NOT_ALLOWED"
  | "BODY_NOT_ALLOWED"
  | "ORIGIN_NOT_ALLOWED"
  | "PROJECT_MISMATCH"
  | "PROBE_CONFIGURATION_INVALID"
  | "PROBE_EXPIRED"
  | "AUTH_REQUIRED"
  | "MEMBERSHIP_REQUIRED"
  | "AUTH_FAILED"
  | "MEMBER_MISMATCH"
  | "CAPABILITY_REQUIRED"
  | "CAPABILITY_INVALID"
  | "PROVIDER_NOT_CONFIGURED"
  | "API_BUDGET_NOT_CONFIGURED"
  | "BUDGET_FAILED"
  | "DEADLINE_EXCEEDED_AFTER_RESERVATION"
  | "NETWORK_FAILED"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_JSON"
  | "ITEM_SCAN_LIMIT"
  | "PROVIDER_FAILED";

type ProbeOutput = {
  tag: typeof TAG;
  run: "COMPLETE" | "STOPPED";
  providerCalls: number;
  budgetReservationFailures: number;
  results: ProbeResult[];
  stopReason?: StopReason;
};

type ProbeDependencies = {
  authenticate: typeof requireMember;
  reserveBudget: typeof consumeBudget;
  providerFetch: typeof fetch;
  env: (name: string) => string | undefined;
  now: () => number;
  timeoutSignal: () => AbortSignal;
  config: ProbeConfig;
};

class ProbeStop extends Error {
  constructor(readonly reason: StopReason) {
    super(reason);
  }
}

function jsonResponse(output: ProbeOutput, status = 200): Response {
  return new Response(JSON.stringify(output), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function stopped(reason: StopReason): ProbeOutput {
  return {
    tag: TAG,
    run: "STOPPED",
    providerCalls: 0,
    budgetReservationFailures: 0,
    results: [],
    stopReason: reason,
  };
}

function statusFor(reason: StopReason): number {
  if (reason === "METHOD_NOT_ALLOWED") return 405;
  if (
    [
      "QUERY_NOT_ALLOWED",
      "BODY_NOT_ALLOWED",
      "ORIGIN_NOT_ALLOWED",
      "CAPABILITY_REQUIRED",
      "CAPABILITY_INVALID",
    ].includes(reason)
  ) return 400;
  if (reason === "AUTH_REQUIRED") return 401;
  if (["MEMBERSHIP_REQUIRED", "MEMBER_MISMATCH"].includes(reason)) return 403;
  if (reason === "PROBE_EXPIRED") return 410;
  return 503;
}

function validHex64(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validConfig(config: ProbeConfig): boolean {
  const expiresAt = Date.parse(config.expiresAt);
  return validHex64(config.memberHash) && validHex64(config.capabilityHash) &&
    Number.isFinite(expiresAt) &&
    new Date(expiresAt).toISOString() === config.expiresAt &&
    Number.isInteger(config.grid.nx) && config.grid.nx > 0 &&
    config.grid.nx <= 1000 &&
    Number.isInteger(config.grid.ny) && config.grid.ny > 0 &&
    config.grid.ny <= 1000;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function equalDigest(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function configuredLimit(value: string | undefined): number {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) {
    throw new ProbeStop("API_BUDGET_NOT_CONFIGURED");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ProbeStop("API_BUDGET_NOT_CONFIGURED");
  }
  return parsed;
}

function configuredKey(value: string | undefined): string {
  if (
    value === undefined || value.length === 0 || value.length > 4096 ||
    value.trim().length === 0
  ) {
    throw new ProbeStop("PROVIDER_NOT_CONFIGURED");
  }
  return value;
}

function responseItems(value: unknown): unknown[] | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const response = (value as Record<string, unknown>).response;
  if (
    response === null || typeof response !== "object" || Array.isArray(response)
  ) return null;
  const body = (response as Record<string, unknown>).body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const items = (body as Record<string, unknown>).items;
  if (items === null || typeof items !== "object" || Array.isArray(items)) {
    return null;
  }
  const item = (items as Record<string, unknown>).item;
  return Array.isArray(item) ? item : null;
}

function issuanceMilliseconds(date: unknown, time: unknown): number | null {
  if (
    typeof date !== "string" || !/^\d{8}$/.test(date) ||
    typeof time !== "string" || !/^(?:[01]\d|2[0-3])[0-5]\d$/.test(time)
  ) return null;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day
  ) return null;
  return local.getTime() - 9 * 60 * 60_000;
}

function returnedIssuances(
  items: readonly unknown[],
  requested: { date: string; time: string },
): ReturnedIssuance[] {
  const requestedMs = issuanceMilliseconds(requested.date, requested.time);
  const seen = new Set<string>();
  const output: ReturnedIssuance[] = [];
  for (const value of items.slice(0, MAX_SCANNED_ITEMS)) {
    const item =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    const returnedMs = issuanceMilliseconds(item.baseDate, item.baseTime);
    if (returnedMs === null || requestedMs === null) {
      if (!seen.has("INVALID")) {
        seen.add("INVALID");
        output.push({ identity: "INVALID" });
      }
    } else {
      const date = item.baseDate as string;
      const time = item.baseTime as string;
      const identity = `${date}:${time}`;
      if (!seen.has(identity)) {
        seen.add(identity);
        output.push({
          date,
          time,
          deltaMinutes: (returnedMs - requestedMs) / 60_000,
        });
      }
    }
    if (output.length === 2) break;
  }
  return output;
}

function emptyBinding(expected: KmaResponseIdentity): string {
  return safeKmaBindingDiagnostic(summarizeKmaBinding([], expected));
}

function parserResponse(raw: string, status: number): Response {
  return [204, 205, 304].includes(status)
    ? new Response(null, { status })
    : new Response(raw, { status });
}

async function boundedBody(response: Response): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null && /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_RESPONSE_BYTES
  ) {
    try {
      await response.body?.cancel();
    } catch { /* deliberately ignored */ }
    throw new ProbeStop("RESPONSE_TOO_LARGE");
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ProbeStop("RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function providerUrl(
  model: ForecastModel,
  base: { date: string; time: string },
  key: string,
  grid: ProbeConfig["grid"],
): URL {
  const operation = model === "ultra" ? "getUltraSrtFcst" : "getVilageFcst";
  const url = new URL(
    `https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/${operation}`,
  );
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", String(MAX_SCANNED_ITEMS));
  url.searchParams.set("dataType", "JSON");
  url.searchParams.set("base_date", base.date);
  url.searchParams.set("base_time", base.time);
  url.searchParams.set("nx", String(grid.nx));
  url.searchParams.set("ny", String(grid.ny));
  url.searchParams.set("authKey", key);
  return url;
}

function previousBase(
  model: ForecastModel,
  base: { date: string; time: string },
): { date: string; time: string } {
  const prior = new Date(
    Date.parse(issuedAtIso(base)) - (model === "ultra" ? 60 : 180) * 60_000,
  );
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(prior).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}${parts.month}${parts.day}`,
    time: `${parts.hour}${parts.minute}`,
  };
}

function parserFailure(error: unknown): ParserResult {
  return {
    status: "FAIL",
    code: safeWeatherDiagnosticCode(error),
    reason: kmaResponseDiagnostic(error),
  };
}

function authStop(error: unknown): StopReason {
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return "AUTH_REQUIRED";
  }
  if (error instanceof Error && error.message === "MEMBERSHIP_REQUIRED") {
    return "MEMBERSHIP_REQUIRED";
  }
  return "AUTH_FAILED";
}

async function assertEmptyRequestBody(request: Request): Promise<void> {
  if (request.body === null) return;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProbeStop("BODY_NOT_ALLOWED")), 1000);
    });
    // Native Deno may yield one zero-byte chunk before closing an empty POST.
    // Bound empty chunks as well as elapsed time to avoid an endless producer.
    for (let chunks = 0; chunks < 4; chunks += 1) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next.done) return;
      if (next.value.byteLength > 0) throw new ProbeStop("BODY_NOT_ALLOWED");
    }
    throw new ProbeStop("BODY_NOT_ALLOWED");
  } catch {
    throw new ProbeStop("BODY_NOT_ALLOWED");
  } finally {
    clearTimeout(timer);
    // A rejected body is already observable; cancellation must not extend the
    // request-read deadline if a client-controlled stream never settles.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createProbeHandler(overrides: Partial<ProbeDependencies> = {}) {
  const dependencies: ProbeDependencies = {
    authenticate: requireMember,
    reserveBudget: consumeBudget,
    providerFetch: fetch,
    env: (name) => Deno.env.get(name),
    now: () => Date.now(),
    timeoutSignal: () => AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    config: PROBE_CONFIG,
    ...overrides,
  };

  return async (request: Request): Promise<Response> => {
    let output: ProbeOutput = stopped("AUTH_FAILED");
    try {
      if (request.method !== "POST") throw new ProbeStop("METHOD_NOT_ALLOWED");
      if (request.url.includes("?")) throw new ProbeStop("QUERY_NOT_ALLOWED");
      await assertEmptyRequestBody(request);
      if (request.headers.has("origin")) {
        throw new ProbeStop("ORIGIN_NOT_ALLOWED");
      }
      if (dependencies.env("SUPABASE_URL") !== EXPECTED_SUPABASE_URL) {
        throw new ProbeStop("PROJECT_MISMATCH");
      }
      if (!validConfig(dependencies.config)) {
        throw new ProbeStop("PROBE_CONFIGURATION_INVALID");
      }

      const expiresAt = Date.parse(dependencies.config.expiresAt);
      const capturedNow = dependencies.now();
      if (!Number.isFinite(capturedNow) || capturedNow >= expiresAt) {
        throw new ProbeStop("PROBE_EXPIRED");
      }

      let member: Awaited<ReturnType<typeof requireMember>>;
      try {
        member = await dependencies.authenticate(request);
      } catch (error) {
        throw new ProbeStop(authStop(error));
      }
      if (
        !equalDigest(
          await sha256(member.user.id),
          dependencies.config.memberHash,
        )
      ) throw new ProbeStop("MEMBER_MISMATCH");

      const capability = request.headers.get("x-motocast-probe-capability");
      if (capability === null) throw new ProbeStop("CAPABILITY_REQUIRED");
      if (
        !validHex64(capability) ||
        !equalDigest(
          await sha256(capability),
          dependencies.config.capabilityHash,
        )
      ) {
        throw new ProbeStop("CAPABILITY_INVALID");
      }

      const key = configuredKey(dependencies.env("KMA_APIHUB_KEY"));
      const limit = configuredLimit(dependencies.env("KMA_DAILY_LIMIT"));
      const baseNow = new Date(capturedNow);
      const target = forecastTarget(new Date(capturedNow + 60 * 60_000));
      const latestUltra = latestForecastBase("ultra", baseNow);
      const candidate = {
        date: latestUltra.date,
        time: `${latestUltra.time.slice(0, 2)}00`,
      };
      const baseline = [candidate, previousBase("ultra", candidate)];
      output = {
        tag: TAG,
        run: "COMPLETE",
        providerCalls: 0,
        budgetReservationFailures: 0,
        results: [],
      };
      const execute = async (
        base: { date: string; time: string },
      ): Promise<unknown> => {
        const model = "ultra" as const;
        const expected: KmaResponseIdentity = {
          model,
          baseDate: base.date,
          baseTime: base.time,
          nx: dependencies.config.grid.nx,
          ny: dependencies.config.grid.ny,
        };
        if (output.providerCalls >= MAX_PROVIDER_CALLS) {
          throw new ProbeStop("PROVIDER_FAILED");
        }
        if (dependencies.now() >= expiresAt) {
          throw new ProbeStop("PROBE_EXPIRED");
        }
        try {
          await dependencies.reserveBudget(
            member.user.id,
            "kma",
            model === "ultra" ? "ultra_forecast" : "short_forecast",
            limit,
          );
        } catch {
          output.budgetReservationFailures += 1;
          throw new ProbeStop("BUDGET_FAILED");
        }
        if (dependencies.now() >= expiresAt) {
          throw new ProbeStop("DEADLINE_EXCEEDED_AFTER_RESERVATION");
        }

        let response: Response;
        output.providerCalls += 1;
        try {
          response = await dependencies.providerFetch(
            providerUrl(model, base, key, dependencies.config.grid),
            {
              method: "GET",
              redirect: "error",
              signal: dependencies.timeoutSignal(),
            },
          );
        } catch {
          output.results.push({
            model,
            requested: base,
            returnedIssuances: [],
            binding: emptyBinding(expected),
            parser: { status: "FAIL", code: "UNKNOWN", reason: "UNKNOWN" },
          });
          throw new ProbeStop("NETWORK_FAILED");
        }

        let bytes: Uint8Array;
        try {
          bytes = await boundedBody(response);
        } catch (error) {
          output.results.push({
            model,
            requested: base,
            returnedIssuances: [],
            binding: emptyBinding(expected),
            parser: { status: "FAIL", code: "UNKNOWN", reason: "UNKNOWN" },
          });
          throw error instanceof ProbeStop
            ? error
            : new ProbeStop("NETWORK_FAILED");
        }

        const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        let decoded: unknown;
        try {
          decoded = JSON.parse(raw);
        } catch {
          const error = await parseKmaItems(
            parserResponse(raw, response.status),
            expected,
          ).catch((value: unknown) => value);
          output.results.push({
            model,
            requested: base,
            returnedIssuances: [],
            binding: emptyBinding(expected),
            parser: parserFailure(error),
          });
          throw new ProbeStop("INVALID_JSON");
        }
        const items = responseItems(decoded) ?? [];
        if (items.length > MAX_SCANNED_ITEMS) {
          output.results.push({
            model,
            requested: base,
            returnedIssuances: returnedIssuances(items, base),
            binding: safeKmaBindingDiagnostic(
              summarizeKmaBinding(items, expected),
            ),
            parser: { status: "FAIL", code: "UNKNOWN", reason: "UNKNOWN" },
          });
          throw new ProbeStop("ITEM_SCAN_LIMIT");
        }

        const returned = returnedIssuances(items, base);
        const binding = safeKmaBindingDiagnostic(
          summarizeKmaBinding(items, expected),
        );
        let parser: ParserResult = { status: "PASS" };
        let error: unknown = null;
        try {
          const parsed = await parseKmaItems(
            parserResponse(raw, response.status),
            expected,
          );
          validatedForecastValues(
            parsed.filter((item) =>
              item.fcstDate === target.date && item.fcstTime === target.time
            ),
            target,
            model,
          );
        } catch (value) {
          error = value;
          parser = parserFailure(value);
        }
        output.results.push({
          model,
          requested: base,
          returnedIssuances: returned,
          binding,
          parser,
        });
        return error;
      };

      for (const base of baseline) {
        const error = await execute(base);
        if (error !== null) throw new ProbeStop("PROVIDER_FAILED");
      }
      return jsonResponse(output);
    } catch (error) {
      const reason = error instanceof ProbeStop ? error.reason : "AUTH_FAILED";
      output.run = "STOPPED";
      output.stopReason = reason;
      return jsonResponse(
        output,
        output.results.length === 0 && output.providerCalls === 0
          ? statusFor(reason)
          : 200,
      );
    }
  };
}

Deno.serve(createProbeHandler());
