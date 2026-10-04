import { describe, expect, it, vi } from "vitest";

import { parseCollectionCourse } from "../../../lib/collections/contracts";
import { prepareCollectionApplication } from "../../../lib/collections/application";
import { parseSafeRecommendedRoute } from "../../../lib/planner/provider-contract";
import { parseSharedRideSnapshot } from "../../../lib/sharing/contracts";
import { parseCollectionSaveRequest } from "./collection-request";
import { signPlace } from "./place-verification";
import { orchestrateRecommendedRoute, type RouteChunkRequest } from "./route-orchestration";
import { parseRouteRequest, type RoutePointRequest } from "./route-request";
import { buildSafeRouteResponse } from "./route-response";

const secret = "test-secret-with-at-least-thirty-two-bytes";
const departureAt = "2026-09-01T00:00:00.000Z";

async function point(index: number, stopRole?: RoutePointRequest["stopRole"], dwellMinutes = 0) {
  const place = {
    kakaoPlaceId: `place-${index}`, name: `지점 ${index}`, address: "경기 테스트 주소", roadAddress: null,
    longitude: 127 + index * 0.01, latitude: 37 + index * 0.01,
  };
  return {
    ...place, verificationToken: await signPlace(place, secret),
    id: `occurrence-${index}`, label: place.name, selected: true, winding: false,
    kind: stopRole === "rest" ? "optional" as const : stopRole ? "stop" as const : "pass-through" as const,
    dwellMinutes, ...(stopRole ? { stopRole } : {}),
  };
}

function providerResult(input: RouteChunkRequest) {
  const points = [input.origin, ...input.waypoints, input.destination];
  return {
    summary: {
      distance: (points.length - 1) * 100, duration: (points.length - 1) * 60,
      origin: points[0], destination: points.at(-1)!, waypoints: points.slice(1, -1),
    },
    sections: points.slice(1).map((to, index) => ({
      distance: 100, duration: 60,
      roads: [{ name: "검증 도로", distance: 100, duration: 60,
        vertexes: [points[index].longitude, points[index].latitude, to.longitude, to.latitude] }],
    })),
  };
}

async function roundtrip(firstRole: "meal" | "lunch", lastRole: "meal" | "dinner") {
  const original = {
    planningId: "123e4567-e89b-42d3-a456-426614174000", serviceDate: "2026-09-01", departureAt,
    origin: await point(0), destination: await point(4),
    waypoints: [await point(1, firstRole, 45), await point(2, "rest", 15), await point(3, lastRole, 45)],
  };
  const originalBytes = JSON.stringify(original);
  const request = await parseRouteRequest(original, secret, () => new Date(departureAt));
  let receipt = 0;
  const provider = vi.fn(async (input: RouteChunkRequest) => providerResult(input));
  const planned = await orchestrateRecommendedRoute(
    [request.origin, ...request.waypoints, request.destination], request.departureAt,
    { now: () => Date.parse(departureAt), limitFor: () => 100,
      consumeBudget: async () => ++receipt, requestProvider: provider },
  );
  const route = parseSafeRecommendedRoute(buildSafeRouteResponse({
    ...planned, candidate: { id: "recommended", label: "추천 경로", estimatedWinding: false },
  }));
  const sharedPlace = (point: RoutePointRequest) => ({
    id: point.id, label: point.label, longitude: point.longitude, latitude: point.latitude,
  });
  const snapshot = {
    schemaVersion: 3,
    trip: { title: "식사 왕복", serviceDate: request.serviceDate, departureAt,
      origin: sharedPlace(request.origin), destination: sharedPlace(request.destination),
      lunchStop: firstRole === "lunch" ? sharedPlace(request.waypoints[0]) : null,
      dinnerStop: lastRole === "dinner" ? sharedPlace(request.waypoints[2]) : null },
    waypoints: request.waypoints.map((point, position) => ({
      ...sharedPlace(point), position, kind: point.kind, dwellMinutes: point.dwellMinutes,
      selected: point.selected, winding: point.winding,
    })),
    route,
    weather: {
      source: "kma", issuedAt: departureAt, retrievedAt: departureAt,
      validUntil: "2026-09-01T06:00:00.000Z", stale: false, staleObservedAt: null, staleReason: null, failureKind: null,
      segments: route.legs.map((leg, index) => ({
        id: `recommended-${index}`, label: leg.to.label, longitude: leg.to.longitude, latitude: leg.to.latitude,
        eta: leg.arrivalAt, status: "forecast", model: "ultra", issuedAt: departureAt,
        condition: "clear", temperatureC: 22, precipitationProbability: 0, windSpeedMps: 1.2,
      })),
    },
  };
  const snapshotBytes = JSON.stringify(snapshot);
  const share = parseSharedRideSnapshot(snapshot);
  const course = parseCollectionCourse({ origin: request.origin, destination: request.destination, points: request.waypoints });
  const applied = prepareCollectionApplication(course);
  const saved = await parseCollectionSaveRequest({
    saveOperationId: original.planningId, collectionId: null, title: "식사 코스", description: "",
    origin: applied.origin, destination: applied.destination, points: applied.orderedPoints,
  }, secret);
  expect(JSON.stringify(original)).toBe(originalBytes);
  expect(JSON.stringify(snapshot)).toBe(snapshotBytes);
  return { provider, request, route, snapshot, share, saved };
}

