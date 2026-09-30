import type { PlaceSearchResult } from "./place-search.ts";

export type MapPointRequest = { mode: "coordinate"; latitude: number; longitude: number };

export function parseMapPointRequest(value: unknown): MapPointRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_PLACE_SEARCH_REQUEST");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !["mode", "latitude", "longitude"].includes(key)) || raw.mode !== "coordinate" ||
    typeof raw.latitude !== "number" || !Number.isFinite(raw.latitude) || raw.latitude < 32.8 || raw.latitude > 38.7 ||
    typeof raw.longitude !== "number" || !Number.isFinite(raw.longitude) || raw.longitude < 124.5 || raw.longitude > 132) {
    throw new Error("INVALID_PLACE_SEARCH_REQUEST");
  }
  return { mode: "coordinate", latitude: Number(raw.latitude.toFixed(7)), longitude: Number(raw.longitude.toFixed(7)) };
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("INVALID_PLACE_PROVIDER_RESPONSE");
  }
  return value.trim();
}

/** A reverse-geocoded point is distinct from a Kakao POI. Never snap the chosen
 * coordinate to a building or silently replace a mountain parcel with a road. */
export function normalizeMapPlace(documents: unknown, point: MapPointRequest): PlaceSearchResult | null {
  if (!Array.isArray(documents) || documents.length > 1) throw new Error("INVALID_PLACE_PROVIDER_RESPONSE");
  if (!documents.length) return null;
  const document = documents[0];
  if (!document || typeof document !== "object" || Array.isArray(document) ||
    !document.address || typeof document.address !== "object" || Array.isArray(document.address)) {
    throw new Error("INVALID_PLACE_PROVIDER_RESPONSE");
  }
  const address = text(document.address.address_name, 300);
  const road = document.road_address;
  if (road !== null && road !== undefined && (typeof road !== "object" || Array.isArray(road))) {
    throw new Error("INVALID_PLACE_PROVIDER_RESPONSE");
  }
  const roadAddress = road ? text(road.address_name, 300) : null;
  return {
    kakaoPlaceId: `map:${point.latitude.toFixed(7)}:${point.longitude.toFixed(7)}`,
    name: (roadAddress ?? address).slice(0, 160), address, roadAddress,
    category: "지도에서 선택", phone: null, placeUrl: null,
    latitude: point.latitude, longitude: point.longitude,
  };
}
