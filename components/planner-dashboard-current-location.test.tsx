import type { ReactElement, ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { CollectionCourse } from "@/lib/collections/contracts";
import type { PlaceSearchResult } from "@/lib/places/search";

const mocks = vi.hoisted(() => ({ authListeners: [] as Array<(event: string, session: { user: { id: string } } | null) => void> }));

vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));
vi.mock("next/image", () => ({ default: ({ src }: { src: string }) => <span data-image-src={src} /> }));
vi.mock("@/components/kakao-map-canvas", () => ({ KakaoMapCanvas: () => <div />, MapMarkerLegend: () => <div /> }));
vi.mock("@/components/map-point-confirmation", () => ({ MapPointConfirmation: () => <div /> }));
vi.mock("@/components/place-search-field", () => ({ PlaceSearchField: () => <div /> }));
vi.mock("@/components/ordered-waypoint-editor", () => ({ OrderedWaypointEditor: () => <div /> }));
vi.mock("@/components/collection-manager", () => ({ CollectionManager: () => <div /> }));
vi.mock("@/components/share-manager", () => ({ ShareManager: () => <div /> }));
vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({
    functions: { invoke: vi.fn() },
    rpc: vi.fn(),
    from: () => ({ select() { return this; }, order() { return this; }, limit: async () => ({ data: [], error: null }) }),
    auth: { onAuthStateChange: (listener: (event: string, session: { user: { id: string } } | null) => void) => { mocks.authListeners.push(listener); return { data: { subscription: { unsubscribe: vi.fn() } } }; } },
  }),
}));

import { PlannerDashboard } from "./planner-dashboard";
import { PlaceSearchField } from "./place-search-field";
import { CollectionManager } from "./collection-manager";

const place = (kakaoPlaceId: string, name: string, longitude: number) => ({
  kakaoPlaceId, verificationToken: "a".repeat(43), name, address: `${name} 주소`, roadAddress: null, longitude, latitude: 37.5,
});
const course: CollectionCourse = { origin: place("origin", "팔당역", 127), destination: place("destination", "양평역", 127.2), points: [] };
const located = (suffix = ""): PlaceSearchResult => ({
  ...place(`map:37.5665000:126.9780000${suffix}`, suffix ? "중구 태평로1가 부근" : "서울 중구 세종대로 110", 126.978),
  latitude: 37.5665, category: "지도에서 선택", phone: null, placeUrl: null,
});

function textOf(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}
function createNodeMock(element: ReactElement<unknown>) {
  return { focus: vi.fn(), click: vi.fn(), querySelector: vi.fn(), querySelectorAll: vi.fn(() => []), ...(element.type === "dialog" ? { showModal: vi.fn(), close: vi.fn(), open: false } : {}) };
}

let renderer: ReactTestRenderer;
const field = (role: "출발지" | "도착지") => renderer.root.findAllByType(PlaceSearchField).find((node) => node.props.accessibleLabel === role)!;
const applied = () => renderer.root.findAll((node) => node.props.className === "current-location-applied");

beforeEach(async () => {
  vi.stubGlobal("document", { activeElement: null, querySelector: vi.fn(() => null) });
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("window", {
    localStorage: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    setTimeout, clearTimeout, setInterval, clearInterval,
    history: { pushState: vi.fn(), replaceState: vi.fn() },
    location: { pathname: "/", search: "", hash: "" },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
  mocks.authListeners.length = 0;
  await act(async () => { renderer = create(<PlannerDashboard connected initialCourse={course} navigationMode="memory" />, { createNodeMock }); });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

it("offers current location on origin and destination and applies the found place with the A03 notice", async () => {
  expect(field("출발지").props.onCurrentLocationSelect).toBeTypeOf("function");
  expect(field("도착지").props.onCurrentLocationSelect).toBeTypeOf("function");
  expect(applied()).toHaveLength(0);

  await act(async () => field("출발지").props.onCurrentLocationSelect(located()));
  expect(field("출발지").props.selected).toMatchObject({ kakaoPlaceId: located().kakaoPlaceId });
  expect(field("도착지").props.selected).toMatchObject({ kakaoPlaceId: "destination" });
  expect(applied()).toHaveLength(1);
  expect(applied()[0].props.role).toBe("status");
  expect(textOf(applied()[0])).toBe("현재 위치를 출발지로 넣었어요.");
});

it("adds the region line for a place without a detail address (A04)", async () => {
  await act(async () => field("도착지").props.onCurrentLocationSelect(located(":region")));
  expect(field("도착지").props.selected).toMatchObject({ kakaoPlaceId: `${located().kakaoPlaceId}:region`, name: "중구 태평로1가 부근" });
  expect(textOf(applied()[0])).toBe("현재 위치를 도착지로 넣었어요.상세 주소가 없어 지역 이름으로 표시해요.");
});

it("removes the notice when the endpoint is chosen another way or the account changes", async () => {
  await act(async () => field("출발지").props.onCurrentLocationSelect(located()));
  await act(async () => field("출발지").props.onSelect(place("other", "다른 장소", 127.1)));
  expect(applied()).toHaveLength(0);

  await act(async () => field("출발지").props.onCurrentLocationSelect(located()));
  expect(applied()).toHaveLength(1);
  await act(async () => { for (const listener of mocks.authListeners) listener("SIGNED_IN", { user: { id: "rider-a" } }); });
  await act(async () => { for (const listener of mocks.authListeners) listener("SIGNED_IN", { user: { id: "rider-b" } }); });
  expect(applied()).toHaveLength(0);
});

it("drops a result that arrives after the rider left the editor", async () => {
  const late = field("출발지").props.onCurrentLocationSelect;
  await act(async () => renderer.root.findByProps({ "aria-label": "홈으로" }).props.onClick());
  await act(async () => late(located()));
  expect(renderer.root.findAllByType(CollectionManager)[0].props.currentCourse.origin).toMatchObject({ kakaoPlaceId: "origin" });
  expect(applied()).toHaveLength(0);
});
