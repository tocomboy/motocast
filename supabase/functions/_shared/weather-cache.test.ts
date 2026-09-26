import { describe, expect, it, vi } from "vitest";
import { bundleForecastValues, fetchWeatherBundle, validateWeatherBundle, type WeatherBundleKey } from "./weather-bundle";
import { sharedWeatherBundle, WeatherPendingError, type WeatherCacheStore, type WeatherCacheMetrics } from "./weather-cache";
import { weatherCacheRpc } from "./weather-cache-rpc";

const key: WeatherBundleKey = { model: "ultra", nx: 60, ny: 127, baseDate: "20260922", baseTime: "1000" };
function items() {
  return ["1100", "1200", "1300"].flatMap(fcstTime => Object.entries({ T1H: "21", SKY: "4", PTY: "1", WSD: "2" })
    .map(([category, fcstValue]) => ({ baseDate: key.baseDate, baseTime: key.baseTime, nx: key.nx, ny: key.ny, fcstDate: key.baseDate, fcstTime, category, fcstValue })));
}
function payload(values = items()) { return { response: { header: { resultCode: "00" }, body: { pageNo: 1, totalCount: values.length, items: { item: values } } } }; }
const now = Date.parse("2026-09-22T01:50:00Z");

it("propagates exact capacity denial through RPC before provider dispatch", async () => {
  const fetch = vi.fn();
  const store = weatherCacheRpc(async () => ({ data: null, error: { message: "WEATHER_STORAGE_CAPACITY" } }), "synthetic-member", 100);
  await expect(sharedWeatherBundle(key, { store, fetch })).rejects.toThrow("WEATHER_STORAGE_CAPACITY");
  expect(fetch).not.toHaveBeenCalled();
});
function harness() {
  let ready = false; let clock = now;
  const claim = vi.fn<WeatherCacheStore["claim"]>(async () => ready
    ? { status: "hit", bundle: { items: items(), fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now + 600000).toISOString() } }
    : { status: "owner", generation: 1, leaseUntil: now + 30000 });
  const start = vi.fn<WeatherCacheStore["start"]>(async () => ({ status: "permit", requestNumber: 1, responseBytes: 1048576, leaseUntil: now + 15000 }));
  const finish = vi.fn<WeatherCacheStore["finish"]>(async (_key, _token, _generation, result) => { ready = "items" in result; return true; });
  const fetch = vi.fn(async () => ({ items: items(), bytes: 3000 }));
  const metrics: WeatherCacheMetrics[] = [];
  return { store: { claim, start, finish }, fetch, now: () => clock, sleep: async (ms: number) => { clock += ms; }, measure: (m: WeatherCacheMetrics) => metrics.push(m), metrics };
}
describe("whole issue material validation", () => {
  it("reuses several exact target times; missing probability stays absent", async () => {
    const r = await fetchWeatherBundle(key, "synthetic-test-key", 65536, vi.fn(async () => new Response(JSON.stringify(payload()))));
    expect(r.items).toHaveLength(12);
    expect(bundleForecastValues(r.items, { date: key.baseDate, time: "1200" }).POP).toBeUndefined();
    expect(() => bundleForecastValues(r.items, { date: key.baseDate, time: "1400" })).toThrow("KMA_FORECAST_NOT_FOUND");
  });
  it("normalizes away extra provider fields and rejects foreign identity/duplicate categories", async () => {
    const clean = await validateWeatherBundle(items().map(i => ({ ...i, unexpected: "not retained" })), key);
    expect(Object.keys(clean[0])).toHaveLength(8);
    for (const bad of [items().map(i => ({ ...i, nx: 61 })), items().map(i => ({ ...i, baseTime: "0900" })), [...items(), items()[0]], items().slice(1)]) {
      await expect(validateWeatherBundle(bad, key)).rejects.toThrow();
    }
  });
  it("rejects truncated pages, malformed JSON and bad values", async () => {
    const partial = payload(); partial.response.body.totalCount++;
    const badValue = payload(items().map(i => i.category === "T1H" ? { ...i, fcstValue: "999" } : i));
    for (const body of [JSON.stringify(partial), "<html>failure</html>", JSON.stringify(badValue)]) {
      await expect(fetchWeatherBundle(key, "synthetic", 65536, vi.fn(async () => new Response(body)))).rejects.toThrow("WEATHER_BUNDLE_INVALID");
    }
  });
  it("bounds response size even without a content length header", async () => {
    await expect(fetchWeatherBundle(key, "synthetic", 65536, vi.fn(async () => new Response("x".repeat(65537))))).rejects.toThrow("WEATHER_BUNDLE_OVERSIZE");
    await expect(fetchWeatherBundle(key, "synthetic", 65536, vi.fn(async () => new Response("", { headers: { "content-length": "65537" } })))).rejects.toThrow("WEATHER_BUNDLE_OVERSIZE");
  });
});
describe("shared cache orchestration", () => {
  it("reserves, fetches, publishes, reads back; later targets reuse cache without provider", async () => {
    const h = harness(); await sharedWeatherBundle(key, h); await sharedWeatherBundle(key, h);
    expect(h.store.start).toHaveBeenCalledTimes(1); expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.metrics.map(m => [m.cacheHits, m.providerCalls, m.budgetReservations])).toEqual([[0, 1, 1], [1, 0, 0]]);
  });
  it("never calls provider when start response is lost or denied", async () => {
    for (const error of ["API_DAILY_BUDGET_EXHAUSTED", "WEATHER_CACHE_PERSIST_FAILED", "WEATHER_STORAGE_CAPACITY"]) {
      const h = harness(); h.store.start.mockRejectedValue(new Error(error));
      await expect(sharedWeatherBundle(key, h)).rejects.toThrow(error);
      expect(h.fetch).not.toHaveBeenCalled(); expect(h.store.start).toHaveBeenCalledTimes(1);
    }
  });
  it("does not retry a provider or refund a failed attempt", async () => {
    const h = harness(); h.fetch.mockRejectedValue(new Error("transport"));
    await expect(sharedWeatherBundle(key, h)).rejects.toThrow("WEATHER_BUNDLE_PROVIDER");
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.store.finish.mock.calls[0][3]).toEqual({ failure: "provider" });
    expect(h.metrics[0].budgetReservations).toBe(1);
  });
  it("never presents an unaccepted late result or retries uncertain publication", async () => {
    for (const mode of ["late", "unknown"]) {
      const h = harness();
      if (mode === "late") h.store.finish.mockResolvedValue(false); else h.store.finish.mockRejectedValue(new Error("WEATHER_CACHE_PERSIST_FAILED"));
      await expect(sharedWeatherBundle(key, h)).rejects.toThrow();
      expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.store.finish).toHaveBeenCalledTimes(1);
    }
  });
  it("bounded wait has no external calls and remains explicitly pending", async () => {
    const h = harness(); h.store.claim.mockResolvedValue({ status: "wait", retryAt: now + 600000 });
    await expect(sharedWeatherBundle(key, h)).rejects.toBeInstanceOf(WeatherPendingError);
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.store.start).not.toHaveBeenCalled();
    expect(h.store.claim).toHaveBeenCalledTimes(9); expect(h.metrics[0].durationMs).toBe(4000);
  });
  it("rejects expired owner/permit without sending network request", async () => {
    const h = harness(); h.store.start.mockResolvedValue({ status: "permit", requestNumber: 1, responseBytes: 1048576, leaseUntil: now + 8000 });
    await expect(sharedWeatherBundle(key, h)).rejects.toThrow("WEATHER_SUPERSEDED"); expect(h.fetch).not.toHaveBeenCalled();
  });
  it("validates persisted cache and exact time before returning", async () => {
    const h = harness(); h.store.claim.mockResolvedValue({ status: "hit", bundle: { items: items(), fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now).toISOString() } });
    await expect(sharedWeatherBundle(key, h)).rejects.toThrow("WEATHER_CACHE_INVALID"); expect(h.fetch).not.toHaveBeenCalled();
  });
});
describe("RPC boundary", () => {
  it("rejects malformed grant/count/time and hides server error detail", async () => {
    for (const data of [{ status: "permit", requestNumber: 0, responseBytes: 1048576, leaseUntil: "bad" }, { status: "permit", requestNumber: 1, responseBytes: 1, leaseUntil: new Date(now).toISOString() }]) {
      const store = weatherCacheRpc(async () => ({ data, error: null }), "synthetic", 100);
      await expect(store.start(key, "token", 1)).rejects.toThrow("WEATHER_CACHE_INVALID");
    }
    const store = weatherCacheRpc(async () => ({ data: null, error: { message: "private SQL detail" } }), "synthetic", 100);
    await expect(store.claim(key, "token")).rejects.toThrow("WEATHER_CACHE_PERSIST_FAILED");
  });
});
