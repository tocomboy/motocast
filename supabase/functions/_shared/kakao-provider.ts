import { assertKakaoRouteMatchesPoints, normalizeKakaoRoutesPayload } from "./kakao-route.ts";
import { applyMotorcycleRoutePolicy } from "./kakao-safety.ts";
import type { RoutePointRequest } from "./route-request.ts";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type KakaoRouteRequest = {
  origin: RoutePointRequest;
  destination: RoutePointRequest;
  waypoints: RoutePointRequest[];
  departureAt: Date;
  isFuture: boolean;
  apiKey: string;
};

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

export async function requestKakaoRoute(input: KakaoRouteRequest, fetchImpl: FetchLike = fetch) {
  const endpoint = input.isFuture ? "future/directions" : "directions";
  const url = new URL(`https://apis-navi.kakaomobility.com/v1/${endpoint}`);
  url.searchParams.set("origin", pointParam(input.origin));
  url.searchParams.set("destination", pointParam(input.destination));
  if (input.waypoints.length) url.searchParams.set("waypoints", input.waypoints.map(pointParam).join("|"));
  if (input.isFuture) url.searchParams.set("departure_time", futureTime(input.departureAt));
  applyMotorcycleRoutePolicy(url);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `KakaoAK ${input.apiKey}` },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new Error("PROVIDER_UNAVAILABLE");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("PROVIDER_AUTH_FAILED");
    if (response.status === 429) throw new Error("PROVIDER_RATE_LIMITED");
    if (response.status === 408 || response.status >= 500) throw new Error("PROVIDER_UNAVAILABLE");
    throw new Error("PROVIDER_REQUEST_REJECTED");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("INVALID_ROUTE_PROVIDER_RESPONSE");
  }
  const routes = normalizeKakaoRoutesPayload(payload);
  const requestedPoints = [input.origin, ...input.waypoints, input.destination];
  routes.forEach((route) => assertKakaoRouteMatchesPoints(route, requestedPoints));
  const route = routes[0];
  if (!route) throw new Error("SAFE_ROUTE_NOT_FOUND");
  return route;
}
