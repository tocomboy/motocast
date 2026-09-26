import type { WeatherCacheStore } from "./weather-cache.ts";
import type { WeatherBundleKey } from "./weather-bundle.ts";
import type { KmaItem } from "./weather-forecast.ts";

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("WEATHER_CACHE_INVALID");
  return value as Record<string, unknown>;
}
function instant(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("WEATHER_CACHE_INVALID");
  return Date.parse(value);
}
function positive(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("WEATHER_CACHE_INVALID"); return value;
}
export function weatherCacheRpc(rpc: Rpc, memberId: string, configuredLimit: number): WeatherCacheStore {
  const args = (key: WeatherBundleKey, token: string) => ({ target_model: key.model, target_nx: key.nx, target_ny: key.ny,
    target_date: key.baseDate, target_time: key.baseTime, claim_token: token });
  async function call(name: string, values: Record<string, unknown>) {
    const { data, error } = await rpc(name, values);
    if (error) {
      const allowed = ["API_DAILY_BUDGET_EXHAUSTED", "API_BUDGET_NOT_CONFIGURED", "API_BUDGET_BASELINE_REQUIRED", "MEMBERSHIP_REQUIRED", "WEATHER_LEASE_EXPIRED", "WEATHER_STORAGE_CAPACITY"];
      throw new Error(allowed.includes(error.message) ? error.message : "WEATHER_CACHE_PERSIST_FAILED");
    }
    return data;
  }
  return {
    async claim(key, token) {
      const r = object(await call("claim_weather_fetch_internal", { ...args(key, token), member_id: memberId }));
      if (r.status === "superseded") return { status: "superseded" };
      if (r.status === "owner") return { status: "owner", generation: positive(r.generation), leaseUntil: instant(r.leaseUntil) };
      if (r.status === "wait") return { status: "wait", retryAt: instant(r.retryAt) };
      if (r.status === "hit" && Array.isArray(r.items)) {
        instant(r.fetchedAt); instant(r.expiresAt);
        return { status: "hit", bundle: { items: r.items as KmaItem[], fetchedAt: String(r.fetchedAt), expiresAt: String(r.expiresAt) } };
      }
      throw new Error("WEATHER_CACHE_INVALID");
    },
    async start(key, token, generation) {
      const r = object(await call("start_weather_fetch_internal", { ...args(key, token), member_id: memberId,
        expected_generation: generation, configured_limit: configuredLimit }));
      if (r.status === "superseded") return { status: "superseded" };
      if (r.status !== "permit") throw new Error("WEATHER_CACHE_INVALID");
      const responseBytes = positive(r.responseBytes);
      if (responseBytes < 65536 || responseBytes > 4194304) throw new Error("WEATHER_CACHE_INVALID");
      return { status: "permit", requestNumber: positive(r.requestNumber), responseBytes, leaseUntil: instant(r.leaseUntil) };
    },
    async finish(key, token, generation, result) {
      const success = "items" in result;
      const r = await call("finish_weather_fetch_internal", { ...args(key, token), expected_generation: generation,
        result_items: success ? result.items : null, received_bytes: success ? result.bytes : null, result_failure: success ? null : result.failure });
      if (typeof r !== "boolean") throw new Error("WEATHER_CACHE_INVALID"); return r;
    },
  };
}
