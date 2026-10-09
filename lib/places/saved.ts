import { favoritePlacePayload, type PlaceFavorite } from "./favorites";
import type { PlaceSearchResult } from "./search";

export const PROVINCES = [
  "서울",
  "부산",
  "대구",
  "인천",
  "광주",
  "대전",
  "울산",
  "세종",
  "경기",
  "강원",
  "충북",
  "충남",
  "전북",
  "전남",
  "경북",
  "경남",
  "제주",
] as const;
export type SavedPlaceKind = "riding_spot" | "restaurant";
export type SavedPlace = {
  id: string;
  place: PlaceSearchResult;
  alias: string | null;
  kind: SavedPlaceKind;
  province: string | null;
  starSlot: 1 | 2 | 3 | 4 | 5 | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

/** A stored `place` jsonb (saved, shared or avoided). The signed fields are kept as stored. */
export function parseStoredPlace(value: unknown): PlaceSearchResult {
  const validated = favoritePlacePayload(value);
  const original = value as Record<string, unknown>;
  return {
    ...validated,
    roadAddress: original.roadAddress === "" ? "" : validated.roadAddress,
    category: "",
    phone: null,
    placeUrl: null,
  };
}

export function parseSavedPlace(value: unknown): SavedPlace {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_SAVED_PLACE");
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      row.id,
    ) ||
    (row.alias !== null &&
      (typeof row.alias !== "string" ||
        !row.alias ||
        /^ | $/.test(row.alias) ||
        [...row.alias].length > 80 ||
        /[\u0000-\u001f\u007f]/.test(row.alias))) ||
    !["riding_spot", "restaurant"].includes(String(row.kind)) ||
    (row.province !== null &&
      !PROVINCES.includes(row.province as (typeof PROVINCES)[number])) ||
    (row.star_slot !== null &&
      ![1, 2, 3, 4, 5].includes(row.star_slot as number)) ||
    !Number.isSafeInteger(row.revision) ||
    Number(row.revision) < 1 ||
    typeof row.created_at !== "string" ||
    !Number.isFinite(Date.parse(row.created_at)) ||
    typeof row.updated_at !== "string" ||
    !Number.isFinite(Date.parse(row.updated_at))
  )
    throw new Error("INVALID_SAVED_PLACE");
  return {
    id: row.id,
    place: parseStoredPlace(row.place),
    alias: row.alias as string | null,
    kind: row.kind as SavedPlaceKind,
    province: row.province as string | null,
    starSlot: row.star_slot as SavedPlace["starSlot"],
    revision: Number(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseSavedPlaces(rows: unknown): SavedPlace[] {
  if (!Array.isArray(rows) || rows.length > 1000)
    throw new Error("INVALID_SAVED_PLACES");
  const result = rows.map(parseSavedPlace);
  const stars = result.filter((row) => row.starSlot !== null);
  if (
    new Set(result.map((row) => row.id)).size !== result.length ||
    new Set(result.map((row) => row.place.kakaoPlaceId)).size !==
      result.length ||
    stars.length > 5 ||
    new Set(stars.map((row) => row.starSlot)).size !== stars.length
  )
    throw new Error("INVALID_SAVED_PLACES");
  return result;
}

export const FREQUENT_PLACE_LIMIT = 10;
export type StarPosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
/** A `saved_place_entries` row: the saved place plus its 1..10 star position. */
export type SavedPlaceEntry = SavedPlace & { starPosition: StarPosition | null };

export function parseSavedPlaceEntry(value: unknown): SavedPlaceEntry {
  const saved = parseSavedPlace(value);
  const position = (value as Record<string, unknown>).star_position;
  if (
    (position !== null &&
      (!Number.isInteger(position) ||
        Number(position) < 1 ||
        Number(position) > FREQUENT_PLACE_LIMIT)) ||
    // star_slot is the 1..5 mirror older clients read; it must agree with the star.
    saved.starSlot !==
      (position !== null && Number(position) <= 5 ? position : null)
  )
    throw new Error("INVALID_SAVED_PLACE");
  return { ...saved, starPosition: position as StarPosition | null };
}

/** One view select is one snapshot, so a list that breaks the star rules is an
 * error rather than something to repair locally. */
export function parseSavedPlaceEntries(rows: unknown): SavedPlaceEntry[] {
  if (!Array.isArray(rows) || rows.length > 1000)
    throw new Error("INVALID_SAVED_PLACES");
  const result = rows.map(parseSavedPlaceEntry);
  const stars = result.filter((row) => row.starPosition !== null);
  if (
    new Set(result.map((row) => row.id)).size !== result.length ||
    new Set(result.map((row) => row.place.kakaoPlaceId)).size !==
      result.length ||
    stars.length > FREQUENT_PLACE_LIMIT ||
    new Set(stars.map((row) => row.starPosition)).size !== stars.length
  )
    throw new Error("INVALID_SAVED_PLACES");
  return result;
}

/** Map points without any address carry this id suffix and always an alias. */
export const isRegionOnlyPlace = (place: { kakaoPlaceId: string }) =>
  /^map:-?\d+\.\d{7}:-?\d+\.\d{7}:region$/.test(place.kakaoPlaceId);

export const savedPlaceName = (row: SavedPlace) => row.alias ?? row.place.name;
export function savedAsFavorite(row: SavedPlace): PlaceFavorite {
  if (row.starSlot === null) throw new Error("NOT_STARRED");
  return {
    slot: row.starSlot,
    place: row.place,
    createdAt: row.createdAt,
    displayName: savedPlaceName(row),
  };
}
