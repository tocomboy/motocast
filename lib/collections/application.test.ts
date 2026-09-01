import { describe, expect, it } from "vitest";

import {
  appliedWindingActionLabel,
  insertCollectionWinding,
  moveCollectionWinding,
  prepareCollectionApplication,
  removeCollectionWinding,
  replaceCollectionStop,
  setCollectionRestSelected,
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

describe("prepareCollectionApplication", () => {
  it("preserves the full ordered template while activating only selected winding/rest points", () => {
    const points = [
      point("plain"),
      point("winding-off", { winding: true, selected: false }),
      point("lunch", { kind: "stop", dwellMinutes: 60, stopRole: "lunch" }),
      point("rest-off", { kind: "optional", dwellMinutes: 30, stopRole: "rest", selected: false }),
      point("winding-on", { winding: true }),
    ];
    const result = prepareCollectionApplication(points);
    expect(result.orderedPoints.map((item) => item.id)).toEqual([
      "plain", "winding-off", "lunch", "rest-off", "winding-on",
    ]);
    expect(result.selectedWindingPoints.map((item) => item.kakaoPlaceId)).toEqual(["winding-on"]);
    expect(result.includeRest).toBe(false);
    expect(result.lunch?.kakaoPlaceId).toBe("lunch");
  });

  it("keeps the original ordered points available when schedule fields change after apply", () => {
    const points = [
      point("plain"),
      point("lunch", { kind: "stop", dwellMinutes: 60, stopRole: "lunch" }),
      point("rest", { kind: "optional", dwellMinutes: 30, stopRole: "rest" }),
    ];
    const result = prepareCollectionApplication(points);
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

  it("toggles only rest selection and inserts a new winding point before lunch", () => {
    const points = [
      point("plain"),
      point("rest", { kind: "optional", dwellMinutes: 30, stopRole: "rest", selected: false }),
      point("lunch", { kind: "stop", dwellMinutes: 60, stopRole: "lunch" }),
    ];
    const selected = setCollectionRestSelected(points, true);
    expect(selected.find((item) => item.id === "rest")?.selected).toBe(true);
    expect(insertCollectionWinding(selected, point("new-winding", { winding: true })).map((item) => item.id)).toEqual([
      "plain", "rest", "new-winding", "lunch",
    ]);
  });

  it("does not activate an unselected meal from an immutable template", () => {
    const result = prepareCollectionApplication([
      point("lunch-off", { kind: "stop", dwellMinutes: 60, stopRole: "lunch", selected: false }),
      point("dinner-off", { kind: "stop", dwellMinutes: 60, stopRole: "dinner", selected: false }),
    ]);
    expect(result.lunch).toBeNull();
    expect(result.dinner).toBeNull();
    expect(result.orderedPoints).toHaveLength(2);
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

  it("replaces an unselected lunch in its original ordered slot", () => {
    const points = [
      point("before"),
      point("lunch-off", { kind: "stop", dwellMinutes: 60, stopRole: "lunch", selected: false }),
      point("after"),
    ];
    const replacement = point("current-lunch", { kind: "stop", dwellMinutes: 60, stopRole: "lunch" });
    expect(replaceCollectionStop(points, "lunch", replacement).map((item) => item.id)).toEqual([
      "before", "current-lunch", "after",
    ]);
  });
});
