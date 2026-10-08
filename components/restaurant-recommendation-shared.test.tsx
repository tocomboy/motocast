import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recommendationView } from "@/lib/planner/recommendation-sources";
import type { RecommendationResponseV2 } from "@/lib/planner/restaurant-recommendation";
import { parseFolderPreference, parsePlaceFolder } from "@/lib/places/shared-folders";
import { F1, F2, F3, ME, folderRow, preferenceRow } from "@/tests/fixtures/shared-folders";
import { RestaurantRecommendationDialog, type RecommendationConfirmResult, type RecommendationOutcome } from "./restaurant-recommendation-dialog";

const mocks = vi.hoisted(() => ({ shared: {} as Record<string, unknown>, write: vi.fn() }));
vi.mock("./shared-folders-provider", async () => {
  const actual = await vi.importActual<typeof import("./shared-folders-provider")>("./shared-folders-provider");
  return { ...actual, useSharedFolders: () => mocks.shared };
});

const SAVED = "10000000-0000-4000-8000-000000000001";
const SHARED = "20000000-0000-4000-8000-000000000002";
const DEPARTURE = "2026-10-10T00:00:00.000Z";
const RETURN = "2026-10-10T08:40:00.000Z";
function v2(overrides: Partial<RecommendationResponseV2> = {}, coverage: Partial<RecommendationResponseV2["coverage"]> = {}): RecommendationResponseV2 {
  const candidate = (source: RecommendationResponseV2["meals"][number]["candidates"][number]["source"], name: string, otherFolderIds: string[], minutes: number) => ({
    source, otherFolderIds, displayName: name, placeName: name, address: "강원 춘천시 신북읍", longitude: 127.7, latitude: 37.9,
    insertion: { legIndex: 0, afterPointId: "a", beforePointId: "b" },
    single: { feasible: true, arrivalAt: "2026-10-10T03:10:00.000Z", extraDriveSeconds: minutes * 60, returnAt: "2026-10-10T09:37:00.000Z", reason: null },
  });
  return {
    contractVersion: 2,
    status: "OK",
    basis: { tripId: "t", departureAt: DEPARTURE, returnAt: RETURN, pointIds: ["a", "b"], arrivalAts: [RETURN] },
    settings: { mealCount: 1, toleranceMinutes: 30, detourLimitMinutes: 60 },
    meals: [{ index: 1, targetAt: "2026-10-10T03:00:00.000Z", windowStartAt: "2026-10-10T02:30:00.000Z", windowEndAt: "2026-10-10T03:30:00.000Z", dwellMinutes: 45, candidates: [
      candidate({ type: "saved", id: SAVED, revision: 1 }, "소양강 막국수", [], 6),
      candidate({ type: "shared", id: SHARED, revision: 1, folderId: F1 }, "신북 숯불닭갈비", [F2], 12),
    ] }],
    pairs: [],
    coverage: { savedRestaurants: 12, invalidSaved: 0, alreadyInRoute: 0, nearRoute: 5, evaluated: 5, unreachable: 0, notEvaluated: 0, providerRequests: 5, sharedRestaurants: 9, duplicateMerged: 1, avoidedExcluded: 2, disabledFolders: 1, sharedReadTruncated: false, ...coverage },
    ...overrides,
  };
}
function text(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}
const buttons = (r: ReactTestRenderer, label: string) => r.root.findAll((node) => node.type === "button" && text(node) === label);

let request: ReturnType<typeof vi.fn<() => Promise<RecommendationOutcome>>>;
let confirm: ReturnType<typeof vi.fn<() => Promise<RecommendationConfirmResult>>>;
async function mount(response: RecommendationResponseV2, currentInputs: string | null = "inputs-1") {
  request = vi.fn(async (): Promise<RecommendationOutcome> => ({ kind: "ok", view: recommendationView(response), inputs: "inputs-1" }));
  confirm = vi.fn(async (): Promise<RecommendationConfirmResult> => "changed");
  const props = { stale: false, routeLabel: "팔당역 → 양평역", departureAt: DEPARTURE, returnAt: RETURN, waypointCount: 0, request, currentInputs, confirm, onClose: vi.fn(), onEditRoute: vi.fn(), onOpenFavorites: vi.fn() };
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<RestaurantRecommendationDialog {...props} />, { createNodeMock: () => ({ showModal: vi.fn(), close: vi.fn(), focus: vi.fn(), open: false }) }); });
  await act(async () => buttons(r, "추천 받기")[0].props.onClick());
  return { r, rerender: (inputs: string | null) => act(async () => r.update(<RestaurantRecommendationDialog {...props} currentInputs={inputs} />)) };
}

