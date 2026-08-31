import type { Coordinate, WaypointKind } from "./types";
import { parseStrictRfc3339 } from "../../supabase/functions/_shared/strict-time";

const KOREA_BOUNDS = {
  minLatitude: 32.8,
  maxLatitude: 38.7,
  minLongitude: 124.5,
  maxLongitude: 132,
} as const;

export type SelectedPlace = Coordinate & {
  kakaoPlaceId: string;
  verificationToken: string;
  name: string;
  address: string;
  roadAddress: string | null;
};

export type TripWaypointInput = {
  place: SelectedPlace;
  kind: WaypointKind;
  dwellMinutes: number;
  selected: boolean;
  winding: boolean;
};

export type TripInput = {
  title: string;
  serviceDate: string;
  departureAt: string;
  origin: SelectedPlace;
  destination: SelectedPlace;
  lunch: TripWaypointInput;
  dinner: TripWaypointInput | null;
  waypoints: TripWaypointInput[];
};

export class PlannerInputError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PlannerInputError";
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlannerInputError("INVALID_OBJECT");
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, code: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") throw new PlannerInputError(code);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new PlannerInputError(code);
  }
  return normalized;
}

function nullableBoundedString(value: unknown, code: string, maximum: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  return boundedString(value, code, 1, maximum);
}

function finiteNumber(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PlannerInputError(code);
  }
  return value;
}

export function isKoreanCoordinate(coordinate: Coordinate): boolean {
  return (
    coordinate.latitude >= KOREA_BOUNDS.minLatitude &&
    coordinate.latitude <= KOREA_BOUNDS.maxLatitude &&
    coordinate.longitude >= KOREA_BOUNDS.minLongitude &&
    coordinate.longitude <= KOREA_BOUNDS.maxLongitude
  );
}

export function parseSelectedPlace(value: unknown): SelectedPlace {
  const raw = objectValue(value);
  const coordinate = {
    latitude: finiteNumber(raw.latitude, "INVALID_PLACE_COORDINATE"),
    longitude: finiteNumber(raw.longitude, "INVALID_PLACE_COORDINATE"),
  };

  if (!isKoreanCoordinate(coordinate)) {
    throw new PlannerInputError("PLACE_OUTSIDE_KOREA");
  }

  const verificationToken = boundedString(raw.verificationToken, "INVALID_PLACE_VERIFICATION", 43, 43);
  if (!/^[A-Za-z0-9_-]{43}$/.test(verificationToken)) {
    throw new PlannerInputError("INVALID_PLACE_VERIFICATION");
  }

  return {
    kakaoPlaceId: boundedString(raw.kakaoPlaceId, "INVALID_KAKAO_PLACE_ID", 1, 80),
    verificationToken,
    name: boundedString(raw.name, "INVALID_PLACE_NAME", 1, 160),
    address: boundedString(raw.address, "INVALID_PLACE_ADDRESS", 1, 300),
    roadAddress: nullableBoundedString(raw.roadAddress, "INVALID_ROAD_ADDRESS", 300),
    ...coordinate,
  };
}

export function parseTripWaypoint(value: unknown): TripWaypointInput {
  const raw = objectValue(value);
  if (!(["pass-through", "stop", "optional"] as const).includes(raw.kind as WaypointKind)) {
    throw new PlannerInputError("INVALID_WAYPOINT_KIND");
  }
  if (typeof raw.selected !== "boolean" || typeof raw.winding !== "boolean") {
    throw new PlannerInputError("INVALID_WAYPOINT_FLAGS");
  }
  if (!Number.isInteger(raw.dwellMinutes) || Number(raw.dwellMinutes) < 0 || Number(raw.dwellMinutes) > 1440) {
    throw new PlannerInputError("INVALID_DWELL_MINUTES");
  }

  return {
    place: parseSelectedPlace(raw.place),
    kind: raw.kind as WaypointKind,
    dwellMinutes: Number(raw.dwellMinutes),
    selected: raw.selected,
    winding: raw.winding,
  };
}

function isoDate(value: unknown, code: string): Date {
  const parsed = parseStrictRfc3339(value);
  if (!parsed) throw new PlannerInputError(code);
  return parsed;
}

function validCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function seoulDate(value: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function parseTripInput(value: unknown): TripInput {
  const raw = objectValue(value);
  const serviceDate = boundedString(raw.serviceDate, "INVALID_SERVICE_DATE", 10, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) || !validCalendarDate(serviceDate)) {
    throw new PlannerInputError("INVALID_SERVICE_DATE");
  }

  const departure = isoDate(raw.departureAt, "INVALID_DEPARTURE_AT");
  if (seoulDate(departure) !== serviceDate) {
    throw new PlannerInputError("DEPARTURE_DATE_MISMATCH");
  }

  if (!Array.isArray(raw.waypoints) || raw.waypoints.length > 30) {
    throw new PlannerInputError("INVALID_WAYPOINT_COUNT");
  }

  const lunch = parseTripWaypoint(raw.lunch);
  if (lunch.kind !== "stop" || !lunch.selected || lunch.dwellMinutes <= 0) {
    throw new PlannerInputError("INVALID_LUNCH_STOP");
  }

  const dinner = raw.dinner === null || raw.dinner === undefined ? null : parseTripWaypoint(raw.dinner);
  if (dinner && (dinner.kind !== "stop" || !dinner.selected || dinner.dwellMinutes <= 0)) {
    throw new PlannerInputError("INVALID_DINNER_STOP");
  }

  return {
    title: boundedString(raw.title, "INVALID_TRIP_TITLE", 1, 120),
    serviceDate,
    departureAt: departure.toISOString(),
    origin: parseSelectedPlace(raw.origin),
    destination: parseSelectedPlace(raw.destination),
    lunch,
    dinner,
    waypoints: raw.waypoints.map(parseTripWaypoint),
  };
}
