import type { PlannedSegment } from "./types";

export function buildPlannerMapPoints(segments: PlannedSegment[]) {
  if (segments.length === 0) return [];
  const points = [segments[0].from, ...segments.map((segment) => segment.to)];
  return points.map((point, index) => {
    let role: "origin" | "destination" | "lunch" | "dinner" | "rest" | "winding" | "waypoint" = "waypoint";
    if (index === 0) role = "origin";
    else if (index === points.length - 1) role = "destination";
    else if (point.stopRole === "lunch") role = "lunch";
    else if (point.stopRole === "dinner") role = "dinner";
    else if (point.stopRole === "rest") role = "rest";
    return { ...point, role };
  });
}
