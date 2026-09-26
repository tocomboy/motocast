import { validateWeatherBundle, WeatherBundleError, type WeatherBundle, type WeatherBundleKey, type BundleFailure } from "./weather-bundle.ts";
import type { KmaItem } from "./weather-forecast.ts";

export type CacheClaim = { status: "hit"; bundle: WeatherBundle } | { status: "owner"; generation: number; leaseUntil: number } |
  { status: "wait"; retryAt: number } | { status: "superseded" };
export type FetchPermit = { status: "permit"; requestNumber: number; responseBytes: number; leaseUntil: number } | { status: "superseded" };
export type WeatherCacheStore = {
  claim(key: WeatherBundleKey, token: string): Promise<CacheClaim>;
  start(key: WeatherBundleKey, token: string, generation: number): Promise<FetchPermit>;
  finish(key: WeatherBundleKey, token: string, generation: number, result: { items: KmaItem[]; bytes: number } | { failure: BundleFailure }): Promise<boolean>;
};
export type WeatherCacheMetrics = { cacheHits: number; waits: number; providerCalls: number; budgetReservations: number; responseBytes: number; durationMs: number };
export class WeatherPendingError extends Error {
  constructor(readonly retryAt: number) { super("WEATHER_PENDING"); }
}

/** One request owns one token. Never retries start or provider after an uncertain result. */
export async function sharedWeatherBundle(key: WeatherBundleKey, dependencies: {
  store: WeatherCacheStore; fetch: (key: WeatherBundleKey, maxBytes: number) => Promise<{ items: KmaItem[]; bytes: number }>;
  now?: () => number; sleep?: (ms: number) => Promise<void>; token?: string; measure?: (metrics: WeatherCacheMetrics) => void;
}): Promise<WeatherBundle> {
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const startAt = now(); const token = dependencies.token ?? crypto.randomUUID();
  const metrics: WeatherCacheMetrics = { cacheHits: 0, waits: 0, providerCalls: 0, budgetReservations: 0, responseBytes: 0, durationMs: 0 };
  try {
    // Bounded DB wait; pending is explicit, never a forecast of no rain.
    for (let poll = 0; poll < 9; poll++) {
      const claim = await dependencies.store.claim(key, token);
      if (claim.status === "hit") {
        checkFreshBundle(claim.bundle, now());
        const items = await validateWeatherBundle(claim.bundle.items, key);
        metrics.cacheHits++;
        return { ...claim.bundle, items };
      }
      if (claim.status === "superseded") throw new Error("WEATHER_SUPERSEDED");
      if (claim.status === "wait") {
        metrics.waits++;
        if (poll === 8 || now() - startAt >= 4000) throw new WeatherPendingError(claim.retryAt);
        await sleep(500); continue;
      }
      if (claim.leaseUntil <= now()) throw new Error("WEATHER_SUPERSEDED");
      const permit = await dependencies.store.start(key, token, claim.generation);
      if (permit.status !== "permit") throw new Error("WEATHER_SUPERSEDED");
      metrics.budgetReservations++;
      // Leave time for the entire 8s provider deadline. Expired permits are never replayed.
      if (permit.leaseUntil - now() < 9000) throw new Error("WEATHER_SUPERSEDED");
      let result: { items: KmaItem[]; bytes: number };
      try {
        metrics.providerCalls++;
        result = await dependencies.fetch(key, permit.responseBytes);
        result.items = await validateWeatherBundle(result.items, key);
        if (!Number.isSafeInteger(result.bytes) || result.bytes <= 0 || result.bytes > permit.responseBytes) throw new WeatherBundleError("oversize");
        metrics.responseBytes = result.bytes;
      } catch (error) {
        const failure = error instanceof WeatherBundleError ? error.kind : "provider";
        await dependencies.store.finish(key, token, claim.generation, { failure });
        throw error instanceof WeatherBundleError ? error : new WeatherBundleError(failure);
      }
      if (!await dependencies.store.finish(key, token, claim.generation, result)) throw new Error("WEATHER_SUPERSEDED");
      // Read the authoritative stored timestamp and payload; uncertain publication is not success.
      const published = await dependencies.store.claim(key, token);
      if (published.status !== "hit") throw new Error("WEATHER_CACHE_PERSIST_FAILED");
      checkFreshBundle(published.bundle, now());
      return { ...published.bundle, items: await validateWeatherBundle(published.bundle.items, key) };
    }
    throw new Error("WEATHER_PENDING");
  } finally {
    metrics.durationMs = Math.max(0, now() - startAt);
    dependencies.measure?.(metrics);
  }
}

function checkFreshBundle(bundle: WeatherBundle, now: number) {
  const expiry = Date.parse(bundle.expiresAt), fetched = Date.parse(bundle.fetchedAt);
  if (!Number.isFinite(expiry) || !Number.isFinite(fetched) || fetched > now + 5000 || expiry <= now || expiry <= fetched || expiry - fetched > 600_000)
    throw new Error("WEATHER_CACHE_INVALID");
}
