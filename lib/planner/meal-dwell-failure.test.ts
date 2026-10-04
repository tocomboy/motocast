import { describe, expect, it } from "vitest";

import { mealDwellFixedMessage, readMealDwellFixedMessage } from "./meal-dwell-failure";

const guidance = "식사 시간은 45분으로 바뀌었어요. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.";
const httpError = (body: unknown, status = 400) => ({ context: new Response(typeof body === "string" ? body : JSON.stringify(body), { status }) });

describe("fixed meal dwell refusal", () => {
  it("returns the server guidance only for MEAL_DWELL_FIXED", async () => {
    await expect(readMealDwellFixedMessage(httpError({ error: guidance, code: "MEAL_DWELL_FIXED" }))).resolves.toBe(guidance);
    await expect(readMealDwellFixedMessage(httpError({ error: "server detail", code: "UNVERIFIED_PLACE" }))).resolves.toBeNull();
    await expect(readMealDwellFixedMessage(httpError({ error: guidance }))).resolves.toBeNull();
  });

  it("rejects unusable guidance and non-HTTP failures", async () => {
    expect(mealDwellFixedMessage({ error: 42, code: "MEAL_DWELL_FIXED" })).toBeNull();
    expect(mealDwellFixedMessage({ error: "   ", code: "MEAL_DWELL_FIXED" })).toBeNull();
    expect(mealDwellFixedMessage({ error: "a".repeat(201), code: "MEAL_DWELL_FIXED" })).toBeNull();
    expect(mealDwellFixedMessage({ error: "줄\n바꿈", code: "MEAL_DWELL_FIXED" })).toBeNull();
    await expect(readMealDwellFixedMessage(httpError("not json"))).resolves.toBeNull();
    await expect(readMealDwellFixedMessage(new Error("CLIENT_REQUEST_TIMEOUT"))).resolves.toBeNull();
    await expect(readMealDwellFixedMessage(true)).resolves.toBeNull();
  });
});
