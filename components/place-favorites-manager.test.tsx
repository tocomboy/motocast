import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaceFavorite } from "@/lib/places/favorites";
import type { PlaceSearchResult } from "@/lib/places/search";
import type { PlaceFavoritesControls } from "./place-search-field";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), focus: vi.fn(), showModal: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ getBrowserSupabase: () => ({ functions: { invoke: mocks.invoke } }) }));
vi.mock("next/image", () => ({ default: () => <span /> }));
import { PlaceFavoritesManager } from "./place-favorites-manager";

function place(id: string, name = id): PlaceSearchResult {
  return { kakaoPlaceId: id, name, verificationToken: "a".repeat(43), address: "공개 장소 주소", roadAddress: null, longitude: 127, latitude: 37, category: "", phone: null, placeUrl: null };
}
function favorite(slot: 1 | 2 | 3): PlaceFavorite { return { slot, place: place(`place-${slot}`), createdAt: "2026-10-02T00:00:00Z" }; }
function controls(favorites: PlaceFavorite[] = []): PlaceFavoritesControls { return { favorites, status: "ready", busy: false, message: "저장한 즐겨찾기가 없습니다.", retry: vi.fn(), add: vi.fn().mockResolvedValue(true), remove: vi.fn().mockResolvedValue(true), captureSnapshot: () => () => true }; }
function textOf(node: { children: unknown[] }): string { return node.children.map((child) => typeof child === "string" ? child : child && typeof child === "object" && "children" in child ? textOf(child as { children: unknown[] }) : "").join(""); }
async function render(favorites: PlaceFavoritesControls) {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<PlaceFavoritesManager favorites={favorites} onBack={vi.fn()} />, { createNodeMock: () => ({ focus: mocks.focus, showModal: mocks.showModal, close: vi.fn(), open: false }) }); });
  return renderer;
}
async function open(renderer: ReactTestRenderer) { await act(async () => renderer.root.findAllByType("button").find((button) => textOf(button) === "+ 즐겨찾기 추가")!.props.onClick()); }
async function search(renderer: ReactTestRenderer) {
  await act(async () => renderer.root.findByType("input").props.onChange({ target: { value: "공개 장소" } }));
  await act(async () => renderer.root.findByProps({ "aria-label": "장소 검색" }).props.onClick());
}
beforeEach(() => { mocks.invoke.mockReset(); mocks.focus.mockClear(); mocks.showModal.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

describe("PlaceFavoritesManager", () => {
  it("deletes the exact listed favorite and refuses adding to a full or unavailable list", async () => {
    const favorites = controls([favorite(1), favorite(2), favorite(3)]);
    const renderer = await render(favorites);
    await act(async () => renderer.root.findByProps({ "aria-label": "place-2 즐겨찾기 삭제" }).props.onClick());
    expect(favorites.remove).not.toHaveBeenCalled();
    await act(async () => renderer.root.findAllByType("dialog")[0].findAllByType("button").find((button) => textOf(button) === "삭제")!.props.onClick());
    expect(favorites.remove).toHaveBeenCalledWith(favorites.favorites[1]);
    const addButton = () => renderer.root.findAllByType("button").find((button) => textOf(button) === "+ 즐겨찾기 추가")!;
    expect(addButton().props.disabled).toBe(true);
    await act(async () => renderer.update(<PlaceFavoritesManager favorites={{ ...favorites, favorites: [], status: "error", message: "삭제 결과와 최신 목록을 확인할 수 없습니다." }} onBack={vi.fn()} />));
    expect(addButton().props.disabled).toBe(true);
    expect(textOf(renderer.root.findByProps({ role: "alert" }))).toContain("삭제 결과");
    await act(async () => renderer.unmount());
  });

  it("only adds a searched place and disables duplicates, full lists and concurrent writes", async () => {
    const favorites = controls([favorite(1)]);
    mocks.invoke.mockResolvedValue({ data: { places: [place("place-1"), place("candidate")], isEnd: true }, error: null });
    const renderer = await render(favorites);
    await open(renderer);
    await search(renderer);
    expect(renderer.root.findByProps({ "aria-label": "place-1 즐겨찾기 저장됨" }).props.disabled).toBe(true);
    const candidate = () => renderer.root.findByProps({ "aria-label": "candidate 즐겨찾기 추가" });
    expect(candidate().props.disabled).toBe(false);
    await act(async () => candidate().props.onClick());
    expect(favorites.add).not.toHaveBeenCalled();
    await act(async () => renderer.root.findAllByType("dialog").find((dialog) => textOf(dialog).includes("즐겨찾기에 추가할까요?"))!.findAllByType("button").find((button) => textOf(button) === "추가")!.props.onClick());
    expect(favorites.add).toHaveBeenCalledWith(place("candidate"));
    expect(renderer.root.findAllByType("button").some((button) => /로 선택$/.test(textOf(button)))).toBe(false);
    await act(async () => renderer.update(<PlaceFavoritesManager favorites={{ ...favorites, busy: true }} onBack={vi.fn()} />));
    expect(candidate().props.disabled).toBe(true);
    await act(async () => renderer.update(<PlaceFavoritesManager favorites={{ ...favorites, favorites: [favorite(1), favorite(2), favorite(3)] }} onBack={vi.fn()} />));
    expect(candidate().props.disabled).toBe(true);
    await act(async () => renderer.unmount());
  });

  it("cancels registration with X or Escape, restores focus and ignores a closed search response", async () => {
    let finishSearch!: (value: unknown) => void;
    mocks.invoke.mockReturnValue(new Promise((resolve) => { finishSearch = resolve; }));
    const renderer = await render(controls());
    await open(renderer);
    await search(renderer);
    await act(async () => renderer.root.findByProps({ "aria-label": "즐겨찾기 추가 닫기" }).props.onClick());
    expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
    expect(mocks.focus).toHaveBeenCalled();
    await open(renderer);
    expect(renderer.root.findByType("input").props.value).toBe("");
    await act(async () => finishSearch({ data: { places: [place("late")], isEnd: true }, error: null }));
    expect(renderer.root.findAllByType("li")).toHaveLength(0);
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    await act(async () => renderer.root.findByType("dialog").props.onCancel(event));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

  it("releases a cleared pending search and ignores its late result", async () => {
    let finishSearch!: (value: unknown) => void;
    mocks.invoke.mockReturnValue(new Promise((resolve) => { finishSearch = resolve; }));
    const renderer = await render(controls());
    await open(renderer);
    await search(renderer);
    await act(async () => renderer.root.findByProps({ "aria-label": "검색어 지우기" }).props.onClick());
    expect(renderer.root.findByProps({ "aria-label": "장소 검색" }).props.disabled).toBe(false);
    await act(async () => finishSearch({ data: { places: [place("late")], isEnd: true }, error: null }));
    expect(renderer.root.findAllByType("li")).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

  it.each(["취소", "X", "Escape"])("cancels a deletion with %s without issuing a mutation", async (action) => {
    const favorites = controls([favorite(1)]);
    const renderer = await render(favorites);
    await act(async () => renderer.root.findByProps({ "aria-label": "place-1 즐겨찾기 삭제" }).props.onClick());
    const dialog = renderer.root.findByType("dialog");
    expect(textOf(dialog.findByType("h2"))).toBe("즐겨찾기를 삭제할까요?");
    expect(textOf(dialog.findByType("strong"))).toBe("place-1");
    expect(favorites.remove).not.toHaveBeenCalled();
    await act(async () => {
      if (action === "Escape") dialog.props.onCancel({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
      else if (action === "X") dialog.findByProps({ "aria-label": "즐겨찾기 삭제 확인 닫기" }).props.onClick();
      else dialog.findAllByType("button").find((button) => textOf(button) === "취소")!.props.onClick();
    });
    expect(favorites.remove).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

  it.each(["취소", "X", "Escape"])("cancels an addition with %s and keeps registration open without writing", async (action) => {
    const favorites = controls();
    mocks.invoke.mockResolvedValue({ data: { places: [place("candidate")], isEnd: true }, error: null });
    const renderer = await render(favorites);
    await open(renderer);
    await search(renderer);
    await act(async () => renderer.root.findByProps({ "aria-label": "candidate 즐겨찾기 추가" }).props.onClick());
    const dialog = renderer.root.findAllByType("dialog").find((node) => textOf(node).includes("즐겨찾기에 추가할까요?"))!;
    expect(favorites.add).not.toHaveBeenCalled();
    await act(async () => {
      if (action === "Escape") dialog.props.onCancel({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
      else if (action === "X") dialog.findByProps({ "aria-label": "즐겨찾기 추가 확인 닫기" }).props.onClick();
      else dialog.findAllByType("button").find((button) => textOf(button) === "취소")!.props.onClick();
    });
    expect(favorites.add).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType("dialog")).toHaveLength(1);
    expect(renderer.root.findByType("input").props.value).toBe("공개 장소");
    await act(async () => renderer.unmount());
  });

  it("issues one confirmed write even when the same confirmation handler runs twice", async () => {
    let finish!: (value: boolean) => void;
    const favorites = controls([favorite(1)]);
    favorites.remove = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const renderer = await render(favorites);
    await act(async () => renderer.root.findByProps({ "aria-label": "place-1 즐겨찾기 삭제" }).props.onClick());
    const confirm = renderer.root.findByType("dialog").findAllByType("button").find((button) => textOf(button) === "삭제")!;
    await act(async () => { confirm.props.onClick(); confirm.props.onClick(); });
    expect(favorites.remove).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ "aria-label": "즐겨찾기 삭제 확인 닫기" }).props.disabled).toBe(true);
    await act(async () => renderer.root.findByType("dialog").props.onCancel({ preventDefault: vi.fn(), stopPropagation: vi.fn() }));
    expect(renderer.root.findAllByType("dialog")).toHaveLength(1);
    await act(async () => finish(true));
    expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

  it("refuses a pending confirmation whose owner or read snapshot became stale before rendering", async () => {
    let current = true;
    const favorites = { ...controls([favorite(1)]), captureSnapshot: () => () => current };
    const renderer = await render(favorites);
    await act(async () => renderer.root.findByProps({ "aria-label": "place-1 즐겨찾기 삭제" }).props.onClick());
    const confirm = renderer.root.findByType("dialog").findAllByType("button").find((button) => textOf(button) === "삭제")!;
    current = false;
    await act(async () => confirm.props.onClick());
    expect(favorites.remove).not.toHaveBeenCalled();
    await act(async () => renderer.update(<PlaceFavoritesManager favorites={{ ...favorites, favorites: [favorite(2)] }} onBack={vi.fn()} />));
    expect(renderer.root.findByType("dialog").findAllByType("button").find((button) => textOf(button) === "삭제")!.props.disabled).toBe(true);
    expect(textOf(renderer.root.findByProps({ role: "alert" }))).toContain("목록이나 계정이 바뀌었어요");
    expect(textOf(renderer.root.findByType("dialog").findByType("strong"))).not.toContain("place-1");
    await act(async () => renderer.unmount());
  });

  it("clears the old account's target and lets the new account dismiss an unfinished old write", async () => {
    let current = true;
    let finish!: (value: boolean) => void;
    const favorites = { ...controls([favorite(1)]), captureSnapshot: () => () => current };
    favorites.remove = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const renderer = await render(favorites);
    await act(async () => renderer.root.findByProps({ "aria-label": "place-1 즐겨찾기 삭제" }).props.onClick());
    await act(async () => renderer.root.findByType("dialog").findAllByType("button").find((button) => textOf(button) === "삭제")!.props.onClick());
    current = false;
    await act(async () => renderer.update(<PlaceFavoritesManager favorites={{ ...controls(), status: "loading" }} onBack={vi.fn()} />));
    expect(textOf(renderer.root.findByType("dialog").findByType("strong"))).not.toContain("place-1");
    const close = renderer.root.findByProps({ "aria-label": "즐겨찾기 삭제 확인 닫기" });
    expect(close.props.disabled).toBe(false);
    await act(async () => close.props.onClick());
    expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
    await act(async () => finish(false));
    expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
    expect(favorites.remove).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });
});
