import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaceSearchResult } from "@/lib/places/search";
import type { EditableWaypoint } from "@/lib/planner/ordered-waypoints";

vi.mock("@/components/place-search-field", () => ({
  PlaceSearchField: ({ label, onSelect }: { label: string; onSelect: (place: PlaceSearchResult | null) => void }) => (
    <button type="button" data-place-label={label} onClick={() => onSelect({
      kakaoPlaceId: label,
      verificationToken: "a".repeat(43),
      name: label,
      address: "테스트 주소",
      roadAddress: null,
      longitude: 127,
      latitude: 37,
      category: "",
      phone: null,
      placeUrl: null,
    })}>{label}</button>
  ),
}));

import { OrderedWaypointEditor } from "./ordered-waypoint-editor";

function Harness() {
  const [waypoints, setWaypoints] = useState<EditableWaypoint[]>([]);
  const [status, setStatus] = useState("");
  return (
    <>
      <OrderedWaypointEditor
        connected
        selectionRevision={0}
        waypoints={waypoints}
        onChange={setWaypoints}
        onStatus={setStatus}
      />
      <output>{status}</output>
    </>
  );
}

describe("OrderedWaypointEditor", () => {
  let sequence = 0;

  beforeEach(() => {
    sequence = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `waypoint-${++sequence}` });
    vi.stubGlobal("document", { querySelectorAll: () => [] });
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => { callback(); return 1; } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("adds typed stops and reorders them in one shared visit sequence", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Harness />); });

    const add = () => renderer.root.findByProps({ className: "text-button" });
    const addRole = () => renderer.root.findByProps({ "aria-label": "추가할 종류" });

    await act(async () => addRole().props.onChange({ target: { value: "lunch" } }));
    await act(async () => add().props.onClick());
    await act(async () => renderer.root.findByProps({ "data-place-label": "1번째 점심 장소" }).props.onClick());

    await act(async () => addRole().props.onChange({ target: { value: "waypoint" } }));
    await act(async () => add().props.onClick());
    await act(async () => renderer.root.findByProps({ "data-place-label": "2번째 경유지 장소" }).props.onClick());
    await act(async () => renderer.root.findByProps({ "aria-label": "2번째 경유지 위로 이동" }).props.onClick());

    await act(async () => addRole().props.onChange({ target: { value: "rest" } }));
    await act(async () => add().props.onClick());

    const list = renderer.root.findByProps({ "aria-label": "경유지 방문 순서" });
    expect(list.findAllByType("li").map((item) => item.findByType("select").props.value)).toEqual([
      "waypoint", "lunch", "rest",
    ]);
    expect(renderer.root.findByProps({ "aria-label": "2번째 경유지 종류" }).props.value).toBe("lunch");
    expect(renderer.root.findByProps({ "aria-label": "3번째 경유지 종류" }).props.value).toBe("rest");
    expect(renderer.root.findAllByType("output")[0].children.join("")).toContain("휴식");

    await act(async () => renderer.unmount());
  });
});
