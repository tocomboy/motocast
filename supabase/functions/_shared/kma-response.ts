import type { ForecastModel, KmaItem } from "./weather-forecast.ts";

export type KmaResponseIdentity = {
  baseDate: string;
  baseTime: string;
  nx: number;
  ny: number;
  model: ForecastModel;
};

function sanitizedProviderCode(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,16}$/.test(value)
    ? value
    : "UNKNOWN";
}

function validKmaDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validKmaTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3])[0-5]\d$/.test(value);
}

function validNumericValue(value: string, minimum: number, maximum: number, integer = false) {
  const format = integer ? /^-?\d+$/ : /^-?\d+(?:\.\d+)?$/;
  if (!format.test(value)) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= minimum && numeric <= maximum && (!integer || Number.isInteger(numeric));
}

function validForecastValue(category: string, value: unknown, model: ForecastModel) {
  if (typeof value !== "string" || value !== value.trim() || value.length === 0 || value.length > 64) return false;
  if (category === "T1H" || category === "TMP") return validNumericValue(value, -100, 100);
  if (category === "POP") return validNumericValue(value, 0, 100, true);
  if (category === "WSD") return validNumericValue(value, 0, 200);
  if (category === "SKY") return [1, 3, 4].includes(Number(value)) && validNumericValue(value, 1, 4, true);
  if (category === "PTY") {
    const allowed = model === "ultra" ? [0, 1, 2, 3, 5, 6, 7] : [0, 1, 2, 3, 4];
    return validNumericValue(value, 0, 7, true) && allowed.includes(Number(value));
  }
  return true;
}

function validKmaItem(value: unknown, expected: KmaResponseIdentity): value is KmaItem {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.baseDate === expected.baseDate && validKmaDate(item.baseDate) &&
    item.baseTime === expected.baseTime && validKmaTime(item.baseTime) &&
    typeof item.category === "string" && /^[A-Z0-9]{1,8}$/.test(item.category) &&
    validKmaDate(item.fcstDate) &&
    validKmaTime(item.fcstTime) &&
    validForecastValue(item.category, item.fcstValue, expected.model) &&
    item.nx === expected.nx &&
    item.ny === expected.ny;
}

export async function parseKmaItems(response: Response, expected: KmaResponseIdentity): Promise<KmaItem[]> {
  if (!response.ok) throw new Error(`KMA_HTTP_STATUS_${response.status}`);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("KMA_INVALID_RESPONSE");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("KMA_INVALID_RESPONSE");
  }
  const payload = data as {
    response?: { header?: { resultCode?: string }; body?: { items?: { item?: KmaItem[] } } };
  };
  const providerResponse = payload.response;
  const resultCode = providerResponse?.header?.resultCode;
  if (resultCode !== "00") {
    throw new Error(`KMA_RESULT_CODE_${sanitizedProviderCode(resultCode)}`);
  }
  const items = providerResponse?.body?.items?.item;
  if (!Array.isArray(items) || items.length === 0) throw new Error("KMA_FORECAST_NOT_FOUND");
  if (!items.every((item) => validKmaItem(item, expected))) throw new Error("KMA_INVALID_RESPONSE");
  const identities = new Set(items.map((item) => `${item.fcstDate}:${item.fcstTime}:${item.category}`));
  if (identities.size !== items.length) throw new Error("KMA_INVALID_RESPONSE");
  return items;
}
