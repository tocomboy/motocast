export type NormalizedKakaoRoute = {
  summary: {
    distance: number;
    duration: number;
    origin: KakaoSummaryPoint;
    destination: KakaoSummaryPoint;
    waypoints: KakaoSummaryPoint[];
  };
  sections: Array<{
    distance: number;
    duration: number;
    roads: Array<{ name: string; distance: number; duration: number; vertexes: number[] }>;
  }>;
};

type KakaoSummaryPoint = { longitude: number; latitude: number };
type RequestedPoint = { longitude: number; latitude: number };

const routeValidationReasons = [
  "JSON_BODY", "OBJECT_SHAPE", "INTEGER_VALUE", "SUMMARY_POINT", "ROAD_VERTEX_SHAPE",
  "ROAD_VERTEX_RANGE", "SECTION_ROADS", "SECTION_DISTANCE_TOTAL", "SECTION_DURATION_TOTAL",
  "ROAD_CONTINUITY", "ROUTES_SHAPE", "RESULT_CODE", "SUMMARY_WAYPOINTS", "ROUTE_SECTIONS",
  "ROUTE_DISTANCE_TOTAL", "ROUTE_DURATION_TOTAL", "REQUEST_POINT_COUNT", "SUMMARY_POINT_SNAP",
  "GEOMETRY_POINT_SNAP", "SECTION_CONTINUITY",
] as const;
type RouteValidationReason = typeof routeValidationReasons[number];
const allowedRouteValidationReasons = new Set<string>(routeValidationReasons);

export class RouteResponseValidationError extends Error {
  constructor(readonly reason: RouteValidationReason) {
    super("INVALID_ROUTE_PROVIDER_RESPONSE");
  }
}

// Only fixed categories leave this module. Never log error objects, payloads,
// coordinates, names, URLs, or provider messages to diagnose a rejected route.
export function routeResponseDiagnostic(error: unknown): RouteValidationReason | "UNKNOWN" {
  if (!(error instanceof RouteResponseValidationError)) return "UNKNOWN";
  const reason = error.reason;
  return allowedRouteValidationReasons.has(reason) ? reason : "UNKNOWN";
}

// Kakao documents result_code 1 as the standard directions response for
// "길찾기 결과를 찾을 수 없음". Other non-zero codes describe bad points,
// road-selection failures, incidents, or endpoint-specific failures and must
// not be presented as proof that no motorcycle-safe route exists.
const KAKAO_NO_ROUTE_RESULT_CODES = new Set([1]);
const ROAD_CONTINUITY_TOLERANCE = 0.0002;
const REQUEST_POINT_SNAP_TOLERANCE = 0.005;

function geometryNear(left: KakaoSummaryPoint, right: KakaoSummaryPoint, tolerance = ROAD_CONTINUITY_TOLERANCE) {
  return Math.abs(left.longitude - right.longitude) <= tolerance && Math.abs(left.latitude - right.latitude) <= tolerance;
}

function roadStart(road: { vertexes: number[] }): KakaoSummaryPoint {
  return { longitude: road.vertexes[0], latitude: road.vertexes[1] };
}

function roadEnd(road: { vertexes: number[] }): KakaoSummaryPoint {
  return { longitude: road.vertexes.at(-2)!, latitude: road.vertexes.at(-1)! };
}

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RouteResponseValidationError("OBJECT_SHAPE");
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, positive: boolean) {
  if (!Number.isInteger(value) || Number(value) < (positive ? 1 : 0)) {
    throw new RouteResponseValidationError("INTEGER_VALUE");
  }
  return Number(value);
}

function summaryPoint(value: unknown): KakaoSummaryPoint {
  const raw = record(value);
  if (
    typeof raw.x !== "number" || !Number.isFinite(raw.x) || raw.x < 124.5 || raw.x > 132 ||
    typeof raw.y !== "number" || !Number.isFinite(raw.y) || raw.y < 32.8 || raw.y > 38.7
  ) throw new RouteResponseValidationError("SUMMARY_POINT");
  return { longitude: raw.x, latitude: raw.y };
}

function normalizeRoad(value: unknown) {
  const raw = record(value);
  if (
    !Array.isArray(raw.vertexes) || raw.vertexes.length < 4 || raw.vertexes.length % 2 !== 0 ||
    !raw.vertexes.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
  ) throw new RouteResponseValidationError("ROAD_VERTEX_SHAPE");
  for (let index = 0; index < raw.vertexes.length; index += 2) {
    const longitude = raw.vertexes[index] as number;
    const latitude = raw.vertexes[index + 1] as number;
    if (longitude < 124.5 || longitude > 132 || latitude < 32.8 || latitude > 38.7) {
      throw new RouteResponseValidationError("ROAD_VERTEX_RANGE");
    }
  }
  return {
    name: typeof raw.name === "string" ? raw.name.slice(0, 200) : "",
    distance: integer(raw.distance, false),
    duration: integer(raw.duration, false),
    vertexes: raw.vertexes as number[],
  };
}

