import type { ReactElement, ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CollectionCourse } from "@/lib/collections/contracts";
import { mealTargetAt, type RecommendationRequest } from "@/lib/planner/restaurant-recommendation";

const mocks = vi.hoisted(() => ({
  reads: [] as string[],
  pickers: new Map<string, { onOpen?: () => void }>(),
  invoke: vi.fn(),
  rpc: vi.fn(),
  savedRows: [] as unknown[],
  focused: [] as string[],
  authListeners: [] as Array<(event: string, session: { user: { id: string } } | null) => void>,
}));

vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));
vi.mock("next/image", () => ({ default: ({ src }: { src: string }) => <span data-image-src={src} /> }));
vi.mock("@/components/kakao-map-canvas", () => ({ KakaoMapCanvas: () => <div />, MapMarkerLegend: () => <div /> }));
vi.mock("@/components/map-point-confirmation", () => ({ MapPointConfirmation: () => <div /> }));
vi.mock("@/components/place-search-field", () => ({ PlaceSearchField: (props: { onOpen?: () => void; label: string }) => { mocks.pickers.set(props.label, props); return <div />; } }));
vi.mock("@/components/ordered-waypoint-editor", () => ({ OrderedWaypointEditor: () => <div /> }));
vi.mock("@/components/collection-manager", () => ({ CollectionManager: () => <div /> }));
vi.mock("@/components/share-manager", () => ({ ShareManager: () => <div /> }));
// Contract v2 (#124 §7.3): the bodies below are written in the v1 shape and converted here,
// so each candidate comes from my saved place and every v2-only count is zero.
function toV2(body: unknown) {
  if (!body || typeof body !== "object") return body;
  const raw = body as { meals?: Array<{ candidates?: Array<Record<string, unknown>> }>; pairs?: Array<Record<string, unknown>>; coverage?: Record<string, unknown> };
  const source = (id: unknown, revision: unknown) => ({ type: "saved", id, revision });
  return {
    contractVersion: 2,
    ...raw,
    meals: raw.meals?.map((meal) => ({
      ...meal,
      candidates: meal.candidates?.map(({ savedPlaceId, savedPlaceRevision, ...candidate }) => ({ ...candidate, source: source(savedPlaceId, savedPlaceRevision), otherFolderIds: [] })),
    })),
    pairs: raw.pairs?.map(({ firstSavedPlaceId, secondSavedPlaceId, ...pair }) => ({ ...pair, first: source(firstSavedPlaceId, 1), second: source(secondSavedPlaceId, 1) })),
    coverage: raw.coverage && { ...raw.coverage, sharedRestaurants: 0, duplicateMerged: 0, avoidedExcluded: 0, disabledFolders: 0, sharedReadTruncated: false },
  };
}
// Pairs name both sources with their revisions; the two-meal fixtures use revision 1 throughout.
vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({
    functions: {
      invoke: async (name: string, options: unknown) => {
        const result = await mocks.invoke(name, options);
        return name === "recommend-restaurants" && result && typeof result === "object" && "data" in result ? { ...result, data: toV2((result as { data: unknown }).data) } : result;
      },
    },
    rpc: mocks.rpc,
    // Table-aware reads: my saved places, and nothing shared or avoided (§7.4 re-check reads too).
    from: (table: string) => {
      mocks.reads.push(table);
      const rows = () => (table === "saved_place_entries" ? mocks.savedRows : []);
      const builder = {
        select() { return builder; },
        order() { return builder; },
        in() { return builder; },
        range() { return builder; },
        limit: async () => ({ data: rows(), error: null }),
        then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve(resolve({ data: rows(), error: null })),
      };
      return builder;
    },
    auth: { getSession: async () => ({ data: { session: { user: { id: "00000000-0000-4000-8000-0000000000a1" } } } }), onAuthStateChange: (listener: (event: string, session: { user: { id: string } } | null) => void) => { mocks.authListeners.push(listener); return { data: { subscription: { unsubscribe: vi.fn() } } }; } },
  }),
}));

import { PlannerDashboard } from "./planner-dashboard";
import { OrderedWaypointEditor } from "./ordered-waypoint-editor";
import { RestaurantRecommendationDialog } from "./restaurant-recommendation-dialog";

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
const savedId = "20000000-0000-4000-8000-000000000001";
const savedRow = (revision = 2) => ({
  id: savedId,
  place: { ...place("kakao-restaurant", 127.1), name: "공개 시험 국밥" },
  alias: "단골 국밥",
  kind: "restaurant",
  province: null,
  star_slot: null,
  star_position: null,
  revision,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
});

