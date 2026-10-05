import type { PlaceSearchResult } from "../places/search";
import type { SavedPlace } from "../places/saved";
import { isKoreanCoordinate } from "./input";
import { MEAL_DWELL_FIXED, mealDwellFixedMessage } from "./meal-dwell-failure";
import { MEAL_DWELL_MINUTES, roleAssignmentError, waypointLimits, type EditableWaypoint } from "./ordered-waypoints";
import { parseStrictRfc3339 } from "../../supabase/functions/_shared/strict-time";

// Response contract: docs/work/research/2026-10-05-restaurant-recommendation.md §3.3
// and contracts/android/restaurant-recommendation/fixtures.json.

export type MealIndex = 1 | 2;
export type SingleRejectReason = "WINDOW" | "DETOUR" | "RETURN_24H";

export type RecommendationCandidate = {
  savedPlaceId: string;
  savedPlaceRevision: number;
  displayName: string;
  placeName: string;
  address: string;
  longitude: number;
  latitude: number;
  insertion: { legIndex: number; afterPointId: string; beforePointId: string };
  single: {
    feasible: boolean;
    arrivalAt: string;
    extraDriveSeconds: number;
    returnAt: string;
    reason: SingleRejectReason | null;
  };
};

export type RecommendationMeal = {
  index: MealIndex;
  targetAt: string;
  windowStartAt: string;
  windowEndAt: string;
  dwellMinutes: number;
  candidates: RecommendationCandidate[];
};

export type RecommendationPair = {
  firstSavedPlaceId: string;
  secondSavedPlaceId: string;
  firstArrivalAt: string;
  secondArrivalAt: string;
  extraDriveSeconds: number;
  returnAt: string;
};

export type RecommendationCoverage = {
  savedRestaurants: number;
  invalidSaved: number;
  alreadyInRoute: number;
  nearRoute: number;
  evaluated: number;
  unreachable: number;
  notEvaluated: number;
  providerRequests: number;
};

export type RecommendationResponse = {
  status: "OK" | "NO_SAVED_RESTAURANTS";
  basis: { tripId: string; departureAt: string; returnAt: string; pointIds: string[]; arrivalAts: string[] };
  settings: { mealCount: 1 | 2; toleranceMinutes: ToleranceMinutes; detourLimitMinutes: number };
  meals: RecommendationMeal[];
  pairs: RecommendationPair[];
  coverage: RecommendationCoverage;
};

export type RecommendationRequest = {
  tripId: string;
  basis: { departureAt: string; returnAt: string; pointIds: string[]; arrivalAts: string[] };
  mealCount: 1 | 2;
  meals: Array<{ desiredTime: string; dwellMinutes: number }>;
  toleranceMinutes: ToleranceMinutes;
};

export type RecommendationInput = {
  mealCount: 1 | 2;
  // Meal dwell is not an input: every meal takes MEAL_DWELL_MINUTES (contract 3.0.0).
  meals: [{ desiredTime: string }, { desiredTime: string }];
  toleranceMinutes: ToleranceMinutes;
};

export const defaultRecommendationInput: RecommendationInput = {
  mealCount: 1,
  meals: [{ desiredTime: "12:00" }, { desiredTime: "18:00" }],
  toleranceMinutes: 30,
};

// `원하는 식사 시간` 앞뒤 허용 범위: ±30~±90, −/+ in 30-minute steps (§1.2).
export const toleranceOptions = [30, 60, 90] as const;
export type ToleranceMinutes = (typeof toleranceOptions)[number];

export function stepTolerance(current: ToleranceMinutes, direction: -1 | 1): ToleranceMinutes {
  const index = toleranceOptions.indexOf(current) + direction;
  return toleranceOptions[Math.min(toleranceOptions.length - 1, Math.max(0, index))];
}

// The server's fixed extra-drive cap (§1.1, contract 3.0.1). A response must
// echo exactly this value in `settings.detourLimitMinutes`; anything else is a
// contract violation, so judging and wording always use one 60-minute cap.
export const SERVER_DETOUR_CAP_MINUTES = 60;

export class RecommendationContractError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "RecommendationContractError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAVED_PLACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DESIRED_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const REJECT_REASONS: ReadonlyArray<SingleRejectReason> = ["WINDOW", "DETOUR", "RETURN_24H"];
const SEOUL_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

// The server's judgement rules (§3.2 step 8, contracts README): seconds,
// inclusive bounds, return strictly within 24 hours of departure.
type Judge = { departureMs: number; baseReturnMs: number; limitSeconds: number };

function fail(code = "INVALID_RECOMMENDATION_RESPONSE"): never {
  throw new RecommendationContractError(code);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.length > maximum) fail();
  return value;
}

function instant(value: unknown): string {
  const parsed = parseStrictRfc3339(value);
  if (!parsed) fail("INVALID_RECOMMENDATION_TIME");
  return parsed.toISOString();
}

function ms(value: string) {
  return new Date(value).getTime();
}

