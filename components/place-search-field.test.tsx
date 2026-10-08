import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import type { PlaceSearchResult } from "@/lib/places/search";
import type { PlaceFavorite } from "@/lib/places/favorites";
import type { PlaceFavoritesControls } from "./place-search-field";

const supabase = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ getBrowserSupabase: () => ({ functions: supabase }) }));

import { PlaceSearchField } from "./place-search-field";

function place(kakaoPlaceId: string, name: string): PlaceSearchResult {
  return {
    kakaoPlaceId,
    verificationToken: "a".repeat(43),
    name,
    address: "테스트 주소",
    roadAddress: null,
    longitude: 127,
    latitude: 37,
    category: "",
    phone: null,
    placeUrl: null,
  };
}

function favorite(slot: 1 | 2 | 3, kakaoPlaceId: string, name: string): PlaceFavorite {
  return { slot, place: place(kakaoPlaceId, name), createdAt: "2026-09-17T00:00:00.000Z" };
}

function favoriteControls(favorites: PlaceFavorite[]): PlaceFavoritesControls {
  return { favorites, status: "ready", busy: false, message: "즐겨찾기는 최대 3개까지 등록할 수 있어요.", retry: vi.fn(), add: vi.fn(), remove: vi.fn(), captureSnapshot: () => () => true };
}

function textOf(node: { children: unknown[] }): string {
  return node.children.map((child) => typeof child === "string" ? child : child && typeof child === "object" && "children" in child ? textOf(child as { children: unknown[] }) : "").join("");
}

describe("PlaceSearchField collection application", () => {
  it("replaces an edited query when the planner remounts it for an applied collection", async () => {
    let renderer!: ReactTestRenderer;
    const onSelect = vi.fn();
    await act(async () => {
      renderer = create(
        <PlaceSearchField key="origin-0" label="출발지" placeholder="검색" selected={place("a", "기존 장소")} onSelect={onSelect} />,
      );
    });
    await act(async () => renderer.root.findByType("input").props.onChange({ target: { value: "사용자 입력 중" } }));
    expect(renderer.root.findByType("input").props.value).toBe("사용자 입력 중");

    await act(async () => {
      renderer.update(
        <PlaceSearchField key="origin-1" label="출발지" placeholder="검색" selected={place("b", "컬렉션 출발지")} onSelect={onSelect} />,
      );
    });
    expect(renderer.root.findByType("input").props.value).toBe("");
    expect(renderer.root.findByType("strong").children).toEqual(["컬렉션 출발지"]);
    const trigger = renderer.root.findAllByType("button").find((button) => button.props.className?.includes("place-picker-trigger"));
    expect(trigger?.props["aria-label"]).toBe("출발지, 컬렉션 출발지");
    await act(async () => renderer.unmount());
  });

  it("releases the search button when clearing a pending request and ignores its late response", async () => {
    let resolveSearch!: (value: unknown) => void;
    supabase.invoke.mockReturnValueOnce(new Promise((resolve) => { resolveSearch = resolve; }));
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<PlaceSearchField label="출발지" placeholder="검색" selected={null} onSelect={vi.fn()} />);
    });
    const input = renderer.root.findByType("input");
    await act(async () => input.props.onChange({ target: { value: "서울역" } }));
    expect(renderer.root.findAll((node) => node.props.className?.includes?.("show-results"))).toHaveLength(1);
    const searchButton = () => renderer.root.findAllByType("button").find((button) => button.props.className?.includes("place-search-button"))!;
    await act(async () => searchButton().props.onClick());
    const clearButton = renderer.root.findAllByType("button").find((button) => button.props.className === "place-query-clear")!;
    expect(clearButton).toBeDefined();
    await act(async () => clearButton.props.onClick());
    expect(searchButton().props.disabled).toBe(false);
    expect(renderer.root.findByType("input").props.value).toBe("");
    expect(renderer.root.findAll((node) => node.props.className?.includes?.("show-favorites"))).toHaveLength(1);
    await act(async () => resolveSearch({ data: { places: [place("late", "늦은 장소")], isEnd: true }, error: null }));
    expect(renderer.root.findAllByProps({ className: "place-picker-results" })[0].findAllByType("li")).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

  it("parity 4: calls onOpen each time the picker opens, not on focus", async () => {
    vi.stubGlobal("window", { scrollTo: vi.fn(), setTimeout, location: { href: "http://localhost/" } });
    const onOpen = vi.fn();
    const onActivate = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<PlaceSearchField label="출발" accessibleLabel="출발지" placeholder="검색" selected={null} onSelect={vi.fn()} onActivate={onActivate} onOpen={onOpen} favorites={favoriteControls([])} />, { createNodeMock: () => ({ showModal: vi.fn(), close: vi.fn(), focus: vi.fn() }) });
    });
    const trigger = renderer.root.findAllByType("button").find((button) => button.props["aria-haspopup"] === "dialog")!;
    await act(async () => trigger.props.onFocus());
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    await act(async () => trigger.props.onClick());
    await act(async () => trigger.props.onClick());
    expect(onOpen).toHaveBeenCalledTimes(2);
    await act(async () => renderer.unmount());
    vi.unstubAllGlobals();
  });

  it("offers favorite selection without any management or registration controls", async () => {
    vi.stubGlobal("window", { scrollTo: vi.fn(), setTimeout, location: { href: "http://localhost/" } });
    const controls = favoriteControls([favorite(1, "a", "첫 장소")]);
    const onSelect = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<PlaceSearchField label="출발" accessibleLabel="출발지" placeholder="검색" selected={null} onSelect={onSelect} favorites={controls} />);
    });
    expect(renderer.root.findAllByType("button").some((button) => /관리|등록|추가|삭제/.test(textOf(button)))).toBe(false);
    await act(async () => renderer.root.findAllByType("button").find((button) => textOf(button).includes("첫 장소"))!.props.onClick());
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kakaoPlaceId: "a", name: "첫 장소" }));
    expect(controls.add).not.toHaveBeenCalled();
    expect(controls.remove).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
    vi.unstubAllGlobals();
  });
});
