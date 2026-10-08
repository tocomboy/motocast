/**
 * Synthetic rows in the exact shapes of contract §6.1 (snake_case, as PostgREST returns them).
 * Names follow the Figma #124 sample data; nothing here is real user data.
 */
export const ME = "00000000-0000-4000-8000-0000000000a1";
export const OTHER = "00000000-0000-4000-8000-0000000000a2";
export const VIEWER = "00000000-0000-4000-8000-0000000000a3";
export const LEFT = "00000000-0000-4000-8000-0000000000a9";
export const F1 = "00000000-0000-4000-8000-0000000000f1";
export const F2 = "00000000-0000-4000-8000-0000000000f2";
export const F3 = "00000000-0000-4000-8000-0000000000f3";

export const place = (kakaoPlaceId: string, name: string, extra: Record<string, unknown> = {}) => ({
  kakaoPlaceId,
  verificationToken: "s".repeat(43),
  name,
  address: "경기 양평군 양서면",
  roadAddress: `경기 양평군 양서면 ${name}길 12`,
  latitude: 37.5,
  longitude: 127.3,
  ...extra,
});

export const folderRow = (id: string, name: string, owner: string, extra: Record<string, unknown> = {}) => ({
  id, owner_id: owner, name, revision: 1, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...extra,
});
export const memberRow = (folder: string, member: string, role: string, name: string, extra: Record<string, unknown> = {}) => ({
  folder_id: folder, member_id: member, role, display_name: name, joined_at: "2026-10-01T00:00:00Z", revision: 1, ...extra,
});
export const preferenceRow = (folder: string, enabled: boolean) => ({ member_id: ME, folder_id: folder, enabled, updated_at: "2026-10-01T00:00:00Z" });
export const sharedRow = (n: number, folder: string, kakaoPlaceId: string, name: string, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  folder_id: folder,
  place: place(kakaoPlaceId, name),
  alias: null,
  kind: "riding_spot",
  province: "경기",
  revision: 1,
  created_by: OTHER,
  updated_by: OTHER,
  created_at: `2026-10-0${1 + (n % 8)}T00:00:00Z`,
  updated_at: "2026-10-06T05:20:00Z",
  updated_by_display_name: "새벽바이크",
  updated_by_left: false,
  starred: false,
  ...extra,
});
export const savedEntryRow = (n: number, kakaoPlaceId: string, name: string, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-1000000000${String(n).padStart(2, "0")}`,
  place: place(kakaoPlaceId, name),
  alias: null,
  kind: "riding_spot",
  province: "경기",
  star_slot: null,
  star_position: null,
  revision: 1,
  created_at: "2026-10-02T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
  ...extra,
});

/** Three folders (owner of F1, editor of F2, viewer of F3), F3 switched off. */
export function sampleTables() {
  return {
    place_folders: [folderRow(F1, "주말 라이더", ME), folderRow(F2, "남한강 맛집", OTHER), folderRow(F3, "동호회 정모 코스", OTHER)],
    place_folder_members: [
      memberRow(F1, ME, "owner", "바람개비"),
      memberRow(F1, OTHER, "editor", "새벽바이크"),
      memberRow(F1, VIEWER, "viewer", "양평토박이", { joined_at: "2026-10-03T00:00:00Z" }),
      memberRow(F2, OTHER, "owner", "새벽바이크"),
      memberRow(F2, ME, "editor", "초록헬멧"),
      memberRow(F3, OTHER, "owner", "새벽바이크"),
      memberRow(F3, ME, "viewer", "초록헬멧"),
    ],
    place_folder_preferences: [preferenceRow(F1, true), preferenceRow(F2, true), preferenceRow(F3, false)],
    shared_place_entries: [
      // Same place as my saved place "k-mine": my place wins.
      sharedRow(1, F1, "k-mine", "팔당 라이딩 카페"),
      // In two enabled folders: F2's row is older, so it represents ("외 1").
      sharedRow(2, F1, "k-both", "남한강 강변 쉼터", { created_at: "2026-10-05T00:00:00Z" }),
      sharedRow(3, F2, "k-both", "남한강 강변 쉼터", { created_at: "2026-10-02T00:00:00Z" }),
      sharedRow(4, F1, "k-f1", "문호리 강변 쉼터", { updated_by: LEFT, updated_by_display_name: null, updated_by_left: true }),
      // Only in the disabled folder: hidden from the places view, still starred.
      sharedRow(5, F3, "k-off", "양수리 닭갈비", { kind: "restaurant", starred: true }),
      sharedRow(6, F1, "k-avoid", "가평 휴게소", { kind: "restaurant" }),
    ],
    my_star_entries: [
      { owner_id: ME, source: "shared", id: sharedRow(5, F3, "", "").id, folder_id: F3, place: place("k-off", "양수리 닭갈비"), alias: null, kind: "restaurant", province: "경기", revision: 1, starred_at: "2026-10-04T00:00:00Z", star_slot: null },
      { owner_id: ME, source: "saved", id: savedEntryRow(1, "", "").id, folder_id: null, place: place("k-mine", "팔당 라이딩 카페"), alias: null, kind: "riding_spot", province: "경기", revision: 2, starred_at: "2026-10-03T00:00:00Z", star_slot: 1 },
    ],
    avoided_places: [
      { id: "00000000-0000-4000-8000-0000000000b1", place: place("k-avoid", "가평 휴게소"), source_shared_place_id: sharedRow(6, F1, "", "").id, created_at: "2026-10-06T00:00:00Z" },
      { id: "00000000-0000-4000-8000-0000000000b2", place: place("map:37.4000000:127.2000000", "서종 공사 구간", { latitude: 37.4, longitude: 127.2 }), source_shared_place_id: null, created_at: "2026-10-01T00:00:00Z" },
    ],
  };
}
export const sampleSaved = () => [
  savedEntryRow(1, "k-mine", "팔당 라이딩 카페", { star_slot: 1, star_position: 1, revision: 2 }),
  savedEntryRow(2, "k-saved-2", "유명산 정상 주차장"),
];
