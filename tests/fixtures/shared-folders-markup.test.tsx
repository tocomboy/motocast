import { writeFileSync } from "node:fs";
import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseSavedPlaceEntry } from "@/lib/places/saved";
import {
  parseAvoidedPlace,
  parseFolderMember,
  parseFolderPreference,
  parsePlaceFolder,
  parseSharedPlace,
  parseStarEntries,
} from "@/lib/places/shared-folders";
import { ConfirmPopup, type Pending } from "@/components/confirm-popup";
import { SavedPlacesManager } from "@/components/saved-places-manager";
import { SharedFolderDetail } from "@/components/shared-folder-detail";
import { FolderSettings } from "@/components/shared-folder-settings";
import { deleteSharedPopup, folderPickerPopup, sharedStarPopup } from "@/components/shared-place-actions";
import type { SharedSnapshot } from "@/components/shared-folders-provider";
import { F1, F2, ME, sampleSaved, sampleTables } from "./shared-folders";
import { AllExcludedStatus, Exclusions, ResultView, StatusView } from "@/components/restaurant-recommendation-dialog";
import recommendationStyles from "@/components/restaurant-recommendation-dialog.module.css";
import { LineIcon } from "@/components/line-icon";
import { coverageTextV2, recommendationView } from "@/lib/planner/recommendation-sources";
import type { RecommendationResponseV2 } from "@/lib/planner/restaurant-recommendation";

// SRC02 sample: one meal, my restaurant and a folder restaurant held by another enabled folder.
function recommendation(empty = false, coverage: Partial<RecommendationResponseV2["coverage"]> = {}, status: RecommendationResponseV2["status"] = "OK"): RecommendationResponseV2 {
  const candidate = (source: RecommendationResponseV2["meals"][number]["candidates"][number]["source"], otherFolderIds: string[], name: string, address: string, minutes: number) => ({
    source, otherFolderIds, displayName: name, placeName: name, address, longitude: 127.7, latitude: 37.9,
    insertion: { legIndex: 0, afterPointId: "a", beforePointId: "b" },
    single: { feasible: true, arrivalAt: "2026-10-10T03:10:00.000Z", extraDriveSeconds: minutes * 60, returnAt: "2026-10-10T09:37:00.000Z", reason: null },
  });
  return {
    contractVersion: 2,
    status,
    basis: { tripId: "t", departureAt: "2026-10-10T00:00:00.000Z", returnAt: "2026-10-10T08:40:00.000Z", pointIds: ["a", "b"], arrivalAts: ["2026-10-10T08:40:00.000Z"] },
    settings: { mealCount: 1, toleranceMinutes: 30, detourLimitMinutes: 60 },
    meals: [{ index: 1, targetAt: "2026-10-10T03:00:00.000Z", windowStartAt: "2026-10-10T02:30:00.000Z", windowEndAt: "2026-10-10T03:30:00.000Z", dwellMinutes: 45, candidates: empty ? [] : [
      candidate({ type: "saved", id: "10000000-0000-4000-8000-000000000001", revision: 1 }, [], "소양강 막국수", "강원 춘천시 신북읍 신샘밭로", 6),
      candidate({ type: "shared", id: "20000000-0000-4000-8000-000000000002", revision: 1, folderId: F1 }, [F2], "신북 숯불닭갈비", "강원 춘천시 신북읍 천전리", 12),
      candidate({ type: "saved", id: "10000000-0000-4000-8000-000000000003", revision: 1 }, [], "소양강 다리 건너 왼쪽 숯불닭갈비집 (지난가을 투어 때 들른 곳)", "강원 춘천시 동면 소양강로 순환도로 옆 공영주차장 맞은편 2층", 18),
    ] }],
    pairs: [],
    coverage: { savedRestaurants: 12, invalidSaved: 0, alreadyInRoute: 0, nearRoute: 5, evaluated: 5, unreachable: 0, notEvaluated: 0, providerRequests: empty ? 0 : 5, sharedRestaurants: 9, duplicateMerged: 1, avoidedExcluded: 2, disabledFolders: 1, sharedReadTruncated: false, ...coverage },
  };
}
const recommendationDialog = (size: string, body: ReactNode) => renderToStaticMarkup(
  <dialog className={recommendationStyles.dialog} data-size={size}>
    <header className={recommendationStyles.header}><div><h2>음식점 추천</h2></div><button type="button" aria-label="음식점 추천 닫기"><LineIcon name="close" /></button></header>
    {body}
  </dialog>,
);

/*
 * Production markup of the #124 favorites screens with synthetic folder data, for the
 * responsive layout checks in tests/e2e/shared-folders-responsive.spec.ts (the local E2E
 * server runs without Supabase, so data screens are checked from this markup).
 */
