import { describe, expect, it } from "vitest";

import { buildSharedMapPoints } from "./shared-ride-snapshot";

const origin = { id: "route-origin", label: "출발", longitude: 127, latitude: 37 };
const lunch = { id: "route-lunch", label: "점심", longitude: 127.1, latitude: 37.1 };
const rest = { id: "route-rest", label: "휴식", longitude: 127.2, latitude: 37.2 };
const winding = { id: "route-winding", label: "경유지", longitude: 127.3, latitude: 37.3 };
const destination = { id: "route-destination", label: "복귀", longitude: 127.4, latitude: 37.4 };

describe("buildSharedMapPoints", () => {
  it("renders an endpoint-only route when lunch is omitted", () => {
    expect(buildSharedMapPoints({
      routePoints: [origin, destination],
      lunchStop: null,
      dinnerStop: null,
      waypoints: [],
    }).map((point) => point.role)).toEqual(["origin", "destination"]);
  });

  it("correlates DB snapshot waypoint IDs to provider route points by ordered place identity", () => {
    expect(buildSharedMapPoints({
      routePoints: [origin, lunch, rest, winding, destination],
      lunchStop: { ...lunch, id: "trip-lunch" },
      dinnerStop: null,
      waypoints: [
        { ...lunch, id: "waypoint-0", position: 0, kind: "stop", dwellMinutes: 60, selected: true, winding: false },
        { ...rest, id: "waypoint-1", position: 1, kind: "optional", dwellMinutes: 30, selected: true, winding: false },
        { ...winding, id: "waypoint-2", position: 2, kind: "pass-through", dwellMinutes: 0, selected: true, winding: true },
      ],
    }).map((point) => point.role)).toEqual(["origin", "lunch", "rest", "waypoint", "destination"]);
  });

  it("does not mark a winding point omitted when a balanced route traverses it", () => {
    const points = buildSharedMapPoints({
      routePoints: [origin, winding, lunch, destination],
      lunchStop: { ...lunch, id: "trip-lunch" },
      dinnerStop: null,
      waypoints: [
        { ...winding, id: "waypoint-0", position: 0, kind: "pass-through", dwellMinutes: 0, selected: true, winding: true },
        { ...lunch, id: "waypoint-1", position: 1, kind: "stop", dwellMinutes: 60, selected: true, winding: false },
      ],
    });

    expect(points.map((point) => point.role)).toEqual(["origin", "waypoint", "lunch", "destination"]);
    expect(points.some((point) => "nonTraversed" in point && point.nonTraversed)).toBe(false);
  });

  it("matches a complete current route by authoritative occurrence order", () => {
    const persistedLunch = {
      ...lunch,
      id: "waypoint-0",
      longitude: lunch.longitude + 5e-10,
      latitude: lunch.latitude - 5e-10,
      position: 0,
      kind: "stop" as const,
      dwellMinutes: 60,
      selected: true,
      winding: false,
    };
    const points = buildSharedMapPoints({
      routePoints: [origin, { ...lunch, stopRole: "lunch" as const }, destination],
      lunchStop: { ...lunch, id: "trip-lunch" },
      dinnerStop: null,
      waypoints: [persistedLunch],
    });

    expect(points.map((point) => point.role)).toEqual(["origin", "lunch", "destination"]);
    expect(points.some((point) => "nonTraversed" in point && point.nonTraversed)).toBe(false);
  });

  it("keeps later stop roles when the selected route omits an earlier winding waypoint", () => {
    expect(buildSharedMapPoints({
      routePoints: [origin, lunch, rest, destination],
      lunchStop: { ...lunch, id: "trip-lunch" },
      dinnerStop: null,
      waypoints: [
        { ...winding, id: "waypoint-0", position: 0, kind: "pass-through", dwellMinutes: 0, selected: true, winding: true },
        { ...lunch, id: "waypoint-1", position: 1, kind: "stop", dwellMinutes: 60, selected: true, winding: false },
        { ...rest, id: "waypoint-2", position: 2, kind: "optional", dwellMinutes: 30, selected: true, winding: false },
      ],
    })).toMatchObject([
      { role: "origin" },
      { role: "lunch" },
      { role: "rest" },
      { role: "destination" },
      { role: "waypoint", label: "경유지 · 선택 경로 미통과" },
    ]);
  });

  it("keeps a same-place winding-only marker omitted from a balanced candidate", () => {
    expect(buildSharedMapPoints({
      routePoints: [origin, lunch, destination],
      lunchStop: { ...lunch, id: "trip-lunch" },
      dinnerStop: null,
      waypoints: [
        { ...lunch, id: "waypoint-0", position: 0, kind: "pass-through", dwellMinutes: 0, selected: true, winding: true },
        { ...lunch, id: "waypoint-1", position: 1, kind: "stop", dwellMinutes: 60, selected: true, winding: false },
      ],
    })).toMatchObject([
      { role: "origin" },
      { role: "lunch" },
      { role: "destination" },
      { role: "waypoint", label: "점심 · 선택 경로 미통과", nonTraversed: true },
    ]);
  });

  it("keeps a same-place winding-only marker omitted after a legacy route becomes schema 3 recommended", () => {
    expect(buildSharedMapPoints({
      routePoints: [origin, lunch, destination],
      lunchStop: { ...lunch, id: "trip-lunch" },
      dinnerStop: null,
      waypoints: [
        { ...lunch, id: "waypoint-0", position: 0, kind: "pass-through", dwellMinutes: 0, selected: true, winding: true },
        { ...lunch, id: "waypoint-1", position: 1, kind: "stop", dwellMinutes: 60, selected: true, winding: false },
      ],
    })).toMatchObject([
      { role: "origin" },
      { role: "lunch" },
      { role: "destination" },
      { role: "waypoint", nonTraversed: true },
    ]);
  });

  it("matches same-place winding and lunch route points one-to-one for the winding candidate", () => {
    expect(buildSharedMapPoints({
      routePoints: [origin, lunch, lunch, destination],
      lunchStop: { ...lunch, id: "trip-lunch" },
      dinnerStop: null,
      waypoints: [
        { ...lunch, id: "waypoint-0", position: 0, kind: "pass-through", dwellMinutes: 0, selected: true, winding: true },
        { ...lunch, id: "waypoint-1", position: 1, kind: "stop", dwellMinutes: 60, selected: true, winding: false },
      ],
    }).map((point) => point.role)).toEqual(["origin", "waypoint", "lunch", "destination"]);
  });

  it("keeps same-place plain, lunch and dinner occurrences distinct", () => {
    const same = { id: "same", label: "같은 장소", longitude: 127.1, latitude: 37.1 };
    expect(buildSharedMapPoints({
      routePoints: [origin, same, same, same, destination],
      lunchStop: { ...same, id: "trip-lunch" },
      dinnerStop: { ...same, id: "trip-dinner" },
      waypoints: [
        { ...same, id: "waypoint-0", position: 0, kind: "pass-through", dwellMinutes: 0, selected: true, winding: false },
        { ...same, id: "waypoint-1", position: 1, kind: "stop", dwellMinutes: 60, selected: true, winding: false },
        { ...same, id: "waypoint-2", position: 2, kind: "stop", dwellMinutes: 60, selected: true, winding: false },
      ],
    }).map((point) => point.role)).toEqual([
      "origin", "waypoint", "lunch", "dinner", "destination",
    ]);
  });

  it("uses immutable route stop roles for new snapshots", () => {
    const same = { id: "same", label: "같은 장소", longitude: 127.1, latitude: 37.1 };
    expect(buildSharedMapPoints({
      routePoints: [
        origin,
        { ...same, kind: "stop", stopRole: "dinner" },
        { ...same, kind: "stop", stopRole: "lunch" },
        destination,
      ],
      lunchStop: { ...same, id: "trip-lunch" },
      dinnerStop: { ...same, id: "trip-dinner" },
      waypoints: [
        { ...same, id: "waypoint-0", position: 0, kind: "stop", dwellMinutes: 60, selected: true, winding: false },
        { ...same, id: "waypoint-1", position: 1, kind: "stop", dwellMinutes: 60, selected: true, winding: false },
      ],
    }).map((point) => point.role)).toEqual([
      "origin", "dinner", "lunch", "destination",
    ]);
  });
});
