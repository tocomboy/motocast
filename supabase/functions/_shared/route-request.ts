import { verifyPlace, type VerifiablePlace } from "./place-verification.ts";
import { parseStrictRfc3339 } from "./strict-time.ts";

export type RoutePointRequest = VerifiablePlace & {
  id: string;
  label: string;
  kind: "pass-through" | "stop" | "optional";
  longitude: number;
  latitude: number;
  verificationToken: string;
  dwellMinutes: number;
  selected: boolean;
  winding?: boolean;
};

export type RouteRequest = {
  origin: RoutePointRequest;
  destination: RoutePointRequest;
  waypoints: RoutePointRequest[];
  departureAt: string;
  priority: "RECOMMEND" | "TIME" | "DISTANCE";
};

function validPoint(value: unknown): value is RoutePointRequest {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<RoutePointRequest>;
  return (
    typeof point.longitude === "number" && Number.isFinite(point.longitude) && point.longitude >= 124.5 && point.longitude <= 132 &&
    typeof point.latitude === "number" && Number.isFinite(point.latitude) && point.latitude >= 32.8 && point.latitude <= 38.7 &&
    typeof point.id === "string" && point.id.length > 0 && point.id.length <= 100 &&
    typeof point.label === "string" && point.label.trim().length > 0 && point.label.length <= 160 &&
    typeof point.kakaoPlaceId === "string" && point.kakaoPlaceId.length > 0 && point.kakaoPlaceId.length <= 80 &&
    typeof point.verificationToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(point.verificationToken) &&
    typeof point.name === "string" && point.name.trim().length > 0 && point.name.length <= 160 &&
    typeof point.address === "string" && point.address.trim().length > 0 && point.address.length <= 300 &&
    (point.roadAddress === null || (typeof point.roadAddress === "string" && point.roadAddress.length <= 300)) &&
    ["pass-through", "stop", "optional"].includes(String(point.kind)) &&
    typeof point.selected === "boolean" &&
    (point.winding === undefined || typeof point.winding === "boolean") &&
    typeof point.dwellMinutes === "number" && Number.isInteger(point.dwellMinutes) &&
    point.dwellMinutes >= 0 && point.dwellMinutes <= 1440
  );
}

function canonicalPoint(point: RoutePointRequest, endpoint = false): RoutePointRequest {
  const passThrough = endpoint || point.kind === "pass-through";
  return {
    ...point,
    id: point.kakaoPlaceId,
    label: point.name,
    kind: endpoint ? "pass-through" : point.kind,
    dwellMinutes: passThrough ? 0 : point.dwellMinutes,
    selected: true,
  };
}

export async function parseRouteRequest(value: unknown, verificationSecret: string): Promise<RouteRequest> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_REQUEST");
  const body = value as Partial<RouteRequest>;
  if (!validPoint(body.origin) || !validPoint(body.destination)) throw new Error("INVALID_POINT");
  if (!Array.isArray(body.waypoints) || !body.waypoints.every(validPoint) || body.waypoints.length > 30) {
    throw new Error("INVALID_WAYPOINTS");
  }
  if (body.priority && !["RECOMMEND", "TIME", "DISTANCE"].includes(body.priority)) {
    throw new Error("INVALID_PRIORITY");
  }
  const departure = parseStrictRfc3339(body.departureAt);
  if (!departure) throw new Error("INVALID_DEPARTURE");

  const selectedWaypoints = body.waypoints.filter((point) => point.kind !== "optional" || point.selected);
  if (selectedWaypoints.some((point) => (
    (point.kind !== "optional" && !point.selected) ||
    ((point.kind === "stop" || point.kind === "optional") && point.dwellMinutes <= 0)
  ))) throw new Error("INVALID_WAYPOINTS");

  const points = [body.origin, ...selectedWaypoints, body.destination];
  const verified = await Promise.all(points.map((point) => (
    verifyPlace(point, point.verificationToken, verificationSecret)
  )));
  if (verified.some((result) => !result)) throw new Error("UNVERIFIED_PLACE");

  return {
    origin: canonicalPoint(body.origin, true),
    destination: canonicalPoint(body.destination, true),
    waypoints: selectedWaypoints.map((point) => canonicalPoint(point)),
    departureAt: departure.toISOString(),
    priority: body.priority ?? "RECOMMEND",
  };
}
