import { safeKmaBindingDiagnostic } from "./kma-binding-diagnostic.ts";

export type WeatherFailureKind = "provider" | "budget" | "configuration" | "persistence" | "request";

const kmaValidationReasons = [
  "JSON_BODY", "OBJECT_SHAPE", "ITEM_SHAPE", "BASE_BINDING", "CATEGORY_SHAPE",
  "BASE_DATE_TYPE", "BASE_DATE_FORMAT", "BASE_DATE_MISMATCH", "BASE_DATE_NUMERIC_EQUIVALENT",
  "BASE_TIME_TYPE", "BASE_TIME_FORMAT", "BASE_TIME_MISMATCH", "BASE_TIME_NUMERIC_EQUIVALENT",
  "FORECAST_IDENTITY", "VALUE_CONTRACT", "GRID_BINDING", "DUPLICATE_IDENTITY",
  "MISSING_TEMPERATURE", "MISSING_POP", "MISSING_WSD", "MISSING_SKY", "MISSING_PTY",
] as const;
type KmaValidationReason = typeof kmaValidationReasons[number];
const bindingDiagnostics = new WeakMap<KmaResponseValidationError, string>();

export class KmaResponseValidationError extends Error {
  constructor(readonly reason: KmaValidationReason) {
    super("KMA_INVALID_RESPONSE");
  }
}

export function attachKmaBindingDiagnostic(error: KmaResponseValidationError, diagnostic: string): void {
  bindingDiagnostics.set(error, safeKmaBindingDiagnostic(diagnostic));
}

export function kmaBindingDiagnostic(error: unknown): string[] {
  if (!(error instanceof KmaResponseValidationError)) return [];
  const diagnostic = bindingDiagnostics.get(error);
  return diagnostic === undefined ? [] : [safeKmaBindingDiagnostic(diagnostic)];
}

export function kmaResponseDiagnostic(error: unknown): string {
  if (!(error instanceof KmaResponseValidationError)) return "UNKNOWN";
  const reason = error.reason;
  return kmaValidationReasons.includes(reason) ? reason : "UNKNOWN";
}

const weatherDiagnosticCodes = new Set([
  "KMA_REQUEST_FAILED", "KMA_INVALID_RESPONSE", "KMA_FORECAST_NOT_FOUND",
  "API_DAILY_BUDGET_EXHAUSTED", "API_BUDGET_NOT_CONFIGURED", "API_BUDGET_ACCOUNTING_FAILED",
  "PROVIDER_NOT_CONFIGURED", "WEATHER_PERSIST_FAILED", "SERVER_STORAGE_NOT_CONFIGURED",
  "AUTH_REQUIRED", "MEMBERSHIP_REQUIRED", "INVALID_WEATHER_ROUTE", "INVALID_REQUEST",
  "INVALID_POINTS", "INVALID_POINT", "INVALID_TRIP", "INVALID_CANDIDATE",
]);

export function safeWeatherDiagnosticCode(error: unknown): string {
  if (!(error instanceof Error)) return "UNKNOWN";
  const code = error.message;
  if (weatherDiagnosticCodes.has(code)) return code;
  if (/^KMA_HTTP_STATUS_[1-5][0-9]{2}$/.test(code)) return code;
  if (/^KMA_RESULT_CODE_(?:[0-9]{2}|UNKNOWN)$/.test(code)) return code;
  return "UNKNOWN";
}

export function weatherFailureKind(error: unknown): WeatherFailureKind {
  const code = error instanceof Error ? error.message : "";
  if (code.includes("API_DAILY_BUDGET_EXHAUSTED")) return "budget";
  if (code === "API_BUDGET_ACCOUNTING_FAILED") return "persistence";
  if (code.includes("NOT_CONFIGURED")) return "configuration";
  if (code === "WEATHER_PERSIST_FAILED") return "persistence";
  if (code.startsWith("KMA_")) return "provider";
  return "request";
}
