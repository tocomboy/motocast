import { describe, expect, it } from "vitest";
import {
  coverageTextV2,
  exclusionText,
  recheckRecommendationSources,
  recommendationGeneration,
  recommendationView,
  type RecheckClient,
} from "./recommendation-sources";
import type { RecommendationResponseV2, RecommendationSourceRef } from "./restaurant-recommendation";

const SAVED = "10000000-0000-4000-8000-000000000001";
const SHARED = "20000000-0000-4000-8000-000000000002";
const FOLDER = "30000000-0000-4000-8000-000000000003";
const OTHER_FOLDER = "30000000-0000-4000-8000-000000000004";
const place = (kakaoPlaceId: string, latitude = 37.5, longitude = 127.1) => ({
  kakaoPlaceId, verificationToken: "v".repeat(43), name: `원래 ${kakaoPlaceId}`, address: "경기 양평군", roadAddress: null, latitude, longitude,
});

type Tables = Record<string, Array<Record<string, unknown>>>;
function client(tables: Tables, failing: string[] = []) {
  const reads: string[] = [];
  const api: RecheckClient = {
    from(table) {
      let ids: string[] | null = null;
      let column = "";
      const builder = {
        select: () => builder,
        in: (name: string, values: string[]) => { column = name; ids = values; return builder; },
        limit: async () => {
          reads.push(table);
          if (failing.includes(table)) return { data: null, error: { message: "boom" } };
          const rows = tables[table] ?? [];
          return { data: ids ? rows.filter((row) => ids!.includes(String(row[column]))) : rows, error: null };
        },
      };
      return builder;
    },
  };
  return { api, reads };
}
const savedSource: RecommendationSourceRef = { type: "saved", id: SAVED, revision: 3 };
const sharedSource: RecommendationSourceRef = { type: "shared", id: SHARED, revision: 2, folderId: FOLDER };
const healthy = (): Tables => ({
  saved_place_entries: [{ id: SAVED, place: place("mine"), revision: 3 }],
  shared_place_entries: [{ id: SHARED, folder_id: FOLDER, place: place("folder", 37.6), revision: 2 }],
  place_folder_preferences: [{ folder_id: FOLDER, enabled: true }],
  avoided_places: [],
});

describe("apply-time re-check (contract §7.4)", () => {
  it("passes an unchanged saved and shared source and returns their original places", async () => {
    const { api, reads } = client(healthy());
    const result = await recheckRecommendationSources(api, [savedSource, sharedSource]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.places.get(`shared:${SHARED}`)).toMatchObject({ kakaoPlaceId: "folder", verificationToken: "v".repeat(43) });
    expect(result.places.get(`saved:${SAVED}`)).toMatchObject({ kakaoPlaceId: "mine" });
    // Server reads only: rows, folder settings and avoided places.
    expect(reads.sort()).toEqual(["avoided_places", "place_folder_preferences", "saved_place_entries", "shared_place_entries"]);
  });

  it("refuses after an avoided place was added for the same place", async () => {
    const tables = healthy();
    tables.avoided_places = [{ id: "a1", place: place("folder", 37.6) }];
    expect(await recheckRecommendationSources(client(tables).api, [sharedSource])).toEqual({ ok: false, reason: "changed" });
  });

  it("refuses when an avoided map point sits within 30 m, and allows it 35 m away", async () => {
    const tables = healthy();
    tables.avoided_places = [{ id: "a1", place: place("map:37.5002250:127.1000000", 37.500225, 127.1) }];
    expect(await recheckRecommendationSources(client(tables).api, [savedSource])).toEqual({ ok: false, reason: "changed" });
    tables.avoided_places = [{ id: "a1", place: place("map:37.5003150:127.1000000", 37.500315, 127.1) }];
    expect((await recheckRecommendationSources(client(tables).api, [savedSource])).ok).toBe(true);
  });

  it("refuses after the folder was switched off", async () => {
    const tables = healthy();
    tables.place_folder_preferences = [{ folder_id: FOLDER, enabled: false }];
    expect(await recheckRecommendationSources(client(tables).api, [sharedSource])).toEqual({ ok: false, reason: "changed" });
  });

  it("refuses after I was removed from the folder (the row is no longer visible)", async () => {
    const tables = healthy();
    tables.shared_place_entries = [];
    tables.place_folder_preferences = [];
    expect(await recheckRecommendationSources(client(tables).api, [sharedSource])).toEqual({ ok: false, reason: "changed" });
  });

  it("refuses a newer revision and a deleted saved place", async () => {
    const tables = healthy();
    tables.saved_place_entries = [{ id: SAVED, place: place("mine"), revision: 4 }];
    expect(await recheckRecommendationSources(client(tables).api, [savedSource])).toEqual({ ok: false, reason: "changed" });
    tables.saved_place_entries = [];
    expect(await recheckRecommendationSources(client(tables).api, [savedSource])).toEqual({ ok: false, reason: "changed" });
  });

  it("refuses a row that moved to another folder id", async () => {
    const tables = healthy();
    tables.shared_place_entries = [{ id: SHARED, folder_id: OTHER_FOLDER, place: place("folder"), revision: 2 }];
    tables.place_folder_preferences = [{ folder_id: FOLDER, enabled: true }, { folder_id: OTHER_FOLDER, enabled: true }];
    expect(await recheckRecommendationSources(client(tables).api, [sharedSource])).toEqual({ ok: false, reason: "changed" });
  });

  it("reports an unreadable re-check instead of applying", async () => {
    expect(await recheckRecommendationSources(client(healthy(), ["avoided_places"]).api, [savedSource])).toEqual({ ok: false, reason: "unreadable" });
  });
});

