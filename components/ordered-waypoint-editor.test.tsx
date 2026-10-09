import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaceSearchResult } from "@/lib/places/search";
import type { EditableWaypoint } from "@/lib/planner/ordered-waypoints";

// Shared folders are off here: these tests cover the #123 personal-place behavior.
vi.mock("./shared-folders-provider", async () => {
  const React = await import("react");
  const actual = await vi.importActual<typeof import("./shared-folders-provider")>("./shared-folders-provider");
  return { ...actual, useSharedFolders: () => React.useMemo(() => ({ accountEpoch: 0, enabled: false, status: "ready", snapshot: { userId: null, folders: [], members: [], preferences: [], places: [], stars: [], avoided: [] }, busy: false, verifying: false, message: "", current: () => ({ status: "ready", snapshot: { userId: null, folders: [], members: [], preferences: [], places: [], stars: [], avoided: [] } }), retry: () => undefined, refresh: async () => null, reloadStars: async () => undefined, captureSnapshot: () => () => true, recheck: async () => "unreadable", write: async () => ({ ok: false, reason: "blocked", title: "", message: "" }), call: async () => ({ data: null, code: "UNAVAILABLE", lost: false }) }), []) };
});
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

const savedControls = vi.hoisted(() => ({ accountEpoch: 1, places: [] as unknown[], favorites: [], status: "ready", busy: false, message: "", retry: vi.fn(), captureSnapshot: () => () => true }));
vi.mock("./saved-places-provider", () => ({ useSavedPlaces: () => savedControls }));
vi.mock("./kakao-map-canvas", () => ({ KakaoMapCanvas: () => null }));
vi.mock("./map-point-confirmation", () => ({ MapPointConfirmation: () => null }));

import { OrderedWaypointEditor } from "./ordered-waypoint-editor";

function Harness() {
  const [waypoints, setWaypoints] = useState<EditableWaypoint[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      <OrderedWaypointEditor
        connected
        favorites={{ ...savedControls, status: "ready", add: async () => true, remove: async () => true }}
        selectionRevision={0}
        waypoints={waypoints}
        onChange={setWaypoints}
        onStatus={setStatus}
        onError={setError}
      />
      <output>{status}</output>
      <output data-error>{error}</output>
    </>
  );
}

