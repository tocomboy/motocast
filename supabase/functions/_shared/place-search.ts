export type PlaceSearchRequest = {
  query: string;
  page: number;
  size: number;
};

export type PlaceSearchResult = {
  kakaoPlaceId: string;
  name: string;
  category: string;
  address: string;
  roadAddress: string | null;
  phone: string | null;
  placeUrl: string | null;
  latitude: number;
  longitude: number;
};

type KakaoPlaceDocument = {
  id?: unknown;
  place_name?: unknown;
  category_name?: unknown;
  address_name?: unknown;
  road_address_name?: unknown;
  phone?: unknown;
  place_url?: unknown;
  x?: unknown;
  y?: unknown;
};

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error("INVALID_PLACE_SEARCH_PAGE");
  }
  return Number(value);
}

export function parsePlaceSearchRequest(value: unknown): PlaceSearchRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_PLACE_SEARCH_REQUEST");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.query !== "string") throw new Error("INVALID_PLACE_SEARCH_QUERY");
  const query = raw.query.trim().replace(/\s+/g, " ");
  if (query.length < 2 || query.length > 100) throw new Error("INVALID_PLACE_SEARCH_QUERY");
  return {
    query,
    page: boundedInteger(raw.page, 1, 1, 45),
    size: boundedInteger(raw.size, 10, 1, 15),
  };
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("INVALID_PLACE_PROVIDER_RESPONSE");
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function kakaoPlaceUrl(value: unknown) {
  const rawUrl = optionalString(value);
  if (!rawUrl) return null;
  if (rawUrl.length > 500) throw new Error("INVALID_PLACE_PROVIDER_RESPONSE");

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("INVALID_PLACE_PROVIDER_RESPONSE");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.hostname !== "place.map.kakao.com" ||
    parsed.port ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("INVALID_PLACE_PROVIDER_RESPONSE");
  }
  parsed.protocol = "https:";
  const canonical = parsed.toString();
  if (canonical.length > 500) throw new Error("INVALID_PLACE_PROVIDER_RESPONSE");
  return canonical;
}

function coordinate(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("INVALID_PLACE_PROVIDER_RESPONSE");
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("INVALID_PLACE_PROVIDER_RESPONSE");
  return parsed;
}

export function normalizeKakaoPlace(value: unknown): PlaceSearchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_PLACE_PROVIDER_RESPONSE");
  }
  const raw = value as KakaoPlaceDocument;
  const latitude = coordinate(raw.y);
  const longitude = coordinate(raw.x);
  if (latitude < 32.8 || latitude > 38.7 || longitude < 124.5 || longitude > 132) {
    throw new Error("PLACE_OUTSIDE_KOREA");
  }
  return {
    kakaoPlaceId: requiredString(raw.id).slice(0, 80),
    name: requiredString(raw.place_name).slice(0, 160),
    category: typeof raw.category_name === "string" ? raw.category_name.trim().slice(0, 200) : "",
    address: requiredString(raw.address_name).slice(0, 300),
    roadAddress: optionalString(raw.road_address_name)?.slice(0, 300) ?? null,
    phone: optionalString(raw.phone)?.slice(0, 40) ?? null,
    placeUrl: kakaoPlaceUrl(raw.place_url),
    latitude,
    longitude,
  };
}

export function normalizeKakaoPlaceDocuments(value: unknown): PlaceSearchResult[] {
  if (!Array.isArray(value)) throw new Error("INVALID_PLACE_PROVIDER_RESPONSE");
  return value.map(normalizeKakaoPlace);
}
