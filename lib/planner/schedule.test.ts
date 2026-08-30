import { describe, expect, it } from "vitest";

import { buildTimeline, formatElapsedAge, formatKoreanDateTime, weatherRiskLabel } from "./schedule";
import type { PlannedSegment, RoutePoint } from "./types";

const issuedAt = "2026-08-30T00:00:00.000Z";

function point(id: string, dwellMinutes = 0, selected = true): RoutePoint {
  return {
    id,
    label: id,
    latitude: 37.5,
    longitude: 127.1,
    kind: dwellMinutes > 0 ? "stop" : "pass-through",
    dwellMinutes,
    selected,
  };
}

function segment(id: string, from: RoutePoint, to: RoutePoint, rideMinutes: number): PlannedSegment {
  return {
    id,
    from,
    to,
    rideMinutes,
    distanceKm: 40,
    weather: {
      condition: "clear",
      temperatureC: 24,
      precipitationProbability: 10,
      windSpeedMps: 2,
      issuedAt,
    },
  };
}

describe("buildTimeline", () => {
  it("adds dwell time only for selected stops", () => {
    const origin = point("origin");
    const lunch = point("lunch", 60, true);
    const optionalRest = point("rest", 30, false);
    const home = point("home");

    const result = buildTimeline({
      departureAt: "2026-08-30T00:00:00.000Z",
      desiredReturnAt: "2026-08-30T04:00:00.000Z",
      hardReturnAt: "2026-08-30T05:00:00.000Z",
      segments: [
        segment("a", origin, lunch, 60),
        segment("b", lunch, optionalRest, 60),
        segment("c", optionalRest, home, 60),
      ],
    });

    expect(result.rideMinutes).toBe(180);
    expect(result.stopMinutes).toBe(60);
    expect(result.returnAt).toBe("2026-08-30T04:00:00.000Z");
    expect(result.fitsDesiredReturn).toBe(true);
    expect(result.fitsHardReturn).toBe(true);
  });

  it("keeps the hard return as a discard boundary", () => {
    const origin = point("origin");
    const home = point("home");
    const result = buildTimeline({
      departureAt: "2026-08-30T00:00:00.000Z",
      desiredReturnAt: "2026-08-30T01:00:00.000Z",
      hardReturnAt: "2026-08-30T02:00:00.000Z",
      segments: [segment("late", origin, home, 121)],
    });

    expect(result.fitsDesiredReturn).toBe(false);
    expect(result.fitsHardReturn).toBe(false);
  });

  it("rejects negative durations instead of hiding invalid data", () => {
    const origin = point("origin");
    const home = point("home");
    expect(() =>
      buildTimeline({
        departureAt: "2026-08-30T00:00:00.000Z",
        desiredReturnAt: "2026-08-30T04:00:00.000Z",
        hardReturnAt: "2026-08-30T05:00:00.000Z",
        segments: [segment("broken", origin, home, -1)],
      }),
    ).toThrow(/positive ride duration/);
  });

  it("preserves provider timestamps without per-leg minute rounding drift", () => {
    const origin = point("origin");
    const pass = point("pass");
    const home = point("home");
    const first = segment("first", origin, pass, 1);
    first.departureAt = "2026-08-30T00:00:00.000Z";
    first.arrivalAt = "2026-08-30T00:00:31.000Z";
    const second = segment("second", pass, home, 1);
    second.departureAt = "2026-08-30T00:00:31.000Z";
    second.arrivalAt = "2026-08-30T00:01:02.000Z";

    const result = buildTimeline({
      departureAt: "2026-08-30T00:00:00.000Z",
      desiredReturnAt: "2026-08-30T01:00:00.000Z",
      hardReturnAt: "2026-08-30T02:00:00.000Z",
      segments: [first, second],
    });

    expect(result.returnAt).toBe("2026-08-30T00:01:02.000Z");
    expect(result.rideMinutes).toBe(2);
    expect(result.segments[0].arrivalAt).toBe(first.arrivalAt);
  });
});

describe("weatherRiskLabel", () => {
  it("marks rain as a riding danger", () => {
    const origin = point("origin");
    const home = point("home");
    const rainy = segment("rain", origin, home, 30);
    rainy.weather.condition = "rain";
    expect(weatherRiskLabel(rainy)).toEqual({ level: "danger", label: "주행 주의" });
  });
});

describe("weather snapshot age labels", () => {
  it("shows the full Seoul date and time", () => {
    expect(formatKoreanDateTime("2026-08-30T15:05:00.000Z")).toMatch(/2026.*08.*31.*00.*05/);
  });

  it("reports elapsed age without hiding multi-day staleness", () => {
    expect(formatElapsedAge("2026-08-29T00:00:00.000Z", "2026-08-31T03:30:00.000Z")).toBe("2일 3시간 전");
    expect(formatElapsedAge("2026-08-31T02:00:00.000Z", "2026-08-31T03:30:00.000Z")).toBe("1시간 30분 전");
  });
});
