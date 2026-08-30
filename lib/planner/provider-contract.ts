import type { RoutePoint } from "./types";
import { isKoreanCoordinate } from "./input";
import { parseStrictRfc3339 } from "../../supabase/functions/_shared/strict-time";

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
  const date = parseStrictRfc3339(value);
  if (!date) throw new ProviderContractError("INVALID_ROUTE_TIME");
  return date.toISOString();
}

function routePoint(value: unknown): RoutePoint {
  const raw = record(value);
  if (
    typeof raw.id !== "string" || raw.id.length < 1 || raw.id.length > 100 ||
    typeof raw.label !== "string" || raw.label.trim().length < 1 || raw.label.length > 160 ||
    typeof raw.latitude !== "number" || !Number.isFinite(raw.latitude) ||
    typeof raw.longitude !== "number" || !Number.isFinite(raw.longitude) ||
    !["pass-through", "stop", "optional"].includes(String(raw.kind)) ||
    !Number.isInteger(raw.dwellMinutes) || Number(raw.dwellMinutes) < 0 || Number(raw.dwellMinutes) > 1440 ||
    typeof raw.selected !== "boolean"
  ) {
    throw new ProviderContractError("INVALID_ROUTE_POINT");
  }
  if (!isKoreanCoordinate({ latitude: raw.latitude, longitude: raw.longitude })) {
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
  if (
    !Array.isArray(raw.vertexes) ||
    raw.vertexes.length < 4 ||
    raw.vertexes.length % 2 !== 0 ||
    !raw.vertexes.every((item) => typeof item === "number" && Number.isFinite(item))
  ) {
    throw new ProviderContractError("INVALID_ROUTE_GEOMETRY");
  }
  for (let index = 0; index < raw.vertexes.length; index += 2) {
    if (!isKoreanCoordinate({ longitude: raw.vertexes[index] as number, latitude: raw.vertexes[index + 1] as number })) {
      throw new ProviderContractError("INVALID_ROUTE_GEOMETRY");
    }
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
  if (!Array.isArray(raw.roads) || raw.roads.length === 0) {
    throw new ProviderContractError("INVALID_ROUTE_GEOMETRY");
  }
  const parsed = {
    distance: positiveNumber(raw.distance),
    duration: positiveNumber(raw.duration),
    roads: raw.roads.map(road),
  };
  const roadDistance = parsed.roads.reduce((total, item) => total + item.distance, 0);
  const roadDuration = parsed.roads.reduce((total, item) => total + item.duration, 0);
  if (roadDistance !== parsed.distance || roadDuration !== parsed.duration) {
    throw new ProviderContractError("INVALID_ROUTE_TOTALS");
  }
  return parsed;
}

function leg(value: unknown): SafeRouteLeg {
  const raw = record(value);
  if (!Array.isArray(raw.via) || !Array.isArray(raw.sections) || typeof raw.forecastTraffic !== "boolean") {
    throw new ProviderContractError("INVALID_ROUTE_LEG");
  }
  if (raw.sections.length === 0) throw new ProviderContractError("INVALID_ROUTE_GEOMETRY");
  const departureAt = timestamp(raw.departureAt);
  const arrivalAt = timestamp(raw.arrivalAt);
  if (new Date(arrivalAt) <= new Date(departureAt)) {
    throw new ProviderContractError("INVALID_ROUTE_TIME");
  }
  const parsed = {
    from: routePoint(raw.from),
    to: routePoint(raw.to),
    via: raw.via.map(routePoint),
    departureAt,
    arrivalAt,
    dwellMinutes: Number.isInteger(raw.dwellMinutes) && Number(raw.dwellMinutes) <= 1440
      ? nonNegativeNumber(raw.dwellMinutes)
      : (() => { throw new ProviderContractError("INVALID_ROUTE_LEG"); })(),
    distanceMeters: positiveNumber(raw.distanceMeters),
    durationSeconds: positiveNumber(raw.durationSeconds),
    sections: raw.sections.map(section),
    forecastTraffic: raw.forecastTraffic,
  };
  const elapsedSeconds = (new Date(arrivalAt).getTime() - new Date(departureAt).getTime()) / 1000;
  const sectionDistance = parsed.sections.reduce((total, item) => total + item.distance, 0);
  const sectionDuration = parsed.sections.reduce((total, item) => total + item.duration, 0);
  if (
    elapsedSeconds !== parsed.durationSeconds ||
    sectionDistance !== parsed.distanceMeters ||
    sectionDuration !== parsed.durationSeconds
  ) {
    throw new ProviderContractError("INVALID_ROUTE_TOTALS");
  }
  return parsed;
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
  for (let index = 1; index < legs.length; index += 1) {
    const previous = legs[index - 1];
    const current = legs[index];
    const expectedDeparture = new Date(
      new Date(previous.arrivalAt).getTime() + previous.dwellMinutes * 60_000,
    ).toISOString();
    if (
      current.departureAt !== expectedDeparture ||
      current.from.id !== previous.to.id ||
      current.from.latitude !== previous.to.latitude ||
      current.from.longitude !== previous.to.longitude
    ) {
      throw new ProviderContractError("DISCONTINUOUS_ROUTE_LEGS");
    }
  }

  const expectedReturn = new Date(
    new Date(legs.at(-1)!.arrivalAt).getTime() + legs.at(-1)!.dwellMinutes * 60_000,
  ).toISOString();
  if (returnAt !== expectedReturn) {
    throw new ProviderContractError("INVALID_ROUTE_TIME");
  }

  const expectedDistance = legs.reduce((total, item) => total + item.distanceMeters, 0);
  const expectedDuration = legs.reduce(
    (total, item) => total + item.durationSeconds + item.dwellMinutes * 60,
    0,
  );
  const totalDistanceMeters = positiveNumber(raw.totalDistanceMeters);
  const totalDurationSeconds = positiveNumber(raw.totalDurationSeconds);
  if (totalDistanceMeters !== expectedDistance || totalDurationSeconds !== expectedDuration) {
    throw new ProviderContractError("INVALID_ROUTE_TOTALS");
  }

  return {
    safety: { vehicle: "motorcycle", motorwayExcluded: true, fallbackUsed: false },
    totalDistanceMeters,
    totalDurationSeconds,
    returnAt,
    legs,
  };
}
