import type { ReactElement, ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CollectionCourse } from "@/lib/collections/contracts";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), shareProps: [] as Array<Record<string, unknown>>, summaryDialogShowModal: vi.fn(), noticeFocus: vi.fn() }));

vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));
vi.mock("next/image", () => ({ default: ({ src }: { src: string }) => <span data-image-src={src} /> }));
vi.mock("@/components/kakao-map-canvas", () => ({ KakaoMapCanvas: () => <div />, MapMarkerLegend: () => <div /> }));
vi.mock("@/components/place-search-field", () => ({ PlaceSearchField: () => <div /> }));
vi.mock("@/components/ordered-waypoint-editor", () => ({ OrderedWaypointEditor: () => <div /> }));
vi.mock("@/components/collection-manager", () => ({
  CollectionManager: ({ onShare }: { onShare: (course: CollectionCourse, title: string) => void }) => (
    <button type="button" onClick={() => onShare(course, "공유 준비 코스")}>공유 준비 테스트</button>
  ),
}));
vi.mock("@/components/share-manager", () => ({
  ShareManager: (props: Record<string, unknown>) => {
    mocks.shareProps.push(props);
    return <div data-preview-request={String(props.previewRequest)}>공유 관리자</div>;
  },
}));
vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({ functions: { invoke: mocks.invoke }, rpc: mocks.rpc }),
}));

import { PlannerDashboard } from "./planner-dashboard";

const place = (id: string, longitude: number) => ({
  kakaoPlaceId: id,
  verificationToken: "a".repeat(43),
  name: id,
  address: "테스트 주소",
  roadAddress: null,
  longitude,
  latitude: 37.5,
});
const course: CollectionCourse = { origin: place("origin", 127), destination: place("destination", 127.2), points: [] };
const tripId = "10000000-0000-4000-8000-000000000001";

function renderedText(node: ReactTestRenderer["root"] | string): string {
  if (typeof node === "string") return node;
  return node.children.map((child) => typeof child === "string" ? child : renderedText(child)).join("");
}

function createNodeMock(element: ReactElement<unknown>) {
  const props = element.props as { className?: unknown };
  const className = typeof props.className === "string" ? props.className : "";
  return {
    focus: className.includes("action-notice") ? mocks.noticeFocus : vi.fn(),
    querySelector: vi.fn(),
    querySelectorAll: vi.fn(() => []),
    ...(element.type === "dialog" ? { showModal: mocks.summaryDialogShowModal, close: vi.fn(), open: false } : {}),
  };
}

