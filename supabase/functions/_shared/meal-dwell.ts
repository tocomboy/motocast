// PLAN-003 amendment (2026-10-05): every meal occurrence (and legacy lunch/dinner)
// uses a fixed 45-minute dwell. Trusted write boundaries reject any other meal dwell
// before budget, provider or storage work so an outdated client is told to update.
// Stored collections, trips and immutable shares are read unchanged.
export const MEAL_DWELL_MINUTES = 45;
export const MEAL_DWELL_FIXED = "MEAL_DWELL_FIXED";
export const MEAL_DWELL_FIXED_MESSAGE = "식사 시간은 45분으로 바뀌었어요. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.";

const MEAL_ROLES = new Set(["meal", "lunch", "dinner"]);

export function isMealDwellError(error: unknown) {
  return error instanceof Error && error.message === MEAL_DWELL_FIXED;
}

export function assertFixedMealDwell(points: ReadonlyArray<{ stopRole?: string; dwellMinutes: number }>) {
  if (points.some((point) => MEAL_ROLES.has(String(point.stopRole)) && point.dwellMinutes !== MEAL_DWELL_MINUTES)) {
    throw new Error(MEAL_DWELL_FIXED);
  }
}
