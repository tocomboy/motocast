import type { PlannedSegment } from "./types";

type StopIds = {
  lunchId?: string;
  dinnerId?: string;
  restId?: string;
};

export function buildPlannerMapPoints(segments: PlannedSegment[], stopIds: StopIds) {
  if (segments.length === 0) return [];
  const points = [segments[0].from, ...segments.map((segment) => segment.to)];
  return points.map((point, index) => {
    let role: "origin" | "destination" | "lunch" | "dinner" | "rest" | "winding" | "waypoint" = "waypoint";
    if (index === 0) role = "origin";
    else if (index === points.length - 1) role = "destination";
    else if (point.winding === true) role = "winding";
    else if (point.id === stopIds.lunchId) role = "lunch";
    else if (point.id === stopIds.dinnerId) role = "dinner";
    else if (point.id === stopIds.restId) role = "rest";
    return { ...point, role };
  });
}
