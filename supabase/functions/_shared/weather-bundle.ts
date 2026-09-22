import { parseKmaItems, type KmaResponseIdentity } from "./kma-response.ts";
import type { KmaItem } from "./weather-forecast.ts";

export type WeatherBundleKey = KmaResponseIdentity;
export type WeatherBundle = { items: KmaItem[]; fetchedAt: string; expiresAt: string };
export type BundleFailure = "provider" | "timeout" | "invalid" | "oversize";
export class WeatherBundleError extends Error {
  constructor(readonly kind: BundleFailure) { super(`WEATHER_BUNDLE_${kind.toUpperCase()}`); }
}

/** Same material, all available target hours. No user/course fields survive normalization. */
export async function validateWeatherBundle(items: unknown, key: WeatherBundleKey): Promise<KmaItem[]> {
  if (!Array.isArray(items) || items.length < 1 || items.length > 1000) throw new WeatherBundleError("invalid");
  const parsed = await parseKmaItems(new Response(JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: { item: items } } } })), key);
  const groups = new Map<string, Set<string>>();
  for (const item of parsed) {
    const target = `${item.fcstDate}:${item.fcstTime}`;
    if (!groups.has(target)) groups.set(target, new Set());
    groups.get(target)!.add(item.category);
  }
  // POP is genuinely absent in some ultra material. Absence stays null, never zero.
  const required = [key.model === "ultra" ? "T1H" : "TMP", "SKY", "PTY", "WSD"];
  if ([...groups.values()].some(categories => required.some(c => !categories.has(c)))) throw new WeatherBundleError("invalid");
  return parsed.map(i => ({ baseDate: i.baseDate, baseTime: i.baseTime, nx: i.nx, ny: i.ny,
    fcstDate: i.fcstDate, fcstTime: i.fcstTime, category: i.category, fcstValue: i.fcstValue }));
}

export function bundleForecastValues(items: KmaItem[], target: { date: string; time: string }) {
  const selected = items.filter(i => i.fcstDate === target.date && i.fcstTime === target.time);
  if (!selected.length) throw new Error("KMA_FORECAST_NOT_FOUND");
  return Object.fromEntries(selected.map(i => [i.category, i.fcstValue]));
}

export const WEATHER_RESPONSE_BYTE_CAP = 1_048_576;
export async function readBoundedWeatherBody(response: Response, maxBytes: number): Promise<{ raw: unknown; bytes: number }> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (!response.ok || !response.body) throw new WeatherBundleError("provider");
    const declared = response.headers.get("content-length");
    if (declared && Number(declared) > maxBytes) throw new WeatherBundleError("oversize");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) throw new WeatherBundleError("oversize");
      chunks.push(part.value);
    }
    const body = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    return { raw, bytes };
  } catch (error) {
    if (error instanceof WeatherBundleError) throw error;
    throw new WeatherBundleError("invalid");
  } finally {
    if (reader) { try { await reader.cancel(); } catch { /* The request abort owns stream termination. */ } reader.releaseLock(); }
  }
}

export async function fetchWeatherBundle(key: WeatherBundleKey, apiKey: string, maxBytes: number, fetchImpl: typeof fetch = fetch) {
  if (!apiKey || !Number.isSafeInteger(maxBytes) || maxBytes < 65536 || maxBytes > 4194304) throw new Error("PROVIDER_NOT_CONFIGURED");
  const operation = key.model === "ultra" ? "getUltraSrtFcst" : "getVilageFcst";
  const url = new URL(`https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/${operation}`);
  for (const [name, value] of Object.entries({ pageNo: "1", numOfRows: "1000", dataType: "JSON", base_date: key.baseDate,
    base_time: key.baseTime, nx: String(key.nx), ny: String(key.ny), authKey: apiKey })) url.searchParams.set(name, value);
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 8000);
  try {
    const response = await fetchImpl(url, { signal: abort.signal });
    const decoded = await readBoundedWeatherBody(response, maxBytes);
    const raw = decoded.raw as { response?: { header?: { resultCode?: string }; body?: { totalCount?: number; pageNo?: number; items?: { item?: unknown } } } };
    const bytes = decoded.bytes;
    if (raw?.response?.header?.resultCode !== "00") throw new WeatherBundleError("provider");
    const payload = raw.response.body;
    const items = payload?.items?.item;
    // A truncated first page cannot masquerade as the complete issue.
    if (!Array.isArray(items) || !Number.isInteger(payload?.totalCount) || payload?.totalCount !== items.length ||
      payload?.pageNo !== 1) throw new WeatherBundleError("invalid");
    return { items: await validateWeatherBundle(items, key), bytes };
  } catch (error) {
    if (abort.signal.aborted) throw new WeatherBundleError("timeout");
    if (error instanceof WeatherBundleError) throw error;
    throw new WeatherBundleError("invalid");
  } finally {
    clearTimeout(timeout);
    abort.abort();
  }
}
