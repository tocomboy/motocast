import type { KmaItem } from "./weather-forecast.ts";

function sanitizedProviderCode(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,16}$/.test(value)
    ? value
    : "UNKNOWN";
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
  return items;
}
