import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SavedPlacesProvider } from "./saved-places-provider";
import { SavedPlacesManager } from "./saved-places-manager";
import { SAVED_PLACE_READ_TIMEOUT_MS, SAVED_PLACE_WRITE_TIMEOUT_MS } from "./saved-places-provider";

// The manager and the real provider together: what the rider can press after unclear results.
type Reply = { data: unknown; error: unknown };
const mocks = vi.hoisted(() => ({
  reads: [] as Array<Promise<Reply>>,
  readCount: 0,
  rpc: vi.fn(),
  mapSelect: null as null | ((place: unknown) => void),
}));
vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({
    from: () => ({
      select() { return this; },
      order() { return this; },
      limit: () => { mocks.readCount++; return mocks.reads.shift() ?? new Promise<Reply>(() => undefined); },
    }),
    rpc: mocks.rpc,
    functions: { invoke: vi.fn() },
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) },
  }),
}));
vi.mock("./kakao-map-canvas", () => ({ KakaoMapCanvas: () => null }));
vi.mock("./place-search-field", () => ({ PlaceSearchField: () => null }));
vi.mock("./map-point-confirmation", async () => {
  const actual = await vi.importActual<typeof import("./map-point-confirmation")>("./map-point-confirmation");
  return {
    resolveMapPoint: actual.resolveMapPoint,
    MapPointConfirmation: ({ onSelect }: { onSelect: (place: unknown) => void }) => { mocks.mapSelect = onSelect; return null; },
  };
});

const id = "00000000-0000-4000-8000-000000000001";
const row = (overrides: Record<string, unknown> = {}) => ({
  id,
  place: { kakaoPlaceId: "k1", verificationToken: "a".repeat(43), name: "원래 장소", address: "경기 남양주시", roadAddress: null, latitude: 37.55, longitude: 127.24 },
  alias: "A",
  kind: "riding_spot",
  province: "경기",
  star_slot: null,
  star_position: null,
  revision: 1,
  created_at: "2026-10-02T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
  ...overrides,
});
const region = { kakaoPlaceId: "map:37.5000000:127.1000000:region", verificationToken: "c".repeat(43), name: "양평군 서종면 부근", address: "경기도 양평군 서종면 문호리", roadAddress: null, latitude: 37.5, longitude: 127.1, category: "지도에서 선택 · 상세 주소 없음", phone: null, placeUrl: null };
const ok = (data: unknown): Promise<Reply> => Promise.resolve({ data, error: null });

