export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type WaypointKind = "pass-through" | "stop" | "optional";

export type RoutePoint = Coordinate & {
  id: string;
  label: string;
  kind: WaypointKind;
  dwellMinutes: number;
  selected: boolean;
  winding?: boolean;
  stopRole?: "lunch" | "dinner" | "rest";
};

export type WeatherSnapshot = {
  condition: "clear" | "cloudy" | "rain" | "snow" | "unknown";
  temperatureC: number | null;
  precipitationProbability: number | null;
  windSpeedMps: number | null;
  issuedAt: string;
  retrievedAt?: string;
  model?: "ultra" | "short";
  status?: "forecast" | "outside-window" | "unavailable";
  stale?: boolean;
  staleReason?: string;
};

export type PlannedSegment = {
  id: string;
  from: RoutePoint;
  to: RoutePoint;
  distanceKm: number;
  rideMinutes: number;
  departureAt?: string;
  arrivalAt?: string;
  weather: WeatherSnapshot;
};

export type TimelineSegment = PlannedSegment & {
  departureAt: string;
  arrivalAt: string;
  nextDepartureAt: string;
};

export type RouteCandidate = {
  id: "recommended";
  label: string;
  description: string;
  distanceKm: number;
  rideMinutes: number;
  stopMinutes: number;
  returnAt: string;
  path?: Coordinate[];
  segments: PlannedSegment[];
};