// Echoes the request like the server: target = first Seoul desired time at or
// after departure − tolerance; return = base return + extra drive + dwell.
function recommendationBody(request: RecommendationRequest, candidateRevision = 2) {
  const target = mealTargetAt(request.basis.departureAt, request.toleranceMinutes, request.meals[0].desiredTime)!;
  const dwell = request.meals[0].dwellMinutes;
  return {
    status: "OK",
    basis: { tripId: request.tripId, ...request.basis },
    // The server echoes its fixed 60-minute cap (contract 2.0.0).
    settings: { mealCount: request.mealCount, toleranceMinutes: request.toleranceMinutes, detourLimitMinutes: 60 },
    meals: [{
      index: 1,
      targetAt: target.toISOString(),
      windowStartAt: new Date(target.getTime() - request.toleranceMinutes * 60_000).toISOString(),
      windowEndAt: new Date(target.getTime() + request.toleranceMinutes * 60_000).toISOString(),
      dwellMinutes: request.meals[0].dwellMinutes,
      candidates: [{
        savedPlaceId: savedId,
        savedPlaceRevision: candidateRevision,
        displayName: "단골 국밥",
        placeName: "공개 시험 국밥",
        address: "테스트 주소",
        longitude: 127.1,
        latitude: 37.5,
        insertion: { legIndex: 0, afterPointId: request.basis.pointIds[0], beforePointId: request.basis.pointIds[1] },
        single: { feasible: true, arrivalAt: target.toISOString(), extraDriveSeconds: 540, returnAt: new Date(new Date(request.basis.returnAt).getTime() + (540 + dwell * 60) * 1000).toISOString(), reason: null },
      }],
    }],
    pairs: [],
    coverage: { savedRestaurants: 1, invalidSaved: 0, alreadyInRoute: 0, nearRoute: 1, evaluated: 1, unreachable: 0, notEvaluated: 0, providerRequests: 1 },
  };
}

// Two meals on the single leg: meal 1 a (alone 10 min) and b (alone 20 min); meal 2 c.
// Paired with c the totals flip: b + c 30 min < a + c 50 min (same-leg pairs).
function twoMealBody(request: RecommendationRequest) {
  const base = Date.parse(request.basis.returnAt);
  const iso = (value: number) => new Date(value).toISOString();
  const meals = request.meals.map((asked, index) => {
    const target = mealTargetAt(request.basis.departureAt, request.toleranceMinutes, asked.desiredTime)!.getTime();
    return { index: index + 1, target, dwellMinutes: asked.dwellMinutes };
  });
  const candidate = (key: string, name: string, meal: number, extraMinutes: number) => ({
    savedPlaceId: `30000000-0000-4000-8000-00000000000${key}`,
    savedPlaceRevision: 1,
    displayName: name,
    placeName: name,
    address: "테스트 주소",
    longitude: 127.1,
    latitude: 37.5,
    insertion: { legIndex: 0, afterPointId: request.basis.pointIds[0], beforePointId: request.basis.pointIds[1] },
    single: { feasible: true, arrivalAt: iso(meals[meal].target), extraDriveSeconds: extraMinutes * 60, returnAt: iso(base + (extraMinutes + 45) * 60_000), reason: null },
  });
  const pair = (first: string, extraMinutes: number) => ({
    firstSavedPlaceId: `30000000-0000-4000-8000-00000000000${first}`,
    secondSavedPlaceId: "30000000-0000-4000-8000-00000000000c",
    firstArrivalAt: iso(meals[0].target),
    secondArrivalAt: iso(meals[1].target),
    extraDriveSeconds: extraMinutes * 60,
    returnAt: iso(base + (extraMinutes + 90) * 60_000),
  });
  return {
    status: "OK",
    basis: { tripId: request.tripId, ...request.basis },
    settings: { mealCount: 2, toleranceMinutes: request.toleranceMinutes, detourLimitMinutes: 60 },
    meals: meals.map((meal) => ({
      index: meal.index,
      targetAt: iso(meal.target),
      windowStartAt: iso(meal.target - request.toleranceMinutes * 60_000),
      windowEndAt: iso(meal.target + request.toleranceMinutes * 60_000),
      dwellMinutes: meal.dwellMinutes,
      candidates: meal.index === 1 ? [candidate("a", "식당 a", 0, 10), candidate("b", "식당 b", 0, 20)] : [candidate("c", "식당 c", 1, 5)],
    })),
    pairs: [pair("b", 30), pair("a", 50)],
    coverage: { savedRestaurants: 3, invalidSaved: 0, alreadyInRoute: 0, nearRoute: 3, evaluated: 3, unreachable: 0, notEvaluated: 0, providerRequests: 3 },
  };
}

// Both restaurants miss their windows alone (40 minutes early) but fit together
// on the single leg: pair-only rows on both sides (Codex V3 reproduction shape).
function pairOnlyBody(request: RecommendationRequest) {
  const body = twoMealBody(request);
  const [lunch, dinner] = body.meals;
  const early = (iso: string) => new Date(Date.parse(iso) - 40 * 60_000).toISOString();
  const pairOnly = (candidate: (typeof lunch.candidates)[number], arrivalAt: string) => ({
    ...candidate,
    single: { ...candidate.single, feasible: false, arrivalAt: early(arrivalAt), reason: "WINDOW" as const },
  });
  return {
    ...body,
    meals: [
      { ...lunch, candidates: [pairOnly(lunch.candidates[0], lunch.targetAt)] },
      { ...dinner, candidates: [pairOnly(dinner.candidates[0], dinner.targetAt)] },
    ],
    pairs: [body.pairs.find((pair) => pair.firstSavedPlaceId.endsWith("a"))!],
  };
}

function text(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  return node.children.map((child) => typeof child === "string" ? child : text(child)).join("");
}

function buttons(root: ReactTestInstance, label: string) {
  return root.findAll((node) => node.type === "button" && text(node) === label);
}

