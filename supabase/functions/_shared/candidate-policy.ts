import { isWindingOnlyWaypoint, type RoutePointRequest, type RouteRequest } from "./route-request.ts";
import type { KakaoRoutePriority } from "./kakao-safety.ts";

export type CandidatePolicy = {
  points: RoutePointRequest[];
  priority: KakaoRoutePriority;
  requestAlternatives: boolean;
  metadata: {
    id: RouteRequest["candidate"];
    label: string;
    estimatedWinding: boolean;
  };
};

export function candidatePolicy(input: RouteRequest): CandidatePolicy {
  const hasCustomWinding = input.waypoints.some(isWindingOnlyWaypoint);
  const waypoints = input.waypoints;

  if (input.candidate === "short") {
    return {
      points: [input.origin, ...waypoints, input.destination],
      priority: "DISTANCE",
      requestAlternatives: false,
      metadata: { id: "short", label: "최단", estimatedWinding: false },
    };
  }
  if (input.candidate === "winding") {
    return {
      points: [input.origin, ...waypoints, input.destination],
      priority: "RECOMMEND",
      requestAlternatives: !hasCustomWinding,
      metadata: {
        id: "winding",
        label: hasCustomWinding ? "커스텀 와인딩" : "와인딩 추정",
        estimatedWinding: !hasCustomWinding,
      },
    };
  }
  return {
    points: [input.origin, ...waypoints, input.destination],
    priority: "RECOMMEND",
    requestAlternatives: false,
    metadata: { id: "balanced", label: "균형", estimatedWinding: false },
  };
}
