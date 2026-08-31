import type { PlannedSegment, RouteCandidate, RoutePoint } from "./types";
import { buildTimeline } from "./schedule";

const issuedAt = "2026-08-30T00:00:00.000Z";

const points = {
  origin: {
    id: "origin",
    label: "팔당 출발점",
    latitude: 37.545,
    longitude: 127.31,
    kind: "pass-through",
    dwellMinutes: 0,
    selected: true,
  },
  pass: {
    id: "pass",
    label: "유명산 굽이길",
    latitude: 37.575,
    longitude: 127.487,
    kind: "pass-through",
    dwellMinutes: 0,
    selected: true,
    winding: true,
  },
  lunch: {
    id: "lunch",
    label: "홍천 점심 정차",
    latitude: 37.697,
    longitude: 127.888,
    kind: "stop",
    dwellMinutes: 60,
    selected: true,
  },
  rest: {
    id: "rest",
    label: "북한강 휴식",
    latitude: 37.731,
    longitude: 127.526,
    kind: "stop",
    dwellMinutes: 30,
    selected: true,
  },
  destination: {
    id: "destination",
    label: "팔당 복귀점",
    latitude: 37.545,
    longitude: 127.31,
    kind: "pass-through",
    dwellMinutes: 0,
    selected: true,
  },
} satisfies Record<string, RoutePoint>;

function weather(
  condition: PlannedSegment["weather"]["condition"],
  temperatureC: number,
  precipitationProbability: number,
  windSpeedMps: number,
) {
  return { condition, temperatureC, precipitationProbability, windSpeedMps, issuedAt };
}

const windingSegments: PlannedSegment[] = [
  {
    id: "segment-1",
    from: points.origin,
    to: points.pass,
    distanceKm: 56,
    rideMinutes: 78,
    weather: weather("clear", 21, 10, 2.8),
  },
  {
    id: "segment-2",
    from: points.pass,
    to: points.lunch,
    distanceKm: 71,
    rideMinutes: 92,
    weather: weather("cloudy", 23, 30, 4.1),
  },
  {
    id: "segment-3",
    from: points.lunch,
    to: points.rest,
    distanceKm: 64,
    rideMinutes: 84,
    weather: weather("rain", 20, 70, 7.4),
  },
  {
    id: "segment-4",
    from: points.rest,
    to: points.destination,
    distanceKm: 48,
    rideMinutes: 65,
    weather: weather("cloudy", 19, 40, 5.2),
  },
];

const profiles = [
  {
    id: "balanced" as const,
    label: "균형",
    description: "주행 시간과 경로의 균형",
    distanceScale: 0.92,
    timeScale: 0.9,
  },
  {
    id: "winding" as const,
    label: "와인딩 우선",
    description: "저장한 굽이길 경유지를 최대한 유지",
    distanceScale: 1,
    timeScale: 1,
  },
  {
    id: "short" as const,
    label: "짧은 경로",
    description: "필수 정차를 지키며 총 주행을 단축",
    distanceScale: 0.78,
    timeScale: 0.76,
  },
];

export const demoDepartureAt = "2026-08-30T22:30:00.000Z";

export const demoCandidates: RouteCandidate[] = profiles.map((profile) => {
  const segments = windingSegments.map((segment) => ({
    ...segment,
    distanceKm: Math.round(segment.distanceKm * profile.distanceScale),
    rideMinutes: Math.round(segment.rideMinutes * profile.timeScale),
  }));
  const timeline = buildTimeline({
    departureAt: demoDepartureAt,
    segments,
  });

  return {
    id: profile.id,
    label: profile.label,
    description: profile.description,
    distanceKm: segments.reduce((total, segment) => total + segment.distanceKm, 0),
    rideMinutes: timeline.rideMinutes,
    stopMinutes: timeline.stopMinutes,
    returnAt: timeline.returnAt,
    segments,
  };
});

export const demoMapPoints = [
  { ...points.origin, role: "origin" as const },
  { ...points.pass, role: "winding" as const },
  { ...points.lunch, role: "lunch" as const },
  { ...points.rest, role: "rest" as const },
  { ...points.destination, role: "destination" as const },
];
