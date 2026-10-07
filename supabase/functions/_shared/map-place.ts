import type { PlaceSearchResult } from "./place-search.ts";

/** `fallback: "region"` is sent only by clients that understand region-only points.
 * Without it the endpoint behaves exactly as before. */
export type MapPointRequest = { mode: "coordinate"; latitude: number; longitude: number; fallback?: "region" };

export const REGION_PLACE_CATEGORY = "지도에서 선택 · 상세 주소 없음";

export function parseMapPointRequest(value: unknown): MapPointRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_PLACE_SEARCH_REQUEST");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !["mode", "latitude", "longitude", "fallback"].includes(key)) || raw.mode !== "coordinate" ||
    ("fallback" in raw && raw.fallback !== "region") ||
    typeof raw.latitude !== "number" || !Number.isFinite(raw.latitude) || raw.latitude < 32.8 || raw.latitude > 38.7 ||
    typeof raw.longitude !== "number" || !Number.isFinite(raw.longitude) || raw.longitude < 124.5 || raw.longitude > 132) {
    throw new Error("INVALID_PLACE_SEARCH_REQUEST");
  }
  const point: MapPointRequest = { mode: "coordinate", latitude: Number(raw.latitude.toFixed(7)), longitude: Number(raw.longitude.toFixed(7)) };
  if (raw.fallback === "region") point.fallback = "region";
  return point;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("INVALID_PLACE_PROVIDER_RESPONSE");
  }
  return value.trim();
}

function optionalText(value: unknown, maximum: number): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value) || value.trim().length > maximum) {
    throw new Error("INVALID_PLACE_PROVIDER_RESPONSE");
  }
  return value.trim();
}

const pointId = (point: MapPointRequest) => `map:${point.latitude.toFixed(7)}:${point.longitude.toFixed(7)}`;

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
    kakaoPlaceId: pointId(point),
    name: (roadAddress ?? address).slice(0, 160), address, roadAddress,
    category: "지도에서 선택", phone: null, placeUrl: null,
    latitude: point.latitude, longitude: point.longitude,
  };
}

/** coord2regioncode fallback for a point without any address. Only the single legal
 * ("B") region is used; its coordinate is ignored so the selected point is kept. */
export function normalizeRegionPlace(documents: unknown, point: MapPointRequest): PlaceSearchResult | null {
  if (!Array.isArray(documents) || documents.length > 10 ||
    documents.some(document => !plainObject(document) || (document.region_type !== "B" && document.region_type !== "H"))) {
    throw new Error("INVALID_PLACE_PROVIDER_RESPONSE");
  }
  const legal = documents.filter(document => document.region_type === "B") as Record<string, unknown>[];
  if (legal.length > 1) throw new Error("INVALID_PLACE_PROVIDER_RESPONSE");
  if (!legal.length) return null;
  const address = text(legal[0].address_name, 300);
  const area = [optionalText(legal[0].region_2depth_name, 100), optionalText(legal[0].region_3depth_name, 100)]
    .filter(Boolean).join(" ") || address;
  return {
    kakaoPlaceId: `${pointId(point)}:region`,
    name: `${area.slice(0, 157).trimEnd()} 부근`, address, roadAddress: null,
    category: REGION_PLACE_CATEGORY, phone: null, placeUrl: null,
    latitude: point.latitude, longitude: point.longitude,
  };
}
