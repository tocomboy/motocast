import { MEAL_DWELL_FIXED, MEAL_DWELL_MINUTES } from "./meal-dwell.ts";
import { parseStrictRfc3339 } from "./strict-time.ts";

export type RecommendationMealRequest = { desiredTime: string; dwellMinutes: number };

export type RecommendationRequest = {
  tripId: string;
  basis: { departureAt: string; returnAt: string; pointIds: string[]; arrivalAts: string[] };
  mealCount: 1 | 2;
  meals: RecommendationMealRequest[];
  toleranceMinutes: 30 | 60 | 90;
  // Present only on a v2 request (shared folders, issue #124 contract §7.1).
  contractVersion?: 2;
};

export type MealTarget = {
  index: number;
  targetAt: Date;
  windowStartAt: Date;
  windowEndAt: Date;
  dwellMinutes: number;
};

const REQUEST_KEYS = ["basis", "mealCount", "meals", "toleranceMinutes", "tripId"];
const REQUEST_V2_KEYS = ["basis", "contractVersion", "mealCount", "meals", "toleranceMinutes", "tripId"];
// Meal-time window choices (minutes before/after the desired time), PLAN-005 amendment.
export const TOLERANCE_CHOICES = [30, 60, 90] as const;
const BASIS_KEYS = ["arrivalAts", "departureAt", "pointIds", "returnAt"];
const MEAL_KEYS = ["desiredTime", "dwellMinutes"];
const TRIP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DESIRED_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SEOUL_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

function invalid(): never {
  throw new Error("INVALID_RECOMMENDATION_REQUEST");
}

function exactRecord(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const actual = Object.keys(value).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) invalid();
  return value as Record<string, unknown>;
}

function integerIn(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) invalid();
  return value;
}

function toleranceChoice(value: unknown): RecommendationRequest["toleranceMinutes"] {
  if (!TOLERANCE_CHOICES.some((choice) => choice === value)) invalid();
  return value as RecommendationRequest["toleranceMinutes"];
}

// Seoul has no daylight saving time, so a fixed +09:00 offset is exact.
function firstSeoulTimeAtOrAfter(reference: Date, desiredTime: string): Date {
  const [, hourText, minuteText] = DESIRED_TIME.exec(desiredTime)!;
  const localReference = reference.getTime() + SEOUL_OFFSET_MS;
  const localDayStart = Math.floor(localReference / DAY_MS) * DAY_MS;
  let local = localDayStart + (Number(hourText) * 60 + Number(minuteText)) * 60_000;
  if (local < localReference) local += DAY_MS;
  return new Date(local - SEOUL_OFFSET_MS);
}

export function parseRecommendationRequest(value: unknown): RecommendationRequest {
  // v2 is the v1 key set plus `contractVersion: 2`; any other version value is invalid.
  const isV2 = !!value && typeof value === "object" && !Array.isArray(value) && "contractVersion" in value;
  const body = exactRecord(value, isV2 ? REQUEST_V2_KEYS : REQUEST_KEYS);
  if (isV2 && body.contractVersion !== 2) invalid();
  if (typeof body.tripId !== "string" || !TRIP_ID.test(body.tripId)) invalid();

  const basis = exactRecord(body.basis, BASIS_KEYS);
  const departure = parseStrictRfc3339(basis.departureAt);
  const returned = parseStrictRfc3339(basis.returnAt);
  if (!departure || !returned || returned.getTime() <= departure.getTime()) invalid();
  if (
    !Array.isArray(basis.pointIds) || basis.pointIds.length < 2 || basis.pointIds.length > 32 ||
    !basis.pointIds.every((id) => typeof id === "string" && id.length >= 1 && id.length <= 100)
  ) invalid();
  // One stored arrival per leg binds intermediate dwell changes to the basis too.
  if (!Array.isArray(basis.arrivalAts) || basis.arrivalAts.length !== basis.pointIds.length - 1) invalid();
  const arrivals = basis.arrivalAts.map((value) => parseStrictRfc3339(value) ?? invalid());

  const mealCount = integerIn(body.mealCount, 1, 2) as 1 | 2;
  if (!Array.isArray(body.meals) || body.meals.length !== mealCount) invalid();
  const meals = body.meals.map((value) => {
    const meal = exactRecord(value, MEAL_KEYS);
    if (typeof meal.desiredTime !== "string" || !DESIRED_TIME.test(meal.desiredTime)) invalid();
    return { desiredTime: meal.desiredTime, dwellMinutes: integerIn(meal.dwellMinutes, 1, 1440) };
  });

  const request: RecommendationRequest = {
    tripId: body.tripId,
    basis: {
      departureAt: departure.toISOString(),
      returnAt: returned.toISOString(),
      pointIds: [...basis.pointIds as string[]],
      arrivalAts: arrivals.map((arrival) => arrival.toISOString()),
    },
    mealCount,
    meals,
    toleranceMinutes: toleranceChoice(body.toleranceMinutes),
    ...(isV2 ? { contractVersion: 2 as const } : {}),
  };
  // Every format, range and meal-order error wins over the dwell policy, so only an
  // otherwise valid request from an outdated client gets the update guidance.
  mealTargets(request);
  if (meals.some((meal) => meal.dwellMinutes !== MEAL_DWELL_MINUTES)) throw new Error(MEAL_DWELL_FIXED);
  return request;
}

// Each target is the first Seoul wall-clock occurrence of the desired time at
// or after (departure − tolerance). The second meal must follow the first.
export function mealTargets(request: RecommendationRequest): MealTarget[] {
  const departure = new Date(request.basis.departureAt);
  const reference = new Date(departure.getTime() - request.toleranceMinutes * 60_000);
  const toleranceMs = request.toleranceMinutes * 60_000;
  const targets = request.meals.map((meal, index) => {
    const targetAt = firstSeoulTimeAtOrAfter(reference, meal.desiredTime);
    return {
      index: index + 1,
      targetAt,
      windowStartAt: new Date(targetAt.getTime() - toleranceMs),
      windowEndAt: new Date(targetAt.getTime() + toleranceMs),
      dwellMinutes: meal.dwellMinutes,
    };
  });
  if (targets.length === 2 && targets[1].targetAt.getTime() <= targets[0].targetAt.getTime()) invalid();
  return targets;
}
