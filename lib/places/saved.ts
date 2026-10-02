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
  const validated = favoritePlacePayload(row.place);
  const original = row.place as Record<string, unknown>;
  return {
    id: row.id,
    place: {
      ...validated,
      roadAddress: original.roadAddress === "" ? "" : validated.roadAddress,
      category: "",
      phone: null,
      placeUrl: null,
    },
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
