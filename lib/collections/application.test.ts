import { describe, expect, it } from "vitest";

import {
  appliedWindingActionLabel,
  insertCollectionRest,
  insertCollectionWinding,
  moveCollectionRest,
  moveCollectionWinding,
  prepareCollectionApplication,
  removeCollectionOccurrence,
  removeCollectionWinding,
  replaceCollectionOccurrence,
  replaceCollectionStop,
  selectedWindingCount,
} from "./application";
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
  it("counts every selected winding occurrence without de-duplicating a repeated place", () => {
    const repeated = [
      point("first", { kakaoPlaceId: "same-place", winding: true }),
      point("second", { kakaoPlaceId: "same-place", winding: true }),
    ];
    expect(selectedWindingCount(repeated)).toBe(2);
  });

  it("preserves the complete ordered course while restoring every occurrence id", () => {
    const points = [
      point("plain"),
      point("lunch", { kind: "stop", dwellMinutes: 60, stopRole: "lunch" }),
      point("rest", { kind: "optional", dwellMinutes: 30, stopRole: "rest" }),
      point("winding", { winding: true }),
    ];
    const result = prepareCollectionApplication(course(points));
    expect(result.orderedPoints.map((item) => item.id)).toEqual([
      "plain", "lunch", "rest", "winding",
    ]);
    expect(result.selectedWindingPoints.map((item) => [item.id, item.place.kakaoPlaceId])).toEqual([["winding", "winding"]]);
    expect(result.rests.map((item) => item.id)).toEqual(["rest"]);
    expect(result.lunch?.id).toBe("lunch");
    expect(result.lunch?.place.kakaoPlaceId).toBe("lunch");
    expect(result.origin.kakaoPlaceId).toBe("origin");
    expect(result.destination.kakaoPlaceId).toBe("destination");
  });

  it("keeps the original ordered points available when schedule fields change after apply", () => {
    const points = [
      point("plain"),
      point("lunch", { kind: "stop", dwellMinutes: 60, stopRole: "lunch" }),
      point("rest", { kind: "optional", dwellMinutes: 30, stopRole: "rest" }),
    ];
    const result = prepareCollectionApplication(course(points));
    expect(result.orderedPoints).toEqual(points);
    expect(result.orderedPoints).not.toBe(points);
  });

  it("updates one meal in place without losing unrelated ordered points", () => {
    const points = [
      point("plain"),
      point("old-lunch", { kind: "stop", dwellMinutes: 60, stopRole: "lunch" }),
      point("duplicate-lunch", { kind: "stop", dwellMinutes: 60, stopRole: "lunch" }),
      point("tail"),
    ];
    const replacement = point("new-lunch", { kind: "stop", dwellMinutes: 60, stopRole: "lunch" });
    expect(replaceCollectionStop(points, "lunch", replacement).map((item) => item.id)).toEqual([
      "plain", "new-lunch", "tail",
    ]);
  });

  it("inserts a new winding point before lunch", () => {
    const points = [
      point("plain"),
      point("lunch", { kind: "stop", dwellMinutes: 60, stopRole: "lunch" }),
    ];
    expect(insertCollectionWinding(points, point("new-winding", { winding: true })).map((item) => item.id)).toEqual([
      "plain", "new-winding", "lunch",
    ]);
  });

  it("edits, reorders, and removes one rest occurrence without collapsing a repeated place", () => {
    const lunch = point("lunch", { kind: "stop", dwellMinutes: 60, stopRole: "lunch" });
    const dinner = point("dinner", { kind: "stop", dwellMinutes: 60, stopRole: "dinner" });
    const first = point("rest-a", { kakaoPlaceId: "same-place", kind: "optional", dwellMinutes: 30, stopRole: "rest" });
    const second = point("rest-b", { kakaoPlaceId: "same-place", kind: "optional", dwellMinutes: 45, stopRole: "rest" });
    const inserted = insertCollectionRest(insertCollectionRest([lunch, dinner], first), second);
    expect(inserted.map((item) => item.id)).toEqual(["lunch", "rest-a", "rest-b", "dinner"]);

    const moved = moveCollectionRest(inserted, "rest-b", -1);
    expect(moved.map((item) => item.id)).toEqual(["lunch", "rest-b", "rest-a", "dinner"]);
    expect(replaceCollectionOccurrence(moved, "rest-b", { ...second, dwellMinutes: 60 })[1].dwellMinutes).toBe(60);
    expect(removeCollectionOccurrence(moved, "rest-a").map((item) => item.id)).toEqual(["lunch", "rest-b", "dinner"]);
  });

  it("lets an applied winding point move across stops without reordering other points", () => {
    const points = [
      point("winding-a", { winding: true }),
      point("lunch", { kind: "stop", dwellMinutes: 60, stopRole: "lunch" }),
      point("winding-b", { winding: true }),
      point("rest", { kind: "optional", dwellMinutes: 30, stopRole: "rest" }),
    ];
    expect(moveCollectionWinding(points, 2, -1).map((item) => item.id)).toEqual([
      "winding-a", "winding-b", "lunch", "rest",
    ]);
    expect(moveCollectionWinding(points, 1, -1)).toBe(points);
  });

  it("removes only the selected applied winding point", () => {
    const points = [
      { ...point("plain"), uiKey: "plain-1" },
      { ...point("winding-a", { winding: true }), uiKey: "winding-a-1" },
      { ...point("winding-b", { winding: true }), uiKey: "winding-b-1" },
    ];
    expect(removeCollectionWinding(points, "winding-a-1").map((item) => item.id)).toEqual([
      "plain", "winding-b",
    ]);
  });

  it("removes one occurrence when a collection repeats the same winding place", () => {
    const points = [
      { ...point("first", { kakaoPlaceId: "same", winding: true }), uiKey: "same-1" },
      { ...point("lunch", { kind: "stop", dwellMinutes: 60, stopRole: "lunch" }), uiKey: "lunch-1" },
      { ...point("second", { kakaoPlaceId: "same", winding: true }), uiKey: "same-2" },
    ];
    expect(removeCollectionWinding(points, "same-1").map((item) => item.uiKey)).toEqual([
      "lunch-1", "same-2",
    ]);
  });

  it("gives repeated occurrences distinct accessible action names", () => {
    expect(appliedWindingActionLabel(1, "같은 고개", "제거")).toBe("1번째 같은 고개 제거");
    expect(appliedWindingActionLabel(3, "같은 고개", "제거")).toBe("3번째 같은 고개 제거");
  });

  it("replaces an existing lunch in its original ordered slot", () => {
    const points = [
      point("before"),
      point("lunch", { kind: "stop", dwellMinutes: 60, stopRole: "lunch" }),
      point("after"),
    ];
    const replacement = point("current-lunch", { kind: "stop", dwellMinutes: 60, stopRole: "lunch" });
    expect(replaceCollectionStop(points, "lunch", replacement).map((item) => item.id)).toEqual([
      "before", "current-lunch", "after",
    ]);
  });
});
