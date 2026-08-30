import { parseSelectedPlace, type SelectedPlace } from "../planner/input";

export type PlaceSearchResult = SelectedPlace & {
  category: string;
  phone: string | null;
  placeUrl: string | null;
};

export type PlaceSearchResponse = {
  places: PlaceSearchResult[];
  isEnd: boolean;
};

function optionalText(value: unknown, maximum: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("INVALID_PLACE_SEARCH_RESPONSE");
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error("INVALID_PLACE_SEARCH_RESPONSE");
  return normalized;
}

function placeUrl(value: unknown): string | null {
  const normalized = optionalText(value, 500);
  if (!normalized) return null;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("INVALID_PLACE_SEARCH_RESPONSE");
  }
  if (url.protocol !== "https:" || url.hostname !== "place.map.kakao.com") {
    throw new Error("INVALID_PLACE_SEARCH_RESPONSE");
  }
  return url.toString();
}

function parseResult(value: unknown): PlaceSearchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_PLACE_SEARCH_RESPONSE");
  }
  const raw = value as Record<string, unknown>;
  const selected = parseSelectedPlace(raw);
  return {
    ...selected,
    category: optionalText(raw.category, 200) ?? "",
    phone: optionalText(raw.phone, 40),
    placeUrl: placeUrl(raw.placeUrl),
  };
}

export function parsePlaceSearchResponse(value: unknown): PlaceSearchResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_PLACE_SEARCH_RESPONSE");
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.places) || typeof raw.isEnd !== "boolean") {
    throw new Error("INVALID_PLACE_SEARCH_RESPONSE");
  }
  return { places: raw.places.map(parseResult), isEnd: raw.isEnd };
}