const response = (overrides: Partial<RecommendationResponseV2["coverage"]> = {}): RecommendationResponseV2 => ({
  contractVersion: 2,
  status: "OK",
  basis: { tripId: "t", departureAt: "2026-10-10T00:00:00Z", returnAt: "2026-10-10T08:40:00Z", pointIds: ["a", "b"], arrivalAts: ["2026-10-10T08:40:00Z"] },
  settings: { mealCount: 1, toleranceMinutes: 30, detourLimitMinutes: 60 },
  meals: [{ index: 1, targetAt: "2026-10-10T03:00:00Z", windowStartAt: "2026-10-10T02:30:00Z", windowEndAt: "2026-10-10T03:30:00Z", dwellMinutes: 45, candidates: [{
    source: sharedSource, otherFolderIds: [OTHER_FOLDER], displayName: "신북 숯불닭갈비", placeName: "신북 숯불닭갈비", address: "강원 춘천시", longitude: 127.7, latitude: 37.9,
    insertion: { legIndex: 0, afterPointId: "a", beforePointId: "b" },
    single: { feasible: true, arrivalAt: "2026-10-10T03:10:00Z", extraDriveSeconds: 720, returnAt: "2026-10-10T09:37:00Z", reason: null },
  }] }],
  pairs: [],
  coverage: { savedRestaurants: 12, invalidSaved: 0, alreadyInRoute: 0, nearRoute: 5, evaluated: 5, unreachable: 0, notEvaluated: 0, providerRequests: 5, sharedRestaurants: 9, duplicateMerged: 0, avoidedExcluded: 2, disabledFolders: 1, sharedReadTruncated: false, ...overrides },
});

describe("v2 result wording and keys", () => {
  it("keys candidates by their source so v1 selection rules apply unchanged", () => {
    const view = recommendationView(response());
    expect(view.selectable.meals[0].candidates[0]).toMatchObject({ savedPlaceId: `shared:${SHARED}`, savedPlaceRevision: 2 });
    expect(view.sources.get(`shared:${SHARED}`)).toEqual({ source: sharedSource, otherFolderIds: [OTHER_FOLDER] });
  });

  it("states the pool and what was left out (SRC02, SRC03)", () => {
    expect(coverageTextV2(response())).toBe("내 식당 12곳과 켜 둔 공유 폴더 식당 9곳 중 경로 근처 5곳을 실제 도로 경로로 확인했어요.");
    expect(coverageTextV2(response({ sharedRestaurants: 0 }))).toBe("저장한 식당 12곳 중 경로 근처 5곳을 실제 도로 경로로 확인했어요.");
    expect(exclusionText(response(), ["동호회 정모 코스"])).toBe("기피 장소 2곳과 꺼 둔 공유 폴더 1개(동호회 정모 코스)의 식당은 후보에서 뺐어요.");
    expect(exclusionText(response({ avoidedExcluded: 0 }), [])).toBe("꺼 둔 공유 폴더 1개의 식당은 후보에서 뺐어요.");
    expect(exclusionText(response({ avoidedExcluded: 0, disabledFolders: 0 }), [])).toBeNull();
  });

  it("changes the input generation when a folder is switched, an avoided place added or a folder left", () => {
    const base = { folders: [{ id: FOLDER }, { id: OTHER_FOLDER }], preferences: [{ folderId: FOLDER, enabled: true }, { folderId: OTHER_FOLDER, enabled: false }], avoided: [{ id: "a1" }] };
    const key = recommendationGeneration(base);
    expect(recommendationGeneration({ ...base, preferences: [{ folderId: FOLDER, enabled: false }, { folderId: OTHER_FOLDER, enabled: false }] })).not.toBe(key);
    expect(recommendationGeneration({ ...base, avoided: [{ id: "a1" }, { id: "a2" }] })).not.toBe(key);
    expect(recommendationGeneration({ ...base, folders: [{ id: FOLDER }] })).not.toBe(key);
    expect(recommendationGeneration({ ...base, avoided: [{ id: "a1" }] })).toBe(key);
  });
});