// Records which heading received focus (react-test-renderer returns a new
// mock object from `.instance`, so calls are tracked here instead).
function createNodeMock(element: ReactElement<unknown>) {
  const props = element.props as { children?: unknown };
  return {
    focus: vi.fn(() => { if (element.type === "h2" || element.type === "h3") mocks.focused.push(`${element.type}:${String(props.children)}`); }),
    click: vi.fn(),
    querySelector: vi.fn(),
    querySelectorAll: vi.fn(() => []),
    ...(element.type === "dialog" ? { showModal: vi.fn(), close: vi.fn(), open: false } : {}),
  };
}

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function chooseSchedule(renderer: ReactTestRenderer) {
  await act(async () => renderer.root.findByProps({ className: "schedule-trigger" }).props.onClick());
  await act(async () => renderer.root.findByProps({ "aria-label": "다음 달" }).props.onClick());
  const calendar = renderer.root.findByProps({ className: "calendar-grid" });
  await act(async () => calendar.findAllByType("button").find((button) => text(button) === "1")!.props.onClick());
  await act(async () => renderer.root.findByProps({ className: "schedule-time-rows" }).findAllByType("button")[0].props.onClick());
  await act(async () => renderer.root.findByProps({ className: "clock-grid hour-grid" }).findAllByType("button").find((button) => button.children.includes("08"))!.props.onClick());
  await act(async () => renderer.root.findByProps({ className: "schedule-time-rows" }).findAllByType("button")[1].props.onClick());
  await act(async () => renderer.root.findByProps({ className: "clock-grid minute-grid" }).findAllByType("button").find((button) => button.children.includes("00"))!.props.onClick());
  await act(async () => renderer.root.findByProps({ className: "schedule-dialog-actions" }).findByType("button").props.onClick());
}

// Calculates and saves a live route, then opens the recommendation dialog from the summary.
async function openRecommendation() {
  return openRecommendationFrom(null);
}

// `opener` stands in for the focused entry button that the dialog restores focus to.
async function openRecommendationFrom(opener: object | null) {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<PlannerDashboard connected initialCourse={course} navigationMode="memory" />, { createNodeMock }); });
  await flush();
  await chooseSchedule(renderer);
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
  expect(renderer.root.findByType("main").props["data-view"]).toBe("summary");
  const entries = buttons(renderer.root, "음식점 추천 받기");
  expect(entries).toHaveLength(2);
  expect(entries.every((entry) => entry.props.disabled === false)).toBe(true);
  (document as unknown as { activeElement: object | null }).activeElement = opener;
  await act(async () => entries[0].props.onClick());
  return renderer;
}

const dialog = (renderer: ReactTestRenderer) => renderer.root.findByType(RestaurantRecommendationDialog);
const calls = (name: string) => mocks.invoke.mock.calls.filter(([called]) => called === name);

