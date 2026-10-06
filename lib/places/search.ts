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

/** Checks a coordinate-mode response against the selected point. A region-only id
 * (`:region`) is accepted only when the request opted in with `fallback: "region"`. */
export function selectedMapPointPlace(
  response: PlaceSearchResponse,
  point: { latitude: number; longitude: number },
  regionFallback: boolean,
): PlaceSearchResult | null {
  const latitude = Number(point.latitude.toFixed(7));
  const longitude = Number(point.longitude.toFixed(7));
  const id = `map:${latitude.toFixed(7)}:${longitude.toFixed(7)}`;
  const place = response.places[0];
  if (!response.isEnd || response.places.length > 1 || (place && (
    place.latitude !== latitude || place.longitude !== longitude ||
    (place.kakaoPlaceId !== id && !(regionFallback && place.kakaoPlaceId === `${id}:region`))
  ))) throw new Error("WRONG_SELECTED_POINT");
  return place ?? null;
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
