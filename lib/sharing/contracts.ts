import { parseSafeRouteCandidateSet, type SafeRouteResponse } from "../planner/provider-contract";
import { parseStrictRfc3339 } from "../../supabase/functions/_shared/strict-time";
import { parseWeatherForecast, type WeatherFailureKind, type WeatherForecast } from "../weather/provider-contract";

export type SharedPlace = {
  id: string;
  label: string;
  longitude: number;
  latitude: number;
};

export type SharedWaypoint = SharedPlace & {
  position: number;
  kind: "pass-through" | "stop" | "optional";
  dwellMinutes: number;
  selected: boolean;
  winding: boolean;
};

type SharedTrip = {
  title: string;
  serviceDate: string;
  departureAt: string;
  origin: SharedPlace;
  destination: SharedPlace;
  lunchStop: SharedPlace;
  dinnerStop: SharedPlace | null;
  selectedProfile: "balanced" | "winding" | "short";
};

type SharedSnapshotBody = {
  waypoints: SharedWaypoint[];
  routes: SafeRouteResponse[];
  weather: null | {
    source: "kma";
    issuedAt: string;
    retrievedAt: string;
    validUntil: string;
    stale: boolean;
    staleObservedAt: string | null;
    staleReason: string | null;
    failureKind: WeatherFailureKind | null;
    candidateProfile: "balanced" | "winding" | "short";
    segments: WeatherForecast[];
  };
};

export type SharedRideSnapshot = SharedSnapshotBody & (
  | {
      schemaVersion: 1;
      trip: SharedTrip & {
        desiredReturnAt: string;
        hardReturnAt: string;
      };
    }
  | {
      schemaVersion: 2;
      trip: SharedTrip;
    }
);

function record(value: unknown, code = "INVALID_SHARE_SNAPSHOT"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, maximum: number) {
  if (typeof value !== "string" || value.trim().length < 1 || value.length > maximum) throw new Error("INVALID_SHARE_SNAPSHOT");
  return value.trim();
}

function timestamp(value: unknown) {
  const parsed = parseStrictRfc3339(value);
  if (!parsed) throw new Error("INVALID_SHARE_SNAPSHOT");
  return parsed.toISOString();
}

function place(value: unknown): SharedPlace {
  const raw = record(value);
  if (
    typeof raw.id !== "string" || raw.id.length < 1 || raw.id.length > 100 ||
    typeof raw.label !== "string" || raw.label.length < 1 || raw.label.length > 160 ||
    typeof raw.longitude !== "number" || !Number.isFinite(raw.longitude) || raw.longitude < 124 || raw.longitude > 132 ||
    typeof raw.latitude !== "number" || !Number.isFinite(raw.latitude) || raw.latitude < 32 || raw.latitude > 39.5 ||
    "verificationToken" in raw
  ) throw new Error("INVALID_SHARE_SNAPSHOT");
  return { id: raw.id, label: raw.label, longitude: raw.longitude, latitude: raw.latitude };
}

function waypoint(value: unknown, schemaVersion: 1 | 2): SharedWaypoint {
  const raw = record(value);
  const position = Number(raw.position);
  const parsedPlace = place({
    ...raw,
    id: schemaVersion === 1 && raw.id === undefined ? `waypoint-${position}` : raw.id,
  });
  if (
    !Number.isInteger(position) || position < 0 ||
    !["pass-through", "stop", "optional"].includes(String(raw.kind)) ||
    !Number.isInteger(raw.dwellMinutes) || Number(raw.dwellMinutes) < 0 || Number(raw.dwellMinutes) > 1440 ||
    typeof raw.selected !== "boolean" || typeof raw.winding !== "boolean"
  ) throw new Error("INVALID_SHARE_SNAPSHOT");
  return {
    ...parsedPlace,
    position,
    kind: raw.kind as SharedWaypoint["kind"],
    dwellMinutes: Number(raw.dwellMinutes),
    selected: raw.selected,
    winding: raw.winding,
  };
}

