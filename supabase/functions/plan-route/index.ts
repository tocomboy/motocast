import { consumeBudget, requireMember } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse, safeErrorMessage } from "../_shared/http.ts";

type Point = {
  name?: string;
  longitude: number;
  latitude: number;
  dwellMinutes?: number;
};

type RouteRequest = {
  origin: Point;
  destination: Point;
  waypoints?: Point[];
  departureAt: string;
  priority?: "RECOMMEND" | "TIME" | "DISTANCE";
};

type KakaoRoute = {
  result_code: number;
  result_msg: string;
  summary: { distance: number; duration: number };
  sections?: Array<{
    distance: number;
    duration: number;
    roads?: Array<{ name: string; distance: number; duration: number; vertexes: number[] }>;
  }>;
};

function limitFromEnv(name: string): number {
  const raw = Deno.env.get(name);
  const value = raw ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value <= 0) throw new Error("API_BUDGET_NOT_CONFIGURED");
  return value;
}

function validPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<Point>;
  return (
    typeof point.longitude === "number" && point.longitude >= 124 && point.longitude <= 132 &&
    typeof point.latitude === "number" && point.latitude >= 32 && point.latitude <= 39.5 &&
    (point.dwellMinutes === undefined || (Number.isInteger(point.dwellMinutes) && point.dwellMinutes >= 0 && point.dwellMinutes <= 1440))
  );
}

function parseRequest(value: unknown): RouteRequest {
  if (!value || typeof value !== "object") throw new Error("INVALID_REQUEST");
  const body = value as Partial<RouteRequest>;
  if (!validPoint(body.origin) || !validPoint(body.destination)) throw new Error("INVALID_POINT");
  if (!Array.isArray(body.waypoints) || !body.waypoints.every(validPoint)) throw new Error("INVALID_WAYPOINTS");
  if (body.waypoints.length > 30) throw new Error("INVALID_WAYPOINTS");
  const departure = new Date(body.departureAt ?? "");
  if (Number.isNaN(departure.getTime())) throw new Error("INVALID_DEPARTURE");
  if (body.priority && !["RECOMMEND", "TIME", "DISTANCE"].includes(body.priority)) throw new Error("INVALID_PRIORITY");
  return {
    origin: body.origin,
    destination: body.destination,
    waypoints: body.waypoints,
    departureAt: departure.toISOString(),
    priority: body.priority ?? "RECOMMEND",
  };
}

function pointParam(point: Point) {
  const safeName = point.name?.replace(/[|,]/g, " ").slice(0, 80).trim();
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

function nextChunk(points: Point[], startIndex: number) {
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

async function requestKakaoRoute(input: {
  origin: Point;
  destination: Point;
  waypoints: Point[];
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
  const data = await response.json() as { routes?: KakaoRoute[] };
  const route = data.routes?.[0];
  if (!route || route.result_code !== 0) throw new Error("SAFE_ROUTE_NOT_FOUND");
  return { route, isFuture };
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (!cors) return jsonResponse({ error: "ORIGIN_NOT_ALLOWED" }, 403, {});
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405, cors);

  try {
    const { supabase } = await requireMember(request);
    const input = parseRequest(await request.json());
    const apiKey = Deno.env.get("KAKAO_REST_API_KEY");
    if (!apiKey) throw new Error("PROVIDER_NOT_CONFIGURED");

    const points = [input.origin, ...(input.waypoints ?? []), input.destination];
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
      const used = await consumeBudget(supabase, "kakao", operation, hardLimit);
      const result = await requestKakaoRoute({
        origin: points[cursor],
        destination: points[endIndex],
        waypoints: via,
        departureAt: departure,
        priority: input.priority,
        apiKey,
      });
      const arrivedAt = new Date(departure.getTime() + result.route.summary.duration * 1000);
      const dwellMinutes = points[endIndex].dwellMinutes ?? 0;
      legs.push({
        from: points[cursor],
        to: points[endIndex],
        via,
        departureAt: departure.toISOString(),
        arrivalAt: arrivedAt.toISOString(),
        dwellMinutes,
        distanceMeters: result.route.summary.distance,
        durationSeconds: result.route.summary.duration,
        sections: result.route.sections ?? [],
        providerRequestNumber: used,
        forecastTraffic: result.isFuture,
      });
      totalDistance += result.route.summary.distance;
      totalDuration += result.route.summary.duration + dwellMinutes * 60;
      departure = new Date(arrivedAt.getTime() + dwellMinutes * 60_000);
      cursor = endIndex;
    }

    return jsonResponse({
      safety: { vehicle: "motorcycle", motorwayExcluded: true, fallbackUsed: false },
      totalDistanceMeters: totalDistance,
      totalDurationSeconds: totalDuration,
      returnAt: departure.toISOString(),
      legs,
    }, 200, cors);
  } catch (error) {
    console.error("plan-route failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ error: safeErrorMessage(error) }, 400, cors);
  }
});
