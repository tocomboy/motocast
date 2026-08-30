import type { KmaItem } from "./weather-forecast.ts";

export async function parseKmaItems(response: Response): Promise<KmaItem[]> {
  if (!response.ok) throw new Error("KMA_REQUEST_FAILED");
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
  if (payload.response?.header?.resultCode !== "00") throw new Error("KMA_REQUEST_FAILED");
  const items = payload.response.body?.items?.item;
  if (!Array.isArray(items) || items.length === 0) throw new Error("KMA_FORECAST_NOT_FOUND");
  return items;
}
