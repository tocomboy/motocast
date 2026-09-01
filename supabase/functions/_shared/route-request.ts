import { verifyPlace, type VerifiablePlace } from "./place-verification.ts";
import { isStrictCalendarDate, parseStrictRfc3339, seoulCalendarDate } from "./strict-time.ts";

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
  stopRole?: "lunch" | "dinner" | "rest";
};

export type RouteRequest = {
  planningId: string;
  tripId: string | null;
  origin: RoutePointRequest;
  destination: RoutePointRequest;
  waypoints: RoutePointRequest[];
  serviceDate: string;
  departureAt: string;
};

export function isWindingOnlyWaypoint(point: Pick<RoutePointRequest, "kind" | "dwellMinutes" | "winding" | "stopRole">) {
  return point.winding === true && point.kind === "pass-through" && point.dwellMinutes === 0 && point.stopRole === undefined;
}

function hasValidWindingSemantics(point: Pick<RoutePointRequest, "kind" | "dwellMinutes" | "winding" | "stopRole">) {
  return point.winding !== true || isWindingOnlyWaypoint(point);
}

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
    (point.stopRole === undefined || ["lunch", "dinner", "rest"].includes(point.stopRole)) &&
    typeof point.dwellMinutes === "number" && Number.isInteger(point.dwellMinutes) &&
    point.dwellMinutes >= 0 && point.dwellMinutes <= 1440 &&
    hasValidWindingSemantics(point as Pick<RoutePointRequest, "kind" | "dwellMinutes" | "winding" | "stopRole">)
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
    winding: endpoint ? false : point.winding === true,
    stopRole: endpoint ? undefined : point.stopRole,
  };
}

export async function parseRouteRequest(value: unknown, verificationSecret: string): Promise<RouteRequest> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_REQUEST");
  const body = value as Partial<RouteRequest>;
  if (!validPoint(body.origin) || !validPoint(body.destination)) throw new Error("INVALID_POINT");
  if (!Array.isArray(body.waypoints) || !body.waypoints.every(validPoint) || body.waypoints.length > 30) {
    throw new Error("INVALID_WAYPOINTS");
  }
  const departure = parseStrictRfc3339(body.departureAt);
  if (!departure) throw new Error("INVALID_ROUTE_TIME");
  if (
    !isStrictCalendarDate(body.serviceDate) ||
    seoulCalendarDate(departure) !== body.serviceDate
  ) throw new Error("INVALID_ROUTE_TIME");
  const policyFields = value as Record<string, unknown>;
  if (["candidate", "priority", "alternatives", "car_type", "avoid", "roadevent", "summary"].some((key) => key in policyFields)) {
    throw new Error("CLIENT_ROUTE_POLICY_FORBIDDEN");
  }
  if (typeof body.planningId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.planningId)) {
    throw new Error("INVALID_PLANNING_ID");
  }
  if (body.tripId !== undefined && body.tripId !== null && (
    typeof body.tripId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.tripId)
  )) throw new Error("INVALID_TRIP_ID");

  const selectedWaypoints = body.waypoints.filter((point) => point.selected);
  if (selectedWaypoints.some((point) => (
    (point.kind === "stop" || point.kind === "optional") && point.dwellMinutes <= 0
  ))) throw new Error("INVALID_WAYPOINTS");
  const lunches = selectedWaypoints.filter((point) => point.stopRole === "lunch");
  const dinners = selectedWaypoints.filter((point) => point.stopRole === "dinner");
  const rests = selectedWaypoints.filter((point) => point.stopRole === "rest");
  const windingPoints = selectedWaypoints.filter((point) => point.winding === true);
  if (
    lunches.length !== 1 || lunches[0].kind !== "stop" ||
    dinners.length > 1 || dinners.some((point) => point.kind !== "stop") ||
    rests.length > 1 || rests.some((point) => point.kind !== "optional") ||
    windingPoints.length > 20 ||
    selectedWaypoints.some((point) => point.kind !== "pass-through" && point.stopRole === undefined)
  ) throw new Error("INVALID_WAYPOINTS");

  const points = [body.origin, ...selectedWaypoints, body.destination];
  const verified = await Promise.all(points.map((point) => (
    verifyPlace(point, point.verificationToken, verificationSecret)
  )));
  if (verified.some((result) => !result)) throw new Error("UNVERIFIED_PLACE");

  return {
    planningId: body.planningId,
    tripId: body.tripId ?? null,
    origin: canonicalPoint(body.origin, true),
    destination: canonicalPoint(body.destination, true),
    waypoints: selectedWaypoints.map((point) => canonicalPoint(point)),
    serviceDate: body.serviceDate,
    departureAt: departure.toISOString(),
  };
}
