import { describe, expect, it } from "vitest";

import { prepareCollectionApplication } from "./application";
import type { CollectionPoint } from "./contracts";

function point(id: string, overrides: Partial<CollectionPoint> = {}): CollectionPoint {
  return {
    id,
    label: id,
    kakaoPlaceId: id,
    verificationToken: "a".repeat(43),
    name: id,
    address: "테스트 주소",
    roadAddress: null,
    longitude: 127,
    latitude: 37,
    kind: "pass-through",
    dwellMinutes: 0,
    selected: true,
    winding: false,
    ...overrides,
  };
}

function course(points: CollectionPoint[]) {
  const endpoint = (id: string) => {
    const { kakaoPlaceId, verificationToken, name, address, roadAddress, longitude, latitude } = point(id);
    return { kakaoPlaceId, verificationToken, name, address, roadAddress, longitude, latitude };
  };
  return { origin: endpoint("origin"), destination: endpoint("destination"), points };
}

describe("prepareCollectionApplication", () => {
  it("preserves the complete mixed-role occurrence order", () => {
    const points = [
      point("lunch", { kind: "stop", dwellMinutes: 60, stopRole: "lunch" }),
      point("waypoint", { winding: true }),
      point("rest", { kind: "optional", dwellMinutes: 45, stopRole: "rest" }),
      point("dinner", { kind: "stop", dwellMinutes: 60, stopRole: "dinner" }),
    ];
    const result = prepareCollectionApplication(course(points));

    expect(result.orderedPoints.map((item) => item.id)).toEqual(["lunch", "waypoint", "rest", "dinner"]);
    expect(result.orderedPoints).toEqual(points);
    expect(result.orderedPoints).not.toBe(points);
    expect(result.origin.kakaoPlaceId).toBe("origin");
    expect(result.destination.kakaoPlaceId).toBe("destination");
  });
});
