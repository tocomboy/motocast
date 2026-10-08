// Recommendation candidate pool: my saved restaurants, restaurants of the shared
// folders I keep enabled, minus my avoided places (issue #124 contract §7.2).
// Read failures and broken invariants surface as RECOMMENDATION_STORAGE_FAILED;
// they are never treated as an empty list.

export type SourceRef =
  | { type: "saved"; id: string; revision: number }
  | { type: "shared"; id: string; revision: number; folderId: string };

export type CandidateRestaurant = {
  // Unique across sources. Within one source it orders exactly like the row ID,
  // so it doubles as the deterministic tie-breaker.
  key: string;
  source: SourceRef;
  kakaoPlaceId: string;
  displayName: string;
  placeName: string;
  address: string;
  longitude: number;
  latitude: number;
  // Other enabled folders holding the same place (display only, representative's folder excluded).
  otherFolderIds: string[];
};

export type AvoidedPlace = { kakaoPlaceId: string; longitude: number; latitude: number };

// Single JSON value of recommendation_shared_restaurants (migration 20261009120000).
export type SharedRestaurantRead = { rows: unknown[]; truncated: boolean; enabledTotal: number; disabledFolders: number };

export type CandidatePool = {
  restaurants: CandidateRestaurant[];
  savedRestaurants: number;
  sharedRestaurants: number;
  invalid: number;
  duplicateMerged: number;
  avoidedExcluded: number;
};

export const AVOIDED_PLACE_LIMIT = 200;
export const SHARED_RESTAURANT_READ_LIMIT = 2000;
// A map-point avoided place also excludes any candidate this close (user decision 2026-10-09).
export const AVOIDED_MAP_POINT_RADIUS_METERS = 30;
const MAP_POINT_PREFIX = "map:";
const EARTH_RADIUS_KM = 6371.0088;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHARED_READ_KEYS = ["disabledFolders", "enabledTotal", "rows", "truncated"];

function storageFailed(): never {
  throw new Error("RECOMMENDATION_STORAGE_FAILED");
}

export function inKorea(longitude: unknown, latitude: unknown): boolean {
  return typeof longitude === "number" && Number.isFinite(longitude) && longitude >= 124.5 && longitude <= 132 &&
    typeof latitude === "number" && Number.isFinite(latitude) && latitude >= 32.8 && latitude <= 38.7;
}