function text(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  return ((node as { children?: unknown[] }).children ?? []).map(text).join("");
}
const buttons = (r: ReactTestRenderer, label: string) => r.root.findAllByType("button").filter((b) => text(b) === label);
const popupButton = (r: ReactTestRenderer, label: string) => popup(r)?.findAllByType("button").find((b) => text(b) === label);
const popup = (r: ReactTestRenderer): ReactTestInstance | undefined => r.root.findAll((node) => node.type === "dialog" && typeof node.props.className === "string" && node.props.className.includes("popup"))[0];
async function settle() { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); }
async function mount() {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <SavedPlacesProvider enabled>
        <SavedPlacesManager onBack={vi.fn()} onAddWaypoint={vi.fn(() => null)} routePoints={[]} />
      </SavedPlacesProvider>,
      { createNodeMock: () => ({ showModal: vi.fn(), focus: vi.fn(), close: vi.fn() }) },
    );
  });
  await act(async () => { vi.advanceTimersByTime(1); });
  await settle();
  return r;
}
async function openDetail(r: ReactTestRenderer) {
  await act(async () => r.root.findByProps({ "aria-label": "A 상세 보기" }).props.onClick());
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.reads = [];
  mocks.readCount = 0;
  mocks.rpc.mockReset();
  vi.stubGlobal("window", { setTimeout: (...a: Parameters<typeof setTimeout>) => globalThis.setTimeout(...a), clearTimeout: (t: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(t) });
  vi.stubGlobal("document", { activeElement: null, querySelector: () => null });
  vi.stubGlobal("HTMLElement", class {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("V3-1: an unclear delete with an unreadable list neither closes as done nor resends; a read proves it", async () => {
  mocks.reads.push(ok([row()]));
  const r = await mount();
  await openDetail(r);
  await act(async () => buttons(r, "장소 삭제").at(-1)!.props.onClick());
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "TypeError: Failed to fetch" } });
  mocks.reads.push(Promise.resolve({ data: null, error: { message: "offline" } }));
  await act(async () => popup(r)!.findAllByType("button").find((b) => text(b) === "장소 삭제")!.props.onClick());
  await settle();
  // The emptied list after a failed read is not proof of deletion.
  expect(popup(r)).toBeDefined();
  expect(text(popup(r)!)).toContain("목록을 확인하지 못했어요");
  expect(popup(r)!.findAllByType("button").map(text)).not.toContain("장소 삭제");
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  mocks.reads.push(ok([]));
  await act(async () => popupButton(r, "목록 다시 확인")!.props.onClick());
  await settle();
  expect(popup(r)).toBeUndefined();
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  await act(async () => r.unmount());
});

it("V3-1: an unclear save becomes re-confirmable only after a readable list shows it missing", async () => {
  mocks.reads.push(ok([row()]));
  const r = await mount();
  await act(async () => mocks.mapSelect?.(region));
  await act(async () => r.root.findByProps({ placeholder: "예: 서종 강변 쉼터" }).props.onChange({ target: { value: "강변" } }));
  await act(async () => buttons(r, "장소 저장")[0].props.onClick());
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "TypeError: Failed to fetch" } });
  mocks.reads.push(Promise.resolve({ data: null, error: { message: "offline" } }));
  await act(async () => buttons(r, "확인하고 저장")[0].props.onClick());
  await settle();
  expect(buttons(r, "확인하고 저장")).toHaveLength(0);
  expect(popupButton(r, "목록 다시 확인")).toBeDefined();
  // While the list is unreadable, no request may be sent from the stale save callback.
  mocks.reads.push(Promise.resolve({ data: null, error: { message: "offline" } }));
  await act(async () => popupButton(r, "목록 다시 확인")!.props.onClick());
  await settle();
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  mocks.reads.push(ok([row()]));
  await act(async () => popupButton(r, "목록 다시 확인")!.props.onClick());
  await settle();
  expect(text(popup(r)!)).toContain("저장되지 않았어요");
  mocks.rpc.mockResolvedValueOnce({ data: [{ ...row({ id: "00000000-0000-4000-8000-000000000002", place: { ...region, category: undefined, phone: undefined, placeUrl: undefined }, alias: "강변" }) }], error: null });
  mocks.reads.push(ok([row(), row({ id: "00000000-0000-4000-8000-000000000002", place: { kakaoPlaceId: region.kakaoPlaceId, verificationToken: region.verificationToken, name: region.name, address: region.address, roadAddress: null, latitude: region.latitude, longitude: region.longitude }, alias: "강변" })]));
  await act(async () => buttons(r, "확인하고 저장")[0].props.onClick());
  await settle();
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  // The confirmed save closes the popup and opens the saved place.
  expect(popup(r)).toBeUndefined();
  expect(r.root.findAll((node) => node.type === "dialog" && node.props["aria-label"] === "장소 상세")).toHaveLength(1);
  expect(r.root.findAllByProps({ "aria-label": "강변 상세 보기" }).length).toBeGreaterThan(0);
  await act(async () => r.unmount());
});

it("V3-2: a STALE edit is recalculated from the newest row and keeps the alias the rider did not change", async () => {
  mocks.reads.push(ok([row()]));
  const r = await mount();
  await openDetail(r);
  await act(async () => buttons(r, "별명·분류 수정")[0].props.onClick());
  await act(async () => r.root.findAllByType("button").filter((b) => text(b) === "식당").at(-1)!.props.onClick());
  await act(async () => buttons(r, "수정 내용 확인")[0].props.onClick());
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "SAVED_PLACE_STALE" } });
  mocks.reads.push(ok([row({ alias: "B", revision: 2 })]));
  await act(async () => buttons(r, "확인하고 수정")[0].props.onClick());
  await settle();
  const reopened = text(popup(r)!);
  expect(reopened).toContain("다른 곳에서 바뀐 내용을 반영했어요");
  expect(reopened).not.toContain("별명A");
  expect(reopened).not.toContain("에서 B");
  expect(reopened).toContain("라이딩 스팟 → 에서 식당");
  mocks.rpc.mockResolvedValueOnce({ data: [row({ alias: "B", kind: "restaurant", revision: 3 })], error: null });
  mocks.reads.push(ok([row({ alias: "B", kind: "restaurant", revision: 3 })]));
  await act(async () => buttons(r, "확인하고 수정")[0].props.onClick());
  await settle();
  expect(mocks.rpc).toHaveBeenLastCalledWith("update_saved_place", { saved_place_id: id, expected_revision: 2, place_alias: "B", place_kind: "restaurant" });
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  await act(async () => r.unmount());
});

