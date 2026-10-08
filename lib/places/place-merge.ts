/**
 * Merged view rules shared by web and Android (contract §1, §7.2; fixture
 * contracts/android/shared-folders/merge-fixtures.json).
 *
 * - Duplicates are the same `kakaoPlaceId` string, compared exactly (no normalization).
 *   Map points (`map:<lat7>:<lng7>`) and region points (`...:region`) follow the same rule.
 * - My saved place wins. Among folders only, the earliest `(createdAt, id)` row represents
 *   the place and the other enabled folders that hold it are listed after it.
 * - Disabled folders take no part: they neither add entries nor appear as other folders.
 */

export type MergeSavedInput = { id: string; kakaoPlaceId: string };
export type MergeSharedInput = { id: string; folderId: string; kakaoPlaceId: string; createdAt: string };
export type MergeAvoidedInput = { id: string; kakaoPlaceId: string; latitude: number; longitude: number };
export type MergedEntry =
  | { source: "saved"; id: string; otherFolderIds: string[] }
  | { source: "shared"; id: string; folderId: string; otherFolderIds: string[] };

/** Avoided map points also match anything within this distance (user decision 2026-10-09). */
export const AVOIDED_MAP_POINT_RADIUS_M = 30;
const EARTH_RADIUS_M = 6_371_008.8;

const compareShared = (a: MergeSharedInput, b: MergeSharedInput) =>
  Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function mergePlaces(
  saved: readonly MergeSavedInput[],
  shared: readonly MergeSharedInput[],
  enabledFolderIds: Iterable<string>,
): MergedEntry[] {
  const enabled = new Set(enabledFolderIds);
  const groups = new Map<string, MergeSharedInput[]>();
  for (const row of [...shared].filter((row) => enabled.has(row.folderId)).sort(compareShared)) {
    const group = groups.get(row.kakaoPlaceId);
    if (group) group.push(row);
    else groups.set(row.kakaoPlaceId, [row]);
  }
  const folders = (rows: MergeSharedInput[] | undefined) => [...new Set((rows ?? []).map((row) => row.folderId))];
  const savedIds = new Set(saved.map((row) => row.kakaoPlaceId));
  const entries: MergedEntry[] = saved.map((row) => ({ source: "saved", id: row.id, otherFolderIds: folders(groups.get(row.kakaoPlaceId)) }));
  for (const [kakaoPlaceId, rows] of groups) {
    if (savedIds.has(kakaoPlaceId)) continue;
    const [first] = rows;
    entries.push({ source: "shared", id: first.id, folderId: first.folderId, otherFolderIds: folders(rows).filter((id) => id !== first.folderId) });
  }
  return entries;
}

/** Source line text: "내 장소" or "공유 · <folder>" with " 외 n" for the other folders. */
export function sourceLabel(entry: MergedEntry, folderName: (folderId: string) => string) {
  if (entry.source === "saved") return "내 장소";
  return `공유 · ${folderName(entry.folderId)}${entry.otherFolderIds.length ? ` 외 ${entry.otherFolderIds.length}` : ""}`;
}

export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const toRadians = Math.PI / 180;
  const dLatitude = (b.latitude - a.latitude) * toRadians;
  const dLongitude = (b.longitude - a.longitude) * toRadians;
  const h = Math.sin(dLatitude / 2) ** 2 + Math.cos(a.latitude * toRadians) * Math.cos(b.latitude * toRadians) * Math.sin(dLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A POI avoided place matches its id only; an avoided map point also matches within 30 m. */
export function matchesAvoided(
  place: { kakaoPlaceId: string; latitude: number; longitude: number },
  avoided: readonly MergeAvoidedInput[],
): MergeAvoidedInput | undefined {
  return avoided.find((row) =>
    row.kakaoPlaceId === place.kakaoPlaceId ||
    (row.kakaoPlaceId.startsWith("map:") && distanceMeters(row, place) <= AVOIDED_MAP_POINT_RADIUS_M));
}