function normalizeSection(value: unknown) {
  const raw = record(value);
  if (!Array.isArray(raw.roads) || raw.roads.length === 0) {
    throw new RouteResponseValidationError("SECTION_ROADS");
  }
  const section = {
    distance: integer(raw.distance, true),
    duration: integer(raw.duration, true),
    roads: raw.roads.map(normalizeRoad),
  };
  if (section.roads.reduce((sum, road) => sum + road.distance, 0) !== section.distance) {
    throw new RouteResponseValidationError("SECTION_DISTANCE_TOTAL");
  }
  if (section.roads.reduce((sum, road) => sum + road.duration, 0) !== section.duration) {
    throw new RouteResponseValidationError("SECTION_DURATION_TOTAL");
  }
  for (let index = 1; index < section.roads.length; index += 1) {
    if (!geometryNear(roadEnd(section.roads[index - 1]), roadStart(section.roads[index]))) {
      throw new RouteResponseValidationError("ROAD_CONTINUITY");
    }
  }
  return section;
}

export function normalizeKakaoRoutesPayload(value: unknown): NormalizedKakaoRoute[] {
  const payload = record(value);
  if (!Array.isArray(payload.routes) || payload.routes.length === 0) {
    throw new RouteResponseValidationError("ROUTES_SHAPE");
  }
  return payload.routes.map((value) => {
    const route = record(value);
    if (!Number.isInteger(route.result_code)) throw new RouteResponseValidationError("RESULT_CODE");
    if (KAKAO_NO_ROUTE_RESULT_CODES.has(Number(route.result_code))) throw new Error("SAFE_ROUTE_NOT_FOUND");
    if (route.result_code !== 0) throw new RouteResponseValidationError("RESULT_CODE");
    const rawSummary = record(route.summary);
    if (!Array.isArray(rawSummary.waypoints)) throw new RouteResponseValidationError("SUMMARY_WAYPOINTS");
    const summary = {
      distance: integer(rawSummary.distance, true),
      duration: integer(rawSummary.duration, true),
      origin: summaryPoint(rawSummary.origin),
      destination: summaryPoint(rawSummary.destination),
      waypoints: rawSummary.waypoints.map(summaryPoint),
    };
    if (!Array.isArray(route.sections) || route.sections.length === 0) {
      throw new RouteResponseValidationError("ROUTE_SECTIONS");
    }
    const sections = route.sections.map(normalizeSection);
    if (sections.reduce((sum, section) => sum + section.distance, 0) !== summary.distance) {
      throw new RouteResponseValidationError("ROUTE_DISTANCE_TOTAL");
    }
    if (sections.reduce((sum, section) => sum + section.duration, 0) !== summary.duration) {
      throw new RouteResponseValidationError("ROUTE_DURATION_TOTAL");
    }
    return { summary, sections };
  });
}

function near(left: KakaoSummaryPoint, right: RequestedPoint) {
  return geometryNear(left, right, REQUEST_POINT_SNAP_TOLERANCE);
}

function sectionEndpoints(section: NormalizedKakaoRoute["sections"][number]) {
  const first = section.roads[0].vertexes;
  const last = section.roads.at(-1)!.vertexes;
  return {
    start: { longitude: first[0], latitude: first[1] },
    end: { longitude: last.at(-2)!, latitude: last.at(-1)! },
  };
}

export function assertKakaoRouteMatchesPoints(route: NormalizedKakaoRoute, points: RequestedPoint[]) {
  if (points.length < 2 || route.sections.length !== points.length - 1 || route.summary.waypoints.length !== points.length - 2) {
    throw new RouteResponseValidationError("REQUEST_POINT_COUNT");
  }
  const summarized = [route.summary.origin, ...route.summary.waypoints, route.summary.destination];
  for (let index = 0; index < points.length; index += 1) {
    if (!near(summarized[index], points[index])) throw new RouteResponseValidationError("SUMMARY_POINT_SNAP");
  }
  for (let index = 0; index < route.sections.length; index += 1) {
    const endpoints = sectionEndpoints(route.sections[index]);
    if (!near(endpoints.start, points[index]) || !near(endpoints.end, points[index + 1])) {
      throw new RouteResponseValidationError("GEOMETRY_POINT_SNAP");
    }
  }
  assertKakaoSectionsContinuous(route.sections);
}

export function assertKakaoSectionsContinuous(sections: NormalizedKakaoRoute["sections"]) {
  for (let index = 1; index < sections.length; index += 1) {
    const previous = sectionEndpoints(sections[index - 1]);
    const current = sectionEndpoints(sections[index]);
    if (!geometryNear(previous.end, current.start)) throw new RouteResponseValidationError("SECTION_CONTINUITY");
  }
}

export function normalizeKakaoRoutePayload(value: unknown): NormalizedKakaoRoute {
  return normalizeKakaoRoutesPayload(value)[0];
}
