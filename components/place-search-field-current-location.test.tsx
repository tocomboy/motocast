import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaceSearchResult } from "@/lib/places/search";

const supabase = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ getBrowserSupabase: () => ({ functions: supabase }) }));

import { PlaceSearchField, type PlaceFavoritesControls } from "./place-search-field";

const fix = { latitude: 37.5665, longitude: 126.978, accuracy: 25 };
const located: PlaceSearchResult = {
  kakaoPlaceId: "map:37.5665000:126.9780000", verificationToken: "a".repeat(43), name: "서울 중구 세종대로 110",
  address: "서울 중구 태평로1가 31", roadAddress: "서울 중구 세종대로 110", category: "지도에서 선택", phone: null, placeUrl: null,
  latitude: 37.5665, longitude: 126.978,
};
const existing: PlaceSearchResult = { ...located, kakaoPlaceId: "1", name: "팔당역", latitude: 37.547, longitude: 127.243 };
const lookupBody = { mode: "coordinate", latitude: fix.latitude, longitude: fix.longitude, fallback: "region" };
const favorites: PlaceFavoritesControls = {
  favorites: [{ slot: 1, place: existing, createdAt: "2026-10-01T00:00:00.000Z", displayName: "집" }],
  status: "ready", busy: false, message: "", retry: vi.fn(), add: vi.fn(), remove: vi.fn(), captureSnapshot: () => () => true,
};

type Pending = { success: PositionCallback; failure: PositionErrorCallback };
let pending: Pending[] = [];
const getCurrentPosition = vi.fn((success: PositionCallback, failure: PositionErrorCallback, options?: PositionOptions) => { void options; pending.push({ success, failure }); });
const entryFocus = vi.fn();
const dialog = { open: false, showModal: vi.fn(() => { dialog.open = true; }), close: vi.fn(() => { dialog.open = false; }), focus: vi.fn(), querySelector: vi.fn((selector: string) => selector === ".current-location-entry" ? { focus: entryFocus } : null) };
let renderer: ReactTestRenderer;

