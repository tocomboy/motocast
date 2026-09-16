import { parseSelectedPlace, type SelectedPlace } from "@/lib/planner/input";
import type { PlaceSearchResult } from "@/lib/places/search";

export type PlaceFavorite = {
  slot: 1 | 2 | 3;
  place: SelectedPlace;
  createdAt: string;
};

export function favoritePlacePayload(value: unknown): SelectedPlace {
  const place = parseSelectedPlace(value);
  return {
    kakaoPlaceId: place.kakaoPlaceId,
    verificationToken: place.verificationToken,
    name: place.name,
    address: place.address,
    roadAddress: place.roadAddress,
    longitude: place.longitude,
    latitude: place.latitude,
  };
}

export function parsePlaceFavorite(value: unknown): PlaceFavorite {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_PLACE_FAVORITE");
  const row = value as Record<string, unknown>;
  if (![1, 2, 3].includes(Number(row.slot)) || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) {
    throw new Error("INVALID_PLACE_FAVORITE");
  }
  return { slot: Number(row.slot) as 1 | 2 | 3, place: favoritePlacePayload(row.place), createdAt: row.created_at };
}

export function favoriteAsSearchResult(favorite: PlaceFavorite): PlaceSearchResult {
  return { ...favorite.place, category: "", phone: null, placeUrl: null };
}
