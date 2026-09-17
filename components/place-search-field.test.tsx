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
  return { favorites, status: "ready", busy: false, message: "즐겨찾기는 최대 3개까지 등록할 수 있어요.", retry: vi.fn(), add: vi.fn(), remove: vi.fn() };
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

  it("renders one manage completion action and explicit enabled or disabled registration controls", async () => {
    vi.stubGlobal("window", { scrollTo: vi.fn(), setTimeout, location: { href: "http://localhost/" } });
    supabase.invoke.mockResolvedValue({ data: { places: [place("new", "새 즐겨찾기 후보")], isEnd: true }, error: null });
    const full = favoriteControls([
      favorite(1, "a", "첫 장소"), favorite(2, "b", "둘째 장소"), favorite(3, "c", "셋째 장소"),
    ]);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<PlaceSearchField label="출발" accessibleLabel="출발지" placeholder="검색" selected={null} onSelect={vi.fn()} favorites={full} />);
    });
    const manage = renderer.root.findAllByType("button").find((button) => textOf(button) === "관리")!;
    await act(async () => manage.props.onClick());
    expect(textOf(renderer.root.findAllByType("h3").find((heading) => textOf(heading).includes("공용 즐겨찾기"))!)).toBe("공용 즐겨찾기 3 / 3");
    expect(renderer.root.findAllByType("button").filter((button) => textOf(button) === "완료")).toHaveLength(1);
    const registerMode = renderer.root.findAllByType("button").find((button) => button.props.className?.includes("favorite-register-button"))!;
    expect(registerMode.props.className).toContain("primary-button");
    await act(async () => registerMode.props.onClick());
    await act(async () => renderer.root.findByType("input").props.onChange({ target: { value: "새 장소" } }));
    await act(async () => renderer.root.findAllByType("button").find((button) => button.props.className?.includes("place-search-button"))!.props.onClick());
    const fullRegister = renderer.root.findAllByType("button").find((button) => button.props.className === "favorite-register-result")!;
    expect(textOf(fullRegister)).toBe("등록");
    expect(fullRegister.props.disabled).toBe(true);

    await act(async () => renderer.update(<PlaceSearchField label="출발" accessibleLabel="출발지" placeholder="검색" selected={null} onSelect={vi.fn()} favorites={favoriteControls(full.favorites.slice(0, 2))} />));
    const enabledRegister = renderer.root.findAllByType("button").find((button) => button.props.className === "favorite-register-result")!;
    expect(enabledRegister.props.disabled).toBe(false);
    await act(async () => renderer.unmount());
    vi.unstubAllGlobals();
  });
});