beforeEach(() => {
  pending = [];
  getCurrentPosition.mockClear();
  supabase.invoke.mockReset();
  dialog.open = false;
  dialog.showModal.mockClear();
  dialog.close.mockClear();
  dialog.querySelector.mockClear();
  entryFocus.mockClear();
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
  vi.stubGlobal("window", { setTimeout: () => 0 });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

function textOf(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}
const buttons = () => renderer.root.findAllByType("button");
const buttonNamed = (name: string) => buttons().find((node) => node.props["aria-label"] === name || textOf(node) === name);
const card = () => renderer.root.findAll((node) => typeof node.props.className === "string" && node.props.className.startsWith("current-location-card"))[0];

async function mount(props: { selected?: PlaceSearchResult | null; location?: boolean; accessibleLabel?: string } = {}) {
  const onSelect = vi.fn();
  const onCurrentLocationSelect = vi.fn();
  await act(async () => {
    renderer = create(
      <PlaceSearchField
        label="출발"
        accessibleLabel={props.accessibleLabel ?? "출발지"}
        placeholder="예: 팔당역"
        selected={props.selected ?? null}
        favorites={favorites}
        onSelect={onSelect}
        onCurrentLocationSelect={props.location === false ? undefined : onCurrentLocationSelect}
      />,
      { createNodeMock: (element) => element.type === "dialog" ? dialog : { focus: vi.fn() } },
    );
  });
  await act(async () => buttons().find((node) => node.props.className?.includes("place-picker-trigger"))!.props.onClick());
  return { onSelect, onCurrentLocationSelect };
}

async function press(name: string) {
  const button = buttonNamed(name);
  expect(button, name).toBeDefined();
  await act(async () => button!.props.onClick());
}
async function deliver(coords = fix) {
  await act(async () => pending.shift()!.success({ coords, timestamp: 0 } as unknown as GeolocationPosition));
}

describe("PlaceSearchField current location (Issue #137)", () => {
  it("offers the entry only where the planner opts in, named for the role", async () => {
    await mount({ location: false });
    expect(buttonNamed("현재 위치를 출발지로 설정")).toBeUndefined();
    await act(async () => renderer.unmount());
    await mount({ accessibleLabel: "도착지" });
    expect(buttonNamed("현재 위치를 도착지로 설정")).toBeDefined();
    expect(textOf(buttonNamed("현재 위치를 도착지로 설정")!)).toBe("현재 위치로 설정지금 있는 곳을 도착지로 넣어요");
  });

  it("applies the looked-up place directly and closes the picker", async () => {
    supabase.invoke.mockResolvedValue({ data: { places: [located], isEnd: true }, error: null });
    const { onSelect, onCurrentLocationSelect } = await mount({ selected: existing });
    await press("현재 위치를 출발지로 설정");
    expect(textOf(card())).toContain("현재 위치를 확인하고 있어요");
    expect(textOf(card())).toContain("출발지는 아직 바뀌지 않았어요.");
    await deliver();
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(supabase.invoke).toHaveBeenCalledExactlyOnceWith("search-places", { body: lookupBody });
    expect(onCurrentLocationSelect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kakaoPlaceId: located.kakaoPlaceId, name: located.name }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(dialog.close).toHaveBeenCalled();
  });

  it("locks search and frequent places while locating, and back cancels without leaving the picker", async () => {
    const { onCurrentLocationSelect } = await mount({ selected: existing });
    await press("현재 위치를 출발지로 설정");
    expect(renderer.root.findByType("input").props.disabled).toBe(true);
    expect(buttonNamed("장소 검색")!.props.disabled).toBe(true);
    expect(buttons().find((node) => textOf(node).includes("집"))!.props.disabled).toBe(true);
    // Back/Escape cancels like 취소 and returns focus to the entry button.
    const timers: Array<() => void> = [];
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => { timers.push(callback); return 0; } });
    await press("출발지 선택에서 뒤로");
    await act(async () => { for (const callback of timers.splice(0)) callback(); });
    expect(dialog.querySelector).toHaveBeenCalledWith(".current-location-entry");
    expect(entryFocus).toHaveBeenCalledOnce();
    expect(dialog.close).not.toHaveBeenCalled();
    expect(buttonNamed("현재 위치를 출발지로 설정")).toBeDefined();
    expect(renderer.root.findByType("input").props.disabled).toBe(false);
    await deliver();
    expect(supabase.invoke).not.toHaveBeenCalled();
    expect(onCurrentLocationSelect).not.toHaveBeenCalled();
  });

  it("drops a lookup that finishes after cancel", async () => {
    let finish!: (value: unknown) => void;
    supabase.invoke.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { onCurrentLocationSelect } = await mount();
    await press("현재 위치를 출발지로 설정");
    await deliver();
    expect(textOf(card())).toContain("주소를 확인하고 있어요");
    await press("취소");
    await act(async () => finish({ data: { places: [located], isEnd: true }, error: null }));
    expect(onCurrentLocationSelect).not.toHaveBeenCalled();
    expect(buttonNamed("현재 위치를 출발지로 설정")).toBeDefined();
  });

  it.each(["close", "unmount"] as const)("drops a late result after %s (screen left or account changed)", async (mode) => {
    let finish!: (value: unknown) => void;
    supabase.invoke.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { onCurrentLocationSelect } = await mount();
    await press("현재 위치를 출발지로 설정");
    await deliver();
    await act(async () => {
      if (mode === "close") buttonNamed("출발지 검색 닫기")!.props.onClick();
      else renderer.unmount();
    });
    await act(async () => finish({ data: { places: [located], isEnd: true }, error: null }));
    expect(onCurrentLocationSelect).not.toHaveBeenCalled();
  });

  it.each([
    ["permission denied", { code: 1 }, "위치 권한이 필요해요", "is-settings", true],
    ["timeout", { code: 3 }, "현재 위치를 정확히 잡지 못했어요", "is-failed", true],
    ["a fix less accurate than 500 m", { coords: { ...fix, accuracy: 501 } }, "현재 위치를 정확히 잡지 못했어요", "is-failed", true],
    ["a fix outside Korea", { coords: { latitude: 35.68, longitude: 139.65, accuracy: 10 } }, "한국 안에서만 쓸 수 있어요", "is-failed", false],
  ] as const)("keeps the selection and looks nothing up after %s", async (_, outcome, title, tone, retry) => {
    const { onSelect, onCurrentLocationSelect } = await mount({ selected: existing });
    await press("현재 위치를 출발지로 설정");
    await act(async () => {
      const next = pending.shift()!;
      if ("code" in outcome) next.failure({ code: outcome.code } as GeolocationPositionError);
      else next.success({ coords: outcome.coords, timestamp: 0 } as unknown as GeolocationPosition);
    });
    expect(supabase.invoke).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onCurrentLocationSelect).not.toHaveBeenCalled();
    expect(card().props.className).toContain(tone);
    expect(textOf(card())).toContain(title);
    expect(textOf(card())).toContain("출발지는 그대로예요 · 팔당역");
    expect(Boolean(buttonNamed("다시 시도"))).toBe(retry);
    expect(renderer.root.findByType("input").props.disabled).toBe(false);
  });

  it("separates the exhausted daily lookup limit (429) from other lookup failures", async () => {
    supabase.invoke
      .mockResolvedValueOnce({ data: null, error: Object.assign(new Error("FunctionsHttpError"), { context: new Response("{}", { status: 429 }) }) })
      .mockResolvedValueOnce({ data: null, error: Object.assign(new Error("FunctionsHttpError"), { context: new Response("{}", { status: 502 }) }) });
    const { onCurrentLocationSelect } = await mount();
    await press("현재 위치를 출발지로 설정");
    await deliver();
    expect(textOf(card())).toContain("오늘 장소 조회 한도를 모두 썼어요");
    expect(textOf(card())).toContain("출발지는 아직 비어 있어요");
    expect(buttonNamed("다시 시도")).toBeUndefined();
    await act(async () => renderer.unmount());

    await mount();
    await press("현재 위치를 출발지로 설정");
    await deliver();
    expect(textOf(card())).toContain("현재 위치의 주소를 확인하지 못했어요");
    expect(buttonNamed("다시 시도")).toBeDefined();
    expect(onCurrentLocationSelect).not.toHaveBeenCalled();
  });

  it("reports a point without address or region and never retries on its own", async () => {
    supabase.invoke.mockResolvedValue({ data: { places: [], isEnd: true }, error: null });
    await mount();
    await press("현재 위치를 출발지로 설정");
    await deliver();
    expect(textOf(card())).toContain("이 위치의 주소를 찾지 못했어요");
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(supabase.invoke).toHaveBeenCalledOnce();
  });

  it("retry reads the position and looks the address up again", async () => {
    supabase.invoke
      .mockResolvedValueOnce({ data: null, error: new Error("offline") })
      .mockResolvedValueOnce({ data: { places: [{ ...located, kakaoPlaceId: `${located.kakaoPlaceId}:region`, name: "중구 태평로1가 부근", roadAddress: null }], isEnd: true }, error: null });
    const { onCurrentLocationSelect } = await mount();
    await press("현재 위치를 출발지로 설정");
    await deliver();
    await press("다시 시도");
    await deliver();
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(getCurrentPosition.mock.calls.map((call) => call[2]?.maximumAge)).toEqual([60_000, 0]);
    expect(supabase.invoke).toHaveBeenCalledTimes(2);
    expect(onCurrentLocationSelect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kakaoPlaceId: `${located.kakaoPlaceId}:region` }));
  });

  it("removes the failure card when the picker is opened again", async () => {
    await mount();
    await press("현재 위치를 출발지로 설정");
    await act(async () => pending.shift()!.failure({ code: 1 } as GeolocationPositionError));
    expect(card()).toBeDefined();
    await act(async () => buttonNamed("출발지 검색 닫기")!.props.onClick());
    await act(async () => buttons().find((node) => node.props.className?.includes("place-picker-trigger"))!.props.onClick());
    expect(card()).toBeUndefined();
    expect(buttonNamed("현재 위치를 출발지로 설정")).toBeDefined();
  });
});
