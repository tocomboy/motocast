import { matchesAvoided } from "../places/place-merge";
import { parseStoredPlace } from "../places/saved";
import type { PlaceSearchResult } from "../places/search";
import {
  recommendationSourceKey,
  type RecommendationResponse,
  type RecommendationResponseV2,
  type RecommendationSourceRef,
} from "./restaurant-recommendation";

/**
 * Web side of recommendation contract v2 (issue #124 §7.3, §7.4). The selection and insertion
 * rules of v1 are reused unchanged: each v2 candidate is keyed by its source
 * ("saved:<id>" / "shared:<id>") where v1 used the saved place id.
 */
export type CandidateSource = { source: RecommendationSourceRef; otherFolderIds: string[] };
export type RecommendationView = {
  /** v1-shaped copy whose candidate ids are source keys, for selection and insertion. */
  selectable: RecommendationResponse;
  response: RecommendationResponseV2;
  sources: Map<string, CandidateSource>;
};

export function recommendationView(response: RecommendationResponseV2): RecommendationView {
  const sources = new Map<string, CandidateSource>();
  const selectable: RecommendationResponse = {
    // ALL_EXCLUDED has no candidates; it is an answer like an empty OK.
    status: response.status === "NO_SAVED_RESTAURANTS" ? "NO_SAVED_RESTAURANTS" : "OK",
    basis: response.basis,
    settings: response.settings,
    meals: response.meals.map((meal) => ({
      ...meal,
      candidates: meal.candidates.map(({ source, otherFolderIds, ...candidate }) => {
        const key = recommendationSourceKey(source);
        sources.set(key, { source, otherFolderIds });
        return { ...candidate, savedPlaceId: key, savedPlaceRevision: source.revision };
      }),
    })),
    pairs: response.pairs.map(({ first, second, ...pair }) => ({
      ...pair,
      firstSavedPlaceId: recommendationSourceKey(first),
      secondSavedPlaceId: recommendationSourceKey(second),
    })),
    coverage: response.coverage,
  };
  return { selectable, response, sources };
}

/**
 * The recommendation input generation (§7.4): enabled folders, my avoided places and the folders
 * I belong to. A result computed for another generation is shown as "설정이 바뀌었어요" (SRC02b)
 * and never re-requested automatically.
 */
export function recommendationGeneration(snapshot: {
  folders: ReadonlyArray<{ id: string }>;
  preferences: ReadonlyArray<{ folderId: string; enabled: boolean }>;
  avoided: ReadonlyArray<{ id: string }>;
}) {
  const sorted = (values: string[]) => [...values].sort().join(",");
  return [
    sorted(snapshot.preferences.filter((row) => row.enabled).map((row) => row.folderId)),
    sorted(snapshot.avoided.map((row) => row.id)),
    sorted(snapshot.folders.map((row) => row.id)),
  ].join("|");
}

type Query = PromiseLike<{ data: unknown; error: unknown }>;
type Builder = { select(columns: string): Builder; in(column: string, values: string[]): Builder; limit(count: number): Query };
export type RecheckClient = { from(table: string): Builder };
export type SourceRecheck =
  | { ok: true; places: Map<string, PlaceSearchResult> }
  | { ok: false; reason: "changed" | "unreadable" };

const rows = (value: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) throw new Error("READ_FAILED");
  return value.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("READ_FAILED");
    return row as Record<string, unknown>;
  });
};
const read = async (query: Query) => {
  const { data, error } = await query;
  if (error) throw new Error("READ_FAILED");
  return rows(data);
};

/**
 * Re-check right before the chosen candidates are added (§7.4): each source row still exists
 * with the same revision (a shared row only while I can see it), a shared source's folder is
 * still enabled for me, and the place is not one of my avoided places (POI id; map point 30 m).
 * Server reads only; no provider call and no budget. The original place, signature included,
 * comes from the re-read row.
 */
export async function recheckRecommendationSources(client: RecheckClient, sources: RecommendationSourceRef[]): Promise<SourceRecheck> {
  const saved = sources.filter((source) => source.type === "saved");
  const shared = sources.filter((source): source is Extract<RecommendationSourceRef, { type: "shared" }> => source.type === "shared");
  try {
    const [savedRows, sharedRows, preferences, avoided] = await Promise.all([
      saved.length ? read(client.from("saved_place_entries").select("id,place,revision").in("id", saved.map((source) => source.id)).limit(saved.length)) : Promise.resolve([]),
      shared.length ? read(client.from("shared_place_entries").select("id,folder_id,place,revision").in("id", shared.map((source) => source.id)).limit(shared.length)) : Promise.resolve([]),
      shared.length ? read(client.from("place_folder_preferences").select("folder_id,enabled").in("folder_id", [...new Set(shared.map((source) => source.folderId))]).limit(shared.length)) : Promise.resolve([]),
      read(client.from("avoided_places").select("id,place").limit(201)),
    ]);
    const avoidedPlaces = avoided.map((row) => {
      const place = parseStoredPlace(row.place);
      return { id: String(row.id), kakaoPlaceId: place.kakaoPlaceId, latitude: place.latitude, longitude: place.longitude };
    });
    const places = new Map<string, PlaceSearchResult>();
    for (const source of sources) {
      const row = (source.type === "saved" ? savedRows : sharedRows).find((candidate) => candidate.id === source.id);
      if (!row || row.revision !== source.revision) return { ok: false, reason: "changed" };
      if (source.type === "shared") {
        const enabled = preferences.find((preference) => preference.folder_id === source.folderId)?.enabled === true;
        if (row.folder_id !== source.folderId || !enabled) return { ok: false, reason: "changed" };
      }
      const place = parseStoredPlace(row.place);
      if (matchesAvoided(place, avoidedPlaces)) return { ok: false, reason: "changed" };
      places.set(recommendationSourceKey(source), place);
    }
    return { ok: true, places };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/** "내 식당 12곳과 켜 둔 공유 폴더 식당 9곳 중 경로 근처 5곳을 실제 도로 경로로 확인했어요." */
export function coverageTextV2(response: RecommendationResponseV2) {
  const { savedRestaurants, sharedRestaurants, nearRoute, evaluated } = response.coverage;
  const pool = sharedRestaurants ? `내 식당 ${savedRestaurants}곳과 켜 둔 공유 폴더 식당 ${sharedRestaurants}곳` : `저장한 식당 ${savedRestaurants}곳`;
  return evaluated === nearRoute
    ? `${pool} 중 경로 근처 ${nearRoute}곳을 실제 도로 경로로 확인했어요.`
    : `${pool} 중 경로 근처 ${nearRoute}곳, 그중 ${evaluated}곳을 실제 도로 경로로 확인했어요.`;
}

/** "기피 장소 2곳과 꺼 둔 공유 폴더 1개(동호회 정모 코스)의 식당은 후보에서 뺐어요." or null when nothing was left out. */
export function exclusionText(response: RecommendationResponseV2, disabledFolderNames: string[], ending = "후보에서 뺐어요.") {
  const { avoidedExcluded, disabledFolders } = response.coverage;
  const names = disabledFolderNames.length === disabledFolders && disabledFolders ? `(${disabledFolderNames.join(", ")})` : "";
  const parts = [
    ...(avoidedExcluded ? [`기피 장소 ${avoidedExcluded}곳`] : []),
    ...(disabledFolders ? [`꺼 둔 공유 폴더 ${disabledFolders}개${names}`] : []),
  ];
  if (!parts.length) return null;
  return `${parts.join("과 ")}의 식당은 ${ending}`;
}
