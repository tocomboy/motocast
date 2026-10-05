import type { ReactElement, ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CollectionCourse } from "@/lib/collections/contracts";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), shareProps: [] as Array<Record<string, unknown>>, summaryDialogShowModal: vi.fn(), noticeFocus: vi.fn(), authListeners: [] as Array<(event: string, session: { user: { id: string } } | null) => void> }));

vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));
vi.mock("next/image", () => ({ default: ({ src }: { src: string }) => <span data-image-src={src} /> }));
vi.mock("@/components/kakao-map-canvas", () => ({ KakaoMapCanvas: () => <div />, MapMarkerLegend: () => <div /> }));
vi.mock("@/components/map-point-confirmation", () => ({ MapPointConfirmation: () => <div /> }));
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
  getBrowserSupabase: () => ({
    functions: { invoke: mocks.invoke },
    rpc: mocks.rpc,
    from: () => ({ select() { return this; }, order() { return this; }, limit: async () => ({ data: [], error: null }) }),
    auth: { onAuthStateChange: (listener: (event: string, session: { user: { id: string } } | null) => void) => { mocks.authListeners.push(listener); return { data: { subscription: { unsubscribe: vi.fn() } } }; } },
  }),
}));

import { PlannerDashboard } from "./planner-dashboard";
import { KakaoMapHandoff } from "./kakaomap-handoff";
import { KakaoMapCanvas } from "./kakao-map-canvas";
import { MapPointConfirmation } from "./map-point-confirmation";
import { RouteFailureDialog } from "./route-failure-dialog";
import { OrderedWaypointEditor } from "./ordered-waypoint-editor";
import { SavedPlacesManager } from "./saved-places-manager";
import { PlannerHome } from "./planner-home";

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

it("adds a confirmed map point once and invalidates a picker when the course changes", async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<PlannerDashboard connected initialCourse={course} navigationMode="memory" />, {createNodeMock}); });
  const coordinate = {latitude:37.5,longitude:127.1};
  const mapPlace = {...place("map:37.5000000:127.1000000",127.1),category:"지도에서 선택",phone:null,placeUrl:null};
  const picker = () => renderer.root.findByType(MapPointConfirmation);
  const map = () => renderer.root.findAllByType(KakaoMapCanvas)[0];
  await act(async () => map().props.onSelectCoordinate(coordinate));
  expect(renderer.root.findByType(OrderedWaypointEditor).props.waypoints).toHaveLength(0);
  await act(async () => picker().props.onSelect(mapPlace));
  const points = renderer.root.findByType(OrderedWaypointEditor).props.waypoints;
  expect(points).toHaveLength(1); expect(points[0]).toMatchObject({role:"waypoint",dwellMinutes:0,place:mapPlace});
  expect(mocks.invoke).not.toHaveBeenCalled();
  await act(async () => picker().props.onSelect(mapPlace));
  expect(renderer.root.findByType(OrderedWaypointEditor).props.waypoints).toHaveLength(1);
  await act(async () => map().props.onSelectCoordinate(coordinate));
  const staleConfirm = picker().props.onSelect;
  await act(async () => renderer.root.findByType(OrderedWaypointEditor).props.onChange([]));
  await act(async () => staleConfirm(mapPlace));
  expect(renderer.root.findByType(OrderedWaypointEditor).props.waypoints).toHaveLength(0);
  expect(mocks.invoke).not.toHaveBeenCalled(); await act(async () => renderer.unmount());
});

function renderedText(node: ReactTestRenderer["root"] | string): string {
  if (typeof node === "string") return node;
  return node.children.map((child) => typeof child === "string" ? child : renderedText(child)).join("");
}

function createNodeMock(element: ReactElement<unknown>) {
  const props = element.props as { className?: unknown };
  const className = typeof props.className === "string" ? props.className : "";
  return {
    focus: className.includes("action-notice") ? mocks.noticeFocus : vi.fn(),
    click: vi.fn(),
    querySelector: vi.fn(),
    querySelectorAll: vi.fn(() => []),
    ...(element.type === "dialog" ? { showModal: mocks.summaryDialogShowModal, close: vi.fn(), open: false } : {}),
  };
}