async function chooseSchedule(renderer: ReactTestRenderer) {
  const calendar = renderer.root.findByProps({ className: "calendar-grid" });
  const dateButton = calendar.findAllByType("button").filter((button) => !button.props.disabled).at(-1)!;
  await act(async () => dateButton.props.onClick());
  await act(async () => renderer.root.findByProps({ className: "schedule-time-rows" }).findAllByType("button")[0].props.onClick());
  const hour = renderer.root.findByProps({ className: "clock-grid hour-grid" }).findAllByType("button").find((button) => button.children.includes("08"))!;
  await act(async () => hour.props.onClick());
  await act(async () => renderer.root.findByProps({ className: "schedule-time-rows" }).findAllByType("button")[1].props.onClick());
  const minute = renderer.root.findByProps({ className: "clock-grid minute-grid" }).findAllByType("button").find((button) => button.children.includes("00"))!;
  await act(async () => minute.props.onClick());
  await act(async () => renderer.root.findAllByType("button").find((button) => button.children.includes("일정 적용"))!.props.onClick());
}

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.rpc.mockReset().mockResolvedValue({ data: tripId, error: null });
  mocks.shareProps.length = 0;
  mocks.summaryDialogShowModal.mockReset();
  mocks.noticeFocus.mockReset();
  mocks.invoke.mockImplementation(async (name: string, options: { body: Record<string, unknown> }) => {
    if (name === "plan-route") {
      const departureAt = new Date(String(options.body.departureAt));
      const arrivalAt = new Date(departureAt.getTime() + 30 * 60_000).toISOString();
      const origin = options.body.origin as Record<string, unknown>;
      const destination = options.body.destination as Record<string, unknown>;
      return { error: null, data: {
        candidate: { id: "recommended", label: "추천 경로", estimatedWinding: false },
        safety: { vehicle: "motorcycle", motorwayExcluded: true, fallbackUsed: false },
        totalDistanceMeters: 12000,
        totalDurationSeconds: 1800,
        returnAt: arrivalAt,
        legs: [{
          from: origin, to: destination, via: [], departureAt: departureAt.toISOString(), arrivalAt,
          dwellMinutes: 0, distanceMeters: 12000, durationSeconds: 1800, providerRequestNumber: 1,
          forecastTraffic: false,
          sections: [{ distance: 12000, duration: 1800, roads: [{ name: "테스트 도로", distance: 12000, duration: 1800, vertexes: [127, 37.5, 127.2, 37.5] }] }],
        }],
      } };
    }
    const point = (options.body.points as Array<Record<string, unknown>>)[0];
    return { error: null, data: {
      generatedAt: new Date().toISOString(), issuedAt: new Date().toISOString(),
      validUntil: "2099-01-01T02:00:00.000Z", source: "live", stale: false,
      forecasts: [{ ...point, status: "forecast", model: "ultra", issuedAt: new Date().toISOString(), condition: "clear", temperatureC: 20, precipitationProbability: 0, windSpeedMps: 1 }],
    } };
  });
  vi.stubGlobal("window", {
    localStorage: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    setTimeout, clearTimeout, setInterval, clearInterval,
    history: { pushState: vi.fn(), replaceState: vi.fn() },
    location: { pathname: "/", search: "", hash: "" },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("PlannerDashboard collection share intent", () => {
  it("keeps share preparation across the mandatory new schedule and opens exactly one fresh preview", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<PlannerDashboard connected />, { createNodeMock: (element) => ({ focus: vi.fn(), querySelector: vi.fn(), querySelectorAll: vi.fn(() => []), ...(element.type === "dialog" ? { showModal: mocks.summaryDialogShowModal, close: vi.fn(), open: false } : {}) }) });
    });
    const prepare = renderer.root.findAllByType("button").find((button) => button.children.includes("공유 준비 테스트"))!;
    await act(async () => prepare.props.onClick());
    expect(renderer.root.findByProps({ className: "schedule-trigger" }).children).toEqual(["날짜와 출발 시각 선택"]);
    await chooseSchedule(renderer);
    mocks.summaryDialogShowModal.mockReset();
    const form = renderer.root.findByType("form");
    await act(async () => form.props.onSubmit({ preventDefault: vi.fn() }));

    expect(mocks.invoke.mock.calls.filter(([name]) => name === "plan-route")).toHaveLength(1);
    expect(mocks.invoke.mock.calls.filter(([name]) => name === "weather-timeline")).toHaveLength(1);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "finalize_trip_plan")).toHaveLength(1);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "publish_trip_share")).toHaveLength(0);
    expect(mocks.shareProps.at(-1)).toMatchObject({ tripId, previewRequest: 1 });
    expect(mocks.summaryDialogShowModal).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ className: "summary-action-panel" })[0].props.hidden).toBe(false);
    expect(renderer.root.findByProps({ "data-preview-request": "1" }).children).toEqual(["공유 관리자"]);
    await act(async () => renderer.unmount());
  });

  it("does not finalize or request weather after an embedded planner unmounts during route planning", async () => {
    let resolvePlan!: (value: { error: null; data: null }) => void;
    mocks.invoke.mockImplementation((name: string) => {
      if (name === "plan-route") return new Promise((resolve) => { resolvePlan = resolve; });
      throw new Error("weather must not start after unmount");
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<PlannerDashboard connected />, { createNodeMock: (element) => ({ focus: vi.fn(), querySelector: vi.fn(), querySelectorAll: vi.fn(() => []), ...(element.type === "dialog" ? { showModal: vi.fn(), close: vi.fn() } : {}) }) });
    });
    await act(async () => renderer.root.findAllByType("button").find((button) => button.children.includes("공유 준비 테스트"))!.props.onClick());
    await chooseSchedule(renderer);
    const form = renderer.root.findByType("form");
    let submission!: Promise<void>;
    await act(async () => {
      submission = form.props.onSubmit({ preventDefault: vi.fn() });
      await Promise.resolve();
    });
    await act(async () => renderer.unmount());
    resolvePlan({ error: null, data: null });
    await act(async () => { await submission; });
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "finalize_trip_plan")).toHaveLength(0);
    expect(mocks.invoke.mock.calls.filter(([name]) => name === "weather-timeline")).toHaveLength(0);
  });

  it("keeps a connected input error visible and focused inside the editor form", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<PlannerDashboard connected initialCourse={course} navigationMode="memory" />, { createNodeMock });
    });
    mocks.noticeFocus.mockReset();

    const form = renderer.root.findByType("form");
    await act(async () => form.props.onSubmit({ preventDefault: vi.fn() }));

    const alerts = form.findAllByProps({ role: "alert" });
    expect(alerts).toHaveLength(1);
    expect(renderedText(alerts[0])).toContain("새 라이딩 날짜와 출발 시각을 모두 선택해 주세요.");
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
    expect(mocks.noticeFocus).toHaveBeenCalled();
    expect(renderer.root.findByType("form")).toBe(form);
    await act(async () => renderer.unmount());
  });

  it("keeps a connected provider failure visible and focused in the editor", async () => {
    mocks.invoke.mockResolvedValue({ error: {}, data: null });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<PlannerDashboard connected initialCourse={course} navigationMode="memory" />, { createNodeMock });
    });
    await chooseSchedule(renderer);
    mocks.noticeFocus.mockReset();

    const form = renderer.root.findByType("form");
    await act(async () => form.props.onSubmit({ preventDefault: vi.fn() }));

    const alert = form.findByProps({ role: "alert" });
    expect(renderedText(alert)).toContain("추천 경로 계산을 완료하지 못했습니다.");
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
    expect(mocks.noticeFocus).toHaveBeenCalled();
    expect(mocks.invoke.mock.calls.filter(([name]) => name === "plan-route")).toHaveLength(1);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "finalize_trip_plan")).toHaveLength(0);
    expect(renderer.root.findByType("form")).toBe(form);
    await act(async () => renderer.unmount());
  });
});
