import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseSavedPlace, savedAsFavorite } from "@/lib/places/saved";
import { SavedPlacesManager } from "./saved-places-manager";

const mocks = vi.hoisted(() => ({
  controls: {} as Record<string, unknown>,
  pickerUnmount: vi.fn(),
}));
vi.mock("./saved-places-provider", () => ({
  useSavedPlaces: () => mocks.controls,
}));
vi.mock("./kakao-map-canvas", () => ({ KakaoMapCanvas: () => null }));
vi.mock("./place-search-field", () => ({ PlaceSearchField: ({ onSelect }: { onSelect: (place: unknown) => void }) => <button onClick={() => onSelect(saved.place)}>시험 장소 선택</button> }));
vi.mock("./map-point-confirmation", async () => {
  const { useEffect } = await import("react");
  return {
    MapPointConfirmation: () => {
      useEffect(() => () => mocks.pickerUnmount(), []);
      return null;
    },
  };
});
const saved = parseSavedPlace({
  id: "00000000-0000-4000-8000-000000000001",
  place: {
    kakaoPlaceId: "1",
    verificationToken: "a".repeat(43),
    name: "원래 장소",
    address: "경기 남양주시",
    roadAddress: null,
    latitude: 37.55,
    longitude: 127.24,
  },
  alias: "내 별명",
  kind: "riding_spot",
  province: "경기",
  star_slot: 1,
  revision: 1,
  created_at: "2026-10-02T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
});
const props = {
  onBack: vi.fn(),
  onAddWaypoint: vi.fn(() => null),
  routePoints: [],
};
function text(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  return ((node as { children?: unknown[] }).children ?? []).map(text).join("");
}
function button(r: ReactTestRenderer, label: string) {
  return r.root.findAllByType("button").find((b) => text(b) === label)!;
}
async function mount() {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<SavedPlacesManager {...props} />, {
      createNodeMock: () => ({ showModal: vi.fn(), focus: vi.fn() }),
    });
  });
  return r;
}
beforeEach(() => {
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
  mocks.controls = {
    accountEpoch: 1,
    places: [saved],
    favorites: [savedAsFavorite(saved)],
    status: "ready",
    busy: false,
    message: "",
    captureSnapshot: () => () => true,
    star: vi.fn(async () => true),
    deletePlace: vi.fn(async () => true),
  };
  props.onAddWaypoint.mockClear();
  mocks.pickerUnmount.mockClear();
});
afterEach(() => vi.unstubAllGlobals());
it("pin/list selection and confirmation cancellation send no write or waypoint requests", async () => {
  const r = await mount();
  await act(async () =>
    r.root.findByProps({ "aria-label": "내 별명 상세 보기" }).props.onClick(),
  );
  expect(props.onAddWaypoint).not.toHaveBeenCalled();
  await act(async () => r.root.findAllByProps({ "aria-label": "★ 별표 해제" })[0].props.onClick());
  expect(mocks.controls.star).not.toHaveBeenCalled();
  await act(async () => button(r, "취소").props.onClick());
  expect(mocks.controls.star).not.toHaveBeenCalled();
  await act(async () => button(r, "장소 삭제").props.onClick());
  await act(async () =>
    r.root
      .findByProps({ "aria-label": "이 장소를 삭제할까요? 닫기" })
      .props.onClick(),
  );
  expect(mocks.controls.deletePlace).not.toHaveBeenCalled();
  await act(async () => r.unmount());
});
it("explicit waypoint confirmation forwards role and dwell with the immutable original place", async () => {
  const r = await mount();
  await act(async () =>
    r.root.findByProps({ "aria-label": "내 별명 상세 보기" }).props.onClick(),
  );
  await act(async () => button(r, "경유지에 추가").props.onClick());
  expect(props.onAddWaypoint).not.toHaveBeenCalled();
  await act(async () => button(r, "휴식").props.onClick());
  await act(async () =>
    r.root
      .findByProps({ type: "number" })
      .props.onChange({ target: { value: "45" } }),
  );
  await act(async () => button(r, "경유지 추가하기").props.onClick());
  expect(props.onAddWaypoint).toHaveBeenCalledExactlyOnceWith(
    saved.place,
    "rest",
    45,
  );
  expect(saved.place.name).toBe("원래 장소");
  await act(async () => r.unmount());
});
it("meals forward the fixed 45 minutes without a dwell input and rest rejects an invalid dwell", async () => {
  const r = await mount();
  await act(async () =>
    r.root.findByProps({ "aria-label": "내 별명 상세 보기" }).props.onClick(),
  );
  await act(async () => button(r, "경유지에 추가").props.onClick());
  await act(async () => button(r, "휴식").props.onClick());
  await act(async () =>
    r.root.findByProps({ type: "number" }).props.onChange({ target: { value: "0" } }),
  );
  await act(async () => button(r, "경유지 추가하기").props.onClick());
  expect(text(r.root)).toContain("휴식 시간은 1~1440분 사이의 정수로 입력해 주세요.");
  expect(props.onAddWaypoint).not.toHaveBeenCalled();
  await act(async () => button(r, "식사").props.onClick());
  expect(r.root.findAllByProps({ type: "number" })).toHaveLength(0);
  expect(text(r.root)).toContain("식사는 45분으로 계산해요.");
  await act(async () => button(r, "경유지 추가하기").props.onClick());
  expect(props.onAddWaypoint).toHaveBeenCalledExactlyOnceWith(saved.place, "meal", 45);
  await act(async () => r.unmount());
});
it("opens the saved place detail only after a confirmed save and fresh list", async () => {
  mocks.controls.places = [];
  mocks.controls.favorites = [];
  mocks.controls.save = vi.fn(async () => { mocks.controls.places = [saved]; return true; });
  const r = await mount();
  await act(async () => r.root.findByProps({ "aria-label": "＋ 장소 등록" }).props.onClick());
  await act(async () => button(r, "시험 장소 선택").props.onClick());
  await act(async () => button(r, "저장 내용 확인").props.onClick());
  expect(mocks.controls.save).not.toHaveBeenCalled();
  await act(async () => button(r, "확인하고 저장").props.onClick());
  expect(mocks.controls.save).toHaveBeenCalledTimes(1);
  expect(r.root.findAllByProps({ "aria-label": "장소 상세" })).toHaveLength(1);
  expect(button(r, "경유지에 추가")).toBeDefined();
  expect(props.onAddWaypoint).not.toHaveBeenCalled();
  await act(async () => r.unmount());
});
it("account change discards all former-owner dialogs and coordinate/search selection", async () => {
  const r = await mount();
  await act(async () =>
    r.root.findByProps({ "aria-label": "내 별명 상세 보기" }).props.onClick(),
  );
  await act(async () => button(r, "별명·분류 수정").props.onClick());
  expect(r.root.findAllByType("dialog")).toHaveLength(2);
  mocks.controls = {
    ...mocks.controls,
    accountEpoch: 2,
    places: [],
    favorites: [],
  };
  await act(async () => r.update(<SavedPlacesManager {...props} />));
  expect(r.root.findAllByType("dialog")).toHaveLength(0);
  expect(text(r.root)).not.toContain("내 별명");
  expect(mocks.pickerUnmount).toHaveBeenCalledTimes(1);
  expect(props.onAddWaypoint).not.toHaveBeenCalled();
  await act(async () => r.unmount());
});