const tables = sampleTables();
const snapshot: SharedSnapshot = {
  userId: ME,
  folders: tables.place_folders.map(parsePlaceFolder),
  members: tables.place_folder_members.map(parseFolderMember),
  preferences: tables.place_folder_preferences.map(parseFolderPreference),
  places: tables.shared_place_entries.map(parseSharedPlace),
  stars: parseStarEntries(tables.my_star_entries),
  avoided: tables.avoided_places.map(parseAvoidedPlace),
};
const places = sampleSaved().map(parseSavedPlaceEntry);
const shared = {
  accountEpoch: 0, enabled: true, status: "ready", busy: false, verifying: false, message: "", snapshot,
  current: () => ({ status: "ready" as const, snapshot }), retry: () => undefined, refresh: async () => null, reloadStars: async () => undefined,
  captureSnapshot: () => () => true, recheck: async () => "unreadable" as const, write: async () => ({ ok: true as const }), call: async () => ({ data: null, code: null, lost: false }),
};
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => <a {...props}>{children}</a> }));
vi.mock("@/lib/supabase/browser", () => ({ getBrowserSupabase: () => null }));
vi.mock("@/components/saved-places-provider", async () => {
  const actual = await vi.importActual<typeof import("@/components/saved-places-provider")>("@/components/saved-places-provider");
  return {
    ...actual,
    useSavedPlaces: () => ({
      accountEpoch: 1, places, favorites: [], status: "ready", busy: false, verifying: false, message: "", failureTitle: "",
      current: () => ({ status: "ready", places }), captureSnapshot: () => () => true, recheck: async () => "unreadable", retry: () => undefined,
    }),
  };
});
vi.mock("@/components/shared-folders-provider", async () => {
  const actual = await vi.importActual<typeof import("@/components/shared-folders-provider")>("@/components/shared-folders-provider");
  return { ...actual, useSharedFolders: () => shared };
});

const page = (node: ReactNode) => renderToStaticMarkup(<>{node}</>);
const popup = (pending: Pending<SharedSnapshot>) =>
  page(<ConfirmPopup<SharedSnapshot> pending={pending} busy={false} verifying={false} recheck={async () => "unreadable"} capture={() => () => true} onClose={() => undefined} />);

function recommendationResult(settingsChanged: boolean, options: { response?: RecommendationResponseV2; refused?: "changed" | "unreadable"; selection?: Record<number, string> } = {}) {
  const view = recommendationView(options.response ?? recommendation());
  return recommendationDialog("result-1", <ResultView view={view} selection={options.selection ?? { 1: "shared:20000000-0000-4000-8000-000000000002" }} input={{ mealCount: 1, meals: [{ desiredTime: "12:00" }, { desiredTime: "18:00" }], toleranceMinutes: 30 }} settingsChanged={settingsChanged} refused={options.refused} applying={false} disabledFolderNames={["동호회 정모 코스"]} folderName={(id) => (id === F1 ? "주말 라이더" : "남한강 맛집")} onFolderSettings={() => undefined} onRecommendAgain={() => undefined} onSelect={() => undefined} onChangeConditions={() => undefined} onConfirm={() => undefined} />);
}