describe("OrderedWaypointEditor", () => {
  let sequence = 0;

  beforeEach(() => {
    sequence = 0;
    vi.stubGlobal("HTMLElement", class {});
    savedControls.places = [{ id: "saved1", place: { kakaoPlaceId: "same", verificationToken: "a".repeat(43), name: "원래 장소", address: "서울 중구", roadAddress: "", latitude: 37.56, longitude: 126.97 }, alias: "내 별명", kind: "restaurant", province: "서울", starSlot: 1, revision: 1 }];
    vi.stubGlobal("crypto", { randomUUID: () => `waypoint-${++sequence}` });
    vi.stubGlobal("document", { querySelectorAll: () => [] });
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => { callback(); return 1; } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("adds typed stops and reorders them in one shared visit sequence", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Harness />, { createNodeMock: (element) => element.type === "dialog" ? { showModal: vi.fn(), close: vi.fn() } : {} }); });

    const add = () => renderer.root.findByProps({ className: "text-button" });
    const chooseRole = (label: string) => renderer.root.findAllByType("button").find((button) => button.children.includes(label))!;
    const applyAdd = () => renderer.root.findAllByType("button").find((button) => button.children.includes("추가하고 장소 선택"))!;

    await act(async () => add().props.onClick());
    await act(async () => chooseRole("식사").props.onClick());
    await act(async () => applyAdd().props.onClick());
    await act(async () => renderer.root.findByProps({ "data-place-label": "1번째 식사 장소" }).props.onClick());

    await act(async () => add().props.onClick());
    await act(async () => applyAdd().props.onClick());
    await act(async () => renderer.root.findByProps({ "data-place-label": "2번째 경유지 장소" }).props.onClick());
    await act(async () => renderer.root.findByProps({ "aria-label": "2번째 경유지 위로 이동" }).props.onClick());
    await act(async () => renderer.root.findByProps({ "aria-label": "1번째 경유지 아래로 이동" }).props.onClick());

    await act(async () => add().props.onClick());
    await act(async () => chooseRole("휴식").props.onClick());
    await act(async () => applyAdd().props.onClick());

    const list = renderer.root.findByProps({ "aria-label": "경유지 방문 순서" });
    expect(list.findAll((item) => typeof item.props["data-place-label"] === "string").map((item) => item.props["data-place-label"])).toEqual([
      "1번째 식사 장소", "2번째 경유지 장소", "3번째 휴식 장소",
    ]);
    expect(renderer.root.findAllByType("output")[0].children.join("")).toContain("휴식");

    await act(async () => add().props.onClick());
    await act(async () => chooseRole("식사").props.onClick());
    await act(async () => applyAdd().props.onClick());
    expect(renderer.root.findByProps({ "data-error": true }).children.join("")).toBe("");
    expect(renderer.root.findAllByProps({ "data-place-label": "4번째 식사 장소" })).toHaveLength(1);

    await act(async () => renderer.unmount());
  });

  it("allows another meal and applies the new role default dwell", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Harness />, { createNodeMock: (element) => element.type === "dialog" ? { showModal: vi.fn(), close: vi.fn() } : {} }); });
    const add = () => renderer.root.findByProps({ className: "text-button" });
    const chooseRole = (label: string) => renderer.root.findAllByType("button").find((button) => button.children.includes(label))!;
    const applyAdd = () => renderer.root.findAllByType("button").find((button) => button.children.includes("추가하고 장소 선택"))!;
    await act(async () => add().props.onClick());
    await act(async () => chooseRole("식사").props.onClick());
    // Meals show the fixed-duration note instead of a dwell input.
    expect(renderer.root.findAllByProps({ className: "dwell-stepper" })).toHaveLength(0);
    expect(renderer.root.findByProps({ className: "meal-dwell-note" }).children).toEqual(["식사는 45분으로 계산해요."]);
    await act(async () => applyAdd().props.onClick());
    await act(async () => add().props.onClick());
    await act(async () => chooseRole("휴식").props.onClick());
    await act(async () => applyAdd().props.onClick());

    await act(async () => renderer.root.findByProps({ "aria-label": "경유 2 설정" }).props.onClick());
    await act(async () => renderer.root.findAllByProps({ "aria-pressed": false }).find((button) => button.children.includes("식사"))!.props.onClick());
    await act(async () => renderer.root.findAllByType("button").find((button) => button.children.includes("설정 적용"))!.props.onClick());
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(renderer.root.findByProps({ "aria-label": "경유 2 설정" }).children.join("")).toBe("식사 45분");
    // Rest keeps its editable stepper.
    await act(async () => renderer.root.findByProps({ "aria-label": "경유 2 설정" }).props.onClick());
    await act(async () => renderer.root.findAllByProps({ "aria-pressed": false }).find((button) => button.children.includes("휴식"))!.props.onClick());
    expect(renderer.root.findAllByProps({ className: "dwell-stepper" })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ className: "meal-dwell-note" })).toHaveLength(0);

    await act(async () => renderer.root.findAllByProps({ "aria-pressed": false }).find((button) => button.children.includes("통과"))!.props.onClick());
    expect(renderer.root.findAllByProps({ className: "dwell-stepper" })).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

it("selects repeated saved meals only on confirmation and preserves add settings on back", async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<Harness />, { createNodeMock: () => ({ showModal: vi.fn(), close: vi.fn(), focus: vi.fn() }) }); });
  const click = async (label: string) => act(async () => renderer.root.findAllByType("button").find(b => b.children.includes(label))!.props.onClick());
  await act(async () => renderer.root.findByProps({ "aria-label": "+ 경유지 추가" }).props.onClick());
  // A rest's edited dwell survives a round trip through the saved places.
  await click("휴식");
  await act(async () => renderer.root.findByProps({ "aria-label": "머무는 시간 10분 늘리기" }).props.onClick());
  await click("즐겨찾기에서 선택");
  expect(renderer.root.findAllByProps({ className: "ordered-waypoint waypoint-card" })).toHaveLength(0);
  await act(async () => renderer.root.findByProps({ "aria-label": "뒤로" }).props.onClick());
  expect(renderer.root.findByProps({ className: "dwell-stepper" }).findByType("strong").children).toEqual(["40", "분"]);
  await click("식사");
  for (let i = 0; i < 3; i++) {
    if (i) { await act(async () => renderer.root.findByProps({ "aria-label": "+ 경유지 추가" }).props.onClick()); await click("식사"); }
    await click("즐겨찾기에서 선택");
    await click("식당");
    await act(async () => renderer.root.findByProps({ "aria-label": "내 별명 상세 보기" }).props.onClick());
    await click("경유지에 추가");
    expect(renderer.root.findAllByProps({ className: "ordered-waypoint waypoint-card" })).toHaveLength(i);
    await click("경유지 추가하기");
  }
  const cards = renderer.root.findAllByProps({ className: "ordered-waypoint waypoint-card" });
  expect(cards).toHaveLength(3);
  expect(new Set(cards.map(c => c.props["data-waypoint-id"])).size).toBe(3);
  expect(cards.map((card) => card.findByProps({ "aria-label": `경유 ${cards.indexOf(card) + 1} 설정` }).children.join(""))).toEqual(["식사 45분", "식사 45분", "식사 45분"]);
  await act(async () => renderer.unmount());
});

});
