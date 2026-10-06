import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseSavedPlaceEntry, type SavedPlaceEntry } from "@/lib/places/saved";
import type { PlaceFavorite } from "@/lib/places/favorites";
import type { PlaceSearchResult } from "@/lib/places/search";
import { SavedPlacesManager } from "./saved-places-manager";

const mocks = vi.hoisted(() => ({
  controls: {} as Record<string, unknown>,
  pickerUnmount: vi.fn(),
  canvases: [] as Array<Record<string, unknown>>,
  mapSelect: null as null | ((place: unknown) => void),
  invoke: vi.fn(),
}));
vi.mock("./saved-places-provider", () => ({
  useSavedPlaces: () => mocks.controls,
}));
vi.mock("@/lib/supabase/browser", () => ({ getBrowserSupabase: () => ({ functions: { invoke: mocks.invoke } }) }));
vi.mock("./kakao-map-canvas", () => ({
  KakaoMapCanvas: (props: Record<string, unknown>) => {
    mocks.canvases.push(props);
    const handle = props.centerHandle as { current: unknown } | undefined;
    if (handle) handle.current = { getCenter: () => ({ latitude: 37.5, longitude: 127.1 }) };
    return null;
  },
}));
vi.mock("./place-search-field", () => ({ PlaceSearchField: () => <span>장소 검색 팝업</span> }));
vi.mock("./map-point-confirmation", async () => {
  const actual = await vi.importActual<typeof import("./map-point-confirmation")>("./map-point-confirmation");
  const { useEffect } = await import("react");
  return {
    resolveMapPoint: actual.resolveMapPoint,
    MapPointConfirmation: ({ onSelect }: { onSelect: (place: unknown) => void }) => {
      mocks.mapSelect = onSelect;
      useEffect(() => () => mocks.pickerUnmount(), []);
      return null;
    },
  };
});
const saved = parseSavedPlaceEntry({
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
  star_position: 1,
  revision: 1,
  created_at: "2026-10-02T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
});
const favorite = (row: SavedPlaceEntry): PlaceFavorite => ({ slot: row.starPosition!, place: row.place, createdAt: row.createdAt, displayName: row.alias ?? row.place.name });
const entry = (index: number, star: number | null, extra: Record<string, unknown> = {}) => parseSavedPlaceEntry({
  id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`,
  place: { kakaoPlaceId: `k${index}`, verificationToken: "a".repeat(43), name: `장소 ${index}`, address: "경기 양평군", roadAddress: null, latitude: 37.5 + index / 100, longitude: 127.2 },
  alias: null,
  kind: "restaurant",
  province: "경기",
  star_slot: star !== null && star <= 5 ? star : null,
  star_position: star,
  revision: 1,
  created_at: "2026-10-02T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
  ...extra,
});
const searchResult = (index: number): PlaceSearchResult => ({ kakaoPlaceId: `s${index}`, verificationToken: "b".repeat(43), name: `막국수 ${index}`, address: `경기 양평군 ${index}`, roadAddress: null, latitude: 37.5 + index / 1000, longitude: 127.3, category: "음식점", phone: null, placeUrl: null });
const regionPlace: PlaceSearchResult = { kakaoPlaceId: "map:37.5000000:127.1000000:region", verificationToken: "c".repeat(43), name: "양평군 서종면 부근", address: "경기도 양평군 서종면 문호리", roadAddress: null, latitude: 37.5, longitude: 127.1, category: "지도에서 선택 · 상세 주소 없음", phone: null, placeUrl: null };
function dialogNamed(r: ReactTestRenderer, label: string) {
  return r.root.findAll((node) => node.type === "dialog" && node.props["aria-label"] === label)[0];
}
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
    favorites: [favorite(saved)],
    status: "ready",
    busy: false,
    message: "",
    failureTitle: "",
    captureSnapshot: () => () => true,
    star: vi.fn(async () => ({ ok: true })),
    deletePlace: vi.fn(async () => ({ ok: true })),
  };
  props.onAddWaypoint.mockClear();
  mocks.pickerUnmount.mockClear();
  mocks.canvases = [];
  mocks.mapSelect = null;
  mocks.invoke.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
it("pin/list selection and confirmation cancellation send no write or waypoint requests", async () => {
  const r = await mount();
  await act(async () =>
    r.root.findByProps({ "aria-label": "내 별명 상세 보기" }).props.onClick(),
  );
  expect(props.onAddWaypoint).not.toHaveBeenCalled();
  await act(async () => r.root.findAllByProps({ "aria-label": "자주 찾는 장소에서 빼기" })[0].props.onClick());
  expect(mocks.controls.star).not.toHaveBeenCalled();
  await act(async () => button(r, "취소").props.onClick());
  expect(mocks.controls.star).not.toHaveBeenCalled();
  await act(async () => button(r, "장소 삭제").props.onClick());
  // FP37: the popup has no X; cancel, Escape and the backdrop only close it.
  expect(text(r.root)).toContain("되돌릴 수 없어요");
  const popup = () => r.root.findAll((node) => node.type === "dialog" && text(node).includes("이 장소를 삭제할까요?"));
  await act(async () => popup()[0].props.onCancel({ preventDefault: vi.fn(), stopPropagation: vi.fn() }));
  expect(popup()).toHaveLength(0);
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
  mocks.controls.save = vi.fn(async () => { mocks.controls.places = [saved]; return { ok: true, id: saved.id, duplicate: false }; });
  mocks.invoke.mockResolvedValue({ data: { places: [saved.place], isEnd: true }, error: null });
  const r = await mount();
  await act(async () => r.root.findByProps({ "aria-label": "＋ 장소 등록" }).props.onClick());
  await act(async () => r.root.findByProps({ placeholder: "예: 서종 막국수, 양평군 서종면" }).props.onChange({ target: { value: "원래 장소" } }));
  await act(async () => r.root.findByProps({ role: "search" }).props.onSubmit({ preventDefault: vi.fn() }));
  await act(async () => button(r, "1번 원래 장소 선택선택한 장소로 진행").props.onClick());
  await act(async () => button(r, "장소 저장").props.onClick());
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

it("names the frequent places, shows 10 / 10, and disables adding an 11th star", async () => {
  const stars = Array.from({ length: 10 }, (_, index) => entry(index, index + 1));
  const plain = entry(10, null, { alias: "새 쉼터" });
  mocks.controls.places = [...stars, plain];
  mocks.controls.favorites = stars.map(favorite);
  const r = await mount();
  await act(async () => button(r, "자주 찾는 장소").props.onClick());
  expect(text(r.root)).toContain("자주 찾는 장소10 / 10");
  expect(text(r.root)).not.toContain("자주 찾는 곳");
  expect(r.root.findAllByProps({ "aria-label": "자주 찾는 장소에서 빼기" }).filter((n) => n.type === "button")).toHaveLength(10);
  await act(async () => button(r, "식당").props.onClick());
  const add = r.root.findAllByProps({ "aria-label": "자주 찾는 장소에 추가" }).filter((n) => n.type === "button");
  expect(add).toHaveLength(1);
  // FP36: the empty star in a full list explains the limit without sending anything.
  await act(async () => add[0].props.onClick());
  expect(text(r.root)).toContain("자주 찾는 장소 10곳이 모두 찼어요");
  expect(text(r.root)).toContain("아무것도 바뀌지 않았어요.");
  await act(async () => button(r, "닫기").props.onClick());
  expect(text(r.root)).not.toContain("자주 찾는 장소 10곳이 모두 찼어요");
  await act(async () => r.root.findByProps({ "aria-label": "새 쉼터 상세 보기" }).props.onClick());
  const detail = r.root.findAllByProps({ "aria-label": "자주 찾는 장소에 추가" }).filter((n) => n.type === "button").at(-1)!;
  expect(detail.props.disabled).toBe(true);
  expect(text(detail)).toContain("10 / 10 가득 참");
  expect(text(r.root)).toContain("자주 찾는 장소 10곳이 모두 찼어요.");
  expect(mocks.controls.star).not.toHaveBeenCalled();
  await act(async () => r.unmount());
});

it("shows the server's 11th-star rejection as an error in the detail", async () => {
  const plain = entry(1, null, { alias: "새 쉼터", kind: "riding_spot" });
  mocks.controls.places = [plain];
  mocks.controls.favorites = [];
  mocks.controls.failureTitle = "자주 찾는 장소에 추가하지 못했어요";
  mocks.controls.message = "이미 10곳이 별표돼 있어요. 다른 기기에서 먼저 추가했을 수 있어요. 목록을 새로 불러왔어요.";
  const r = await mount();
  await act(async () => r.root.findByProps({ "aria-label": "새 쉼터 상세 보기" }).props.onClick());
  const alerts = r.root.findAllByProps({ role: "alert" }).map(text);
  expect(alerts).toContain("자주 찾는 장소에 추가하지 못했어요이미 10곳이 별표돼 있어요. 다른 기기에서 먼저 추가했을 수 있어요. 목록을 새로 불러왔어요.");
  await act(async () => r.unmount());
});

it("registration search lists no frequent places and moves the result map with the selection", async () => {
  mocks.invoke.mockResolvedValue({ data: { places: [searchResult(1), searchResult(2), searchResult(3)], isEnd: true }, error: null });
  const r = await mount();
  await act(async () => r.root.findByProps({ "aria-label": "＋ 장소 등록" }).props.onClick());
  const registration = () => dialogNamed(r, "장소 등록");
  expect(text(registration())).not.toContain("자주 찾는 장소");
  expect(text(registration())).not.toContain("장소 검색 팝업");
  expect(button(r, "검색").props.disabled).toBe(true);
  await act(async () => r.root.findByProps({ placeholder: "예: 서종 막국수, 양평군 서종면" }).props.onChange({ target: { value: "막국수" } }));
  await act(async () => r.root.findByProps({ role: "search" }).props.onSubmit({ preventDefault: vi.fn() }));
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("search-places", { body: { query: "막국수", page: 1, size: 10 } });
  const resultMap = () => mocks.canvases.filter((canvas) => Array.isArray(canvas.numberedPins) && (canvas.numberedPins as unknown[]).length).at(-1)!;
  expect(resultMap().numberedPins).toEqual([1, 2, 3].map((n) => expect.objectContaining({ id: `s${n}`, number: n })));
  expect(resultMap().selectedNumberedPinId).toBe("s1");
  expect(text(registration())).not.toContain("자주 찾는 장소");
  await act(async () => r.root.findAll((n) => n.type === "button" && n.props["aria-pressed"] === false && text(n).includes("막국수 3"))[0].props.onClick());
  expect(resultMap().selectedNumberedPinId).toBe("s3");
  await act(async () => (resultMap().onSelectNumberedPin as (id: string) => void)("s2"));
  expect(button(r, "2번 막국수 2 선택선택한 장소로 진행")).toBeDefined();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  await act(async () => r.unmount());
});

it("shows empty and failed registration searches without faking results", async () => {
  mocks.invoke.mockResolvedValueOnce({ data: { places: [], isEnd: true }, error: null }).mockResolvedValueOnce({ data: null, error: new Error("offline") });
  const r = await mount();
  await act(async () => r.root.findByProps({ "aria-label": "＋ 장소 등록" }).props.onClick());
  await act(async () => r.root.findByProps({ placeholder: "예: 서종 막국수, 양평군 서종면" }).props.onChange({ target: { value: "없는 집" } }));
  await act(async () => r.root.findByProps({ role: "search" }).props.onSubmit({ preventDefault: vi.fn() }));
  expect(text(r.root)).toContain("‘없는 집’ 검색 결과가 없어요");
  await act(async () => r.root.findByProps({ role: "search" }).props.onSubmit({ preventDefault: vi.fn() }));
  expect(text(r.root)).toContain("장소를 검색하지 못했어요");
  expect(button(r, "다시 검색")).toBeDefined();
  expect(r.root.findByProps({ placeholder: "예: 서종 막국수, 양평군 서종면" }).props.value).toBe("없는 집");
  await act(async () => r.unmount());
});

it("picks a map point inside registration with the region opt-in and requires an alias", async () => {
  mocks.invoke.mockResolvedValue({ data: { places: [regionPlace], isEnd: true }, error: null });
  mocks.controls.save = vi.fn(async () => ({ ok: true, duplicate: false }));
  const r = await mount();
  await act(async () => r.root.findByProps({ "aria-label": "＋ 장소 등록" }).props.onClick());
  await act(async () => button(r, "지도에서 지점 고르기").props.onClick());
  expect(mocks.canvases.at(-1)).toMatchObject({ centerPicker: true });
  await act(async () => button(r, "이 지점 선택").props.onClick());
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("search-places", { body: { mode: "coordinate", latitude: 37.5, longitude: 127.1, fallback: "region" } });
  expect(text(r.root)).toContain("상세 주소 없음");
  expect(text(r.root)).toContain("37.5000, 127.1000");
  await act(async () => button(r, "별명 정하고 저장").props.onClick());
  expect(text(dialogNamed(r, "내 장소로 저장"))).toContain("별명 (필수)");
  await act(async () => button(r, "장소 저장").props.onClick());
  expect(text(r.root)).toContain("별명을 입력해 주세요. 상세 주소가 없는 지점은 별명이 있어야 저장할 수 있어요.");
  expect(button(r, "확인하고 저장")).toBeUndefined();
  await act(async () => r.root.findByProps({ placeholder: "예: 서종 강변 쉼터" }).props.onChange({ target: { value: "서종 강변 쉼터" } }));
  await act(async () => button(r, "장소 저장").props.onClick());
  await act(async () => button(r, "확인하고 저장").props.onClick());
  expect(mocks.controls.save).toHaveBeenCalledExactlyOnceWith(regionPlace, "서종 강변 쉼터", "riding_spot", false);
  await act(async () => r.unmount());
});

it("long-pressed region points open the alias-required form and keep the star toggle within 10", async () => {
  const stars = Array.from({ length: 10 }, (_, index) => entry(index, index + 1));
  mocks.controls.places = stars;
  mocks.controls.favorites = stars.map(favorite);
  const r = await mount();
  await act(async () => mocks.mapSelect?.(regionPlace));
  const form = dialogNamed(r, "내 장소로 저장");
  expect(text(form)).toContain("상세 주소 없음");
  const toggle = form.findAll((n) => n.type === "button" && text(n).startsWith("☆ 자주 찾는 장소에 추가"))[0];
  expect(toggle.props.disabled).toBe(true);
  expect(text(toggle)).toContain("10 / 10 가득 참");
  await act(async () => r.unmount());
});

it("lists same-coordinate cluster places in a sheet and opens the chosen detail", async () => {
  const a = entry(1, 1, { alias: "팔당 라이딩 카페" });
  const b = entry(2, null, { alias: "팔당 카페 식당" });
  mocks.controls.places = [a, b];
  mocks.controls.favorites = [favorite(a)];
  const r = await mount();
  const map = mocks.canvases.find((canvas) => canvas.onSelectSavedCluster)!;
  expect(map.savedPins).toEqual([expect.objectContaining({ id: a.id, starred: true }), expect.objectContaining({ id: b.id, starred: false })]);
  await act(async () => (map.onSelectSavedCluster as (ids: string[]) => void)([a.id, b.id]));
  expect(text(r.root)).toContain("이 위치의 장소 2곳");
  await act(async () => r.root.findAllByProps({ "aria-label": "팔당 카페 식당 상세 보기" }).at(-1)!.props.onClick());
  expect(text(r.root)).not.toContain("이 위치의 장소 2곳");
  expect(mocks.canvases.some((canvas) => canvas.selectedSavedPinId === b.id)).toBe(true);
  await act(async () => r.unmount());
});

it("returns from the map picker to the same search query without a new request", async () => {
  mocks.invoke.mockResolvedValue({ data: { places: [searchResult(1)], isEnd: true }, error: null });
  const r = await mount();
  await act(async () => r.root.findByProps({ "aria-label": "＋ 장소 등록" }).props.onClick());
  await act(async () => r.root.findByProps({ placeholder: "예: 서종 막국수, 양평군 서종면" }).props.onChange({ target: { value: "막국수" } }));
  await act(async () => r.root.findByProps({ role: "search" }).props.onSubmit({ preventDefault: vi.fn() }));
  await act(async () => button(r, "지도에서 지점 고르기").props.onClick());
  await act(async () => r.root.findByProps({ "aria-label": "지도에서 지점 고르기 뒤로" }).props.onClick());
  expect(r.root.findByProps({ placeholder: "예: 서종 막국수, 양평군 서종면" }).props.value).toBe("막국수");
  expect(button(r, "1번 막국수 1 선택선택한 장소로 진행")).toBeDefined();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  await act(async () => r.unmount());
});

it("shows a tapped pin as a preview card under the map and opens the detail only from the card", async () => {
  const r = await mount();
  const map = mocks.canvases.find((canvas) => canvas.onSelectSavedCluster)!;
  await act(async () => (map.onSelectSavedPin as (id: string) => void)(saved.id));
  expect(r.root.findAllByType("dialog")).toHaveLength(0);
  expect(mocks.canvases.at(-2)?.selectedSavedPinId ?? mocks.canvases.at(-1)?.selectedSavedPinId).toBe(saved.id);
  const previews = r.root.findAllByProps({ "aria-label": "내 별명 상세 보기" });
  expect(previews).toHaveLength(2);
  await act(async () => previews[0].props.onClick());
  const detail = dialogNamed(r, "장소 상세");
  expect(detail).toBeDefined();
  // FP02: actions are body buttons in this order, with no fixed footer.
  expect(detail.findAllByType("button").map(text).filter((label) => ["경유지에 추가", "별명·분류 수정", "장소 삭제"].includes(label))).toEqual(["경유지에 추가", "별명·분류 수정", "장소 삭제"]);
  await act(async () => r.unmount());
});

it("keeps one picker map on the chosen point and locks dragging while the address is checked", async () => {
  let resolve!: (value: unknown) => void;
  mocks.invoke.mockReturnValue(new Promise((done) => { resolve = done; }));
  const r = await mount();
  await act(async () => r.root.findByProps({ "aria-label": "＋ 장소 등록" }).props.onClick());
  await act(async () => button(r, "지도에서 지점 고르기").props.onClick());
  await act(async () => button(r, "이 지점 선택").props.onClick());
  const picker = mocks.canvases.filter((canvas) => canvas.centerPicker).at(-1)!;
  expect(picker.centerLocked).toBe(true);
  expect(mocks.canvases.some((canvas) => canvas.selectionPreview)).toBe(false);
  expect(text(r.root)).toContain("주소를 확인하고 있어요");
  await act(async () => button(r, "조회 취소").props.onClick());
  expect(mocks.canvases.filter((canvas) => canvas.centerPicker).at(-1)!.centerLocked).toBe(false);
  await act(async () => resolve({ data: { places: [regionPlace], isEnd: true }, error: null }));
  expect(button(r, "별명 정하고 저장")).toBeUndefined();
  await act(async () => r.unmount());
});

async function openRegionSave(r: ReactTestRenderer) {
  await act(async () => mocks.mapSelect?.(regionPlace));
  await act(async () => r.root.findByProps({ placeholder: "예: 서종 강변 쉼터" }).props.onChange({ target: { value: "서종 강변 쉼터" } }));
  await act(async () => button(r, "☆ 자주 찾는 장소에 추가 · 1 / 10").props.onClick());
  await act(async () => button(r, "장소 저장").props.onClick());
}

it("shows the FP29 save popup, a busy confirm, and closes only after the save lands", async () => {
  let finish!: (value: unknown) => void;
  mocks.controls.save = vi.fn(() => new Promise((done) => { finish = done; }));
  const r = await mount();
  await openRegionSave(r);
  const popup = text(r.root.findAll((node) => node.type === "dialog" && text(node).includes("이 장소를 저장할까요?"))[0]);
  for (const part of ["원래 이름 · 양평군 서종면 부근", "별명서종 강변 쉼터", "분류라이딩 스팟", "주소상세 주소 없음 · 경기도 양평군 서종면 문호리", "자주 찾는 장소추가1 → 2 / 10", "원래 위치는 그대로 저장돼요."]) expect(popup).toContain(part);
  await act(async () => button(r, "확인하고 저장").props.onClick());
  expect(button(r, "저장하는 중…").props.disabled).toBe(true);
  expect(r.root.findAllByType("button").filter((b) => text(b) === "취소").at(-1)!.props.disabled).toBe(true);
  await act(async () => finish({ ok: true, id: saved.id, duplicate: false }));
  expect(mocks.controls.save).toHaveBeenCalledExactlyOnceWith(regionPlace, "서종 강변 쉼터", "riding_spot", true);
  expect(text(r.root)).not.toContain("이 장소를 저장할까요?");
  await act(async () => r.unmount());
});

it("keeps the popup after an unknown result and sends again only when the rider confirms", async () => {
  mocks.controls.save = vi.fn()
    .mockResolvedValueOnce({ ok: false, reason: "unknown", title: "변경을 확인하지 못했어요", message: "저장됐는지 확인했는데 반영되지 않았어요. 입력 내용은 그대로예요." })
    .mockResolvedValueOnce({ ok: true, id: saved.id, duplicate: false });
  const r = await mount();
  await openRegionSave(r);
  await act(async () => button(r, "확인하고 저장").props.onClick());
  expect(text(r.root)).toContain("저장됐는지 확인했는데 반영되지 않았어요. 입력 내용은 그대로예요.");
  expect(mocks.controls.save).toHaveBeenCalledTimes(1);
  await act(async () => button(r, "다시 시도").props.onClick());
  expect(mocks.controls.save).toHaveBeenCalledTimes(2);
  expect(text(r.root)).not.toContain("이 장소를 저장할까요?");
  await act(async () => r.unmount());
});

it("offers the existing place for a duplicate save and re-confirms without a star after an 11th-star refusal", async () => {
  mocks.controls.save = vi.fn()
    .mockResolvedValueOnce({ ok: false, reason: "star_limit", title: "자주 찾는 장소에 추가하지 못했어요", message: "" })
    .mockResolvedValueOnce({ ok: true, id: saved.id, duplicate: true });
  const r = await mount();
  await openRegionSave(r);
  await act(async () => button(r, "확인하고 저장").props.onClick());
  expect(text(r.root)).toContain("별표 없이 저장할지 다시 확인해 주세요.");
  expect(text(r.root)).toContain("추가 안 함");
  await act(async () => button(r, "확인하고 저장").props.onClick());
  expect(mocks.controls.save).toHaveBeenLastCalledWith(regionPlace, "서종 강변 쉼터", "riding_spot", false);
  expect(text(r.root)).toContain("이미 저장한 장소예요");
  await act(async () => button(r, "기존 장소 열기").props.onClick());
  expect(r.root.findAll((node) => node.type === "dialog" && node.props["aria-label"] === "장소 상세")).toHaveLength(1);
  await act(async () => r.unmount());
});

it("confirms a delete with the red button and the star count it removes (FP37)", async () => {
  const r = await mount();
  await act(async () => r.root.findByProps({ "aria-label": "내 별명 상세 보기" }).props.onClick());
  await act(async () => button(r, "장소 삭제").props.onClick());
  const popup = r.root.findAll((node) => node.type === "dialog" && text(node).includes("이 장소를 삭제할까요?"))[0];
  expect(text(popup)).toContain("자주 찾는 장소에서도 빠져요1 → 0 / 10");
  expect(text(popup)).toContain("원래 이름 · 원래 장소");
  await act(async () => popup.findAllByType("button").find((b) => text(b) === "장소 삭제")!.props.onClick());
  expect(mocks.controls.deletePlace).toHaveBeenCalledTimes(1);
  await act(async () => r.unmount());
});