it("V3-3: a write and its re-read that never answer end within the time limits without resending", async () => {
  mocks.reads.push(ok([row()]));
  const r = await mount();
  await openDetail(r);
  await act(async () => buttons(r, "장소 삭제").at(-1)!.props.onClick());
  let lateWrite!: (value: Reply) => void;
  mocks.rpc.mockReturnValueOnce(new Promise<Reply>((resolve) => { lateWrite = resolve; }));
  await act(async () => popup(r)!.findAllByType("button").find((b) => text(b) === "장소 삭제")!.props.onClick());
  expect(buttons(r, "삭제하는 중…")).toHaveLength(1);
  await act(async () => { vi.advanceTimersByTime(SAVED_PLACE_WRITE_TIMEOUT_MS); });
  await settle();
  // The re-read never answers either (no queued reply): it ends after the read limit.
  expect(text(popup(r)!)).toContain("삭제됐는지 확인하고 있어요");
  await act(async () => { vi.advanceTimersByTime(SAVED_PLACE_READ_TIMEOUT_MS); });
  await settle();
  expect(text(popup(r)!)).toContain("목록을 확인하지 못했어요");
  expect(popupButton(r, "목록 다시 확인")!.props.disabled).toBe(false);
  const closeX = popup(r)!.findByProps({ "aria-label": "닫기" });
  expect(closeX.props.disabled).toBe(false);
  // The late reply changes nothing and nothing is sent again.
  await act(async () => { lateWrite({ data: null, error: null }); });
  await settle();
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(popupButton(r, "목록 다시 확인")).toBeDefined();
  await act(async () => r.unmount());
});

it("V3-3: a re-read that times out ignores its late reply", async () => {
  mocks.reads.push(ok([row()]));
  const r = await mount();
  await openDetail(r);
  await act(async () => buttons(r, "장소 삭제").at(-1)!.props.onClick());
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "TypeError: Failed to fetch" } });
  let lateRead!: (value: Reply) => void;
  mocks.reads.push(new Promise<Reply>((resolve) => { lateRead = resolve; }));
  await act(async () => popup(r)!.findAllByType("button").find((b) => text(b) === "장소 삭제")!.props.onClick());
  await settle();
  expect(text(popup(r)!)).toContain("삭제됐는지 확인하고 있어요");
  await act(async () => { vi.advanceTimersByTime(SAVED_PLACE_READ_TIMEOUT_MS); });
  await settle();
  const before = text(r.root);
  expect(text(popup(r)!)).toContain("목록을 확인하지 못했어요");
  // An empty list arriving after the timeout would look like "deleted"; it must change nothing.
  await act(async () => { lateRead({ data: [], error: null }); });
  await settle();
  expect(text(r.root)).toBe(before);
  expect(popup(r)).toBeDefined();
  expect(popupButton(r, "목록 다시 확인")).toBeDefined();
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.readCount).toBe(2);
  await act(async () => r.unmount());
});

it("V3-4: a receipt the list never shows stays an error after the fixed re-reads, with read-only recheck", async () => {
  mocks.reads.push(ok([row()]));
  const r = await mount();
  await openDetail(r);
  await act(async () => buttons(r, "☆ 자주 찾는 장소에 추가 · 0 / 10")[0].props.onClick());
  mocks.rpc.mockResolvedValueOnce({ data: [row({ star_slot: 1, star_position: 1, revision: 2 })], error: null });
  // Both re-reads still show revision 1 with no star.
  mocks.reads.push(ok([row()]), ok([row()]));
  await act(async () => popup(r)!.findAllByType("button").find((b) => text(b) === "추가")!.props.onClick());
  await settle();
  expect(mocks.readCount).toBe(3);
  expect(text(popup(r)!)).toContain("목록에서 변경을 확인하지 못했어요");
  expect(popup(r)!.findAllByType("button").map(text)).not.toContain("추가");
  // A list with the star but an older revision is not the receipt.
  mocks.reads.push(ok([row({ star_slot: 1, star_position: 1 })]));
  await act(async () => popupButton(r, "목록 다시 확인")!.props.onClick());
  await settle();
  expect(popup(r)).toBeDefined();
  mocks.reads.push(ok([row({ star_slot: 1, star_position: 1, revision: 2 })]));
  await act(async () => popupButton(r, "목록 다시 확인")!.props.onClick());
  await settle();
  expect(popup(r)).toBeUndefined();
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  await act(async () => r.unmount());
});

it("V3-5: every confirmation popup has a close X that is locked while a request runs", async () => {
  mocks.reads.push(ok([row()]));
  const r = await mount();
  await openDetail(r);
  await act(async () => buttons(r, "장소 삭제").at(-1)!.props.onClick());
  const x = () => popup(r)!.findByProps({ "aria-label": "닫기" });
  expect(x().props.disabled).toBe(false);
  mocks.rpc.mockReturnValueOnce(new Promise<Reply>(() => undefined));
  await act(async () => popup(r)!.findAllByType("button").find((b) => text(b) === "장소 삭제")!.props.onClick());
  expect(x().props.disabled).toBe(true);
  await act(async () => r.unmount());
});