describe("shared folder screens production markup", () => {
  it("renders every checked screen", () => {
    const manager = (section: "places" | "folders" | "avoided") =>
      page(<SavedPlacesManager onBack={() => undefined} onAddWaypoint={() => null} routePoints={[]} initialSection={section} />);
    const markup = {
      places: manager("places"),
      folders: manager("folders"),
      avoided: manager("avoided"),
      folderDetail: page(<SharedFolderDetail folderId={F1} wide={false} disabled={false} onBack={() => undefined} onAddWaypoint={() => undefined} />),
      members: page(<FolderSettings folderId={F1} page="members" onClose={() => undefined} onLeft={() => undefined} />),
      folderPopup: popup({ key: 1, ...folderPickerPopup(shared as never, snapshot.preferences.filter((row) => row.enabled).map((row) => row.folderId)) }),
      starPopup: popup({ key: 2, ...sharedStarPopup(shared as never, snapshot.places[3]) }),
      deletePopup: popup({ key: 3, ...deleteSharedPopup(shared as never, snapshot.places[3], () => undefined) }),
      // G08 count rows (label hugs, number follows) next to G13b labeled rows (100px label column).
      rowsPopup: popup({
        key: 4,
        title: "이 공유 폴더를 만들까요?",
        rows: [
          { label: "라이딩 스팟 · 식당", value: "", count: "1 · 0" },
          { label: "폴더 장소", value: "", count: "1 / 1,000" },
          { label: "내 공유 폴더", value: "", count: "3 → 4 / 20" },
          { label: "분류", value: "식당" },
          { label: "자주 찾는 장소", value: "추가", count: "3 → 4 / 10" },
        ],
        buttons: [{ label: "닫기", onClick: () => undefined }],
      }),
      recommendResult: recommendationResult(false),
      recommendChanged: recommendationResult(true),
      // SRC04–SRC07 (#124 copy frames 462:*)
      recommendAllExcluded: recommendationDialog("status", <AllExcludedStatus stateTitleRef={{ current: null }} view={recommendationView(recommendation(true, { avoidedExcluded: 6 }, "ALL_EXCLUDED"))} names={["동호회 정모 코스"]} onFolderSettings={() => undefined} conditions={["식사 1 12:00 · 식사 2 18:00 · 앞뒤 30분 · 각 45분", "경로에서 1시간 넘게 돌아가는 식당은 제외해요."]} onClose={() => undefined} onOpenAvoided={() => undefined} />),
      recommendTruncated: recommendationResult(false, { response: recommendation(false, { sharedRestaurants: 2000, sharedReadTruncated: true }) }),
      recommendTruncatedNone: recommendationDialog("status", <StatusView stateTitleRef={{ current: null }} tone="neutral" role="status" icon={<LineIcon name="search" />} title="조건에 맞는 음식점이 없습니다" text="원하는 식사 시간 앞뒤 30분 안에 도착하고 주행이 1시간 이내로 늘어나는 식당이 없어요." note={coverageTextV2(recommendation(true, { sharedRestaurants: 2000, sharedReadTruncated: true }))} extra={<Exclusions view={recommendationView(recommendation(true, { sharedRestaurants: 2000, sharedReadTruncated: true }))} names={["동호회 정모 코스"]} ending="뺐어요. 꺼 둔 폴더를 켜면 후보가 늘 수 있어요." onFolderSettings={() => undefined} />} conditions={["식사 1 12:00 · 식사 2 18:00 · 앞뒤 30분 · 각 45분", "경로에서 1시간 넘게 돌아가는 식당은 제외해요."]} actions={<><button type="button" className={recommendationStyles.textAction}>닫기</button><button type="button" className="primary-button">조건 바꾸기</button></>} />),
      recommendRefused: recommendationResult(false, { refused: "changed", selection: {} }),
      recommendUnreadable: recommendationResult(false, { refused: "unreadable" }),
      recommendNone: recommendationDialog("status", <StatusView stateTitleRef={{ current: null }} tone="neutral" role="status" icon={<LineIcon name="search" />} title="조건에 맞는 음식점이 없습니다" text="원하는 식사 시간 앞뒤 30분 안에 도착하고 주행이 1시간 이내로 늘어나는 식당이 없어요." note={coverageTextV2(recommendation(true))} extra={<Exclusions view={recommendationView(recommendation(true))} names={["동호회 정모 코스"]} ending="뺐어요. 꺼 둔 폴더를 켜면 후보가 늘 수 있어요." onFolderSettings={() => undefined} />} conditions={["식사 1 12:00 · 식사 2 18:00 · 앞뒤 30분 · 각 45분", "경로에서 1시간 넘게 돌아가는 식당은 제외해요."]} actions={<><button type="button" className={recommendationStyles.textAction}>닫기</button><button type="button" className="primary-button">조건 바꾸기</button></>} />),
    };
    expect(markup.places).toContain("공유 · 남한강 맛집 외 1");
    expect(markup.folders).toContain("내 공유 폴더");
    expect(markup.avoided).toContain("기피 장소");
    expect(markup.folderDetail).toContain("폴더 장소");
    expect(markup.members).toContain("회원·권한 관리");
    expect(markup.folderPopup).toContain("지도와 목록에 보일 공유 폴더");
    expect(markup.deletePopup).toContain("폴더에서 이 장소를 삭제할까요?");
    expect(markup.rowsPopup).toContain("라이딩 스팟 · 식당");
    expect(markup.recommendResult).toContain("공유 · 주말 라이더 외 1");
    expect(markup.recommendChanged).toContain("공유 폴더 설정이 바뀌었어요");
    expect(markup.recommendNone).toContain("꺼 둔 폴더를 켜면 후보가 늘 수 있어요.");
    expect(markup.recommendAllExcluded).toContain("추천할 식당이 모두 기피 장소예요");
    expect(markup.recommendTruncated).toContain("2,000곳까지만 후보로 읽었어요.");
    expect(markup.recommendRefused).toContain("고른 식당이 없어요");
    expect(markup.recommendUnreadable).toContain("다시 시도 · 선택한 식당 1곳 일정에 추가");
    const outputPath = process.env.MOTOCAST_SHARED_FOLDERS_MARKUP_OUTPUT?.trim();
    if (outputPath) writeFileSync(outputPath, JSON.stringify(markup), "utf8");
  });
});
