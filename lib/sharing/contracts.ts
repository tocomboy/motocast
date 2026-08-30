import { parseSafeRouteCandidateSet, type SafeRouteResponse } from "../planner/provider-contract";
import { parseStrictRfc3339 } from "../../supabase/functions/_shared/strict-time";
import { parseWeatherForecast, type WeatherForecast } from "../weather/provider-contract";

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

export type SharedRideSnapshot = {
  schemaVersion: 1;
  trip: {
    title: string;
    serviceDate: string;
    departureAt: string;
    desiredReturnAt: string;
    hardReturnAt: string;
    origin: SharedPlace;
    destination: SharedPlace;
    lunchStop: SharedPlace;
    dinnerStop: SharedPlace | null;
    selectedProfile: "balanced" | "winding" | "short";
  };
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
    candidateProfile: "balanced" | "winding" | "short";
    segments: WeatherForecast[];
  };
};

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

function waypoint(value: unknown): SharedWaypoint {
  const raw = record(value);
  const parsedPlace = place(raw);
  if (
    !Number.isInteger(raw.position) || Number(raw.position) < 0 ||
    !["pass-through", "stop", "optional"].includes(String(raw.kind)) ||
    !Number.isInteger(raw.dwellMinutes) || Number(raw.dwellMinutes) < 0 || Number(raw.dwellMinutes) > 1440 ||
    typeof raw.selected !== "boolean" || typeof raw.winding !== "boolean"
  ) throw new Error("INVALID_SHARE_SNAPSHOT");
  return {
    ...parsedPlace,
    position: Number(raw.position),
    kind: raw.kind as SharedWaypoint["kind"],
    dwellMinutes: Number(raw.dwellMinutes),
    selected: raw.selected,
    winding: raw.winding,
  };
}

export function parseSharedRideSnapshot(value: unknown): SharedRideSnapshot {
  const raw = record(value);
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.waypoints) || !Array.isArray(raw.routes)) {
    throw new Error("INVALID_SHARE_SNAPSHOT");
  }
  const trip = record(raw.trip);
  const selectedProfile = String(trip.selectedProfile);
  if (!["balanced", "winding", "short"].includes(selectedProfile)) throw new Error("INVALID_SHARE_SNAPSHOT");
  const routeWrappers = raw.routes.map((item) => record(item));
  const routes = parseSafeRouteCandidateSet(routeWrappers.map((item) => item.route));
  if (routeWrappers.some((item, index) => item.profile !== routes[index].candidate.id)) throw new Error("INVALID_SHARE_SNAPSHOT");

  const weather = raw.weather === null ? null : (() => {
    const parsed = record(raw.weather);
    if (
      parsed.source !== "kma" ||
      !["balanced", "winding", "short"].includes(String(parsed.candidateProfile)) ||
      typeof parsed.stale !== "boolean" ||
      !(parsed.staleObservedAt === null || typeof parsed.staleObservedAt === "string") ||
      !(parsed.staleReason === null || (typeof parsed.staleReason === "string" && parsed.staleReason.length <= 200)) ||
      !Array.isArray(parsed.segments) || parsed.segments.length < 1 || parsed.segments.length > 40
    ) throw new Error("INVALID_SHARE_SNAPSHOT");
    return {
      source: "kma" as const,
      issuedAt: timestamp(parsed.issuedAt),
      retrievedAt: timestamp(parsed.retrievedAt),
      validUntil: timestamp(parsed.validUntil),
      stale: parsed.stale,
      staleObservedAt: parsed.staleObservedAt === null ? null : timestamp(parsed.staleObservedAt),
      staleReason: parsed.staleReason,
      candidateProfile: parsed.candidateProfile as "balanced" | "winding" | "short",
      segments: parsed.segments.map(parseWeatherForecast),
    };
  })();

  const waypoints = raw.waypoints.map(waypoint).sort((left, right) => left.position - right.position);
  if (waypoints.some((item, index) => item.position !== index)) throw new Error("INVALID_SHARE_SNAPSHOT");
  if (weather && weather.candidateProfile !== selectedProfile) throw new Error("INVALID_SHARE_SNAPSHOT");
  return {
    schemaVersion: 1,
    trip: {
      title: boundedText(trip.title, 120),
      serviceDate: boundedText(trip.serviceDate, 10),
      departureAt: timestamp(trip.departureAt),
      desiredReturnAt: timestamp(trip.desiredReturnAt),
      hardReturnAt: timestamp(trip.hardReturnAt),
      origin: place(trip.origin),
      destination: place(trip.destination),
      lunchStop: place(trip.lunchStop),
      dinnerStop: trip.dinnerStop === null ? null : place(trip.dinnerStop),
      selectedProfile: selectedProfile as SharedRideSnapshot["trip"]["selectedProfile"],
    },
    waypoints,
    routes,
    weather,
  };
}
