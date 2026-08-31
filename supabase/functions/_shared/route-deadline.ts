import { parseStrictRfc3339, seoulCalendarDate } from "./strict-time.ts";

const MAX_RIDE_DURATION_MS = 24 * 60 * 60_000;

export function assertRideUnder24Hours(departureAt: string, returnAt: string) {
  const departure = parseStrictRfc3339(departureAt);
  const returned = parseStrictRfc3339(returnAt);
  if (
    !departure || !returned ||
    returned.getTime() <= departure.getTime() ||
    returned.getTime() - departure.getTime() >= MAX_RIDE_DURATION_MS
  ) {
    throw new Error("ROUTE_EXCEEDS_24_HOURS");
  }
}

export function legacyScheduleBoundary(departureAt: string) {
  const departure = parseStrictRfc3339(departureAt);
  if (!departure) throw new Error("INVALID_ROUTE_TIME");
  const boundary = new Date(`${seoulCalendarDate(departure)}T23:59:59.999+09:00`);
  if (boundary.getTime() <= departure.getTime()) throw new Error("INVALID_ROUTE_TIME");
  return boundary.toISOString();
}
