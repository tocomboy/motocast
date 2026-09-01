import { consumeBudget, requireMember, serviceClient } from "../_shared/auth.ts";
import { executeBudgetedProviderCall } from "../_shared/budgeted-call.ts";
import { corsHeaders, jsonResponse, safeErrorCode, safeErrorMessage, safeErrorStatus } from "../_shared/http.ts";
import { requestKakaoRoute } from "../_shared/kakao-provider.ts";
import { assertKakaoSectionsContinuous, type NormalizedKakaoRoute } from "../_shared/kakao-route.ts";
import { assertRideUnder24Hours, legacyScheduleBoundary } from "../_shared/route-deadline.ts";
import { parseRouteRequest, type RoutePointRequest } from "../_shared/route-request.ts";
import { buildSafeRouteResponse } from "../_shared/route-response.ts";

function limitFromEnv(name: string): number {
  const raw = Deno.env.get(name);
  const value = raw ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value <= 0) throw new Error("API_BUDGET_NOT_CONFIGURED");
  return value;
}

function nextChunk(points: RoutePointRequest[], startIndex: number) {
  const furthest = Math.min(startIndex + 6, points.length - 1);
  let endIndex = furthest;
  for (let index = startIndex + 1; index <= furthest; index += 1) {
    if ((points[index].dwellMinutes ?? 0) > 0) {
      endIndex = index;
      break;
    }
  }
  return { endIndex, via: points.slice(startIndex + 1, endIndex) };
}

function responsePoint(point: RoutePointRequest) {
  return {
    id: point.id,
    label: point.label,
    longitude: point.longitude,
    latitude: point.latitude,
    kind: point.kind,
    dwellMinutes: point.dwellMinutes,
    selected: point.selected,
    winding: point.winding,
  };
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
    const { user } = await requireMember(request);
    const verificationSecret = Deno.env.get("PLACE_VERIFICATION_SECRET");
    if (!verificationSecret) throw new Error("PLACE_VERIFICATION_NOT_CONFIGURED");
    const input = await parseRouteRequest(await request.json(), verificationSecret);
    const apiKey = Deno.env.get("KAKAO_REST_API_KEY");
    if (!apiKey) throw new Error("PROVIDER_NOT_CONFIGURED");

    const points = [input.origin, ...input.waypoints, input.destination];
    const legs = [];
    let cursor = 0;
    let departure = new Date(input.departureAt);
    let totalDistance = 0;
    let totalDuration = 0;
    const acceptedSections: NormalizedKakaoRoute["sections"] = [];

    while (cursor < points.length - 1) {
      const { endIndex, via } = nextChunk(points, cursor);
      const isFuture = departure.getTime() > Date.now() + 5 * 60_000;
      const operation = isFuture ? "future_directions" : "directions";
      const hardLimit = limitFromEnv(isFuture ? "KAKAO_FUTURE_DAILY_LIMIT" : "KAKAO_CURRENT_DAILY_LIMIT");
      const providerInput = {
        origin: points[cursor],
        destination: points[endIndex],
        waypoints: via,
        departureAt: departure,
        isFuture,
        apiKey,
      };
      const selected = await executeBudgetedProviderCall(
        () => consumeBudget(user.id, "kakao", operation, hardLimit),
        () => requestKakaoRoute(providerInput),
      );
      const chunkPoints = [points[cursor], ...via, points[endIndex]];
      for (let index = 0; index < selected.result.sections.length; index += 1) {
        const section = selected.result.sections[index];
        acceptedSections.push(section);
        const from = chunkPoints[index];
        const to = chunkPoints[index + 1];
        const arrivedAt = new Date(departure.getTime() + section.duration * 1000);
        const dwellMinutes = to.dwellMinutes;
        legs.push({
          from: responsePoint(from),
          to: responsePoint(to),
          via: [],
          departureAt: departure.toISOString(),
          arrivalAt: arrivedAt.toISOString(),
          dwellMinutes,
          distanceMeters: section.distance,
          durationSeconds: section.duration,
          sections: [{
            distance: section.distance,
            duration: section.duration,
            roads: section.roads.map((road) => ({
              name: road.name,
              distance: road.distance,
              duration: road.duration,
              vertexes: road.vertexes,
            })),
          }],
          providerRequestNumber: selected.requestNumber,
          forecastTraffic: isFuture,
        });
        totalDistance += section.distance;
        totalDuration += section.duration + dwellMinutes * 60;
        departure = new Date(arrivedAt.getTime() + dwellMinutes * 60_000);
      }
      cursor = endIndex;
    }

    assertKakaoSectionsContinuous(acceptedSections);
    assertRideUnder24Hours(input.departureAt, departure.toISOString());

    const route = buildSafeRouteResponse({
      candidate: { id: "recommended", label: "추천 경로", estimatedWinding: false },
      totalDistanceMeters: totalDistance,
      totalDurationSeconds: totalDuration,
      returnAt: departure.toISOString(),
      legs,
    });
    const lunchStop = input.waypoints.find((point) => point.stopRole === "lunch")!;
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
      origin: storagePoint(input.origin),
      destination: storagePoint(input.destination),
      lunchStop: storagePoint(lunchStop),
      dinnerStop: dinnerStop ? storagePoint(dinnerStop) : null,
      waypoints: input.waypoints.map(storagePoint),
      selectedProfile: "recommended",
    };
    const { error: stageError } = await serviceClient().rpc("stage_route_candidate_internal", {
      member_id: user.id,
      target_planning_id: input.planningId,
      staged_plan: stagedPlan,
      staged_route: route,
    });
    if (stageError) throw new Error("ROUTE_PERSIST_FAILED");

    return jsonResponse(route, 200, cors);
  } catch (error) {
    console.error("plan-route failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ error: safeErrorMessage(error), code: safeErrorCode(error) }, safeErrorStatus(error), cors);
  }
});
