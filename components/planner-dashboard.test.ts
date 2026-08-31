import { describe, expect, it } from "vitest";

import { buildPlannerDisplayTimeline } from "./planner-dashboard";
import type { PlannedSegment, RoutePoint } from "@/lib/planner/types";

const origin: RoutePoint = { id: "origin", label: "출발", longitude: 127, latitude: 37, kind: "pass-through", dwellMinutes: 0, selected: true };
const destination: RoutePoint = { id: "destination", label: "복귀", longitude: 127.1, latitude: 37.1, kind: "pass-through", dwellMinutes: 0, selected: true };
const segment: PlannedSegment = {
  id: "balanced-0",
  from: origin,
  to: destination,
  distanceKm: 10,
  rideMinutes: 60,
  departureAt: "2026-09-01T00:00:00.000Z",
  arrivalAt: "2026-09-01T01:00:00.000Z",
  weather: { condition: "unknown", temperatureC: null, precipitationProbability: null, windSpeedMps: null, issuedAt: "2026-09-01T00:00:00.000Z" },
};

describe("buildPlannerDisplayTimeline", () => {
  it("keeps a persisted route internally continuous after the draft departure changes", () => {
    expect(buildPlannerDisplayTimeline({
      live: true,
      draftDepartureAt: "2026-09-02T03:00:00+09:00",
      fallbackDepartureAt: "2026-09-01T00:00:00.000Z",
      includeRest: false,
      segments: [segment],
    })).toMatchObject({
      departureAt: segment.departureAt,
      timeline: { returnAt: segment.arrivalAt },
    });
  });
});
