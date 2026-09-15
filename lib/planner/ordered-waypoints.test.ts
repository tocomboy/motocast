import { describe, expect, it } from "vitest";

import type { CollectionPoint } from "../collections/contracts";
import {
  collectionPointFromEditableWaypoint,
  defaultDwellMinutes,
  editableWaypointFromCollectionPoint,
  moveWaypoint,
  roleAssignmentError,
  type EditableWaypoint,
  type WaypointRole,
} from "./ordered-waypoints";

function waypoint(id: string, role: WaypointRole): EditableWaypoint {
  return {
    id,
    role,
    dwellMinutes: defaultDwellMinutes(role),
    place: {
      kakaoPlaceId: `place-${id}`,
      verificationToken: "a".repeat(43),
      name: id,
      address: "테스트 주소",
      roadAddress: null,
      longitude: 127,
      latitude: 37,
      category: "",
      phone: null,
      placeUrl: null,
    },
  };
}

describe("ordered route waypoints", () => {
  it("maps every visible role to the existing ordered persistence contract", () => {
    const points = [
      waypoint("pass", "waypoint"),
      waypoint("lunch", "lunch"),
      waypoint("rest", "rest"),
      waypoint("dinner", "dinner"),
    ].map(collectionPointFromEditableWaypoint);

    expect(points).toMatchObject([
      { id: "pass", kind: "pass-through", dwellMinutes: 0, winding: true },
      { id: "lunch", kind: "stop", dwellMinutes: 60, winding: false, stopRole: "lunch" },
      { id: "rest", kind: "optional", dwellMinutes: 30, winding: false, stopRole: "rest" },
      { id: "dinner", kind: "stop", dwellMinutes: 60, winding: false, stopRole: "dinner" },
    ]);
  });

  it("restores collection occurrences without changing their order or dwell", () => {
    const points = [
      waypoint("lunch", "lunch"),
      { ...waypoint("pass", "waypoint"), dwellMinutes: 0 },
      { ...waypoint("rest", "rest"), dwellMinutes: 45 },
    ].map(collectionPointFromEditableWaypoint) as CollectionPoint[];

    expect(points.map(editableWaypointFromCollectionPoint).map(({ id, role, dwellMinutes }) => ({ id, role, dwellMinutes }))).toEqual([
      { id: "lunch", role: "lunch", dwellMinutes: 60 },
      { id: "pass", role: "waypoint", dwellMinutes: 0 },
      { id: "rest", role: "rest", dwellMinutes: 45 },
    ]);
  });

  it("moves meals, rests, and pass-through points across one shared order", () => {
    const points = [waypoint("lunch", "lunch"), waypoint("pass", "waypoint"), waypoint("rest", "rest")];
    expect(moveWaypoint(points, 1, -1).map((point) => point.id)).toEqual(["pass", "lunch", "rest"]);
    expect(moveWaypoint(points, 0, -1)).toBe(points);
  });

  it("enforces one lunch, one dinner, five rests, twenty route waypoints, and thirty total occurrences", () => {
    expect(roleAssignmentError([waypoint("lunch", "lunch")], "lunch")).toBe("점심은 하나만 추가할 수 있습니다.");
    expect(roleAssignmentError(Array.from({ length: 5 }, (_, index) => waypoint(`rest-${index}`, "rest")), "rest"))
      .toBe("휴식은 최대 5개까지 추가할 수 있습니다.");
    expect(roleAssignmentError(Array.from({ length: 20 }, (_, index) => waypoint(`pass-${index}`, "waypoint")), "waypoint"))
      .toBe("경유지는 최대 20개까지 추가할 수 있습니다.");
    const thirty = Array.from({ length: 30 }, (_, index) => waypoint(`point-${index}`, "waypoint"));
    expect(roleAssignmentError(thirty, "rest")).toBe("경유지는 전체 30개까지 추가할 수 있습니다.");
    expect(roleAssignmentError([waypoint("lunch", "lunch")], "lunch", "lunch")).toBeNull();
  });

  it("does not silently persist an unfinished place selection", () => {
    expect(collectionPointFromEditableWaypoint({
      id: "pending",
      role: "rest",
      place: null,
      dwellMinutes: 30,
    })).toBeNull();
  });
});
