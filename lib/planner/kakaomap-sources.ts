import type { CollectionCourse } from "../collections/contracts";
import { sharedSnapshotRoute, type SharedRideSnapshot } from "../sharing/contracts";
import type { RouteCandidate } from "./types";
import { sameHandoffPlace, validateHandoffPlaces, type HandoffPlace, type HandoffResult } from "./kakaomap-handoff";

function completeTraversal(expected: HandoffPlace[], legs: { from: HandoffPlace; to: HandoffPlace; via?: HandoffPlace[] }[]): HandoffResult {
  if (!legs.length || legs.some((leg, index) => index > 0 && !sameHandoffPlace(legs[index - 1].to, leg.from))) {
    return { status: "blocked", reason: "invalid" };
  }
  const visited = [legs[0].from, ...legs.flatMap((leg) => [...(leg.via ?? []), leg.to])];
  if (visited.length !== expected.length || visited.some((place, index) => !sameHandoffPlace(place, expected[index]))) {
    return { status: "blocked", reason: "invalid" };
  }
  return validateHandoffPlaces(expected);
}

export function ownerHandoff(input: {
  course: CollectionCourse | null;
  route: RouteCandidate | null;
  departureAt: string;
  stale: boolean;
  busy: boolean;
}): HandoffResult {
  if (input.stale || input.busy || !input.route || !Number.isFinite(Date.parse(input.departureAt))
    || Date.parse(input.route.segments[0]?.departureAt ?? "") !== Date.parse(input.departureAt)) {
    return { status: "blocked", reason: "stale" };
  }
  if (!input.course || input.course.points.some((p) => !p.selected)) return { status: "blocked", reason: "invalid" };
  const places = [input.course.origin, ...input.course.points, input.course.destination]
    .map((p) => ({ label: p.name, latitude: p.latitude, longitude: p.longitude }));
  return completeTraversal(places, input.route.segments);
}

export function sharedHandoff(snapshot: SharedRideSnapshot): HandoffResult {
  const points = snapshot.waypoints.filter((p) => p.selected);
  // A legacy stop outside the ordered list is ambiguous: do not guess where it belongs.
  if ([snapshot.trip.lunchStop, snapshot.trip.dinnerStop].some((stop) => stop && !points.some((p) => sameHandoffPlace(p, stop)))) {
    return { status: "blocked", reason: "invalid" };
  }
  if (points.some((p, index) => index > 0 && p.position <= points[index - 1].position)) return { status: "blocked", reason: "invalid" };
  return completeTraversal([snapshot.trip.origin, ...points, snapshot.trip.destination], sharedSnapshotRoute(snapshot).legs);
}
