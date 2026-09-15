import { consumeBudget, requireMember, serviceClient } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse, safeErrorCode, safeErrorMessage, safeErrorStatus } from "../_shared/http.ts";
import { requestKakaoRoute } from "../_shared/kakao-provider.ts";
import { routeRequestDiagnostic, routeResponseDiagnostic } from "../_shared/kakao-route.ts";
import { orchestrateRecommendedRoute } from "../_shared/route-orchestration.ts";
import { legacyScheduleBoundary } from "../_shared/route-deadline.ts";
import { withValidatedRouteRequest, type RoutePointRequest } from "../_shared/route-request.ts";
import { buildSafeRouteResponse } from "../_shared/route-response.ts";

function limitFromEnv(name: string): number {
  const raw = Deno.env.get(name);
  const value = raw ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value <= 0) throw new Error("API_BUDGET_NOT_CONFIGURED");
  return value;
}

function storagePoint(point: RoutePointRequest) {
  return {
    id: point.id,
    label: point.label,
    kakaoPlaceId: point.kakaoPlaceId,
    name: point.name,
    address: point.address,
    roadAddress: point.roadAddress,
    longitude: point.longitude,
    latitude: point.latitude,
    kind: point.kind,
    dwellMinutes: point.dwellMinutes,
    selected: point.selected,
    winding: point.winding === true,
    ...(point.stopRole ? { stopRole: point.stopRole } : {}),
  };
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (!cors) return jsonResponse({ error: "ORIGIN_NOT_ALLOWED" }, 403, {});
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405, cors);

  try {
    const { supabase, user } = await requireMember(request);
    const verificationSecret = Deno.env.get("PLACE_VERIFICATION_SECRET");
    if (!verificationSecret) throw new Error("PLACE_VERIFICATION_NOT_CONFIGURED");
    const route = await withValidatedRouteRequest(await request.json(), verificationSecret, async (input) => {
      const targetRevision = input.tripId ? await (async () => {
        const { data, error } = await supabase
          .from("trips")
          .select("updated_at")
          .eq("id", input.tripId)
          .maybeSingle();
        if (error || !data || typeof data.updated_at !== "string") throw new Error("INVALID_TRIP_TARGET");
        return data.updated_at;
      })() : null;
      const apiKey = Deno.env.get("KAKAO_REST_API_KEY");
      if (!apiKey) throw new Error("PROVIDER_NOT_CONFIGURED");

      const points = [input.origin, ...input.waypoints, input.destination];
      const journey = await orchestrateRecommendedRoute(points, input.departureAt, {
        now: Date.now,
        limitFor: (operation) => limitFromEnv(
          operation === "future_directions" ? "KAKAO_FUTURE_DAILY_LIMIT" : "KAKAO_CURRENT_DAILY_LIMIT"
        ),
        consumeBudget: (operation, hardLimit) => consumeBudget(user.id, "kakao", operation, hardLimit),
        requestProvider: (chunk) => requestKakaoRoute({ ...chunk, apiKey }),
      });

      const safeRoute = buildSafeRouteResponse({
        candidate: { id: "recommended", label: "추천 경로", estimatedWinding: false },
        ...journey,
      });
      const lunchStop = input.waypoints.find((point) => point.stopRole === "lunch") ?? null;
      const dinnerStop = input.waypoints.find((point) => point.stopRole === "dinner") ?? null;
      const legacyBoundary = legacyScheduleBoundary(input.departureAt);
      const stagedPlan = {
        title: `${input.origin.name} → ${input.destination.name}`,
        serviceDate: input.serviceDate,
        departureAt: input.departureAt,
        // Compatibility only: the legacy persistence function still requires these
        // undisplayed fields. Route eligibility is governed by the computed returnAt.
        desiredReturnAt: legacyBoundary,
        hardReturnAt: legacyBoundary,
        tripId: input.tripId,
        targetUpdatedAt: targetRevision,
        origin: storagePoint(input.origin),
        destination: storagePoint(input.destination),
        lunchStop: lunchStop ? storagePoint(lunchStop) : null,
        dinnerStop: dinnerStop ? storagePoint(dinnerStop) : null,
        waypoints: input.waypoints.map(storagePoint),
        selectedProfile: "recommended",
      };
      const { error: stageError } = await serviceClient().rpc("stage_route_candidate_internal", {
        member_id: user.id,
        target_planning_id: input.planningId,
        staged_plan: stagedPlan,
        staged_route: safeRoute,
      });
      if (stageError) throw new Error("ROUTE_PERSIST_FAILED");
      return safeRoute;
    });

    return jsonResponse(route, 200, cors);
  } catch (error) {
    console.error("plan-route failed", safeErrorCode(error), routeResponseDiagnostic(error), routeRequestDiagnostic(error));
    return jsonResponse({ error: safeErrorMessage(error), code: safeErrorCode(error) }, safeErrorStatus(error), cors);
  }
});
