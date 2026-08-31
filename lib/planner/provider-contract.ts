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
  candidate: {
    id: "balanced" | "winding" | "short";
    label: string;
    estimatedWinding: boolean;
  };
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

function geometryPoint(vertexes: number[], atEnd: boolean) {
  const index = atEnd ? vertexes.length - 2 : 0;
  return { longitude: vertexes[index], latitude: vertexes[index + 1] };
}

function geometryNear(left: { longitude: number; latitude: number }, right: { longitude: number; latitude: number }) {
  return Math.abs(left.longitude - right.longitude) <= 0.0002 && Math.abs(left.latitude - right.latitude) <= 0.0002;
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
  for (let index = 1; index < parsed.roads.length; index += 1) {
    if (!geometryNear(
      geometryPoint(parsed.roads[index - 1].vertexes, true),
      geometryPoint(parsed.roads[index].vertexes, false),
    )) throw new ProviderContractError("DISCONTINUOUS_ROUTE_GEOMETRY");
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
  const candidate = record(raw.candidate, "INVALID_ROUTE_CANDIDATE");
  if (
    !["balanced", "winding", "short"].includes(String(candidate.id)) ||
    typeof candidate.label !== "string" || candidate.label.length < 1 || candidate.label.length > 80 ||
    typeof candidate.estimatedWinding !== "boolean" ||
    (candidate.estimatedWinding && (candidate.id !== "winding" || candidate.label !== "와인딩 추정"))
  ) throw new ProviderContractError("INVALID_ROUTE_CANDIDATE");
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
  const allSections = legs.flatMap((item) => item.sections);
  for (let index = 1; index < allSections.length; index += 1) {
    const previousRoad = allSections[index - 1].roads.at(-1)!;
    const currentRoad = allSections[index].roads[0];
    if (!geometryNear(
      geometryPoint(previousRoad.vertexes, true),
      geometryPoint(currentRoad.vertexes, false),
    )) throw new ProviderContractError("DISCONTINUOUS_ROUTE_GEOMETRY");
  }
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
    candidate: {
      id: candidate.id as SafeRouteResponse["candidate"]["id"],
      label: candidate.label,
      estimatedWinding: candidate.estimatedWinding,
    },
    safety: { vehicle: "motorcycle", motorwayExcluded: true, fallbackUsed: false },
    totalDistanceMeters,
    totalDurationSeconds,
    returnAt,
    legs,
  };
}

export function routeResponseFingerprint(response: SafeRouteResponse) {
  const points: Array<{ longitude: number; latitude: number }> = [];
  for (const leg of response.legs) for (const section of leg.sections) for (const road of section.roads) {
    for (let index = 0; index + 1 < road.vertexes.length; index += 2) {
      const point = { longitude: road.vertexes[index], latitude: road.vertexes[index + 1] };
      const previous = points.at(-1);
      if (!previous || previous.longitude !== point.longitude || previous.latitude !== point.latitude) points.push(point);
    }
  }
  return points
    .map((point) => `${coordinateMicros(point.longitude)},${coordinateMicros(point.latitude)}`)
    .join("|");
}

function coordinateMicros(value: number) {
  const [whole, fraction = ""] = String(value).split(".");
  const sixDigits = `${fraction}000000`.slice(0, 6);
  const micros = Number(whole) * 1_000_000 + Number(sixDigits);
  return micros + (Number(fraction[6] ?? "0") >= 5 ? 1 : 0);
}

export function parseSafeRouteCandidateSet(values: unknown[]): SafeRouteResponse[] {
  const expected = ["balanced", "winding", "short"] as const;
  if (values.length !== expected.length) throw new ProviderContractError("INVALID_ROUTE_CANDIDATE_SET");
  const parsed = values.map((value, index) => {
    try {
      return parseSafeRouteResponse(value);
    } catch {
      throw new ProviderContractError(`INVALID_${expected[index].toUpperCase()}_ROUTE_RESPONSE`);
    }
  });
  if (parsed.some((candidate, index) => candidate.candidate.id !== expected[index])) {
    throw new ProviderContractError("INVALID_ROUTE_CANDIDATE_SET");
  }
  const fingerprints = new Set(parsed.map(routeResponseFingerprint));
  if (fingerprints.size !== expected.length) throw new ProviderContractError("DUPLICATE_ROUTE_CANDIDATES");
  return parsed;
}
