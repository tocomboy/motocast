import type { ReactElement, ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { CollectionCourse } from "@/lib/collections/contracts";

// V3 finding (Issue #137): the editor form stays mounted, hidden, while the summary is
// shown. A location request started in the editor must not apply after the rider left it,
// even when the rider is back in the editor by the time the answer arrives.
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }));

vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));
vi.mock("next/image", () => ({ default: ({ src }: { src: string }) => <span data-image-src={src} /> }));
vi.mock("@/components/kakao-map-canvas", () => ({ KakaoMapCanvas: () => <div />, MapMarkerLegend: () => <div /> }));
vi.mock("@/components/map-point-confirmation", async (importOriginal) => ({ ...(await importOriginal<object>()), MapPointConfirmation: () => <div /> }));
vi.mock("@/components/ordered-waypoint-editor", () => ({ OrderedWaypointEditor: () => <div /> }));
vi.mock("@/components/collection-manager", () => ({ CollectionManager: () => <div /> }));
vi.mock("@/components/share-manager", () => ({ ShareManager: () => <div /> }));
vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({
    functions: { invoke: mocks.invoke },
    rpc: mocks.rpc,
    from: () => ({ select() { return this; }, order() { return this; }, limit: async () => ({ data: [], error: null }) }),
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) },
  }),
}));

import { PlannerDashboard } from "./planner-dashboard";
import { PlaceSearchField } from "./place-search-field";

const place = (id: string, longitude: number) => ({ kakaoPlaceId: id, verificationToken: "a".repeat(43), name: id, address: "테스트 주소", roadAddress: null, longitude, latitude: 37.5 });
const course: CollectionCourse = { origin: place("origin", 127), destination: place("destination", 127.2), points: [] };
const fix = { latitude: 37.5665, longitude: 126.978, accuracy: 20 };
const located = { kakaoPlaceId: "map:37.5665000:126.9780000", verificationToken: "b".repeat(43), name: "서울 중구 세종대로 110", address: "서울 중구 태평로1가 31", roadAddress: "서울 중구 세종대로 110", category: "지도에서 선택", phone: null, placeUrl: null, latitude: 37.5665, longitude: 126.978 };

let fixes: PositionCallback[] = [];
let lookups: Array<(value: unknown) => void> = [];
let renderer: ReactTestRenderer;

function textOf(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}
function createNodeMock(element: ReactElement<unknown>) {
  if (element.type !== "dialog") return { focus: vi.fn(), click: vi.fn(), querySelector: vi.fn(() => null), querySelectorAll: vi.fn(() => []) };
  const dialog = { open: false, showModal: vi.fn(() => { dialog.open = true; }), close: vi.fn(() => { dialog.open = false; }), focus: vi.fn(), querySelector: vi.fn(() => null), querySelectorAll: vi.fn(() => []) };
  return dialog;
}
const button = (label: string) => renderer.root.findAllByType("button").find((node) => node.props["aria-label"] === label || textOf(node) === label);
const origin = () => renderer.root.findAllByType(PlaceSearchField).find((node) => node.props.accessibleLabel === "출발지")!;
const press = async (label: string) => {
  const target = button(label);
  expect(target, label).toBeDefined();
  await act(async () => target!.props.onClick());
};

