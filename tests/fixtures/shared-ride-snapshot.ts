import type { SafeRouteResponse } from "../../lib/planner/provider-contract";
import { parseSharedRideSnapshot, type SharedRideSnapshot } from "../../lib/sharing/contracts";

const origin = {
  id: "fixture-origin", label: "공개 출발지", longitude: 127, latitude: 37,
  kind: "pass-through" as const, dwellMinutes: 0, selected: true,
};
const lunch = {
  id: "fixture-lunch", label: "공개 점심지", longitude: 127.1, latitude: 37.1,
  kind: "stop" as const, dwellMinutes: 60, selected: true,
};
const destination = {
  id: "fixture-destination", label: "공개 복귀지", longitude: 127.8, latitude: 37.8,
  kind: "pass-through" as const, dwellMinutes: 0, selected: true,
};

function route(candidate: "balanced" | "winding" | "short", offset: number): SafeRouteResponse {
  const legs: SafeRouteResponse["legs"] = [
    {
      from: origin,
      to: lunch,
      via: [],
      departureAt: "2030-01-01T00:00:00.000Z",
      arrivalAt: "2030-01-01T01:00:00.000Z",
      dwellMinutes: 60,
      distanceMeters: 10_000,
      durationSeconds: 3_600,
      forecastTraffic: false,
      sections: [{
        distance: 10_000,
        duration: 3_600,
        roads: [{
          name: "공개 도로 1",
          distance: 10_000,
          duration: 3_600,
          vertexes: [origin.longitude, origin.latitude, 127.05 + offset, 37.05, lunch.longitude, lunch.latitude],
        }],
      }],
    },
    {
      from: lunch,
      to: destination,
      via: [],
      departureAt: "2030-01-01T02:00:00.000Z",
      arrivalAt: "2030-01-01T03:00:00.000Z",
      dwellMinutes: 0,
      distanceMeters: 10_000,
      durationSeconds: 3_600,
      forecastTraffic: false,
      sections: [{
        distance: 10_000,
        duration: 3_600,
        roads: [{
          name: "공개 도로 2",
          distance: 10_000,
          duration: 3_600,
          vertexes: [lunch.longitude, lunch.latitude, 127.45 + offset, 37.45, destination.longitude, destination.latitude],
        }],
      }],
    },
  ];
  return {
    candidate: {
      id: candidate,
      label: candidate === "balanced" ? "균형" : candidate === "winding" ? "와인딩 추정" : "최단",
      estimatedWinding: candidate === "winding",
    },
    safety: { vehicle: "motorcycle", motorwayExcluded: true, fallbackUsed: false },
    totalDistanceMeters: 20_000,
    totalDurationSeconds: 10_800,
    returnAt: "2030-01-01T03:00:00.000Z",
    legs,
  };
}

export function rawSharedRideSnapshotWithOmissions(omissionCount = 20) {
  const windingWaypoints = Array.from({ length: omissionCount }, (_, index) => ({
    id: `fixture-winding-${index}`,
    label: `와인딩 경유지 ${index + 1}`,
    longitude: 127.2 + index * 0.002,
    latitude: 37.2 + index * 0.002,
    position: index + 1,
    kind: "pass-through" as const,
    dwellMinutes: 0,
    selected: true,
    winding: true,
  }));
  return {
    schemaVersion: 2,
    trip: {
      title: "공유 지도 미통과 표시 검증",
      serviceDate: "2030-01-01",
      departureAt: "2030-01-01T00:00:00.000Z",
      origin,
      destination,
      lunchStop: lunch,
      dinnerStop: null,
      selectedProfile: "balanced",
    },
    waypoints: [
      { ...lunch, id: "fixture-waypoint-lunch", position: 0, winding: false },
      ...windingWaypoints,
    ],
    routes: [
      { profile: "balanced", route: route("balanced", 0) },
      { profile: "winding", route: route("winding", 0.001) },
      { profile: "short", route: route("short", -0.001) },
    ],
    weather: null,
  };
}

export function sharedRideSnapshotWithOmissions(omissionCount = 20): SharedRideSnapshot {
  return parseSharedRideSnapshot(rawSharedRideSnapshotWithOmissions(omissionCount));
}
