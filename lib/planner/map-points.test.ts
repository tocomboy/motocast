import { describe, expect, it } from "vitest";

import { buildPlannerMapPoints } from "./map-points";
import type { PlannedSegment, RoutePoint } from "./types";

function point(id: string, winding = false, stopRole?: RoutePoint["stopRole"]): RoutePoint {
  return {
    id,
    label: id,
    latitude: 37,
    longitude: 127,
    kind: winding ? "pass-through" : "stop",
    dwellMinutes: winding ? 0 : 60,
    selected: true,
    winding,
    stopRole,
  };
}

function segment(id: string, from: RoutePoint, to: RoutePoint): PlannedSegment {
  return {
    id,
    from,
    to,
    distanceKm: 1,
    rideMinutes: 1,
    weather: {
      condition: "unknown",
      temperatureC: null,
      precipitationProbability: null,
      windSpeedMps: null,
      issuedAt: "2026-09-01T00:00:00.000Z",
    },
  };
}

describe("buildPlannerMapPoints", () => {
  it("preserves winding and meal roles when the same Kakao place occurs twice", () => {
    const origin = point("origin");
    const winding = point("same-place", true);
    const lunch = point("same-place", false, "lunch");
    const destination = point("destination");

    expect(buildPlannerMapPoints([
      segment("0", origin, winding),
      segment("1", winding, lunch),
      segment("2", lunch, destination),
    ]).map(({ role }) => role)).toEqual([
      "origin", "winding", "lunch", "destination",
    ]);
  });

  it("keeps occurrence roles from the accepted route when form places later change", () => {
    const origin = point("origin");
    const lunch = point("same-place", false, "lunch");
    const rest = point("same-place", false, "rest");
    const dinner = point("same-place", false, "dinner");
    const destination = point("destination");

    expect(buildPlannerMapPoints([
      segment("0", origin, lunch),
      segment("1", lunch, rest),
      segment("2", rest, dinner),
      segment("3", dinner, destination),
    ]).map(({ role }) => role)).toEqual([
      "origin", "lunch", "rest", "dinner", "destination",
    ]);
  });
});