beforeEach(async () => {
  fixes = [];
  lookups = [];
  vi.stubGlobal("document", { activeElement: null, querySelector: vi.fn(() => null) });
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: (success: PositionCallback) => { fixes.push(success); } } });
  vi.stubGlobal("window", {
    localStorage: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    setTimeout, clearTimeout, setInterval, clearInterval,
    history: { pushState: vi.fn(), replaceState: vi.fn() },
    location: { pathname: "/", search: "", hash: "" },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T08:57:00.000Z"));
  mocks.rpc.mockReset().mockResolvedValue({ data: "10000000-0000-4000-8000-000000000001", error: null });
  mocks.invoke.mockReset().mockImplementation(async (name: string, options: { body: Record<string, unknown> }) => {
    if (name === "search-places") return new Promise((resolve) => { lookups.push(resolve); });
    if (name === "plan-route") {
      const departureAt = new Date(String(options.body.departureAt));
      const arrivalAt = new Date(departureAt.getTime() + 30 * 60_000).toISOString();
      return { error: null, data: {
        candidate: { id: "recommended", label: "추천 경로", estimatedWinding: false },
        safety: { vehicle: "motorcycle", motorwayExcluded: true, fallbackUsed: false },
        totalDistanceMeters: 12000, totalDurationSeconds: 1800, returnAt: arrivalAt,
        legs: [{
          from: options.body.origin, to: options.body.destination, via: [], departureAt: departureAt.toISOString(), arrivalAt,
          dwellMinutes: 0, distanceMeters: 12000, durationSeconds: 1800, providerRequestNumber: 1, forecastTraffic: false,
          sections: [{ distance: 12000, duration: 1800, roads: [{ name: "테스트 도로", distance: 12000, duration: 1800, vertexes: [127, 37.5, 127.2, 37.5] }] }],
        }],
      } };
    }
    const point = (options.body.points as Array<Record<string, unknown>>)[0];
    return { error: null, data: {
      generatedAt: new Date().toISOString(), issuedAt: new Date().toISOString(), validUntil: "2099-01-01T02:00:00.000Z", source: "live", stale: false,
      forecasts: [{ ...point, status: "forecast", model: "ultra", issuedAt: new Date().toISOString(), condition: "clear", temperatureC: 20, precipitationProbability: 0, windSpeedMps: 1 }],
    } };
  });

  await act(async () => { renderer = create(<PlannerDashboard connected initialCourse={course} navigationMode="memory" />, { createNodeMock }); });
  // A calculated route, so leaving the editor shows the summary with the form kept hidden.
  await act(async () => renderer.root.findByProps({ className: "schedule-trigger" }).props.onClick());
  await act(async () => renderer.root.findByProps({ "aria-label": "다음 달" }).props.onClick());
  await act(async () => renderer.root.findByProps({ className: "calendar-grid" }).findAllByType("button").find((node) => textOf(node) === "1")!.props.onClick());
  await act(async () => renderer.root.findByProps({ className: "schedule-dialog-actions" }).findByType("button").props.onClick());
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
  expect(mocks.invoke.mock.calls.map((call) => call[0])).toContain("plan-route");
  if (button("경로 편집으로")) await press("경로 편집으로");
  expect(renderer.root.findByType("main").props["data-view"]).toBe("editor");
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function startLocating() {
  await act(async () => origin().findAllByType("button").find((node) => node.props.className?.includes("place-picker-trigger"))!.props.onClick());
  await press("현재 위치를 출발지로 설정");
  expect(fixes).toHaveLength(1);
}
async function leaveAndReturn() {
  await press("경로 요약으로");
  expect(renderer.root.findByType("main").props["data-view"]).toBe("summary");
  await press("경로 편집으로");
  expect(renderer.root.findByType("main").props["data-view"]).toBe("editor");
}
function expectOriginKept() {
  expect(origin().props.selected).toMatchObject({ kakaoPlaceId: "origin" });
  expect(renderer.root.findAll((node) => node.props.className === "current-location-applied")).toHaveLength(0);
}

it("drops a fix that arrives after a round trip through the summary, without spending a lookup", async () => {
  await startLocating();
  await leaveAndReturn();
  await act(async () => fixes[0]({ coords: fix, timestamp: 0 } as unknown as GeolocationPosition));
  expect(mocks.invoke.mock.calls.filter((call) => call[0] === "search-places")).toHaveLength(0);
  expectOriginKept();
});

it("drops a lookup that answers after a round trip through the summary", async () => {
  await startLocating();
  await act(async () => fixes[0]({ coords: fix, timestamp: 0 } as unknown as GeolocationPosition));
  expect(lookups).toHaveLength(1);
  await leaveAndReturn();
  await act(async () => lookups[0]({ data: { places: [located], isEnd: true }, error: null }));
  expectOriginKept();
});
