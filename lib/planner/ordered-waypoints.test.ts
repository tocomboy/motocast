import { describe, expect, it } from "vitest";

import type { CollectionPoint } from "../collections/contracts";
import {
  collectionPointFromEditableWaypoint,
  defaultDwellMinutes,
  dwellError,
  dwellForRole,
  editableWaypointFromCollectionPoint,
  MEAL_DWELL_MINUTES,
  mealDwellNormalized,
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
      { id: "lunch", kind: "stop", dwellMinutes: 45, winding: false, stopRole: "lunch" },
      { id: "rest", kind: "optional", dwellMinutes: 30, winding: false, stopRole: "rest" },
      { id: "dinner", kind: "stop", dwellMinutes: 45, winding: false, stopRole: "dinner" },
    ]);
  });

  it("restores collection occurrences in order, fixing meals to 45 minutes and keeping rest dwell", () => {
    // A course saved before the 45-minute rule: legacy lunch 60, meal 93, rest 50.
    const points = [
      { ...waypoint("lunch", "lunch"), dwellMinutes: 60 },
      { ...waypoint("pass", "waypoint"), dwellMinutes: 0 },
      { ...waypoint("rest", "rest"), dwellMinutes: 50 },
      { ...waypoint("meal", "meal"), dwellMinutes: 93 },
    ].map(collectionPointFromEditableWaypoint) as CollectionPoint[];
    const before = structuredClone(points);

    expect(points.map(editableWaypointFromCollectionPoint).map(({ id, role, dwellMinutes }) => ({ id, role, dwellMinutes }))).toEqual([
      { id: "lunch", role: "meal", dwellMinutes: 45 },
      { id: "pass", role: "waypoint", dwellMinutes: 0 },
      { id: "rest", role: "rest", dwellMinutes: 50 },
      { id: "meal", role: "meal", dwellMinutes: 45 },
    ]);
    // The stored course itself is not rewritten.
    expect(points).toEqual(before);
    expect(mealDwellNormalized(points)).toBe(true);
  });

  it("reports a meal normalization only when a meal dwell actually changes", () => {
    const at45 = [waypoint("meal", "meal"), waypoint("rest", "rest")].map(collectionPointFromEditableWaypoint) as CollectionPoint[];
    expect(mealDwellNormalized(at45)).toBe(false);
    expect(mealDwellNormalized([])).toBe(false);
    const legacyDinner = [{ ...waypoint("dinner", "dinner"), dwellMinutes: 60 }].map(collectionPointFromEditableWaypoint) as CollectionPoint[];
    expect(mealDwellNormalized(legacyDinner)).toBe(true);
    // Rest dwell differences never count as a meal normalization.
    const rest = [{ ...waypoint("rest", "rest"), dwellMinutes: 90 }].map(collectionPointFromEditableWaypoint) as CollectionPoint[];
    expect(mealDwellNormalized(rest)).toBe(false);
  });

  it("fixes meal dwell, keeps rest editable within 1–1440 and pass-through at 0", () => {
    expect(MEAL_DWELL_MINUTES).toBe(45);
    expect(defaultDwellMinutes("meal")).toBe(45);
    expect(defaultDwellMinutes("rest")).toBe(30);
    expect(dwellForRole("meal", 60)).toBe(45);
    expect(dwellForRole("lunch", 90)).toBe(45);
    expect(dwellForRole("rest", 50)).toBe(50);
    expect(dwellForRole("waypoint", 50)).toBe(0);
    expect(dwellError("meal", 45)).toBeNull();
    expect(dwellError("meal", 60)).toBe("식사는 45분으로 계산해요.");
    expect(dwellError("rest", 1)).toBeNull();
    expect(dwellError("rest", 1440)).toBeNull();
    for (const invalid of [0, 1441, 1.5, Number.NaN]) {
      expect(dwellError("rest", invalid)).toBe("휴식 시간은 1~1440분 사이의 정수로 입력해 주세요.");
    }
    expect(dwellError("waypoint", 0)).toBeNull();
  });

  it("moves meals, rests, and pass-through points across one shared order", () => {
    const points = [waypoint("lunch", "lunch"), waypoint("pass", "waypoint"), waypoint("rest", "rest")];
    expect(moveWaypoint(points, 1, -1).map((point) => point.id)).toEqual(["pass", "lunch", "rest"]);
    expect(moveWaypoint(points, 0, -1)).toBe(points);
  });

  it("enforces one lunch, one dinner, five rests, twenty route waypoints, and thirty total occurrences", () => {
    expect(roleAssignmentError([waypoint("lunch", "lunch")], "lunch")).toBe("기존 식사 구분은 하나만 추가할 수 있습니다.");
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

  it("allows repeated meal places through thirty total occurrences and preserves each identity", () => {
    const meals = Array.from({ length: 30 }, (_, i) => ({ ...waypoint(`meal-${i}`, "meal"), place: waypoint("same", "meal").place }));
    expect(roleAssignmentError(meals.slice(0, 2), "meal")).toBeNull();
    expect(roleAssignmentError(meals.slice(0, 29), "meal")).toBeNull();
    expect(roleAssignmentError(meals, "meal")).toBe("경유지는 전체 30개까지 추가할 수 있습니다.");
    expect(roleAssignmentError(meals, "meal", meals[0].id)).toBeNull();
    const points = meals.map(collectionPointFromEditableWaypoint);
    expect(new Set(points.map((p) => p?.id)).size).toBe(30);
    expect(points.every((p) => p?.stopRole === "meal" && p.kind === "stop" && p.dwellMinutes === 45 && p.winding === false)).toBe(true);
  });
});