async function chooseSchedule(renderer: ReactTestRenderer) {
  await act(async () => renderer.root.findByProps({ className: "schedule-trigger" }).props.onClick());
  // Use the first day of the next visible month, including at Seoul month/year end.
  await act(async () => renderer.root.findByProps({ "aria-label": "다음 달" }).props.onClick());
  const calendar = renderer.root.findByProps({ className: "calendar-grid" });
  const dateButton = calendar.findAllByType("button").find((button) => renderedText(button) === "1")!;
  expect(dateButton.props.disabled).toBe(false);
  await act(async () => dateButton.props.onClick());
  await act(async () => renderer.root.findByProps({ className: "schedule-time-rows" }).findAllByType("button")[0].props.onClick());
  const hour = renderer.root.findByProps({ className: "clock-grid hour-grid" }).findAllByType("button").find((button) => button.children.includes("08"))!;
  await act(async () => hour.props.onClick());
  await act(async () => renderer.root.findByProps({ className: "schedule-time-rows" }).findAllByType("button")[1].props.onClick());
  const minute = renderer.root.findByProps({ className: "clock-grid minute-grid" }).findAllByType("button").find((button) => button.children.includes("00"))!;
  await act(async () => minute.props.onClick());
  await act(async () => renderer.root.findByProps({ className: "schedule-dialog-actions" }).findByType("button").props.onClick());
}