function parseCandidate(value: unknown, pointIds: string[]): RecommendationCandidate {
  const raw = record(value);
  const insertion = record(raw.insertion);
  const single = record(raw.single);
  if (typeof raw.savedPlaceId !== "string" || !SAVED_PLACE_ID.test(raw.savedPlaceId)) fail();
  if (
    typeof raw.longitude !== "number" || typeof raw.latitude !== "number" ||
    !Number.isFinite(raw.longitude) || !Number.isFinite(raw.latitude) ||
    !isKoreanCoordinate({ longitude: raw.longitude, latitude: raw.latitude })
  ) fail();
  const legIndex = integer(insertion.legIndex, 0, pointIds.length - 2);
  if (insertion.afterPointId !== pointIds[legIndex] || insertion.beforePointId !== pointIds[legIndex + 1]) {
    fail("INVALID_RECOMMENDATION_INSERTION");
  }
  if (typeof single.feasible !== "boolean") fail();
  const reason = single.reason;
  if (single.feasible ? reason !== null : !REJECT_REASONS.includes(reason as SingleRejectReason)) fail();
  return {
    savedPlaceId: raw.savedPlaceId,
    savedPlaceRevision: integer(raw.savedPlaceRevision, 1, Number.MAX_SAFE_INTEGER),
    displayName: text(raw.displayName, 160),
    placeName: text(raw.placeName, 160),
    address: text(raw.address, 300),
    longitude: raw.longitude,
    latitude: raw.latitude,
    insertion: { legIndex, afterPointId: pointIds[legIndex], beforePointId: pointIds[legIndex + 1] },
    single: {
      feasible: single.feasible,
      arrivalAt: instant(single.arrivalAt),
      extraDriveSeconds: integer(single.extraDriveSeconds, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
      returnAt: instant(single.returnAt),
      reason: reason as SingleRejectReason | null,
    },
  };
}

function parseMeal(value: unknown, position: number, toleranceMinutes: number, pointIds: string[]): RecommendationMeal {
  const raw = record(value);
  if (raw.index !== position + 1 || !Array.isArray(raw.candidates)) fail();
  const targetAt = instant(raw.targetAt);
  const windowStartAt = instant(raw.windowStartAt);
  const windowEndAt = instant(raw.windowEndAt);
  const tolerance = toleranceMinutes * 60_000;
  if (ms(windowStartAt) !== ms(targetAt) - tolerance || ms(windowEndAt) !== ms(targetAt) + tolerance) {
    fail("INVALID_RECOMMENDATION_WINDOW");
  }
  const candidates = raw.candidates.map((candidate) => parseCandidate(candidate, pointIds));
  if (new Set(candidates.map((candidate) => candidate.savedPlaceId)).size !== candidates.length) fail();
  return {
    index: (position + 1) as MealIndex,
    targetAt,
    windowStartAt,
    windowEndAt,
    // Contract 3.0.0: every meal takes the fixed dwell.
    dwellMinutes: integer(raw.dwellMinutes, MEAL_DWELL_MINUTES, MEAL_DWELL_MINUTES),
    candidates,
  };
}

function withinWindow(arrivalAt: string, meal: RecommendationMeal) {
  const arrival = ms(arrivalAt);
  return arrival >= ms(meal.windowStartAt) && arrival <= ms(meal.windowEndAt);
}

function within24Hours(returnAt: string, judge: Judge) {
  return ms(returnAt) - judge.departureMs < DAY_MS;
}

// A candidate must state the server's own verdict: return = base return +
// extra drive + dwell, and `reason` names the first violated rule
// (WINDOW, DETOUR, RETURN_24H) or is null when none is violated.
function checkCandidate(candidate: RecommendationCandidate, meal: RecommendationMeal, judge: Judge) {
  const { single } = candidate;
  if (ms(single.returnAt) !== judge.baseReturnMs + (single.extraDriveSeconds + meal.dwellMinutes * 60) * 1000) {
    fail("INVALID_RECOMMENDATION_CANDIDATE");
  }
  const reason: SingleRejectReason | null = !withinWindow(single.arrivalAt, meal)
    ? "WINDOW"
    : single.extraDriveSeconds > judge.limitSeconds
      ? "DETOUR"
      : !within24Hours(single.returnAt, judge) ? "RETURN_24H" : null;
  if (reason !== single.reason || single.feasible !== (reason === null)) fail("INVALID_RECOMMENDATION_CANDIDATE");
}

// A pair is listed only when both arrivals fit their windows, the combined
// extra drive fits the limit and the return (base + extra + both dwells) is
// within 24 hours.
function checkPair(pair: RecommendationPair, meals: RecommendationMeal[], judge: Judge) {
  const expectedReturn = judge.baseReturnMs + (pair.extraDriveSeconds + (meals[0].dwellMinutes + meals[1].dwellMinutes) * 60) * 1000;
  if (
    !withinWindow(pair.firstArrivalAt, meals[0]) || !withinWindow(pair.secondArrivalAt, meals[1]) ||
    pair.extraDriveSeconds > judge.limitSeconds ||
    ms(pair.returnAt) !== expectedReturn || !within24Hours(pair.returnAt, judge)
  ) fail("INVALID_RECOMMENDATION_PAIR");
  // Different legs are combined from the two single results (contracts README):
  // meal 1 arrives as alone; meal 2 is delayed by meal 1's extra drive and dwell;
  // the extra drive adds up. A same-leg pair is its own provider route, so its
  // values are not derived from the singles.
  const first = meals[0].candidates.find((candidate) => candidate.savedPlaceId === pair.firstSavedPlaceId)!;
  const second = meals[1].candidates.find((candidate) => candidate.savedPlaceId === pair.secondSavedPlaceId)!;
  if (first.insertion.legIndex < second.insertion.legIndex && (
    ms(pair.firstArrivalAt) !== ms(first.single.arrivalAt) ||
    ms(pair.secondArrivalAt) !== ms(second.single.arrivalAt) + (first.single.extraDriveSeconds + meals[0].dwellMinutes * 60) * 1000 ||
    pair.extraDriveSeconds !== first.single.extraDriveSeconds + second.single.extraDriveSeconds
  )) fail("INVALID_RECOMMENDATION_PAIR");
}

function parsePair(value: unknown, meals: RecommendationMeal[]): RecommendationPair {
  const raw = record(value);
  const first = meals[0].candidates.find((candidate) => candidate.savedPlaceId === raw.firstSavedPlaceId);
  const second = meals[1]?.candidates.find((candidate) => candidate.savedPlaceId === raw.secondSavedPlaceId);
  // A pair must name listed candidates in visiting order (same leg or a later leg).
  if (!first || !second || first.savedPlaceId === second.savedPlaceId ||
    first.insertion.legIndex > second.insertion.legIndex) fail("INVALID_RECOMMENDATION_PAIR");
  return {
    firstSavedPlaceId: first.savedPlaceId,
    secondSavedPlaceId: second.savedPlaceId,
    firstArrivalAt: instant(raw.firstArrivalAt),
    secondArrivalAt: instant(raw.secondArrivalAt),
    extraDriveSeconds: integer(raw.extraDriveSeconds, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    returnAt: instant(raw.returnAt),
  };
}

export function parseRecommendationResponse(value: unknown): RecommendationResponse {
  const raw = record(value);
  if (raw.status !== "OK" && raw.status !== "NO_SAVED_RESTAURANTS") fail();
  const basis = record(raw.basis);
  const settings = record(raw.settings);
  const coverage = record(raw.coverage);
  if (typeof basis.tripId !== "string" || !UUID.test(basis.tripId)) fail();
  if (
    !Array.isArray(basis.pointIds) || basis.pointIds.length < 2 || basis.pointIds.length > 32 ||
    !basis.pointIds.every((id) => typeof id === "string" && id.length >= 1 && id.length <= 100)
  ) fail();
  const pointIds = [...basis.pointIds as string[]];
  const departureAt = instant(basis.departureAt);
  const returnAt = instant(basis.returnAt);
  if (ms(returnAt) <= ms(departureAt)) fail();
  // Leg arrivals of the displayed route: one per leg, increasing, within the trip.
  if (!Array.isArray(basis.arrivalAts) || basis.arrivalAts.length !== pointIds.length - 1) fail();
  const arrivalAts = basis.arrivalAts.map(instant);
  if (arrivalAts.some((arrival, index) => (
    ms(arrival) <= (index === 0 ? ms(departureAt) : ms(arrivalAts[index - 1])) || ms(arrival) > ms(returnAt)
  ))) fail("INVALID_RECOMMENDATION_TIME");
  const mealCount = integer(settings.mealCount, 1, 2) as 1 | 2;
  if (!toleranceOptions.includes(settings.toleranceMinutes as ToleranceMinutes)) fail();
  const toleranceMinutes = settings.toleranceMinutes as ToleranceMinutes;
  if (settings.detourLimitMinutes !== SERVER_DETOUR_CAP_MINUTES) fail("INVALID_RECOMMENDATION_SETTINGS");
  const detourLimitMinutes = SERVER_DETOUR_CAP_MINUTES;
  if (!Array.isArray(raw.meals) || raw.meals.length !== mealCount || !Array.isArray(raw.pairs)) fail();
  const meals = raw.meals.map((meal, index) => parseMeal(meal, index, toleranceMinutes, pointIds));
  if (meals.length === 2 && ms(meals[1].targetAt) <= ms(meals[0].targetAt)) fail("INVALID_RECOMMENDATION_WINDOW");
  if (mealCount === 1 && raw.pairs.length > 0) fail("INVALID_RECOMMENDATION_PAIR");
  const pairs = raw.pairs.map((pair) => parsePair(pair, meals));
  const judge: Judge = { departureMs: ms(departureAt), baseReturnMs: ms(returnAt), limitSeconds: detourLimitMinutes * 60 };
  meals.forEach((meal) => meal.candidates.forEach((candidate) => checkCandidate(candidate, meal, judge)));
  pairs.forEach((pair) => checkPair(pair, meals, judge));
  if (new Set(pairs.map((pair) => `${pair.firstSavedPlaceId}|${pair.secondSavedPlaceId}`)).size !== pairs.length) {
    fail("INVALID_RECOMMENDATION_PAIR");
  }
  // Every listed candidate is usable alone or as a member of a listed pair (§3.3).
  meals.forEach((meal) => meal.candidates.forEach((candidate) => {
    if (candidate.single.feasible) return;
    const key = meal.index === 1 ? "firstSavedPlaceId" : "secondSavedPlaceId";
    if (!pairs.some((pair) => pair[key] === candidate.savedPlaceId)) fail("INVALID_RECOMMENDATION_CANDIDATE");
  }));
  const counts = {
    savedRestaurants: integer(coverage.savedRestaurants, 0, 1000),
    invalidSaved: integer(coverage.invalidSaved, 0, 1000),
    alreadyInRoute: integer(coverage.alreadyInRoute, 0, 1000),
    nearRoute: integer(coverage.nearRoute, 0, 1000),
    evaluated: integer(coverage.evaluated, 0, 1000),
    unreachable: integer(coverage.unreachable, 0, 1000),
    notEvaluated: integer(coverage.notEvaluated, 0, 1000),
    providerRequests: integer(coverage.providerRequests, 0, 14),
  };
  if (raw.status === "NO_SAVED_RESTAURANTS" && (
    meals.some((meal) => meal.candidates.length > 0) || pairs.length > 0 || counts.providerRequests !== 0
  )) fail();
  return {
    status: raw.status,
    basis: { tripId: basis.tripId, departureAt, returnAt, pointIds, arrivalAts },
    settings: { mealCount, toleranceMinutes, detourLimitMinutes },
    meals,
    pairs,
    coverage: counts,
  };
}

type BasisLike = { departureAt: string; returnAt: string; pointIds: string[]; arrivalAts: string[] };

// Same displayed route: instants compared, IDs and leg arrivals in order.
export function sameBasis(left: BasisLike, right: BasisLike) {
  return ms(left.departureAt) === ms(right.departureAt) &&
    ms(left.returnAt) === ms(right.returnAt) &&
    left.pointIds.length === right.pointIds.length &&
    left.pointIds.every((id, index) => id === right.pointIds[index]) &&
    left.arrivalAts.length === right.arrivalAts.length &&
    left.arrivalAts.every((arrival, index) => ms(arrival) === ms(right.arrivalAts[index]));
}

// The response must answer exactly the request that was sent, including each
// meal's target (same rule as the server) and its ± tolerance window.
export function responseMatchesRequest(response: RecommendationResponse, request: RecommendationRequest) {
  const toleranceMs = request.toleranceMinutes * 60_000;
  return response.basis.tripId === request.tripId &&
    sameBasis(response.basis, request.basis) &&
    response.settings.mealCount === request.mealCount &&
    response.settings.toleranceMinutes === request.toleranceMinutes &&
    response.meals.length === request.meals.length &&
    response.meals.every((meal, index) => {
      const asked = request.meals[index];
      const target = mealTargetAt(request.basis.departureAt, request.toleranceMinutes, asked.desiredTime)?.getTime();
      return target !== undefined && meal.dwellMinutes === asked.dwellMinutes &&
        ms(meal.targetAt) === target &&
        ms(meal.windowStartAt) === target - toleranceMs &&
        ms(meal.windowEndAt) === target + toleranceMs;
    });
}

// ---------------------------------------------------------------------------
// Request building and pre-request checks

type RouteBasisSource = {
  returnAt: string;
  segments: Array<{ from: { id: string }; to: { id: string }; departureAt?: string; arrivalAt?: string }>;
};

export function recommendationBasis(route: RouteBasisSource) {
  const first = route.segments[0];
  if (!first?.departureAt || route.segments.some((segment) => !segment.arrivalAt)) return null;
  return {
    departureAt: first.departureAt,
    returnAt: route.returnAt,
    pointIds: [first.from.id, ...route.segments.map((segment) => segment.to.id)],
    arrivalAts: route.segments.map((segment) => segment.arrivalAt!),
  };
}

export function buildRecommendationRequest(tripId: string, route: RouteBasisSource, input: RecommendationInput): RecommendationRequest | null {
  const basis = recommendationBasis(route);
  if (!basis) return null;
  return {
    tripId,
    basis,
    mealCount: input.mealCount,
    meals: input.meals.slice(0, input.mealCount).map((meal) => ({ desiredTime: meal.desiredTime, dwellMinutes: MEAL_DWELL_MINUTES })),
    toleranceMinutes: input.toleranceMinutes,
  };
}

// Same rule as the server: the first Seoul wall-clock occurrence of the desired
// time at or after (departure − tolerance). Seoul has no daylight saving time.
export function mealTargetAt(departureAt: string, toleranceMinutes: number, desiredTime: string): Date | null {
  const match = DESIRED_TIME.exec(desiredTime);
  const departure = parseStrictRfc3339(departureAt);
  if (!match || !departure) return null;
  const localReference = departure.getTime() - toleranceMinutes * 60_000 + SEOUL_OFFSET_MS;
  let local = Math.floor(localReference / DAY_MS) * DAY_MS + (Number(match[1]) * 60 + Number(match[2])) * 60_000;
  if (local < localReference) local += DAY_MS;
  return new Date(local - SEOUL_OFFSET_MS);
}

const TEN_MINUTES_MS = 10 * 60_000;

function seoulDay(instantMs: number) {
  return Math.floor((instantMs + SEOUL_OFFSET_MS) / DAY_MS);
}

// Seoul wall clock of an instant rounded to the nearest 10 minutes (always a
// valid choice for the 5-minute minute picker).
function roundedSeoulClock(instantMs: number) {
  return seoulClock(new Date(Math.round(instantMs / TEN_MINUTES_MS) * TEN_MINUTES_MS).toISOString());
}

// Route-based default meal times (§4.1 A, judged with the default ±30 window).
// Each step is checked on the targets mealTargetAt resolves (an HH:MM alone can
// land on another date), falling back until meal 2 targets a later moment:
// 1. meal 1 = 12:00 when its target lies within [departure, return], else one
//    third of the way; meal 2 = 18:00 when inside and after meal 1, else two
//    thirds of the way (thirds rounded to 10 minutes);
// 2. otherwise both thirds;
// 3. otherwise meal 2 = meal 1's target + 10 minutes.
// Thirds of a route shorter than 24 hours always resolve to their own moment,
// so step 3 settles every such route; a failure is reported, and the dialog
// still shows the ordinary meal-order input error.
export function defaultMealTimes(departureAt: string, returnAt: string, toleranceMinutes = defaultRecommendationInput.toleranceMinutes): [string, string] {
  const start = ms(departureAt);
  const end = ms(returnAt);
  const target = (time: string) => mealTargetAt(departureAt, toleranceMinutes, time)!.getTime();
  const inside = (time: string) => target(time) >= start && target(time) <= end;
  const ordered = ([first, second]: [string, string]) => target(second) > target(first);
  const thirds: [string, string] = [roundedSeoulClock(start + (end - start) / 3), roundedSeoulClock(start + (2 * (end - start)) / 3)];
  const first = inside("12:00") ? "12:00" : thirds[0];
  let pair: [string, string] = [first, inside("18:00") && target("18:00") > target(first) ? "18:00" : thirds[1]];
  if (!ordered(pair)) pair = thirds;
  if (!ordered(pair)) pair = [pair[0], seoulClock(new Date(target(pair[0]) + TEN_MINUTES_MS).toISOString())];
  if (!ordered(pair)) console.error("defaultMealTimes: no ordered default meal times", { departureAt, returnAt });
  return pair;
}

export function recommendationDefaults(departureAt: string, returnAt: string): RecommendationInput {
  const [first, second] = defaultMealTimes(departureAt, returnAt);
  return { ...defaultRecommendationInput, meals: [{ desiredTime: first }, { desiredTime: second }] };
}

// The desired time lands on a later Seoul date than the departure (§4.1 B).
export function isNextDayMeal(departureAt: string, toleranceMinutes: number, desiredTime: string) {
  const target = mealTargetAt(departureAt, toleranceMinutes, desiredTime);
  return target !== null && seoulDay(target.getTime()) > seoulDay(ms(departureAt));
}

export function recommendationInputError(input: RecommendationInput, departureAt: string, waypointCount: number): string | null {
  const meals = input.meals.slice(0, input.mealCount);
  if (meals.some((meal) => !DESIRED_TIME.test(meal.desiredTime))) return "원하는 식사 시간을 선택해 주세요.";
  if (!toleranceOptions.includes(input.toleranceMinutes)) return "원하는 식사 시간 허용 범위를 골라 주세요.";
  if (input.mealCount === 2) {
    const first = mealTargetAt(departureAt, input.toleranceMinutes, meals[0].desiredTime);
    const second = mealTargetAt(departureAt, input.toleranceMinutes, meals[1].desiredTime);
    if (!first || !second || second.getTime() <= first.getTime()) return "식사 2의 원하는 식사 시간은 식사 1보다 늦어야 해요.";
  }
  if (waypointCount + input.mealCount > waypointLimits.total) return "경유지가 30개를 넘어 식당을 추가할 수 없어요.";
  return null;
}

// ---------------------------------------------------------------------------
// Failure classification (HTTP body `code`, never provider text)

export type RecommendationFailureCode =
  | "RECOMMENDATION_INPUT_INVALID"
  | "AUTH_REQUIRED"
  | "MEMBERSHIP_REQUIRED"
  | "RECOMMENDATION_ROUTE_STALE"
  | "RECOMMENDATION_WAYPOINT_LIMIT"
  | "RECOMMENDATION_BUDGET_OR_CONFIG"
  | "RECOMMENDATION_PROVIDER_TEMPORARY"
  | "RECOMMENDATION_RESPONSE_INVALID"
  | "RECOMMENDATION_FAILED"
  | "MEAL_DWELL_FIXED"
  | "CLIENT_REQUEST_TIMEOUT";

// `serverMessage` is kept only for MEAL_DWELL_FIXED, whose guidance is shown as-is.
export type RecommendationFailure = { code: RecommendationFailureCode; status: number | null; serverMessage?: string };

const failureCodes = new Set<RecommendationFailureCode>([
  "RECOMMENDATION_INPUT_INVALID", "AUTH_REQUIRED", "MEMBERSHIP_REQUIRED", "RECOMMENDATION_ROUTE_STALE",
  "RECOMMENDATION_WAYPOINT_LIMIT", "RECOMMENDATION_BUDGET_OR_CONFIG", "RECOMMENDATION_PROVIDER_TEMPORARY",
  "RECOMMENDATION_RESPONSE_INVALID", "RECOMMENDATION_FAILED", MEAL_DWELL_FIXED,
]);

export async function readRecommendationFailure(error: unknown): Promise<RecommendationFailure> {
  if (error instanceof Error && error.message === "CLIENT_REQUEST_TIMEOUT") return { code: "CLIENT_REQUEST_TIMEOUT", status: null };
  const context = error && typeof error === "object" ? (error as { context?: unknown }).context : undefined;
  if (!(context instanceof Response)) return { code: "RECOMMENDATION_FAILED", status: null };
  try {
    const body = await context.clone().json() as { code?: unknown };
    const code = typeof body.code === "string" && failureCodes.has(body.code as RecommendationFailureCode)
      ? body.code as RecommendationFailureCode
      : "RECOMMENDATION_FAILED";
    const serverMessage = code === MEAL_DWELL_FIXED ? mealDwellFixedMessage(body) : null;
    return serverMessage ? { code, status: context.status, serverMessage } : { code, status: context.status };
  } catch {
    return { code: "RECOMMENDATION_FAILED", status: context.status };
  }
}

export function isRouteStaleFailure(failure: RecommendationFailure) {
  return failure.code === "RECOMMENDATION_ROUTE_STALE";
}

// Only the exhausted daily budget (HTTP 429) makes "close" the primary action.
export function isDailyBudgetFailure(failure: RecommendationFailure) {
  return failure.code === "RECOMMENDATION_BUDGET_OR_CONFIG" && failure.status === 429;
}

export function recommendationFailureMessage(failure: RecommendationFailure) {
  if (isDailyBudgetFailure(failure)) return "오늘의 무료 경로 계산 한도를 모두 사용했습니다. 내일 다시 시도해 주세요.";
  if (failure.code === MEAL_DWELL_FIXED && failure.serverMessage) return failure.serverMessage;
  return {
    RECOMMENDATION_INPUT_INVALID: "추천 조건을 확인한 뒤 다시 시도해 주세요.",
    AUTH_REQUIRED: "로그인 상태를 확인한 뒤 다시 시도해 주세요.",
    MEMBERSHIP_REQUIRED: "서비스 이용 권한을 확인한 뒤 다시 시도해 주세요.",
    RECOMMENDATION_ROUTE_STALE: "경로가 바뀌었습니다. 경로를 다시 계산해 주세요.",
    RECOMMENDATION_WAYPOINT_LIMIT: "경유지가 30개를 넘어 식당을 추가할 수 없어요.",
    RECOMMENDATION_BUDGET_OR_CONFIG: "경로 API 사용 한도 또는 서비스 설정을 확인해야 합니다. 관리자에게 문의해 주세요.",
    RECOMMENDATION_PROVIDER_TEMPORARY: "경로 공급자가 일시적으로 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.",
    RECOMMENDATION_RESPONSE_INVALID: "추천 결과를 안전하게 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
    RECOMMENDATION_FAILED: "추천 계산을 완료하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
    CLIENT_REQUEST_TIMEOUT: "응답이 늦어 추천을 받지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.",
    MEAL_DWELL_FIXED: "식사 시간은 45분으로 바뀌었어요. 화면을 새로고침한 뒤 다시 시도해 주세요.",
  }[failure.code];
}

// ---------------------------------------------------------------------------
// Selection (§4.1)

export type RecommendationSelection = Partial<Record<MealIndex, string>>;

export type CandidateRowState = {
  candidate: RecommendationCandidate;
  selected: boolean;
  selectable: boolean;
  combined: boolean;
  // Not feasible alone but a member of at least one listed pair for this meal:
  // selectable, and only confirmable together with a pairing other meal.
  pairOnly: boolean;
  arrivalAt: string;
  extraDriveSeconds: number;
  reason: string | null;
};

// 과/와 by the final syllable: digits are read in Korean (1 일, 2 이).
export function andParticle(word: string) {
  const last = word.trim().at(-1) ?? "";
  const code = last.charCodeAt(0);
  const digitHasFinal: Record<string, boolean> = { "0": true, "1": true, "2": false, "3": true, "4": false, "5": false, "6": true, "7": true, "8": true, "9": false };
  const hasFinal = code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 !== 0 : digitHasFinal[last] ?? false;
  return hasFinal ? "과" : "와";
}

export function withAnd(word: string) {
  return `${word}${andParticle(word)}`;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortCandidates(meal: RecommendationMeal) {
  const target = ms(meal.targetAt);
  return [...meal.candidates].sort((left, right) => (
    left.single.extraDriveSeconds - right.single.extraDriveSeconds ||
    Math.abs(ms(left.single.arrivalAt) - target) - Math.abs(ms(right.single.arrivalAt) - target) ||
    compareText(left.displayName, right.displayName) ||
    compareText(left.savedPlaceId, right.savedPlaceId)
  ));
}

// Extra drive totals of the listed pairs this candidate joins as `mealIndex`.
function pairTotals(response: RecommendationResponse, mealIndex: MealIndex, savedPlaceId: string) {
  const key = mealIndex === 1 ? "firstSavedPlaceId" : "secondSavedPlaceId";
  return response.pairs.filter((pair) => pair[key] === savedPlaceId).map((pair) => pair.extraDriveSeconds);
}

function findPair(response: RecommendationResponse, first: string, second: string) {
  return response.pairs.find((pair) => pair.firstSavedPlaceId === first && pair.secondSavedPlaceId === second) ?? null;
}

export function candidateRows(response: RecommendationResponse, selection: RecommendationSelection, mealIndex: MealIndex): CandidateRowState[] {
  const meal = response.meals[mealIndex - 1];
  if (!meal) return [];
  const otherIndex: MealIndex = mealIndex === 1 ? 2 : 1;
  const other = response.settings.mealCount === 2 ? selection[otherIndex] : undefined;
  const rows: CandidateRowState[] = sortCandidates(meal).map((candidate) => {
    const selected = selection[mealIndex] === candidate.savedPlaceId;
    if (other) {
      if (candidate.savedPlaceId === other) {
        return {
          candidate, selected, selectable: false, combined: false, pairOnly: false,
          arrivalAt: candidate.single.arrivalAt,
          extraDriveSeconds: candidate.single.extraDriveSeconds,
          reason: `식사 ${otherIndex}에서 고른 식당이에요`,
        };
      }
      const pair = mealIndex === 1 ? findPair(response, candidate.savedPlaceId, other) : findPair(response, other, candidate.savedPlaceId);
      if (pair) {
        return {
          candidate, selected, selectable: true, combined: true, pairOnly: false,
          arrivalAt: mealIndex === 1 ? pair.firstArrivalAt : pair.secondArrivalAt,
          extraDriveSeconds: pair.extraDriveSeconds,
          reason: null,
        };
      }
      return {
        candidate, selected, selectable: false, combined: false, pairOnly: false,
        arrivalAt: candidate.single.arrivalAt,
        extraDriveSeconds: candidate.single.extraDriveSeconds,
        reason: `${withAnd(`식사 ${otherIndex}`)} 함께 가면 시간이 맞지 않거나 주행이 ${durationLabel(response.settings.detourLimitMinutes)} 넘게 늘어나요`,
      };
    }
    const pairOnly = !candidate.single.feasible && pairTotals(response, mealIndex, candidate.savedPlaceId).length > 0;
    return {
      candidate, selected, selectable: candidate.single.feasible || pairOnly, combined: false, pairOnly,
      arrivalAt: candidate.single.arrivalAt,
      extraDriveSeconds: candidate.single.extraDriveSeconds,
      reason: pairOnly
        ? `${withAnd(`식사 ${otherIndex}`)} 함께 갈 때만 가능해요`
        : candidate.single.feasible ? null : `식사 ${otherIndex} 식당을 함께 골라야 가능해요`,
    };
  });
  if (!other) {
    // Rows feasible alone keep their single order; pair-only rows follow,
    // ordered by their smallest pair total (then the single-order ties).
    const minPair = (row: CandidateRowState) => Math.min(...pairTotals(response, mealIndex, row.candidate.savedPlaceId));
    const alone = rows.filter((row) => !row.pairOnly);
    const pairOnlyRows = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.pairOnly)
      .sort((left, right) => minPair(left.row) - minPair(right.row) || left.index - right.index)
      .map(({ row }) => row);
    return [...alone, ...pairOnlyRows];
  }
  // With the other meal chosen, rows show pair values: order the possible rows
  // by the combined extra drive they display (then arrival gap, name, ID), and
  // keep the rows that cannot pair after them in their single-value order.
  const target = ms(meal.targetAt);
  const possible = rows.filter((row) => row.combined).sort((left, right) => (
    left.extraDriveSeconds - right.extraDriveSeconds ||
    Math.abs(ms(left.arrivalAt) - target) - Math.abs(ms(right.arrivalAt) - target) ||
    compareText(left.candidate.displayName, right.candidate.displayName) ||
    compareText(left.candidate.savedPlaceId, right.candidate.savedPlaceId)
  ));
  return [...possible, ...rows.filter((row) => !row.combined)];
}

// Selecting a row toggles it. A row that is not selectable cannot be chosen,
// but an already chosen row can always be cleared.
export function toggleSelection(response: RecommendationResponse, selection: RecommendationSelection, mealIndex: MealIndex, savedPlaceId: string): RecommendationSelection {
  if (selection[mealIndex] === savedPlaceId) {
    const next = { ...selection };
    delete next[mealIndex];
    return next;
  }
  const row = candidateRows(response, selection, mealIndex).find((item) => item.candidate.savedPlaceId === savedPlaceId);
  if (!row?.selectable) return selection;
  return { ...selection, [mealIndex]: savedPlaceId };
}

export type ResolvedSelection = {
  items: Array<{ mealIndex: MealIndex; candidate: RecommendationCandidate; dwellMinutes: number }>;
  extraDriveSeconds: number;
  returnAt: string;
};

// Valid: exactly one chosen candidate that is feasible alone, or two chosen
// candidates that form a listed pair.
export function resolveSelection(response: RecommendationResponse, selection: RecommendationSelection): ResolvedSelection | null {
  const items = ([1, 2] as const).flatMap((mealIndex) => {
    const id = selection[mealIndex];
    const meal = response.meals[mealIndex - 1];
    const candidate = id && meal ? meal.candidates.find((item) => item.savedPlaceId === id) : undefined;
    if (id && !candidate) return [null];
    return candidate ? [{ mealIndex, candidate, dwellMinutes: meal.dwellMinutes }] : [];
  });
  if (items.length === 0 || items.some((item) => item === null)) return null;
  const chosen = items as ResolvedSelection["items"];
  if (chosen.length === 1) {
    const { single } = chosen[0].candidate;
    return single.feasible ? { items: chosen, extraDriveSeconds: single.extraDriveSeconds, returnAt: single.returnAt } : null;
  }
  const pair = findPair(response, chosen[0].candidate.savedPlaceId, chosen[1].candidate.savedPlaceId);
  return pair ? { items: chosen, extraDriveSeconds: pair.extraDriveSeconds, returnAt: pair.returnAt } : null;
}

// Why the current selection cannot be confirmed yet: a pair-only restaurant
// chosen without its partner asks for the other meal.
export function selectionGuidance(response: RecommendationResponse, selection: RecommendationSelection): string | null {
  if (resolveSelection(response, selection)) return null;
  const chosen = ([1, 2] as const).filter((mealIndex) => selection[mealIndex]);
  if (chosen.length !== 1) return null;
  const mealIndex = chosen[0];
  const candidate = response.meals[mealIndex - 1]?.candidates.find((item) => item.savedPlaceId === selection[mealIndex]);
  return candidate && !candidate.single.feasible ? `식사 ${mealIndex === 1 ? 2 : 1}도 함께 골라 주세요` : null;
}

// ---------------------------------------------------------------------------
// Confirmation (§4.2): re-check the live plan, then insert after leg i.

export type ApplyRecommendationInput = {
  originId: string;
  destinationId: string;
  waypoints: EditableWaypoint[];
  savedPlaces: SavedPlace[];
  savedPlacesReady: boolean;
  response: RecommendationResponse;
  selection: RecommendationSelection;
  createId: () => string;
};

export type ApplyRecommendationResult =
  | { ok: true; waypoints: EditableWaypoint[]; added: number }
  | { ok: false; reason: "SELECTION" | "ROUTE_CHANGED" | "SAVED_PLACE_CHANGED" | "LIMIT" };

export function applyRecommendedMeals(input: ApplyRecommendationInput): ApplyRecommendationResult {
  const resolved = resolveSelection(input.response, input.selection);
  if (!resolved) return { ok: false, reason: "SELECTION" };
  const pointIds = [input.originId, ...input.waypoints.map((waypoint) => waypoint.id), input.destinationId];
  const basisIds = input.response.basis.pointIds;
  if (pointIds.length !== basisIds.length || pointIds.some((id, index) => id !== basisIds[index])) {
    return { ok: false, reason: "ROUTE_CHANGED" };
  }
  const additions: Array<{ legIndex: number; waypoint: EditableWaypoint }> = [];
  for (const item of resolved.items) {
    const { insertion } = item.candidate;
    if (pointIds[insertion.legIndex] !== insertion.afterPointId || pointIds[insertion.legIndex + 1] !== insertion.beforePointId) {
      return { ok: false, reason: "ROUTE_CHANGED" };
    }
    const saved = input.savedPlacesReady
      ? input.savedPlaces.find((place) => place.id === item.candidate.savedPlaceId)
      : undefined;
    if (
      !saved || saved.revision !== item.candidate.savedPlaceRevision ||
      saved.place.longitude !== item.candidate.longitude || saved.place.latitude !== item.candidate.latitude
    ) return { ok: false, reason: "SAVED_PLACE_CHANGED" };
    additions.push({
      legIndex: insertion.legIndex,
      waypoint: { id: input.createId(), role: "meal", dwellMinutes: item.dwellMinutes, place: { ...saved.place } as PlaceSearchResult },
    });
  }
  let checked = input.waypoints;
  for (const addition of additions) {
    if (roleAssignmentError(checked, "meal")) return { ok: false, reason: "LIMIT" };
    checked = [...checked, addition.waypoint];
  }
  // Leg i runs from point i to point i + 1, so a stop on leg i becomes
  // waypoint array index i. Meal 1 precedes meal 2 on the same leg.
  const next: EditableWaypoint[] = [];
  for (let index = 0; index <= input.waypoints.length; index += 1) {
    for (const addition of additions) if (addition.legIndex === index) next.push(addition.waypoint);
    if (index < input.waypoints.length) next.push(input.waypoints[index]);
  }
  return { ok: true, waypoints: next, added: additions.length };
}

// ---------------------------------------------------------------------------
// Display helpers (Seoul wall clock; fixed +09:00)

export function seoulClock(iso: string) {
  const local = new Date(ms(iso) + SEOUL_OFFSET_MS);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}

export function seoulDateTime(iso: string) {
  const local = new Date(ms(iso) + SEOUL_OFFSET_MS);
  return `${local.getUTCMonth() + 1}월 ${local.getUTCDate()}일 ${seoulClock(iso)}`;
}

// "주행 +12분" (pairs: "두 곳 합계 주행 +22분"). The sign is kept: a rounded
// zero is "±0분" and a negative value (traffic-model difference) "−3분".
export function extraDriveLabel(seconds: number, combined = false) {
  const minutes = Math.round(seconds / 60);
  const sign = minutes > 0 ? "+" : minutes < 0 ? "−" : "±";
  return `${combined ? "두 곳 합계 " : ""}주행 ${sign}${Math.abs(minutes)}분`;
}

// Screen-reader wording: "추가 주행 12분" / "추가 주행 0분" / "주행 3분 줄어듦".
export function extraDriveSpoken(seconds: number, combined = false) {
  const minutes = Math.round(seconds / 60);
  const text = minutes < 0 ? `주행 ${Math.abs(minutes)}분 줄어듦` : `추가 주행 ${minutes}분`;
  return `${combined ? "두 곳 합계 " : ""}${text}`;
}

export function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest}분` : rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}