describe("meal server contract roundtrip", () => {
  it.each([["meal", "meal"], ["lunch", "dinner"]] as const)(
    "preserves %s/rest/%s order, fixed meal and edited rest dwell, ETA, weather and reusable collection", async (first, last) => {
      const { provider, request, route, share, saved } = await roundtrip(first, last);
      expect(request.waypoints.map((point) => point.stopRole)).toEqual([first, "rest", last]);
      expect(saved.points.map((point) => [point.id, point.stopRole, point.dwellMinutes]))
        .toEqual(request.waypoints.map((point) => [point.id, point.stopRole, point.dwellMinutes]));
      expect(route.legs.map((leg) => [leg.to.stopRole, leg.dwellMinutes]))
        .toEqual([[first, 45], ["rest", 15], [last, 45], [undefined, 0]]);
      expect(provider.mock.calls.map(([call]) => call.departureAt.toISOString()))
        .toEqual([departureAt, "2026-09-01T00:46:00.000Z", "2026-09-01T01:02:00.000Z", "2026-09-01T01:48:00.000Z"]);
      expect(route.returnAt).toBe("2026-09-01T01:49:00.000Z");
      expect(route.totalDurationSeconds).toBe((4 + 45 + 15 + 45) * 60);
      expect(share.schemaVersion).toBe(3);
      if (share.schemaVersion !== 3) throw new Error("UNEXPECTED_SHARE_SCHEMA");
      expect(share.route.legs.map((leg) => leg.to.stopRole)).toEqual([first, "rest", last, undefined]);
      expect(share.weather!.segments.map((segment) => segment.eta)).toEqual(route.legs.map((leg) => leg.arrivalAt));
      expect(JSON.stringify(share)).not.toContain("verificationToken");
    },
  );

  it("rejects weather tied to post-meal departure instead of the accepted arrival", async () => {
    const { snapshot } = await roundtrip("meal", "meal");
    snapshot.weather.segments[0].eta = snapshot.route.legs[1].departureAt;
    expect(() => parseSharedRideSnapshot(snapshot)).toThrow("INVALID_SHARE_SNAPSHOT");
  });

  it.each([{ dwellMinutes: 0 }, { kind: "optional" }, { winding: true }])(
    "rejects a malformed meal in a received route %#", async (overrides) => {
      const { snapshot } = await roundtrip("meal", "meal");
      Object.assign(snapshot.route.legs[0].to, overrides);
      expect(() => parseSharedRideSnapshot(snapshot)).toThrow("INVALID_ROUTE_POINT");
    },
  );
});
