// Trusted write boundaries (plan-route, save-collection, recommend-restaurants)
// refuse a meal dwell other than 45 minutes with HTTP 400
// `{ error: "<update guidance>", code: "MEAL_DWELL_FIXED" }` (PLAN-003 amendment).
// Only for this code is the server's own guidance shown as-is.
export const MEAL_DWELL_FIXED = "MEAL_DWELL_FIXED";

const MAX_MESSAGE_LENGTH = 200;

export function mealDwellFixedMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const { code, error } = body as { code?: unknown; error?: unknown };
  if (code !== MEAL_DWELL_FIXED || typeof error !== "string") return null;
  const message = error.trim();
  // C0, DEL and C1 control characters (U+0080–U+009F, e.g. NEL U+0085) are rejected.
  return message && message.length <= MAX_MESSAGE_LENGTH && !/[\u0000-\u001f\u007f-\u009f]/.test(message) ? message : null;
}

export async function readMealDwellFixedMessage(error: unknown): Promise<string | null> {
  const context = error && typeof error === "object" ? (error as { context?: unknown }).context : undefined;
  if (!(context instanceof Response)) return null;
  try {
    return mealDwellFixedMessage(await context.clone().json());
  } catch {
    return null;
  }
}
