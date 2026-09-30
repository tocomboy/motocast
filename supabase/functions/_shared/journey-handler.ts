import { authenticatedClient, consumeBudget, requireMember, serviceClient } from "./auth.ts";
import { corsHeaders, jsonResponse, safeErrorMessage, safeErrorStatus } from "./http.ts";
import { requestKakaoRoute } from "./kakao-provider.ts";
import { calculateJourneyRoute, forecastJourneySamples, recheckJourneySource, type SourceReader } from "./journey-service.ts";
import { fetchWeatherBundle, readBoundedWeatherBody } from "./weather-bundle.ts";
import { sharedWeatherBundle, WeatherPendingError, type WeatherCacheMetrics } from "./weather-cache.ts";
import { weatherCacheRpc } from "./weather-cache-rpc.ts";

function configured(name: string): number {
  const limit = Number(Deno.env.get(name));
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("API_BUDGET_NOT_CONFIGURED"); return limit;
}
function sourceReader(client: ReturnType<typeof authenticatedClient>, memberId: string): SourceReader {
  return async source => {
    if (source.kind === "owned") {
      const { data, error } = await client.from("trips").select("reusable_course").eq("id", source.tripId).eq("user_id", memberId).maybeSingle();
      if (error || !data) throw new Error("INVALID_JOURNEY_SOURCE");
      return data.reusable_course;
    }
    const { data, error } = await client.rpc("get_shared_course", { share_token: source.token });
    if (error || !data) throw new Error("INVALID_JOURNEY_SOURCE"); return data;
  };
}

/** Separate route-only endpoint is used for off-route ETA correction without a weather call. */
export async function journeyHandler(request: Request, weather: boolean): Promise<Response> {
  const cors = corsHeaders(request);
  if (!cors) return jsonResponse({ error: "ORIGIN_NOT_ALLOWED" }, 403, {});
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405, cors);
  const metrics: WeatherCacheMetrics[] = [];
  const started = Date.now();
  let outcome = "failed", sampleCount = 0;
  try {
    const member = await requireMember(request);
    // Do not expose a half-configured path to clients before its local/Preview gates and policy activation.
    if (Deno.env.get("JOURNEY_WEATHER_ENABLED") !== "true") throw new Error("JOURNEY_WEATHER_NOT_CONFIGURED");
    let body: unknown;
    try { body = (await readBoundedWeatherBody(new Response(request.body, { headers: request.headers }), 16384)).raw; }
    catch { throw new Error("INVALID_JOURNEY_WEATHER_REQUEST"); }
    const secret = Deno.env.get("PLACE_VERIFICATION_SECRET");
    const routeKey = Deno.env.get("KAKAO_REST_API_KEY");
    const weatherKey = Deno.env.get("KMA_APIHUB_KEY");
    if (!secret || !routeKey || (weather && !weatherKey)) throw new Error("PROVIDER_NOT_CONFIGURED");
    const readSource = sourceReader(member.supabase, member.user.id);
    const result = await calculateJourneyRoute(body, {
      now: Date.now, readSource, verificationSecret: secret,
      routing: { now: Date.now, limitFor: op => configured(op === "future_directions" ? "KAKAO_FUTURE_DAILY_LIMIT" : "KAKAO_CURRENT_DAILY_LIMIT"),
        consumeBudget: (op, limit) => consumeBudget(member.user.id, "kakao", op, limit), requestProvider: input => requestKakaoRoute({ ...input, apiKey: routeKey }) },
    });
    const identity = { schemaVersion: 1, journeyId: result.request.journeyId, requestId: result.request.requestId, routeRevision: result.request.routeRevision };
    if (!weather) { outcome = "ready"; return jsonResponse({ ...identity, route: result.route, timeline: result.timeline }, 200, cors); }
    sampleCount = result.timeline.samples.length;
    const rpc = serviceClient();
    const store = weatherCacheRpc(async (name, args) => await rpc.rpc(name, args), member.user.id, configured("KMA_DAILY_LIMIT"));
    const forecast = await forecastJourneySamples(result.timeline, key => sharedWeatherBundle(key, {
      store, fetch: (k, cap) => fetchWeatherBundle(k, weatherKey!, cap), measure: m => metrics.push(m),
    }), new Date());
    // Recheck access at delivery; source is never part of public forecast cache or diagnostics.
    await requireMember(request); await recheckJourneySource(result, readSource, secret, Date.now());
    outcome = "ready";
    return jsonResponse({ ...identity, route: result.route, timeline: result.timeline, forecasts: forecast.forecasts }, 200, cors);
  } catch (error) {
    outcome = error instanceof WeatherPendingError ? "pending" : "failed";
    if (error instanceof WeatherPendingError) return jsonResponse({ code: "WEATHER_PENDING", error: "날씨 확인 중입니다.", retryAt: new Date(error.retryAt).toISOString() }, 503, cors);
    return jsonResponse({ code: "JOURNEY_REQUEST_FAILED", error: safeErrorMessage(error) }, safeErrorStatus(error), cors);
  } finally {
    // Aggregate-only diagnostics also survive failures; no course, coordinates, keys or bearer.
    console.info("journey metrics", JSON.stringify({ weather, outcome, sampleCount, materialAttempts: metrics.length,
      cacheHits: metrics.reduce((n, m) => n + m.cacheHits, 0), waits: metrics.reduce((n, m) => n + m.waits, 0),
      providerCalls: metrics.reduce((n, m) => n + m.providerCalls, 0), budgetReservations: metrics.reduce((n, m) => n + m.budgetReservations, 0),
      responseBytes: metrics.reduce((n, m) => n + m.responseBytes, 0), durationMs: Date.now() - started }));
  }
}