export function haversineKm(aLongitude: number, aLatitude: number, bLongitude: number, bLatitude: number) {
  const toRadians = Math.PI / 180;
  const dLatitude = (bLatitude - aLatitude) * toRadians;
  const dLongitude = (bLongitude - aLongitude) * toRadians;
  const h = Math.sin(dLatitude / 2) ** 2 +
    Math.cos(aLatitude * toRadians) * Math.cos(bLatitude * toRadians) * Math.sin(dLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value.trim() !== value) return null;
  return value;
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

// A saved_places row {id, place, alias, revision} or a shared row that also carries
// folder_id. A row without a usable place ID cannot be matched against avoided
// places, so it is invalid rather than recommended.
function restaurantRow(value: unknown, type: SourceRef["type"]): CandidateRestaurant | null {
  const row = plainRecord(value);
  const raw = plainRecord(row?.place);
  if (!row || !raw) return null;
  const name = cleanText(raw.name, 160);
  const address = cleanText(raw.address, 300);
  const roadAddress = raw.roadAddress === null || raw.roadAddress === "" ? null : cleanText(raw.roadAddress, 300);
  const alias = row.alias === null || row.alias === undefined ? null : cleanText(row.alias, 80);
  if (
    typeof row.id !== "string" || !UUID.test(row.id) ||
    !Number.isSafeInteger(row.revision) || Number(row.revision) <= 0 ||
    typeof raw.kakaoPlaceId !== "string" || raw.kakaoPlaceId.length < 1 ||
    !name || !address || (raw.roadAddress !== null && raw.roadAddress !== "" && !roadAddress) ||
    (row.alias !== null && row.alias !== undefined && !alias) ||
    !inKorea(raw.longitude, raw.latitude) ||
    (type === "shared" && (typeof row.folder_id !== "string" || !UUID.test(row.folder_id)))
  ) return null;
  const revision = row.revision as number;
  return {
    key: `${type}:${row.id}`,
    source: type === "saved"
      ? { type, id: row.id, revision }
      : { type, id: row.id, revision, folderId: row.folder_id as string },
    kakaoPlaceId: raw.kakaoPlaceId,
    displayName: alias ?? name,
    placeName: name,
    address: roadAddress ?? address,
    longitude: raw.longitude as number,
    latitude: raw.latitude as number,
    otherFolderIds: [],
  };
}

export function parseAvoidedPlaces(rows: unknown): AvoidedPlace[] {
  if (!Array.isArray(rows) || rows.length > AVOIDED_PLACE_LIMIT) storageFailed();
  return rows.map((value) => {
    const place = plainRecord(plainRecord(value)?.place);
    if (
      !place || typeof place.kakaoPlaceId !== "string" || place.kakaoPlaceId.length < 1 ||
      typeof place.longitude !== "number" || !Number.isFinite(place.longitude) ||
      typeof place.latitude !== "number" || !Number.isFinite(place.latitude)
    ) storageFailed();
    return { kakaoPlaceId: place.kakaoPlaceId, longitude: place.longitude, latitude: place.latitude };
  });
}

export function parseSharedRestaurantRead(value: unknown): SharedRestaurantRead {
  const read = plainRecord(value);
  if (!read) storageFailed();
  const keys = Object.keys(read).sort();
  const count = (item: unknown) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0;
  if (
    keys.length !== SHARED_READ_KEYS.length || keys.some((key, index) => key !== SHARED_READ_KEYS[index]) ||
    !Array.isArray(read.rows) || read.rows.length > SHARED_RESTAURANT_READ_LIMIT ||
    typeof read.truncated !== "boolean" || (read.truncated && read.rows.length !== SHARED_RESTAURANT_READ_LIMIT) ||
    !count(read.enabledTotal) || (read.enabledTotal as number) < read.rows.length ||
    !count(read.disabledFolders)
  ) storageFailed();
  return {
    rows: read.rows,
    truncated: read.truncated,
    enabledTotal: read.enabledTotal as number,
    disabledFolders: read.disabledFolders as number,
  };
}

// POI avoided places match by exact kakaoPlaceId only; a map point (`map:` prefix,
// region points included) also matches any candidate within 30 m.
export function avoidanceMatcher(avoided: AvoidedPlace[]) {
  const ids = new Set(avoided.map((place) => place.kakaoPlaceId));
  const mapPoints = avoided.filter((place) => place.kakaoPlaceId.startsWith(MAP_POINT_PREFIX));
  return (candidate: { kakaoPlaceId: string; longitude: number; latitude: number }) => (
    ids.has(candidate.kakaoPlaceId) ||
    mapPoints.some((point) => (
      haversineKm(point.longitude, point.latitude, candidate.longitude, candidate.latitude) * 1000 <=
        AVOIDED_MAP_POINT_RADIUS_METERS
    ))
  );
}

// My rows always stay (as before, even if two of mine share a place ID). A shared
// row whose kakaoPlaceId is already present merges into that representative: mine
// first, then the earliest shared row, because rows arrive in (created_at, id)
// order. Avoidance applies to the representatives.
export function buildCandidatePool(savedRows: unknown[], avoided: AvoidedPlace[], sharedRows: unknown[] = []): CandidatePool {
  const representatives: CandidateRestaurant[] = [];
  const byPlace = new Map<string, CandidateRestaurant>();
  let savedRestaurants = 0;
  let sharedRestaurants = 0;
  let invalid = 0;
  let duplicateMerged = 0;
  for (const row of savedRows) {
    const restaurant = restaurantRow(row, "saved");
    if (!restaurant) {
      invalid += 1;
      continue;
    }
    savedRestaurants += 1;
    if (!byPlace.has(restaurant.kakaoPlaceId)) byPlace.set(restaurant.kakaoPlaceId, restaurant);
    representatives.push(restaurant);
  }
  for (const row of sharedRows) {
    const restaurant = restaurantRow(row, "shared");
    if (!restaurant || restaurant.source.type !== "shared") {
      invalid += 1;
      continue;
    }
    sharedRestaurants += 1;
    const existing = byPlace.get(restaurant.kakaoPlaceId);
    if (!existing) {
      byPlace.set(restaurant.kakaoPlaceId, restaurant);
      representatives.push(restaurant);
      continue;
    }
    duplicateMerged += 1;
    const folderId = restaurant.source.folderId;
    const ownFolder = existing.source.type === "shared" ? existing.source.folderId : null;
    if (folderId !== ownFolder && !existing.otherFolderIds.includes(folderId)) existing.otherFolderIds.push(folderId);
  }
  const isAvoided = avoidanceMatcher(avoided);
  const restaurants = representatives.filter((restaurant) => !isAvoided(restaurant));
  return {
    restaurants,
    savedRestaurants,
    sharedRestaurants,
    invalid,
    duplicateMerged,
    avoidedExcluded: representatives.length - restaurants.length,
  };
}
