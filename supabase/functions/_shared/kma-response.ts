import type { KmaItem } from "./weather-forecast.ts";

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

function validKmaItem(value: unknown): value is KmaItem {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return validKmaDate(item.baseDate) &&
    validKmaTime(item.baseTime) &&
    typeof item.category === "string" && /^[A-Z0-9]{1,8}$/.test(item.category) &&
    validKmaDate(item.fcstDate) &&
    validKmaTime(item.fcstTime) &&
    typeof item.fcstValue === "string" && item.fcstValue.length > 0 && item.fcstValue.length <= 64 &&
    typeof item.nx === "number" && Number.isInteger(item.nx) && item.nx > 0 && item.nx <= 1_000 &&
    typeof item.ny === "number" && Number.isInteger(item.ny) && item.ny > 0 && item.ny <= 1_000;
}

export async function parseKmaItems(response: Response): Promise<KmaItem[]> {
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
  if (!items.every(validKmaItem)) throw new Error("KMA_INVALID_RESPONSE");
  return items;
}