export function parseSharedRideSnapshot(value: unknown): SharedRideSnapshot {
  const raw = record(value);
  if ((raw.schemaVersion !== 1 && raw.schemaVersion !== 2) || !Array.isArray(raw.waypoints) || !Array.isArray(raw.routes)) {
    throw new Error("INVALID_SHARE_SNAPSHOT");
  }
  const schemaVersion = raw.schemaVersion;
  const trip = record(raw.trip);
  const selectedProfile = String(trip.selectedProfile);
  if (!["balanced", "winding", "short"].includes(selectedProfile)) throw new Error("INVALID_SHARE_SNAPSHOT");
  const routeWrappers = raw.routes.map((item) => record(item));
  const routes = parseSafeRouteCandidateSet(routeWrappers.map((item) => item.route));
  if (routeWrappers.some((item, index) => item.profile !== routes[index].candidate.id)) throw new Error("INVALID_SHARE_SNAPSHOT");

  const weather = raw.weather === null ? null : (() => {
    const parsed = record(raw.weather);
    const legacyFreshness = schemaVersion === 1 && [
      parsed.validUntil,
      parsed.stale,
      parsed.staleObservedAt,
      parsed.staleReason,
      parsed.failureKind,
    ].every((item) => item === undefined);
    const failureKindPresent = parsed.failureKind !== undefined && parsed.failureKind !== null;
    if (
      parsed.source !== "kma" ||
      !["balanced", "winding", "short"].includes(String(parsed.candidateProfile)) ||
      (!legacyFreshness && typeof parsed.stale !== "boolean") ||
      (!legacyFreshness && !(parsed.staleObservedAt === null || typeof parsed.staleObservedAt === "string")) ||
      (!legacyFreshness && !(parsed.staleReason === null || (typeof parsed.staleReason === "string" && parsed.staleReason.length <= 200))) ||
      (failureKindPresent && !["provider", "budget", "configuration", "persistence", "request"].includes(String(parsed.failureKind))) ||
      (!legacyFreshness && !parsed.stale && failureKindPresent) ||
      !Array.isArray(parsed.segments) || parsed.segments.length < 1 || parsed.segments.length > 40
    ) throw new Error("INVALID_SHARE_SNAPSHOT");
    const retrievedAt = timestamp(parsed.retrievedAt);
    return {
      source: "kma" as const,
      issuedAt: timestamp(parsed.issuedAt),
      retrievedAt,
      validUntil: legacyFreshness ? retrievedAt : timestamp(parsed.validUntil),
      stale: legacyFreshness ? false : parsed.stale as boolean,
      staleObservedAt: legacyFreshness || parsed.staleObservedAt === null ? null : timestamp(parsed.staleObservedAt),
      staleReason: legacyFreshness ? null : parsed.staleReason as string | null,
      failureKind: legacyFreshness || !failureKindPresent ? null : parsed.failureKind as WeatherFailureKind,
      candidateProfile: parsed.candidateProfile as "balanced" | "winding" | "short",
      segments: parsed.segments.map(parseWeatherForecast),
    };
  })();

  const waypoints = raw.waypoints.map((item) => waypoint(item, schemaVersion)).sort((left, right) => left.position - right.position);
  if (waypoints.some((item, index) => item.position !== index)) throw new Error("INVALID_SHARE_SNAPSHOT");
  if (weather && weather.candidateProfile !== selectedProfile) throw new Error("INVALID_SHARE_SNAPSHOT");
  const parsedTrip: SharedTrip = {
    title: boundedText(trip.title, 120),
    serviceDate: boundedText(trip.serviceDate, 10),
    departureAt: timestamp(trip.departureAt),
    origin: place(trip.origin),
    destination: place(trip.destination),
    lunchStop: place(trip.lunchStop),
    dinnerStop: trip.dinnerStop === null ? null : place(trip.dinnerStop),
    selectedProfile: selectedProfile as SharedTrip["selectedProfile"],
  };
  const body = {
    waypoints,
    routes,
    weather,
  };
  if (schemaVersion === 1) {
    return {
      schemaVersion: 1,
      trip: {
        ...parsedTrip,
        desiredReturnAt: timestamp(trip.desiredReturnAt),
        hardReturnAt: timestamp(trip.hardReturnAt),
      },
      ...body,
    };
  }
  return { schemaVersion: 2, trip: parsedTrip, ...body };
}
