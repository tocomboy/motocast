import { consumeBudget, requireMember, serviceClient } from "../_shared/auth.ts";
import { executeBudgetedProviderCall } from "../_shared/budgeted-call.ts";
import { candidatePolicy } from "../_shared/candidate-policy.ts";
import { corsHeaders, jsonResponse, safeErrorMessage, safeErrorStatus } from "../_shared/http.ts";
import { assertKakaoRouteMatchesPoints, assertKakaoSectionsContinuous, normalizeKakaoRoutesPayload, type NormalizedKakaoRoute } from "../_shared/kakao-route.ts";
import { applyMotorcycleRoutePolicy } from "../_shared/kakao-safety.ts";
import { assertWithinHardReturn } from "../_shared/route-deadline.ts";
import { parseRouteRequest, type RoutePointRequest } from "../_shared/route-request.ts";
import { buildSafeRouteResponse } from "../_shared/route-response.ts";
import { routeFingerprint, selectEstimatedWindingRoute } from "../_shared/winding.ts";

function limitFromEnv(name: string): number {
  const raw = Deno.env.get(name);
  const value = raw ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value <= 0) throw new Error("API_BUDGET_NOT_CONFIGURED");
  return value;
}

function pointParam(point: RoutePointRequest) {
  const safeName = point.name.replace(/[|,]/g, " ").slice(0, 80).trim();
  return `${point.longitude},${point.latitude}${safeName ? `,name=${safeName}` : ""}`;
}

function futureTime(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
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

async function requestKakaoRoute(input: {
  origin: RoutePointRequest;
  destination: RoutePointRequest;
  waypoints: RoutePointRequest[];
  departureAt: Date;
  isFuture: boolean;
  priority: "RECOMMEND" | "DISTANCE";
  requestAlternatives: boolean;
  excludedFingerprints?: Set<string>;
  apiKey: string;
}) {
  const endpoint = input.isFuture ? "future/directions" : "directions";
  const url = new URL(`https://apis-navi.kakaomobility.com/v1/${endpoint}`);
  url.searchParams.set("origin", pointParam(input.origin));
  url.searchParams.set("destination", pointParam(input.destination));
  if (input.waypoints.length) url.searchParams.set("waypoints", input.waypoints.map(pointParam).join("|"));
  if (input.isFuture) url.searchParams.set("departure_time", futureTime(input.departureAt));
  applyMotorcycleRoutePolicy(url, input.priority, input.requestAlternatives);

  const response = await fetch(url, {
    headers: { Authorization: `KakaoAK ${input.apiKey}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("PROVIDER_AUTH_FAILED");
    if (response.status === 429) throw new Error("PROVIDER_RATE_LIMITED");
    if (response.status >= 500) throw new Error("PROVIDER_UNAVAILABLE");
    throw new Error("SAFE_ROUTE_NOT_FOUND");
  }
  const routes = normalizeKakaoRoutesPayload(await response.json());
  const requestedPoints = [input.origin, ...input.waypoints, input.destination];
  routes.forEach((route) => assertKakaoRouteMatchesPoints(route, requestedPoints));
  const route = input.requestAlternatives
    ? selectEstimatedWindingRoute(routes, input.excludedFingerprints ?? new Set())
    : routes[0];
  if (!route) throw new Error("SAFE_ROUTE_NOT_FOUND");
  return route;
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

    const policy = candidatePolicy(input);
    const points = policy.points;
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
      const providerCall = (requestAlternatives: boolean, excludedFingerprints?: Set<string>) => executeBudgetedProviderCall(
        () => consumeBudget(user.id, "kakao", operation, hardLimit),
        () => requestKakaoRoute({
          origin: points[cursor],
          destination: points[endIndex],
          waypoints: via,
          departureAt: departure,
          isFuture,
          priority: policy.priority,
          requestAlternatives,
          excludedFingerprints,
          apiKey,
        }),
      );
      let selected;
      if (policy.requestAlternatives) {
        const baseline = await providerCall(false);
        selected = await providerCall(true, new Set([routeFingerprint(baseline.result)]));
      } else {
        selected = await providerCall(false);
      }
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
    assertWithinHardReturn(departure.toISOString(), input.hardReturnAt);

    const route = buildSafeRouteResponse({
      candidate: policy.metadata,
      totalDistanceMeters: totalDistance,
      totalDurationSeconds: totalDuration,
      returnAt: departure.toISOString(),
      legs,
    });
    const lunchStop = input.waypoints.find((point) => point.stopRole === "lunch")!;
    const dinnerStop = input.waypoints.find((point) => point.stopRole === "dinner") ?? null;
    const stagedPlan = {
      title: `${input.origin.name} → ${input.destination.name}`,
      serviceDate: input.serviceDate,
      departureAt: input.departureAt,
      desiredReturnAt: input.desiredReturnAt,
      hardReturnAt: input.hardReturnAt,
      origin: storagePoint(input.origin),
      destination: storagePoint(input.destination),
      lunchStop: storagePoint(lunchStop),
      dinnerStop: dinnerStop ? storagePoint(dinnerStop) : null,
      waypoints: input.waypoints.map(storagePoint),
      selectedProfile: "balanced",
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
    return jsonResponse({ error: safeErrorMessage(error) }, safeErrorStatus(error), cors);
  }
});
