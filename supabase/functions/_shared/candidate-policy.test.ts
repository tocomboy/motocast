import { describe, expect, it } from "vitest";

import { candidatePolicy } from "./candidate-policy";
import type { RoutePointRequest, RouteRequest } from "./route-request";

function point(id: string, winding = false): RoutePointRequest {
  return {
    id,
    label: id,
    kakaoPlaceId: id,
    verificationToken: "a".repeat(43),
    name: id,
    address: "경기도 테스트 주소",
    roadAddress: null,
    longitude: 127,
    latitude: 37,
    kind: "pass-through",
    dwellMinutes: 0,
    selected: true,
    winding,
  };
}

function request(candidate: RouteRequest["candidate"], waypoints: RoutePointRequest[] = []): RouteRequest {
  return {
    planningId: "123e4567-e89b-42d3-a456-426614174000",
    origin: point("origin"),
    destination: point("destination"),
    waypoints,
    serviceDate: "2026-08-31",
    departureAt: "2026-08-30T22:30:00.000Z",
    candidate,
  };
}

describe("candidatePolicy", () => {
  it("derives provider priority on the trusted server", () => {
    expect(candidatePolicy(request("balanced")).priority).toBe("RECOMMEND");
    expect(candidatePolicy(request("short")).priority).toBe("DISTANCE");
  });

  it("keeps custom winding points mandatory only for the winding candidate", () => {
    const winding = point("winding", true);
    expect(candidatePolicy(request("winding", [winding])).points).toContain(winding);
    expect(candidatePolicy(request("balanced", [winding])).points).not.toContain(winding);
  });

  it("never drops a required stop even if an untrusted caller overlaps the winding flag", () => {
    const lunch = {
      ...point("lunch", true),
      kind: "stop" as const,
      dwellMinutes: 60,
      stopRole: "lunch" as const,
    };
    expect(candidatePolicy(request("balanced", [lunch])).points).toContain(lunch);
    expect(candidatePolicy(request("short", [lunch])).points).toContain(lunch);
  });

  it("requests alternatives and uses the honest label without custom winding points", () => {
    const policy = candidatePolicy(request("winding"));
    expect(policy.requestAlternatives).toBe(true);
    expect(policy.metadata).toEqual({ id: "winding", label: "와인딩 추정", estimatedWinding: true });
  });
});
