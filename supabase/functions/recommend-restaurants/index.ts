import { consumeBudget, requireMember } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import { requestKakaoRoute } from "../_shared/kakao-provider.ts";
import { mealTargets, parseRecommendationRequest } from "../_shared/restaurant-recommendation-request.ts";
import {
  prepareStoredRoute,
  recommendationDiagnostic,
  recommendationFailure,
  recommendRestaurants,
} from "../_shared/restaurant-recommendation.ts";

const SAVED_RESTAURANT_READ_LIMIT = 1000;

function limitFromEnv(name: string): number {
  const raw = Deno.env.get(name);
  const value = raw ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value <= 0) throw new Error("API_BUDGET_NOT_CONFIGURED");
  return value;
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (!cors) return jsonResponse({ error: "ORIGIN_NOT_ALLOWED", code: "ORIGIN_NOT_ALLOWED" }, 403, {});
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED", code: "METHOD_NOT_ALLOWED" }, 405, cors);

  try {
    const { supabase, user } = await requireMember(request);
    const input = parseRecommendationRequest(await request.json());
    const targets = mealTargets(input);

    // Owner RLS reads with the member JWT client; no service-role data access.
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id")
      .eq("id", input.tripId)
      .maybeSingle();
    if (tripError) throw new Error("RECOMMENDATION_STORAGE_FAILED");
    if (!trip) throw new Error("RECOMMENDATION_ROUTE_STALE");
    const { data: cached, error: cacheError } = await supabase
      .from("route_cache")
      .select("summary")
      .eq("trip_id", input.tripId)
      .eq("profile", "recommended")
      .maybeSingle();
    if (cacheError) throw new Error("RECOMMENDATION_STORAGE_FAILED");
    if (!cached) throw new Error("RECOMMENDATION_ROUTE_STALE");
    const route = prepareStoredRoute(input, cached.summary);

    const { data: savedRows, error: savedError } = await supabase
      .from("saved_places")
      .select("id,place,alias,revision")
      .eq("owner_id", user.id)
      .eq("kind", "restaurant")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(SAVED_RESTAURANT_READ_LIMIT);
    if (savedError || !Array.isArray(savedRows)) throw new Error("RECOMMENDATION_STORAGE_FAILED");

    // Configuration is checked only when a provider call is about to be budgeted,
    // so requests that need no routing (e.g. no saved restaurants) still succeed.
    const apiKey = () => {
      const value = Deno.env.get("KAKAO_REST_API_KEY");
      if (!value) throw new Error("PROVIDER_NOT_CONFIGURED");
      return value;
    };
    const result = await recommendRestaurants({ request: input, targets, route, savedRows }, {
      now: Date.now,
      limitFor: (operation) => {
        apiKey();
        return limitFromEnv(operation === "future_directions" ? "KAKAO_FUTURE_DAILY_LIMIT" : "KAKAO_CURRENT_DAILY_LIMIT");
      },
      consumeBudget: (operation, hardLimit) => consumeBudget(user.id, "kakao", operation, hardLimit),
      requestProvider: (chunk) => requestKakaoRoute({ ...chunk, apiKey: apiKey() }),
    });

    const { coverage } = result;
    console.info(
      "recommend-restaurants completed",
      result.status,
      `saved=${coverage.savedRestaurants}`,
      `invalid=${coverage.invalidSaved}`,
      `inRoute=${coverage.alreadyInRoute}`,
      `near=${coverage.nearRoute}`,
      `evaluated=${coverage.evaluated}`,
      `unreachable=${coverage.unreachable}`,
      `notEvaluated=${coverage.notEvaluated}`,
      `requests=${coverage.providerRequests}`,
      `pairs=${result.pairs.length}`,
      `candidates=${result.meals.map((meal) => meal.candidates.length).join("/")}`,
    );
    return jsonResponse(result, 200, cors);
  } catch (error) {
    const failure = recommendationFailure(error);
    console.error("recommend-restaurants failed", failure.code, recommendationDiagnostic(error));
    return jsonResponse({ error: failure.message, code: failure.code }, failure.status, cors);
  }
});
