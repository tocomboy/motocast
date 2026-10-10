import { isKoreanCoordinate } from "../planner/input";
import type { PlaceSearchResult } from "./search";

/** Issue #137 confirmed values: one read, at most 15 s, a fix up to one minute old. */
export const CURRENT_LOCATION_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 };
/** "다시 시도" reads the position anew; a cached fix would repeat the failure it retries. */
export const CURRENT_LOCATION_RETRY_OPTIONS: PositionOptions = { ...CURRENT_LOCATION_OPTIONS, maximumAge: 0 };
/** A fix with a larger reported error is never applied (D2). */
export const CURRENT_LOCATION_MAX_ACCURACY_METERS = 500;

/** permission: the browser denied location. position: no fix, a timeout or a fix
 * that is too inaccurate. outside: the fix is outside Korea, so nothing was looked up.
 * lookup / no-address / limit follow the map-point lookup (limit = search-places 429).
 * cancelled: the rider left or started over; the caller drops it silently. */
export type CurrentLocationFailure = "permission" | "position" | "outside" | "lookup" | "no-address" | "limit" | "cancelled";

export class CurrentLocationError extends Error {
  constructor(readonly kind: CurrentLocationFailure) {
    super(`CURRENT_LOCATION_${kind.toUpperCase().replace("-", "_")}`);
  }
}

type Point = { latitude: number; longitude: number };
type Fix = Point & { accuracy: number };

function readPosition(geolocation: Geolocation | undefined, options: PositionOptions): Promise<Fix> {
  if (!geolocation) return Promise.reject(new CurrentLocationError("position"));
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
      (error) => reject(new CurrentLocationError(error.code === 1 ? "permission" : "position")),
      options,
    );
  });
}

/** The only coordinate that may leave the device is one that passed these checks. */
export function usableFix(fix: Fix): Point {
  if (![fix.latitude, fix.longitude, fix.accuracy].every(Number.isFinite) || fix.accuracy < 0 ||
    fix.accuracy > CURRENT_LOCATION_MAX_ACCURACY_METERS) throw new CurrentLocationError("position");
  const point = { latitude: fix.latitude, longitude: fix.longitude };
  if (!isKoreanCoordinate(point)) throw new CurrentLocationError("outside");
  return point;
}

/** Reads the position once and turns it into a map-point place. Nothing is retried.
 * `isCurrent` is checked after each wait so a cancelled attempt never spends a lookup
 * and never reports a result. Errors are always `CurrentLocationError`. */
export async function findCurrentPlace({ geolocation, retry = false, resolve, isCurrent, onResolving }: {
  geolocation: Geolocation | undefined;
  retry?: boolean;
  resolve: (point: Point) => Promise<PlaceSearchResult | null>;
  isCurrent: () => boolean;
  onResolving: () => void;
}): Promise<PlaceSearchResult> {
  const point = usableFix(await readPosition(geolocation, retry ? CURRENT_LOCATION_RETRY_OPTIONS : CURRENT_LOCATION_OPTIONS));
  if (!isCurrent()) throw new CurrentLocationError("cancelled");
  onResolving();
  let place: PlaceSearchResult | null;
  try {
    place = await resolve(point);
  } catch (error) {
    throw new CurrentLocationError(error instanceof Error && error.message === "DAILY_LIMIT" ? "limit" : "lookup");
  }
  if (!isCurrent()) throw new CurrentLocationError("cancelled");
  if (!place) throw new CurrentLocationError("no-address");
  return place;
}
