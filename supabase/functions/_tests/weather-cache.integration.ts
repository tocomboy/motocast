// Deno runtime + real local PostgreSQL + loopback HTTP. No hosted project/provider credentials.
import { sharedWeatherBundle, WeatherPendingError, type WeatherCacheMetrics } from "../_shared/weather-cache.ts";
import { weatherCacheRpc } from "../_shared/weather-cache-rpc.ts";
import { fetchWeatherBundle, bundleForecastValues, WeatherBundleError, type WeatherBundleKey } from "../_shared/weather-bundle.ts";
const config = JSON.parse(await Deno.readTextFile(".supabase/journey-weather-run.json"));
if (!/^motocast_weather_[a-f0-9]{10}$/.test(config.database) || config.container !== "supabase_db_motocast") throw new Error("TEST_IDENTITY_MISMATCH");
const decoder = new TextDecoder();
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
async function sql(text: string) {
  const child = new Deno.Command("docker", { args: ["exec", "-i", config.container, "psql", "-U", "supabase_admin", "-d", config.database, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"], stdin: "piped", stdout: "piped", stderr: "piped" }).spawn();
  const writer = child.stdin.getWriter(); await writer.write(new TextEncoder().encode(text)); await writer.close();
  const out = await child.output();
  if (!out.success) throw new Error(decoder.decode(out.stderr));
  return decoder.decode(out.stdout).trim();
}
function assert(ok: unknown, name: string): asserts ok { if (!ok) throw new Error(name); }
assert(await sql("select current_database();") === config.database, "DATABASE_IDENTITY");
const grid = Number(await sql("select min(i) from generate_series(70,149) i where not exists(select 1 from public.weather_fetch_cache where nx=i);"));
assert(grid >= 70 && grid <= 149, "NO_UNUSED_SYNTHETIC_GRID");
// The earlier final-slot scenario intentionally lowered its synthetic limit to 5.
// This is a separate runtime workload, explicitly provisioned on the same task-owned DB.
await sql("update public.weather_budget_policy set daily_calls=100;update public.weather_usage_daily set hard_calls=100;");
const before = Number(await sql("select sum(calls) from public.weather_usage_daily;"));
const rpc = async (name: string, args: Record<string, unknown>) => {
  const allowed = ["claim_weather_fetch_internal", "start_weather_fetch_internal", "finish_weather_fetch_internal"];
  assert(allowed.includes(name), "UNKNOWN_RPC");
  const parameters = Object.entries(args).map(([k, v]) => `${k} => ${v === null ? "null" : typeof v === "number" ? v : typeof v === "string" ? quote(v) : quote(JSON.stringify(v)) + "::jsonb"}`);
  try { return { data: JSON.parse(await sql(`set role service_role;select to_jsonb(public.${name}(${parameters.join(",")}));`)), error: null }; }
  catch { return { data: null, error: { message: "WEATHER_CACHE_PERSIST_FAILED" } }; }
};
const key = { model: "ultra" as const, nx: grid, ny: 127, baseDate: "20260922", baseTime: "1000" };
const material = ["1100", "1200", "1300"].flatMap(fcstTime => Object.entries({ T1H: "21", SKY: "4", PTY: "1", WSD: "2" })
  .map(([category, fcstValue]) => ({ baseDate: key.baseDate, baseTime: key.baseTime, nx: key.nx, ny: key.ny, fcstDate: key.baseDate, fcstTime, category, fcstValue })));
let calls = 0; let active = 0; let peak = 0;
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async () => {
  calls++; active++; peak = Math.max(peak, active);
  await new Promise(r => setTimeout(r, 150));
  active--;
  return Response.json({ response: { header: { resultCode: "00" }, body: { pageNo: 1, totalCount: material.length, items: { item: material } } } });
});
const address = server.addr as Deno.NetAddr;
const metrics: WeatherCacheMetrics[] = [];
const started = performance.now();
try {
  const answers = await Promise.all(Array.from({ length: 10 }, async (_, i) => {
    const bundle = await sharedWeatherBundle(key, {
      store: weatherCacheRpc(rpc, i % 2 ? config.member : config.peer, 100),
      fetch: (k, cap) => fetchWeatherBundle(k, "synthetic-loopback-only", cap, ((_input, init) => fetch(`http://127.0.0.1:${address.port}/forecast`, init)) as typeof fetch),
      measure: m => metrics.push(m),
    });
    return Array.from({ length: 13 }, (_, index) => bundleForecastValues(bundle.items, { date: key.baseDate, time: index < 6 ? "1100" : index < 12 ? "1200" : "1300" }));
  }));
  assert(answers.flat().length === 130 && answers.flat().every(v => v.T1H === "21" && v.PTY === "1" && v.POP === undefined), "FORECAST_CONTRACT");
  assert(calls === 1 && peak === 1, "EXTERNAL_SINGLE_FLIGHT");
  const after = Number(await sql("select sum(calls) from public.weather_usage_daily;"));
  assert(after - before === 1, "EXACT_BUDGET_DELTA");
  assert(Number(await sql("select count(*) from pg_stat_activity where datname=current_database() and state='idle in transaction';")) === 0, "NO_NETWORK_TRANSACTION");
  const report = { scenario: "10 callers, 13 samples each, one grid/model/issue, 3 target hours", database: config.database,
    samples: 130, uniqueBundles: 1, loopbackProviderCalls: calls, peakProviderConcurrency: peak, budgetDelta: after - before,
    cacheHits: metrics.reduce((n, m) => n + m.cacheHits, 0), waits: metrics.reduce((n, m) => n + m.waits, 0),
    responseBytes: metrics.reduce((n, m) => n + m.responseBytes, 0), durationMs: Math.round(performance.now() - started),
    callerLatencyMs: metrics.map(m => m.durationMs), status: "PASS", realKmaCalls: 0 };
  await Deno.writeTextFile(".supabase/journey-weather-runtime.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { await server.shutdown(); }

// Headers arrive immediately but the body never completes. Exercise the real
// eight-second HTTP abort and DB failure/cooldown path, without a fake clock.
const timeoutKey = { ...key, nx: grid + 1 };
assert(await sql(`select count(*) from public.weather_fetch_cache where nx=${timeoutKey.nx};`) === "0", "TIMEOUT_GRID_NOT_EMPTY");
let timeoutCalls = 0;
const slow = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, () => {
  timeoutCalls++;
  return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"response":')); } }),
    { headers: { "content-type": "application/json" } });
});
const slowAddress = slow.addr as Deno.NetAddr;
const timeoutStarted = performance.now();
const timeoutBefore = Number(await sql("select sum(calls) from public.weather_usage_daily;"));
const timeoutDependencies = {
  store: weatherCacheRpc(rpc, config.member, 100),
  fetch: (k: WeatherBundleKey, cap: number) => fetchWeatherBundle(k, "synthetic-loopback-only", cap,
    ((_input, init) => fetch(`http://127.0.0.1:${slowAddress.port}/slow`, init)) as typeof fetch),
};
try {
  let timeoutError: unknown;
  try { await sharedWeatherBundle(timeoutKey, timeoutDependencies); } catch (error) { timeoutError = error; }
  assert(timeoutError instanceof WeatherBundleError && timeoutError.kind === "timeout", "BODY_TIMEOUT_CLASSIFIED");
  assert(await sql(`select outcome from public.weather_fetch_attempts where nx=${timeoutKey.nx};`) === "timeout", "TIMEOUT_DURABLE");
  let retryError: unknown;
  try { await sharedWeatherBundle(timeoutKey, timeoutDependencies); } catch (error) { retryError = error; }
  assert(retryError instanceof WeatherPendingError, "TIMEOUT_COOLDOWN");
  const timeoutDelta = Number(await sql("select sum(calls) from public.weather_usage_daily;")) - timeoutBefore;
  assert(timeoutCalls === 1 && timeoutDelta === 1, "TIMEOUT_NO_REFUND_OR_RESEND");
  const report = JSON.parse(await Deno.readTextFile(".supabase/journey-weather-runtime.json"));
  report.timeout = { status: "PASS", loopbackProviderCalls: timeoutCalls, budgetDelta: timeoutDelta,
    outcome: "timeout", immediateRetry: "pending", durationMs: Math.round(performance.now() - timeoutStarted) };
  await Deno.writeTextFile(".supabase/journey-weather-runtime.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.timeout));
} finally { await slow.shutdown(); }
