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
};

export type WeatherSnapshot = {
  condition: "clear" | "cloudy" | "rain" | "snow" | "unknown";
  temperatureC: number | null;
  precipitationProbability: number | null;
  windSpeedMps: number | null;
  issuedAt: string;
};

export type PlannedSegment = {
  id: string;
  from: RoutePoint;
  to: RoutePoint;
  distanceKm: number;
  rideMinutes: number;
  weather: WeatherSnapshot;
};

export type TimelineSegment = PlannedSegment & {
  departureAt: string;
  arrivalAt: string;
  nextDepartureAt: string;
};

export type RouteCandidate = {
  id: "balanced" | "winding" | "short";
  label: string;
  description: string;
  distanceKm: number;
  rideMinutes: number;
  stopMinutes: number;
  returnAt: string;
  fitsDesiredReturn: boolean;
  fitsHardReturn: boolean;
  segments: PlannedSegment[];
};
