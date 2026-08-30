import { consumeBudget, requireMember } from "../_shared/auth.ts";
import { executeBudgetedProviderCall } from "../_shared/budgeted-call.ts";
import { corsHeaders, jsonResponse, safeErrorMessage, safeErrorStatus } from "../_shared/http.ts";
import { normalizeKakaoRoutePayload } from "../_shared/kakao-route.ts";
import { parseRouteRequest, type RoutePointRequest, type RouteRequest } from "../_shared/route-request.ts";
import { buildSafeRouteResponse } from "../_shared/route-response.ts";

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

async function requestKakaoRoute(input: {
  origin: RoutePointRequest;
  destination: RoutePointRequest;
  waypoints: RoutePointRequest[];
  departureAt: Date;
  priority: RouteRequest["priority"];
  apiKey: string;
}) {
  const isFuture = input.departureAt.getTime() > Date.now() + 5 * 60_000;
  const endpoint = isFuture ? "future/directions" : "directions";
  const url = new URL(`https://apis-navi.kakaomobility.com/v1/${endpoint}`);
  url.searchParams.set("origin", pointParam(input.origin));
  url.searchParams.set("destination", pointParam(input.destination));
  if (input.waypoints.length) url.searchParams.set("waypoints", input.waypoints.map(pointParam).join("|"));
  if (isFuture) url.searchParams.set("departure_time", futureTime(input.departureAt));
  url.searchParams.set("priority", input.priority ?? "RECOMMEND");
  url.searchParams.set("car_type", "7");
  url.searchParams.set("avoid", "motorway");
  url.searchParams.set("roadevent", "0");
  url.searchParams.set("summary", "false");

  const response = await fetch(url, { headers: { Authorization: `KakaoAK ${input.apiKey}` } });
  if (!response.ok) throw new Error("SAFE_ROUTE_NOT_FOUND");
  const route = normalizeKakaoRoutePayload(await response.json());
  return { route, isFuture };
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (!cors) return jsonResponse({ error: "ORIGIN_NOT_ALLOWED" }, 403, {});
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405, cors);

  try {
    const { supabase } = await requireMember(request);
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

    while (cursor < points.length - 1) {
      const { endIndex, via } = nextChunk(points, cursor);
      const isFuture = departure.getTime() > Date.now() + 5 * 60_000;
      const operation = isFuture ? "future_directions" : "directions";
      const hardLimit = limitFromEnv(isFuture ? "KAKAO_FUTURE_DAILY_LIMIT" : "KAKAO_CURRENT_DAILY_LIMIT");
      const { requestNumber: used, result } = await executeBudgetedProviderCall(
        () => consumeBudget(supabase, "kakao", operation, hardLimit),
        () => requestKakaoRoute({
          origin: points[cursor],
          destination: points[endIndex],
          waypoints: via,
          departureAt: departure,
          priority: input.priority,
          apiKey,
        }),
      );
      const arrivedAt = new Date(departure.getTime() + result.route.summary.duration * 1000);
      const dwellMinutes = points[endIndex].dwellMinutes;
      legs.push({
        from: responsePoint(points[cursor]),
        to: responsePoint(points[endIndex]),
        via: via.map(responsePoint),
        departureAt: departure.toISOString(),
        arrivalAt: arrivedAt.toISOString(),
        dwellMinutes,
        distanceMeters: result.route.summary.distance,
        durationSeconds: result.route.summary.duration,
        sections: result.route.sections.map((section) => ({
          distance: section.distance,
          duration: section.duration,
          roads: section.roads.map((road) => ({
            name: road.name,
            distance: road.distance,
            duration: road.duration,
            vertexes: road.vertexes,
          })),
        })),
        providerRequestNumber: used,
        forecastTraffic: result.isFuture,
      });
      totalDistance += result.route.summary.distance;
      totalDuration += result.route.summary.duration + dwellMinutes * 60;
      departure = new Date(arrivedAt.getTime() + dwellMinutes * 60_000);
      cursor = endIndex;
    }

    return jsonResponse(buildSafeRouteResponse({
      totalDistanceMeters: totalDistance,
      totalDurationSeconds: totalDuration,
      returnAt: departure.toISOString(),
      legs,
    }), 200, cors);
  } catch (error) {
    console.error("plan-route failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ error: safeErrorMessage(error) }, safeErrorStatus(error), cors);
  }
});