beforeEach(() => {
  vi.stubGlobal("document", { activeElement: null, querySelector: vi.fn(() => null) });
  vi.stubGlobal("HTMLElement", class {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T08:57:00.000Z"));
  mocks.authListeners.length = 0;
  mocks.savedRows = [savedRow()];
  mocks.focused.length = 0;
  mocks.invoke.mockReset();
  mocks.rpc.mockReset().mockResolvedValue({ data: tripId, error: null });
  mocks.invoke.mockImplementation(async (name: string, options: { body: Record<string, unknown> }) => {
    if (name === "plan-route") {
      const departureAt = new Date(String(options.body.departureAt));
      const arrivalAt = new Date(departureAt.getTime() + 30 * 60_000).toISOString();
      return { error: null, data: {
        candidate: { id: "recommended", label: "추천 경로", estimatedWinding: false },
        safety: { vehicle: "motorcycle", motorwayExcluded: true, fallbackUsed: false },
        totalDistanceMeters: 12000, totalDurationSeconds: 1800, returnAt: arrivalAt,
        legs: [{
          from: options.body.origin, to: options.body.destination, via: [], departureAt: departureAt.toISOString(), arrivalAt,
          dwellMinutes: 0, distanceMeters: 12000, durationSeconds: 1800, forecastTraffic: false,
          sections: [{ distance: 12000, duration: 1800, roads: [{ name: "테스트 도로", distance: 12000, duration: 1800, vertexes: [127, 37.5, 127.2, 37.5] }] }],
        }],
      } };
    }
    if (name === "weather-timeline") {
      const point = (options.body.points as Array<Record<string, unknown>>)[0];
      return { error: null, data: {
        generatedAt: new Date().toISOString(), issuedAt: new Date().toISOString(), validUntil: "2099-01-01T02:00:00.000Z", source: "live", stale: false,
        forecasts: [{ ...point, status: "forecast", model: "ultra", issuedAt: new Date().toISOString(), condition: "clear", temperatureC: 20, precipitationProbability: 0, windSpeedMps: 1 }],
      } };
    }
    if (name === "recommend-restaurants") return { error: null, data: recommendationBody(options.body as RecommendationRequest) };
    throw new Error(`unexpected ${name}`);
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

describe("PlannerDashboard restaurant recommendation", () => {
  it("is disabled before a live route exists", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PlannerDashboard connected initialCourse={course} navigationMode="memory" />, { createNodeMock }); });
    // The summary without a calculated route has no entry at all.
    expect(buttons(renderer.root, "음식점 추천 받기")).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

  it("parity 4: opening the recommendation re-reads the folder settings", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PlannerDashboard connected initialCourse={course} navigationMode="memory" />, { createNodeMock }); });
    await flush();
    await chooseSchedule(renderer);
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
    await flush();
    const before = mocks.reads.filter((table) => table === "place_folder_preferences").length;
    await act(async () => buttons(renderer.root, "음식점 추천 받기")[0].props.onClick());
    await flush();
    expect(mocks.reads.filter((table) => table === "place_folder_preferences").length).toBe(before + 1);
  });

  it("delta 5: opening a place picker re-reads my star list", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PlannerDashboard connected initialCourse={course} navigationMode="memory" />, { createNodeMock }); });
    await flush();
    const before = mocks.reads.filter((table) => table === "my_star_entries").length;
    const origin = mocks.pickers.get("출발");
    expect(origin?.onOpen).toBeTypeOf("function");
    await act(async () => origin!.onOpen!());
    await flush();
    expect(mocks.reads.filter((table) => table === "my_star_entries").length).toBe(before + 1);
    void renderer;
  });

  it("requests with the displayed basis, then adds the chosen restaurant as a meal without any further call", async () => {
    const renderer = await openRecommendation();
    expect(calls("recommend-restaurants")).toHaveLength(0);
    await act(async () => buttons(dialog(renderer), "추천 받기")[0].props.onClick());
    const [[, { body }]] = calls("recommend-restaurants");
    const planned = calls("plan-route")[0][1].body;
    expect(body).toEqual({
      tripId,
      basis: {
        departureAt: new Date(planned.departureAt).toISOString(),
        returnAt: new Date(new Date(planned.departureAt).getTime() + 30 * 60_000).toISOString(),
        pointIds: ["origin", "destination"],
        arrivalAts: [new Date(new Date(planned.departureAt).getTime() + 30 * 60_000).toISOString()],
      },
      mealCount: 1,
      // 08:00–08:30 route: 12:00 is outside, so meal 1 defaults to a third of the way (08:10).
      meals: [{ desiredTime: "08:10", dwellMinutes: 45 }],
      toleranceMinutes: 30,
      contractVersion: 2,
    });
    const row = dialog(renderer).find((node) => node.type === "button" && node.props["aria-pressed"] === false);
    expect(row.props["aria-label"]).toContain("단골 국밥, 테스트 주소");
    expect(row.props["aria-label"]).toContain("영업정보 없음");
    expect(text(row)).toContain("08:10 도착 · 주행 +9분");
    expect(row.props["aria-label"]).toContain("8시 10분 도착, 추가 주행 9분, 영업정보 없음");
    await act(async () => row.props.onClick());
    const shown = text(dialog(renderer));
    expect(shown).toContain("주행 +9분 · 예상 복귀");
    expect(shown).toContain("경로에서 1시간 넘게 돌아가는 식당은 제외해요.");
    expect(shown).not.toMatch(/한도|더 달려요/);
    const totalCalls = mocks.invoke.mock.calls.length;
    const rpcCalls = mocks.rpc.mock.calls.length;
    await act(async () => buttons(dialog(renderer), "선택한 식당 1곳 일정에 추가")[0].props.onClick());
    await flush();

    expect(renderer.root.findAllByType(RestaurantRecommendationDialog)).toHaveLength(0);
    expect(renderer.root.findByType("main").props["data-view"]).toBe("editor");
    const waypoints = renderer.root.findByType(OrderedWaypointEditor).props.waypoints;
    expect(waypoints).toHaveLength(1);
    expect(waypoints[0]).toMatchObject({ role: "meal", dwellMinutes: 45, place: { kakaoPlaceId: "kakao-restaurant", name: "공개 시험 국밥" } });
    expect(waypoints[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(text(renderer.root.findByProps({ className: "action-notice warning" }))).toContain("식당 1곳을 식사로 추가했어요. 경로 업데이트 필요: 경로 다시 계산을 눌러 주세요.");
    expect(text(renderer.root.findByProps({ className: "primary-button calculate" }))).toBe("경로 다시 계산");
    expect(mocks.invoke.mock.calls.length).toBe(totalCalls);
    expect(mocks.rpc.mock.calls.length).toBe(rpcCalls);
    expect(calls("plan-route")).toHaveLength(1);
    expect(calls("weather-timeline")).toHaveLength(1);
    await act(async () => renderer.unmount());
  });

  it("drops a late reply after the route input changed and shows the route-changed state", async () => {
    const renderer = await openRecommendation();
    let resolve!: (value: unknown) => void;
    mocks.invoke.mockImplementationOnce((_name: string, options: { body: RecommendationRequest }) => new Promise((done) => { resolve = () => done({ error: null, data: recommendationBody(options.body) }); }));
    await act(async () => { buttons(dialog(renderer), "추천 받기")[0].props.onClick(); await Promise.resolve(); });
    expect(text(dialog(renderer))).toContain("추천을 계산하고 있어요");
    await act(async () => renderer.root.findByType(OrderedWaypointEditor).props.onChange([{ id: "occ", role: "waypoint", dwellMinutes: 0, place: { ...place("extra", 127.15), category: "", phone: null, placeUrl: null } }]));
    await act(async () => { resolve(undefined); await Promise.resolve(); });
    await flush();
    const shown = text(dialog(renderer));
    expect(shown).toContain("경로가 바뀌어 이전 추천을 사용할 수 없습니다");
    expect(shown).not.toContain("단골 국밥");
    await act(async () => buttons(dialog(renderer), "경로 편집으로")[0].props.onClick());
    expect(renderer.root.findByType("main").props["data-view"]).toBe("editor");
    expect(renderer.root.findByType(OrderedWaypointEditor).props.waypoints.map((item: { id: string }) => item.id)).toEqual(["occ"]);
    await act(async () => renderer.unmount());
  });

  it("discards an open result as soon as the route input changes", async () => {
    const renderer = await openRecommendation();
    await act(async () => buttons(dialog(renderer), "추천 받기")[0].props.onClick());
    const row = dialog(renderer).find((node) => node.type === "button" && node.props["aria-pressed"] === false);
    await act(async () => row.props.onClick());
    const confirm = buttons(dialog(renderer), "선택한 식당 1곳 일정에 추가")[0].props.onClick;
    await act(async () => renderer.root.findByType(OrderedWaypointEditor).props.onChange([{ id: "occ", role: "waypoint", dwellMinutes: 0, place: { ...place("extra", 127.15), category: "", phone: null, placeUrl: null } }]));
    expect(text(dialog(renderer))).toContain("경로가 바뀌어 이전 추천을 사용할 수 없습니다");
    // A confirmation captured before the change is refused too.
    await act(async () => confirm());
    await flush();
    await act(async () => buttons(dialog(renderer), "경로 편집으로")[0].props.onClick());
    expect(renderer.root.findByType(OrderedWaypointEditor).props.waypoints.map((item: { id: string }) => item.id)).toEqual(["occ"]);
    expect(calls("recommend-restaurants")).toHaveLength(1);
    await act(async () => renderer.unmount());
  });

  it("discards an open result when the account changes, so it cannot be confirmed", async () => {
    const renderer = await openRecommendation();
    await act(async () => { for (const listener of mocks.authListeners) listener("INITIAL_SESSION", { user: { id: "first" } }); });
    await act(async () => buttons(dialog(renderer), "추천 받기")[0].props.onClick());
    const row = dialog(renderer).find((node) => node.type === "button" && node.props["aria-pressed"] === false);
    await act(async () => row.props.onClick());
    await act(async () => { for (const listener of mocks.authListeners) listener("SIGNED_IN", { user: { id: "second" } }); });
    expect(text(dialog(renderer))).toContain("경로가 바뀌어 이전 추천을 사용할 수 없습니다");
    expect(buttons(dialog(renderer), "선택한 식당 1곳 일정에 추가")).toHaveLength(0);
    await act(async () => buttons(dialog(renderer), "경로 편집으로")[0].props.onClick());
    expect(renderer.root.findByType(OrderedWaypointEditor).props.waypoints).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

  it("re-checks saved places at confirmation and adds nothing when the restaurant changed", async () => {
    const renderer = await openRecommendation();
    mocks.invoke.mockImplementationOnce(async (_name: string, options: { body: RecommendationRequest }) => ({ error: null, data: recommendationBody(options.body, 1) }));
    await act(async () => buttons(dialog(renderer), "추천 받기")[0].props.onClick());
    const row = dialog(renderer).find((node) => node.type === "button" && node.props["aria-pressed"] === false);
    await act(async () => row.props.onClick());
    const before = mocks.invoke.mock.calls.length;
    await act(async () => buttons(dialog(renderer), "선택한 식당 1곳 일정에 추가")[0].props.onClick());
    await flush();
    // §7.4: the source row re-read on the server has revision 2, not 1. No provider call.
    expect(text(dialog(renderer))).toContain("추천 결과가 바뀌었어요");
    expect(text(dialog(renderer))).toContain("일정에 추가하지 않았어요.");
    expect(mocks.invoke.mock.calls.length).toBe(before);
    expect(renderer.root.findByType(OrderedWaypointEditor).props.waypoints).toHaveLength(0);
    expect(renderer.root.findByType("main").props["data-view"]).toBe("summary");
    await act(async () => renderer.unmount());
  });

  it.each([
    [409, "RECOMMENDATION_ROUTE_STALE", "경로가 바뀌어 이전 추천을 사용할 수 없습니다", "경로 편집으로"],
    [429, "RECOMMENDATION_BUDGET_OR_CONFIG", "오늘의 무료 경로 계산 한도를 모두 사용했습니다.", "닫기"],
    [503, "RECOMMENDATION_BUDGET_OR_CONFIG", "관리자에게 문의해 주세요.", "다시 시도"],
    [503, "RECOMMENDATION_PROVIDER_TEMPORARY", "일시적으로 응답하지 않습니다", "다시 시도"],
  ])("HTTP %i %s shows its own state with the right primary action", async (status, code, message, primary) => {
    const renderer = await openRecommendation();
    mocks.invoke.mockImplementationOnce(async () => ({ data: null, error: { context: new Response(JSON.stringify({ code, error: "private provider detail" }), { status }) } }));
    await act(async () => buttons(dialog(renderer), "추천 받기")[0].props.onClick());
    await flush();
    const shown = text(dialog(renderer));
    expect(shown).toContain(message);
    expect(shown).not.toContain("private provider detail");
    expect(shown).not.toContain("조건에 맞는 음식점이 없습니다");
    const primaryButton = dialog(renderer).find((node) => node.type === "button" && node.props.className === "primary-button");
    expect(text(primaryButton)).toBe(primary);
    if (status !== 409) {
      expect(dialog(renderer).findAll((node) => typeof node.type === "string" && node.props.role === "alert")).toHaveLength(1);
      // Retry sends the same request again.
      await act(async () => buttons(dialog(renderer), "다시 시도")[0].props.onClick());
      expect(calls("recommend-restaurants")).toHaveLength(2);
      expect(calls("recommend-restaurants")[1][1].body).toEqual(calls("recommend-restaurants")[0][1].body);
    }
    await act(async () => renderer.unmount());
  });

  it("shows the server guidance as an error for MEAL_DWELL_FIXED", async () => {
    const renderer = await openRecommendation();
    mocks.invoke.mockImplementationOnce(async () => ({ data: null, error: { context: new Response(JSON.stringify({ error: "식사 시간은 45분으로 바뀌었어요. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.", code: "MEAL_DWELL_FIXED" }), { status: 400 }) } }));
    await act(async () => buttons(dialog(renderer), "추천 받기")[0].props.onClick());
    await flush();
    const shown = text(dialog(renderer));
    expect(shown).toContain("추천을 계산하지 못했습니다");
    expect(shown).toContain("식사 시간은 45분으로 바뀌었어요. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.");
    expect(dialog(renderer).findAll((node) => typeof node.type === "string" && node.props.role === "alert")).toHaveLength(1);
    await act(async () => renderer.unmount());
  });

  it("lists meal-1 rows by the displayed combined drive once a meal-2 restaurant is chosen", async () => {
    const renderer = await openRecommendation();
    mocks.invoke.mockImplementationOnce(async (_name: string, options: { body: RecommendationRequest }) => ({ error: null, data: twoMealBody(options.body) }));
    await act(async () => buttons(dialog(renderer), "2곳")[0].props.onClick());
    await act(async () => buttons(dialog(renderer), "추천 받기")[0].props.onClick());
    const mealOneRows = () => dialog(renderer).findByProps({ id: "meal-heading-1" }).parent!.parent!
      .findAll((node) => node.type === "button" && typeof node.props["aria-pressed"] === "boolean")
      .map((row) => text(row));
    expect(mealOneRows().map((row) => row.match(/식당 [ab]/)?.[0])).toEqual(["식당 a", "식당 b"]);
    const mealTwo = dialog(renderer).find((node) => node.type === "button" && typeof node.props["aria-label"] === "string" && node.props["aria-label"].startsWith("식당 c,"));
    await act(async () => mealTwo.props.onClick());
    const rows = mealOneRows();
    expect(rows.map((row) => row.match(/식당 [ab]/)?.[0])).toEqual(["식당 b", "식당 a"]);
    expect(rows[0]).toContain("두 곳 합계 주행 +30분");
    expect(rows[1]).toContain("두 곳 합계 주행 +50분");
    await act(async () => renderer.unmount());
  });

  it("lets pair-only restaurants be chosen, asks for the partner, and confirms only as a pair", async () => {
    const renderer = await openRecommendation();
    mocks.invoke.mockImplementationOnce(async (_name: string, options: { body: RecommendationRequest }) => ({ error: null, data: pairOnlyBody(options.body) }));
    await act(async () => buttons(dialog(renderer), "2곳")[0].props.onClick());
    await act(async () => buttons(dialog(renderer), "추천 받기")[0].props.onClick());
    const row = (name: string) => dialog(renderer).find((node) => node.type === "button" && typeof node.props["aria-label"] === "string" && node.props["aria-label"].startsWith(`${name},`));
    const confirm = () => dialog(renderer).find((node) => node.type === "button" && node.props.className === "primary-button");
    expect(text(dialog(renderer))).toContain("늘어나는 주행이 짧은 순서예요. 함께 갈 때만 가능한 곳은 뒤에 두었어요.");
    const a = row("식당 a");
    expect(text(a)).toContain("식사 2와 함께 갈 때만 가능해요");
    expect(text(a)).not.toContain("선택 불가");
    expect(a.props["aria-disabled"]).toBeUndefined();
    expect(a.props["data-pair-only"]).toBe(true);
    expect(a.props["aria-label"]).toContain("식사 2와 함께 갈 때만 가능해요");
    await act(async () => a.props.onClick());
    expect(confirm().props.disabled).toBe(true);
    expect(text(dialog(renderer))).toContain("식사 2도 함께 골라 주세요");
    // With A chosen, C shows the pair total and can be added.
    expect(text(row("식당 c"))).toContain("두 곳 합계 주행 +50분");
    await act(async () => row("식당 c").props.onClick());
    expect(confirm().props.disabled).toBe(false);
    expect(text(confirm())).toBe("선택한 식당 2곳 일정에 추가");
    // Clearing the partner disables confirmation again.
    await act(async () => row("식당 c").props.onClick());
    expect(confirm().props.disabled).toBe(true);
    expect(text(dialog(renderer))).toContain("식사 2도 함께 골라 주세요");
    await act(async () => renderer.unmount());
  });

  it("treats an empty result and no saved restaurants as answers, not failures", async () => {
    const renderer = await openRecommendation();
    mocks.invoke.mockImplementationOnce(async (_name: string, options: { body: RecommendationRequest }) => {
      const body = recommendationBody(options.body);
      body.meals[0].candidates = [];
      return { error: null, data: body };
    });
    await act(async () => buttons(dialog(renderer), "추천 받기")[0].props.onClick());
    expect(text(dialog(renderer))).toContain("조건에 맞는 음식점이 없습니다");
    expect(mocks.focused.at(-1)).toBe("h3:조건에 맞는 음식점이 없습니다");
    expect(text(dialog(renderer))).toContain("저장한 식당 1곳 중 경로 근처 1곳을 실제 도로 경로로 확인했어요.");
    expect(text(dialog(renderer))).toContain("원하는 식사 시간 앞뒤 30분 안에 도착하고 주행이 1시간 이내로 늘어나는 식당이 없어요.");
    expect(text(dialog(renderer))).toContain("식사 1 08:10 · 앞뒤 30분 · 45분");
    expect(dialog(renderer).findAll((node) => typeof node.type === "string" && node.props.role === "alert")).toHaveLength(0);
    await act(async () => buttons(dialog(renderer), "조건 바꾸기")[0].props.onClick());
    expect(buttons(dialog(renderer), "추천 받기")).toHaveLength(1);
    mocks.invoke.mockImplementationOnce(async (_name: string, options: { body: RecommendationRequest }) => {
      const body = recommendationBody(options.body);
      return { error: null, data: { ...body, status: "NO_SAVED_RESTAURANTS", meals: [{ ...body.meals[0], candidates: [] }], coverage: { ...body.coverage, savedRestaurants: 0, nearRoute: 0, evaluated: 0, providerRequests: 0 } } };
    });
    await act(async () => buttons(dialog(renderer), "추천 받기")[0].props.onClick());
    expect(text(dialog(renderer))).toContain("저장한 식당이 없습니다");
    expect(mocks.focused.at(-1)).toBe("h3:저장한 식당이 없습니다");
    await act(async () => buttons(dialog(renderer), "즐겨찾기에서 식당 등록")[0].props.onClick());
    expect(renderer.root.findByType("main").props["data-view"]).toBe("favorites");
    await act(async () => renderer.unmount());
  });

  it("blocks a malformed response instead of showing it as a result", async () => {
    const renderer = await openRecommendation();
    mocks.invoke.mockImplementationOnce(async (_name: string, options: { body: RecommendationRequest }) => {
      const body = recommendationBody(options.body);
      body.basis.pointIds = ["origin", "elsewhere"];
      return { error: null, data: body };
    });
    await act(async () => buttons(dialog(renderer), "추천 받기")[0].props.onClick());
    await flush();
    expect(text(dialog(renderer))).toContain("추천을 계산하지 못했습니다");
    expect(text(dialog(renderer))).not.toContain("단골 국밥");
    await act(async () => renderer.unmount());
  });

  it("shows an error, not results, when the success response answers another meal time or route", async () => {
    const renderer = await openRecommendation();
    mocks.invoke.mockImplementationOnce(async (_name: string, options: { body: RecommendationRequest }) => ({
      error: null,
      data: recommendationBody({ ...options.body, meals: [{ ...options.body.meals[0], desiredTime: "13:00" }] }),
    }));
    await act(async () => buttons(dialog(renderer), "추천 받기")[0].props.onClick());
    await flush();
    expect(text(dialog(renderer))).toContain("추천을 계산하지 못했습니다");
    expect(text(dialog(renderer))).not.toContain("단골 국밥");
    await act(async () => buttons(dialog(renderer), "닫기")[0].props.onClick());
    await act(async () => buttons(renderer.root, "음식점 추천 받기")[0].props.onClick());
    mocks.invoke.mockImplementationOnce(async (_name: string, options: { body: RecommendationRequest }) => ({
      error: null,
      data: recommendationBody({ ...options.body, basis: { ...options.body.basis, arrivalAts: [new Date(Date.parse(options.body.basis.arrivalAts[0]) - 60_000).toISOString()] } }),
    }));
    await act(async () => buttons(dialog(renderer), "추천 받기")[0].props.onClick());
    await flush();
    expect(text(dialog(renderer))).toContain("추천을 계산하지 못했습니다");
    expect(calls("recommend-restaurants")[1][1].body.basis.arrivalAts).toHaveLength(1);
    await act(async () => renderer.unmount());
  });

  it("does not touch state after the planner unmounts during a request", async () => {
    const renderer = await openRecommendation();
    let resolve!: () => void;
    mocks.invoke.mockImplementationOnce((_name: string, options: { body: RecommendationRequest }) => new Promise((done) => { resolve = () => done({ error: null, data: recommendationBody(options.body) }); }));
    await act(async () => { buttons(dialog(renderer), "추천 받기")[0].props.onClick(); await Promise.resolve(); });
    await act(async () => renderer.unmount());
    resolve();
    await flush();
    expect(calls("recommend-restaurants")).toHaveLength(1);
  });

  it("Esc goes back from results and errors, closes from input and loading, and moves focus to each new title", async () => {
    const opener = Object.assign(new (globalThis.HTMLElement as unknown as { new(): object })(), { focus: vi.fn() });
    const renderer = await openRecommendationFrom(opener);
    const esc = async () => act(async () => dialog(renderer).findByType("dialog").props.onCancel({ preventDefault: vi.fn() }));
    expect(mocks.focused.at(-1)).toBe("h2:음식점 추천");

    // Result → Esc → input with the kept values (still open).
    const less = () => dialog(renderer).findByProps({ "aria-label": "허용 범위 30분 줄이기" });
    const more = () => dialog(renderer).findByProps({ "aria-label": "허용 범위 30분 늘리기" });
    // ±30 is the lower end: "−" is disabled until the range grows.
    expect(less().props.disabled).toBe(true);
    expect(text(dialog(renderer))).toContain("식사는 45분으로 계산해요.");
    expect(dialog(renderer).findAllByProps({ type: "number" })).toHaveLength(0);
    await act(async () => more().props.onClick());
    expect(less().props.disabled).toBe(false);
    await act(async () => buttons(dialog(renderer), "추천 받기")[0].props.onClick());
    expect(text(dialog(renderer))).toContain("추천 조건");
    expect(calls("recommend-restaurants")[0][1].body.toleranceMinutes).toBe(60);
    await esc();
    expect(buttons(dialog(renderer), "추천 받기")).toHaveLength(1);
    expect(text(dialog(renderer))).toContain("±60분");
    // ±90 is the upper end: "+" is disabled there.
    await act(async () => more().props.onClick());
    expect(more().props.disabled).toBe(true);
    expect(text(dialog(renderer))).toContain("±90분");
    expect(mocks.focused.at(-1)).toBe("h2:음식점 추천");

    // Error → its state title takes focus; Esc → input.
    mocks.invoke.mockImplementationOnce(async () => ({ data: null, error: { context: new Response(JSON.stringify({ code: "RECOMMENDATION_PROVIDER_TEMPORARY" }), { status: 503 }) } }));
    await act(async () => buttons(dialog(renderer), "추천 받기")[0].props.onClick());
    await flush();
    expect(text(dialog(renderer))).toContain("추천을 계산하지 못했습니다");
    expect(mocks.focused.at(-1)).toBe("h3:추천을 계산하지 못했습니다");
    await esc();
    expect(buttons(dialog(renderer), "추천 받기")).toHaveLength(1);

    // Loading → Esc → closed; the late reply is dropped and focus returns to the entry.
    let resolve!: () => void;
    mocks.invoke.mockImplementationOnce((_name: string, options: { body: RecommendationRequest }) => new Promise((done) => { resolve = () => done({ error: null, data: recommendationBody(options.body) }); }));
    await act(async () => { buttons(dialog(renderer), "추천 받기")[0].props.onClick(); await Promise.resolve(); });
    expect(text(dialog(renderer))).toContain("추천을 계산하고 있어요");
    await esc();
    expect(renderer.root.findAllByType(RestaurantRecommendationDialog)).toHaveLength(0);
    expect(opener.focus).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(); await Promise.resolve(); });
    await flush();
    expect(renderer.root.findAllByType(RestaurantRecommendationDialog)).toHaveLength(0);
    expect(renderer.root.findByType("main").props["data-view"]).toBe("summary");

    // Input → Esc → closed.
    await act(async () => buttons(renderer.root, "음식점 추천 받기")[0].props.onClick());
    await esc();
    expect(renderer.root.findAllByType(RestaurantRecommendationDialog)).toHaveLength(0);
    expect(calls("plan-route")).toHaveLength(1);
    expect(calls("weather-timeline")).toHaveLength(1);
    await act(async () => renderer.unmount());
  });

  it("starts from route-based defaults and explains a desired time that falls on the next day", async () => {
    const renderer = await openRecommendation();
    const value = (label: string) => dialog(renderer).findByProps({ "aria-label": label }).props.value;
    expect([value("식사 1 원하는 식사 시간 시"), value("식사 1 원하는 식사 시간 분")]).toEqual(["08", "10"]);
    expect(text(dialog(renderer))).not.toContain("다음 날");
    // 07:10 is before departure − 30 min (07:30), so it means tomorrow.
    await act(async () => dialog(renderer).findByProps({ "aria-label": "식사 1 원하는 식사 시간 시" }).props.onChange({ target: { value: "07" } }));
    const hint = dialog(renderer).find((node) => node.type === "p" && text(node) === "다음 날 07:10으로 계산돼요.");
    const group = dialog(renderer).find((node) => node.props.role === "group" && typeof node.props["aria-labelledby"] === "string" && node.props["aria-labelledby"].endsWith("-time-0"));
    expect(group.props["aria-describedby"]).toBe(hint.props.id);
    await act(async () => buttons(dialog(renderer), "추천 받기")[0].props.onClick());
    expect(calls("recommend-restaurants")[0][1].body.meals[0].desiredTime).toBe("07:10");
    expect(text(dialog(renderer))).toContain("식사 1 다음 날 07:10 · 앞뒤 30분 · 45분");
    await act(async () => renderer.unmount());
  });

  it("blocks the request before sending when meal 2 is not later than meal 1", async () => {
    const renderer = await openRecommendation();
    await act(async () => buttons(dialog(renderer), "2곳")[0].props.onClick());
    // Defaults are 08:10 / 08:20; 08:00 for meal 2 is before meal 1.
    expect(dialog(renderer).findByProps({ "aria-label": "식사 2 원하는 식사 시간 분" }).props.value).toBe("20");
    const minute = dialog(renderer).findByProps({ "aria-label": "식사 2 원하는 식사 시간 분" });
    await act(async () => minute.props.onChange({ target: { value: "00" } }));
    expect(text(dialog(renderer))).toContain("식사 2의 원하는 식사 시간은 식사 1보다 늦어야 해요.");
    expect(buttons(dialog(renderer), "추천 받기")[0].props.disabled).toBe(true);
    // Switching back to one meal keeps meal 2's value and clears the block.
    await act(async () => buttons(dialog(renderer), "1곳")[0].props.onClick());
    expect(buttons(dialog(renderer), "추천 받기")[0].props.disabled).toBe(false);
    await act(async () => buttons(dialog(renderer), "2곳")[0].props.onClick());
    expect(dialog(renderer).findByProps({ "aria-label": "식사 2 원하는 식사 시간 분" }).props.value).toBe("00");
    expect(calls("recommend-restaurants")).toHaveLength(0);
    await act(async () => renderer.unmount());
  });
});
