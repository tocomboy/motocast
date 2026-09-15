import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import type { PlaceSearchResult } from "@/lib/places/search";

vi.mock("@/lib/supabase/browser", () => ({ getBrowserSupabase: () => null }));

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
    expect(renderer.root.findByType("input").props.value).toBe("컬렉션 출발지");
    expect(renderer.root.findByType("strong").children).toEqual(["컬렉션 출발지"]);
    await act(async () => renderer.unmount());
  });
});