beforeEach(() => {
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
  const snapshot = {
    userId: ME,
    folders: [folderRow(F1, "주말 라이더", ME), folderRow(F2, "남한강 맛집", ME), folderRow(F3, "동호회 정모 코스", ME)].map(parsePlaceFolder),
    members: [], places: [], stars: [], avoided: [],
    preferences: [preferenceRow(F1, true), preferenceRow(F2, true), preferenceRow(F3, false)].map(parseFolderPreference),
  };
  mocks.write.mockReset();
  mocks.shared = {
    accountEpoch: 0, enabled: true, status: "ready", busy: false, verifying: false, message: "", snapshot,
    current: () => ({ status: "ready", snapshot }), captureSnapshot: () => () => true, recheck: vi.fn(), write: mocks.write,
  };
});
afterEach(() => vi.unstubAllGlobals());

describe("restaurant recommendation with shared folders (SRC02, SRC02b, SRC03)", () => {
  it("shows each candidate's source, the left-out counts and the folder settings link", async () => {
    const { r } = await mount(v2());
    const rows = r.root.findAll((node) => node.type === "button" && node.props["aria-pressed"] !== undefined).map(text);
    expect(rows[0]).toContain("내 장소");
    expect(rows[1]).toContain("공유 · 주말 라이더 외 1");
    const body = text(r.root);
    expect(body).toContain("내 식당 12곳과 켜 둔 공유 폴더 식당 9곳 중 경로 근처 5곳을 실제 도로 경로로 확인했어요.");
    expect(body).toContain("기피 장소 2곳과 꺼 둔 공유 폴더 1개(동호회 정모 코스)의 식당은 후보에서 뺐어요.");
    await act(async () => buttons(r, "공유 폴더 설정")[0].props.onClick());
    expect(text(r.root)).toContain("지도와 목록에 보일 공유 폴더");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("marks a result from before a folder or avoided change and never re-requests by itself (SRC02b)", async () => {
    const { r, rerender } = await mount(v2());
    expect(text(r.root)).not.toContain("공유 폴더 설정이 바뀌었어요");
    await rerender("inputs-2");
    expect(text(r.root)).toContain("공유 폴더 설정이 바뀌었어요");
    expect(text(r.root)).toContain("자동으로 다시 계산하지 않아요.");
    expect(request).toHaveBeenCalledTimes(1);
    // The old result can still be chosen; adding it goes through the apply-time re-check.
    expect(buttons(r, "선택한 식당 일정에 추가")).toHaveLength(1);
    await act(async () => buttons(r, "다시 추천 받기")[0].props.onClick());
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("adds nothing and asks for a new recommendation when a chosen source changed (§7.4)", async () => {
    const { r } = await mount(v2());
    const shared = r.root.findAll((node) => node.type === "button" && node.props["aria-pressed"] === false)[1];
    await act(async () => shared.props.onClick());
    await act(async () => buttons(r, "선택한 식당 1곳 일정에 추가")[0].props.onClick());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(text(r.root)).toContain("추천 결과가 바뀌었어요");
    expect(text(r.root)).toContain("일정에 추가하지 않았어요.");
    expect(buttons(r, "다시 추천 받기")).toHaveLength(1);
  });

  it("explains all-excluded and empty answers with the folder hint (SRC03)", async () => {
    let mounted = await mount(v2({ status: "ALL_EXCLUDED", meals: v2().meals.map((meal) => ({ ...meal, candidates: [] })) }, { providerRequests: 0, evaluated: 0, nearRoute: 3 }));
    expect(text(mounted.r.root)).toContain("경로 근처 식당이 모두 기피 장소라서 추천에서 뺐어요.");
    expect(text(mounted.r.root)).toContain("꺼 둔 폴더를 켜면 후보가 늘 수 있어요.");
    expect(buttons(mounted.r, "공유 폴더 설정")).toHaveLength(1);
    await act(async () => mounted.r.unmount());
    mounted = await mount(v2({ meals: v2().meals.map((meal) => ({ ...meal, candidates: [] })) }, { sharedReadTruncated: true }));
    expect(text(mounted.r.root)).toContain("조건에 맞는 음식점이 없습니다");
    expect(text(mounted.r.root)).toContain("공유 폴더 식당이 많아 경로 근처 2,000곳까지만 확인했어요.");
  });
});
