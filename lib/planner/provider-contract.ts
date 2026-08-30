import type { RoutePoint } from "./types";

export type SafeRouteLeg = {
  from: RoutePoint;
  to: RoutePoint;
  via: RoutePoint[];
  departureAt: string;
  arrivalAt: string;
  dwellMinutes: number;
  distanceMeters: number;
  durationSeconds: number;
  sections: Array<{
    distance: number;
    duration: number;
    roads: Array<{ name: string; distance: number; duration: number; vertexes: number[] }>;
  }>;
  forecastTraffic: boolean;
};

export type SafeRouteResponse = {
  safety: {
    vehicle: "motorcycle";
    motorwayExcluded: true;
    fallbackUsed: false;
  };
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  returnAt: string;
  legs: SafeRouteLeg[];
};

export class ProviderContractError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ProviderContractError";
  }
}

function record(value: unknown, code = "INVALID_ROUTE_RESPONSE"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProviderContractError(code);
  }
  return value as Record<string, unknown>;
}

function positiveNumber(value: unknown, code = "INVALID_ROUTE_RESPONSE"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ProviderContractError(code);
  }
  return value;
}

function nonNegativeNumber(value: unknown, code = "INVALID_ROUTE_RESPONSE"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ProviderContractError(code);
  }
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") throw new ProviderContractError("INVALID_ROUTE_TIME");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ProviderContractError("INVALID_ROUTE_TIME");
  return date.toISOString();
}

function routePoint(value: unknown): RoutePoint {
  const raw = record(value);
  if (
    typeof raw.id !== "string" ||
    typeof raw.label !== "string" ||
    typeof raw.latitude !== "number" ||
    typeof raw.longitude !== "number" ||
    !["pass-through", "stop", "optional"].includes(String(raw.kind)) ||
    !Number.isInteger(raw.dwellMinutes) ||
    typeof raw.selected !== "boolean"
  ) {
    throw new ProviderContractError("INVALID_ROUTE_POINT");
  }
  return {
    id: raw.id,
    label: raw.label,
    latitude: raw.latitude,
    longitude: raw.longitude,
    kind: raw.kind as RoutePoint["kind"],
    dwellMinutes: Number(raw.dwellMinutes),
    selected: raw.selected,
    winding: typeof raw.winding === "boolean" ? raw.winding : undefined,
  };
}

function road(value: unknown) {
  const raw = record(value);
  if (!Array.isArray(raw.vertexes) || !raw.vertexes.every((item) => typeof item === "number" && Number.isFinite(item))) {
    throw new ProviderContractError("INVALID_ROUTE_GEOMETRY");
  }
  return {
    name: typeof raw.name === "string" ? raw.name : "",
    distance: nonNegativeNumber(raw.distance),
    duration: nonNegativeNumber(raw.duration),
    vertexes: raw.vertexes as number[],
  };
}

function section(value: unknown) {
  const raw = record(value);
  if (!Array.isArray(raw.roads)) throw new ProviderContractError("INVALID_ROUTE_GEOMETRY");
  return {
    distance: positiveNumber(raw.distance),
    duration: positiveNumber(raw.duration),
    roads: raw.roads.map(road),
  };
}

function leg(value: unknown): SafeRouteLeg {
  const raw = record(value);
  if (!Array.isArray(raw.via) || !Array.isArray(raw.sections) || typeof raw.forecastTraffic !== "boolean") {
    throw new ProviderContractError("INVALID_ROUTE_LEG");
  }
  const departureAt = timestamp(raw.departureAt);
  const arrivalAt = timestamp(raw.arrivalAt);
  if (new Date(arrivalAt) <= new Date(departureAt)) {
    throw new ProviderContractError("INVALID_ROUTE_TIME");
  }
  return {
    from: routePoint(raw.from),
    to: routePoint(raw.to),
    via: raw.via.map(routePoint),
    departureAt,
    arrivalAt,
    dwellMinutes: nonNegativeNumber(raw.dwellMinutes),
    distanceMeters: positiveNumber(raw.distanceMeters),
    durationSeconds: positiveNumber(raw.durationSeconds),
    sections: raw.sections.map(section),
    forecastTraffic: raw.forecastTraffic,
  };
}

export function parseSafeRouteResponse(value: unknown): SafeRouteResponse {
  const raw = record(value);
  const safety = record(raw.safety, "UNSAFE_ROUTE_RESPONSE");
  if (
    safety.vehicle !== "motorcycle" ||
    safety.motorwayExcluded !== true ||
    safety.fallbackUsed !== false
  ) {
    throw new ProviderContractError("UNSAFE_ROUTE_RESPONSE");
  }
  if (!Array.isArray(raw.legs) || raw.legs.length === 0) {
    throw new ProviderContractError("INVALID_ROUTE_LEGS");
  }
  const legs = raw.legs.map(leg);
  const returnAt = timestamp(raw.returnAt);
  if (returnAt !== new Date(legs.at(-1)!.arrivalAt).toISOString() && new Date(returnAt) < new Date(legs.at(-1)!.arrivalAt)) {
    throw new ProviderContractError("INVALID_ROUTE_TIME");
  }

  return {
    safety: { vehicle: "motorcycle", motorwayExcluded: true, fallbackUsed: false },
    totalDistanceMeters: positiveNumber(raw.totalDistanceMeters),
    totalDurationSeconds: positiveNumber(raw.totalDurationSeconds),
    returnAt,
    legs,
  };
}