beforeEach(() => {
  vi.stubGlobal("document", { activeElement: null, querySelector: vi.fn(() => null) });
  vi.stubGlobal("HTMLElement", class {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T08:57:00.000Z"));
  mocks.authListeners.length = 0;
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

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("PlannerDashboard collection share intent", () => {
  it("adds repeated saved places with separate occurrence IDs, keeps stale summary recoverable and waits for explicit recalculation",async()=>{
    let r!:ReactTestRenderer;await act(async()=>{r=create(<PlannerDashboard connected initialCourse={course} navigationMode="memory"/>,{createNodeMock});});await chooseSchedule(r);
    await act(async()=>r.root.findByType("form").props.onSubmit({preventDefault:vi.fn()}));const calls=mocks.invoke.mock.calls.length;
    const saved={...place("saved",127.1),category:"",phone:null,placeUrl:null};
    async function add(role:string,dwell:number){await act(async()=>r.root.findByProps({"aria-label":"MOTOCAST 홈"}).props.onClick());await act(async()=>r.root.findByType(PlannerHome).props.onFavorites());await act(async()=>{expect(r.root.findByType(SavedPlacesManager).props.onAddWaypoint(saved,role,dwell)).toBeNull();});}
    await add("rest",45);await add("waypoint",0);
    const points=r.root.findByType(OrderedWaypointEditor).props.waypoints;expect(points).toHaveLength(2);expect(points.map((p:{role:string;dwellMinutes:number})=>[p.role,p.dwellMinutes])).toEqual([["rest",45],["waypoint",0]]);expect(points[0].id).not.toBe(points[1].id);expect(mocks.invoke).toHaveBeenCalledTimes(calls);
    expect(r.root.findAllByType(KakaoMapCanvas)[0].props.path).toBeUndefined();
    await act(async()=>r.root.findByProps({"aria-label":"경로 요약으로"}).props.onClick());expect(renderedText(r.root)).toContain("경로 업데이트 필요");expect(r.root.findAllByType(KakaoMapHandoff)).toHaveLength(0);
    await act(async()=>r.root.findAllByType("button").find(b=>renderedText(b)==="경로 편집으로")!.props.onClick());
    expect(renderedText(r.root.findByProps({className:"primary-button calculate"}))).toBe("경로 다시 계산");
    mocks.invoke.mockResolvedValueOnce({data:null,error:{message:"budget exhausted"}});await act(async()=>r.root.findByType("form").props.onSubmit({preventDefault:vi.fn()}));
    expect(r.root.findByType(OrderedWaypointEditor).props.waypoints).toEqual(points);expect(mocks.invoke).toHaveBeenCalledTimes(calls+1);await act(async()=>r.unmount());
  });
  it.each([
    "ROUTE_WAYPOINT_ROAD_NOT_FOUND", "ROUTE_ORIGIN_ROAD_NOT_FOUND", "ROUTE_DESTINATION_ROAD_NOT_FOUND",
    "ROUTE_POINTS_TOO_CLOSE", "ROUTE_ORIGIN_BLOCKED", "ROUTE_DESTINATION_BLOCKED", "ROUTE_WAYPOINT_BLOCKED",
  ])("shows a safe map popup for %s without saving or fetching weather", async (code) => {
    mocks.invoke.mockImplementation(async () => ({ error: { context: new Response(JSON.stringify({ code, error: "private-provider-detail" }), { status: 422 }) } }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PlannerDashboard connected initialCourse={course} navigationMode="memory" />, { createNodeMock }); });
    await chooseSchedule(renderer);
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
    const popup = renderer.root.findByType(RouteFailureDialog);
    expect(popup.props.code).toBe(code);
    expect(renderedText(popup)).not.toContain("private-provider-detail");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls.map(call => call[0])).toEqual(["plan-route"]);
    await act(async () => popup.props.onEdit());
    expect(renderer.root.findAllByType(RouteFailureDialog)).toHaveLength(0);
    expect(renderer.root.findByType("main").props["data-view"]).toBe("editor");
    await act(async () => renderer.unmount());
  });

  it("shows the server guidance when route calculation refuses an outdated meal dwell", async () => {
    mocks.invoke.mockImplementation(async () => ({ data: null, error: { context: new Response(JSON.stringify({ error: "식사 시간은 45분으로 바뀌었어요. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.", code: "MEAL_DWELL_FIXED" }), { status: 400 }) } }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PlannerDashboard connected initialCourse={course} navigationMode="memory" />, { createNodeMock }); });
    await chooseSchedule(renderer);
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
    const alert = renderer.root.findByType("form").findByProps({ role: "alert" });
    expect(renderedText(alert)).toContain("식사 시간은 45분으로 바뀌었어요. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.");
    expect(renderer.root.findAllByType(RouteFailureDialog)).toHaveLength(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  it("binds owner handoff to the calculated inputs and invalidates it on account change", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PlannerDashboard connected initialCourse={course} navigationMode="memory" />, { createNodeMock }); });
    await act(async () => { for (const listener of mocks.authListeners) listener("INITIAL_SESSION", { user: { id: "first" } }); });
    await chooseSchedule(renderer);
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
    const result = () => renderer.root.findByType(KakaoMapHandoff).props.readSource().result;
    expect(result().status).toBe("ready");
    const calls = mocks.invoke.mock.calls.length;
    await act(async () => { for (const listener of mocks.authListeners) listener("TOKEN_REFRESHED", { user: { id: "first" } }); });
    expect(result().status).toBe("ready");
    await act(async () => { for (const listener of mocks.authListeners) listener("SIGNED_IN", { user: { id: "second" } }); });
    expect(renderer.root.findAllByType(KakaoMapHandoff)).toHaveLength(0);
    expect(mocks.invoke).toHaveBeenCalledTimes(calls);
    await act(async () => renderer.unmount());
  });
  it("keeps share preparation across the mandatory new schedule and opens exactly one fresh preview", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<PlannerDashboard connected />, { createNodeMock: (element) => ({ focus: vi.fn(), click: vi.fn(), querySelector: vi.fn(), querySelectorAll: vi.fn(() => []), ...(element.type === "dialog" ? { showModal: mocks.summaryDialogShowModal, close: vi.fn(), open: false } : {}) }) });
    });
    const prepare = renderer.root.findAllByType("button").find((button) => button.children.includes("공유 준비 테스트"))!;
    await act(async () => prepare.props.onClick());
    expect(renderedText(renderer.root.findByProps({ className: "schedule-trigger" }))).toContain("날짜와 출발 시각 선택");
    await act(async () => renderer.root.findByProps({ className: "schedule-trigger" }).props.onClick());
    expect(renderedText(renderer.root.findByProps({ className: "schedule-selection" }))).toBe("9월 30일 · 18:00 출발");
    expect(renderedText(renderer.root.findByProps({ className: "schedule-trigger" }))).toContain("날짜와 출발 시각 선택");
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    await chooseSchedule(renderer);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.summaryDialogShowModal.mockReset();
    const form = renderer.root.findByType("form");
    await act(async () => form.props.onSubmit({ preventDefault: vi.fn() }));

    expect(mocks.invoke.mock.calls.filter(([name]) => name === "plan-route")).toHaveLength(1);
    const routeRequest = mocks.invoke.mock.calls.find(([name]) => name === "plan-route")![1];
    expect(new Date(routeRequest.body.departureAt).toISOString()).toBe("2026-09-30T23:00:00.000Z");
    expect(mocks.invoke.mock.calls.filter(([name]) => name === "weather-timeline")).toHaveLength(1);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "finalize_trip_plan")).toHaveLength(1);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "publish_trip_share")).toHaveLength(0);
    expect(mocks.shareProps.at(-1)).toMatchObject({ tripId, previewRequest: 1 });
    expect(mocks.summaryDialogShowModal).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ className: "summary-action-panel" })[0].props.hidden).toBe(false);
    expect(renderer.root.findByProps({ "data-preview-request": "1" }).children).toEqual(["공유 관리자"]);
    const weatherStatuses = renderer.root.findAllByProps({ role: "status" })
      .filter((status) => renderedText(status).includes("추천 경로 날씨:"));
    expect(weatherStatuses).toHaveLength(1);
    expect(renderedText(weatherStatuses[0])).toContain("실시간 조회 예보");
    await act(async () => renderer.unmount());
  });

  it("announces connected summary weather while loading and when a stale snapshot replaces it", async () => {
    const successfulInvoke = mocks.invoke.getMockImplementation()!;
    let resolveWeather!: (value: { error: null; data: Record<string, unknown> }) => void;
    let weatherPoint!: Record<string, unknown>;
    mocks.invoke.mockImplementation((name: string, options: { body: Record<string, unknown> }) => {
      if (name !== "weather-timeline") return successfulInvoke(name, options);
      weatherPoint = (options.body.points as Array<Record<string, unknown>>)[0];
      return new Promise((resolve) => { resolveWeather = resolve; });
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<PlannerDashboard connected initialCourse={course} navigationMode="memory" />, { createNodeMock });
    });
    await chooseSchedule(renderer);
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
    await act(async () => { await Promise.resolve(); });

    const loadingStatuses = renderer.root.findAllByProps({ role: "status" })
      .filter((status) => renderedText(status).includes("추천 경로 날씨 조회 중"));
    expect(loadingStatuses).toHaveLength(1);
    expect(renderedText(loadingStatuses[0])).toContain("날씨 조회 중");

    const now = new Date().toISOString();
    await act(async () => resolveWeather({ error: null, data: {
      generatedAt: now,
      issuedAt: now,
      validUntil: "2099-01-01T02:00:00.000Z",
      source: "snapshot",
      stale: true,
      staleReason: "기상청 요청에 실패했습니다.",
      failureKind: "provider",
      staleObservedAt: now,
      forecasts: [{ ...weatherPoint, status: "forecast", model: "ultra", issuedAt: now, condition: "cloudy", temperatureC: 18, precipitationProbability: 20, windSpeedMps: 2 }],
    } }));

    const staleStatuses = renderer.root.findAllByProps({ role: "status" })
      .filter((status) => renderedText(status).includes("추천 경로 날씨:"));
    expect(staleStatuses).toHaveLength(1);
    expect(renderedText(staleStatuses[0])).toContain("기상청 공급자 오류로 저장본 표시");
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
      renderer = create(<PlannerDashboard connected />, { createNodeMock: (element) => ({ focus: vi.fn(), click: vi.fn(), querySelector: vi.fn(), querySelectorAll: vi.fn(() => []), ...(element.type === "dialog" ? { showModal: vi.fn(), close: vi.fn() } : {}) }) });
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

  it.each([
    ["a legacy 60-minute lunch", { stopRole: "lunch" as const, dwellMinutes: 60 }, true],
    ["a meal already at 45 minutes", { stopRole: "meal" as const, dwellMinutes: 45 }, false],
  ])("applying a course with %s normalizes the draft and mentions it only when it changed", async (_name, meal, changed) => {
    const mealPoint = { ...place("meal-place", 127.1), id: "occ-meal", label: "식사 장소", kind: "stop" as const, selected: true, winding: false, ...meal };
    const restPoint = { ...place("rest-place", 127.15), id: "occ-rest", label: "휴식 장소", kind: "optional" as const, selected: true, winding: false, stopRole: "rest" as const, dwellMinutes: 50 };
    const mealCourse: CollectionCourse = { ...course, points: [mealPoint, restPoint] };
    const snapshot = structuredClone(mealCourse);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PlannerDashboard connected initialCourse={mealCourse} navigationMode="memory" />, { createNodeMock }); });
    const waypoints = renderer.root.findByType(OrderedWaypointEditor).props.waypoints;
    expect(waypoints.map((point: { id: string; role: string; dwellMinutes: number }) => [point.id, point.role, point.dwellMinutes])).toEqual([
      ["occ-meal", "meal", 45],
      ["occ-rest", "rest", 50],
    ]);
    const notice = renderedText(renderer.root.findByProps({ className: "action-notice warning" }));
    expect(notice).toContain("컬렉션 전체 코스를 적용했습니다.");
    if (changed) expect(notice).toContain("식사 시간은 45분으로 맞췄어요.");
    else expect(notice).not.toContain("식사 시간은 45분으로 맞췄어요.");
    // The course object handed in (stored collection / received share) is not rewritten.
    expect(mealCourse).toEqual(snapshot);
    expect(mocks.invoke).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
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
