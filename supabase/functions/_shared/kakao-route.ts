export type NormalizedKakaoRoute = {
  summary: { distance: number; duration: number };
  sections: Array<{
    distance: number;
    duration: number;
    roads: Array<{ name: string; distance: number; duration: number; vertexes: number[] }>;
  }>;
};

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_ROUTE_PROVIDER_RESPONSE");
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, positive: boolean) {
  if (!Number.isInteger(value) || Number(value) < (positive ? 1 : 0)) {
    throw new Error("INVALID_ROUTE_PROVIDER_RESPONSE");
  }
  return Number(value);
}

function normalizeRoad(value: unknown) {
  const raw = record(value);
  if (
    !Array.isArray(raw.vertexes) || raw.vertexes.length < 4 || raw.vertexes.length % 2 !== 0 ||
    !raw.vertexes.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
  ) throw new Error("INVALID_ROUTE_PROVIDER_RESPONSE");
  for (let index = 0; index < raw.vertexes.length; index += 2) {
    const longitude = raw.vertexes[index] as number;
    const latitude = raw.vertexes[index + 1] as number;
    if (longitude < 124.5 || longitude > 132 || latitude < 32.8 || latitude > 38.7) {
      throw new Error("INVALID_ROUTE_PROVIDER_RESPONSE");
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
    throw new Error("INVALID_ROUTE_PROVIDER_RESPONSE");
  }
  const section = {
    distance: integer(raw.distance, true),
    duration: integer(raw.duration, true),
    roads: raw.roads.map(normalizeRoad),
  };
  if (
    section.roads.reduce((sum, road) => sum + road.distance, 0) !== section.distance ||
    section.roads.reduce((sum, road) => sum + road.duration, 0) !== section.duration
  ) throw new Error("INVALID_ROUTE_PROVIDER_RESPONSE");
  return section;
}

export function normalizeKakaoRoutesPayload(value: unknown): NormalizedKakaoRoute[] {
  const payload = record(value);
  if (!Array.isArray(payload.routes) || payload.routes.length === 0) {
    throw new Error("SAFE_ROUTE_NOT_FOUND");
  }
  return payload.routes.map((value) => {
    const route = record(value);
    if (route.result_code !== 0) throw new Error("SAFE_ROUTE_NOT_FOUND");
    const rawSummary = record(route.summary);
    const summary = {
      distance: integer(rawSummary.distance, true),
      duration: integer(rawSummary.duration, true),
    };
    if (!Array.isArray(route.sections) || route.sections.length === 0) {
      throw new Error("INVALID_ROUTE_PROVIDER_RESPONSE");
    }
    const sections = route.sections.map(normalizeSection);
    if (
      sections.reduce((sum, section) => sum + section.distance, 0) !== summary.distance ||
      sections.reduce((sum, section) => sum + section.duration, 0) !== summary.duration
    ) throw new Error("INVALID_ROUTE_PROVIDER_RESPONSE");
    return { summary, sections };
  });
}

export function normalizeKakaoRoutePayload(value: unknown): NormalizedKakaoRoute {
  return normalizeKakaoRoutesPayload(value)[0];
}
