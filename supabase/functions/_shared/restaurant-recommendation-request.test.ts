import { describe, expect, it } from "vitest";

import fixture from "../../../contracts/android/restaurant-recommendation/fixtures.json";
import { mealTargets, parseRecommendationRequest } from "./restaurant-recommendation-request";

type RequestCase = {
  id: string;
  input: unknown;
  expected?: { request: unknown; targets: Array<{ targetAt: string; windowStartAt: string; windowEndAt: string }> };
  error?: string;
};

const cases = fixture.requests as RequestCase[];

function parseWithTargets(input: unknown) {
  const request = parseRecommendationRequest(input);
  return { request, targets: mealTargets(request) };
}

describe("shared Android restaurant recommendation request fixtures", () => {
  it("covers both accepted and rejected requests", () => {
    expect(cases.filter((item) => item.expected).length).toBeGreaterThanOrEqual(9);
    expect(cases.filter((item) => item.error).length).toBeGreaterThanOrEqual(30);
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
  });

  it.each(cases.filter((item) => item.expected))("accepts $id", ({ input, expected }) => {
    const { request, targets } = parseWithTargets(input);
    expect(request).toEqual(expected!.request);
    expect(targets.map((target) => ({
      targetAt: target.targetAt.toISOString(),
      windowStartAt: target.windowStartAt.toISOString(),
      windowEndAt: target.windowEndAt.toISOString(),
    }))).toEqual(expected!.targets);
  });

  it.each(cases.filter((item) => item.error))("rejects $id", ({ input, error }) => {
    expect(() => parseWithTargets(input)).toThrow(error);
  });
});

describe("meal target time", () => {
  const request = (departureAt: string, desiredTimes: string[], toleranceMinutes = 30) => parseRecommendationRequest({
    tripId: "11111111-1111-4111-8111-111111111111",
    basis: { departureAt, returnAt: "2030-01-03T00:00:00.000Z", pointIds: ["a", "b"], arrivalAts: ["2030-01-03T00:00:00.000Z"] },
    mealCount: desiredTimes.length,
    meals: desiredTimes.map((desiredTime) => ({ desiredTime, dwellMinutes: 45 })),
    toleranceMinutes,
  });

  it("uses the first Seoul occurrence at or after departure minus tolerance, to the second", () => {
    // 09:00:30 Seoul departure with 30 min tolerance: reference is 08:30:30.
    const departure = "2030-01-01T00:00:30.000Z";
    expect(mealTargets(request(departure, ["08:30"]))[0].targetAt.toISOString()).toBe("2030-01-01T23:30:00.000Z");
    expect(mealTargets(request(departure, ["08:31"]))[0].targetAt.toISOString()).toBe("2029-12-31T23:31:00.000Z");
    // ±90: reference is 07:30 Seoul, so 07:30 is the same day.
    expect(mealTargets(request("2030-01-01T00:00:00.000Z", ["07:30"], 90))[0].targetAt.toISOString())
      .toBe("2029-12-31T22:30:00.000Z");
  });

  it("requires the second meal target to be strictly later than the first", () => {
    expect(() => mealTargets(request("2030-01-01T00:00:00.000Z", ["12:00", "12:00"]))).toThrow("INVALID_RECOMMENDATION_REQUEST");
    expect(() => mealTargets(request("2030-01-01T00:00:00.000Z", ["12:00", "11:59"]))).toThrow("INVALID_RECOMMENDATION_REQUEST");
    const targets = mealTargets(request("2030-01-01T00:00:00.000Z", ["12:00", "12:01"]));
    expect(targets.map((target) => target.index)).toEqual([1, 2]);
    expect(targets[1].targetAt.getTime() - targets[0].targetAt.getTime()).toBe(60_000);
  });
});

describe("contract v2 request", () => {
  const v1 = () => structuredClone((cases.find((item) => item.expected)!).input as Record<string, unknown>);

  it("accepts the v1 key set plus contractVersion 2 and marks only that request as v2", () => {
    expect(parseRecommendationRequest({ ...v1(), contractVersion: 2 }).contractVersion).toBe(2);
    expect("contractVersion" in parseRecommendationRequest(v1())).toBe(false);
  });

  it.each([1, 3, "2", null, 2.5])("rejects contractVersion %s", (contractVersion) => {
    expect(() => parseRecommendationRequest({ ...v1(), contractVersion })).toThrow("INVALID_RECOMMENDATION_REQUEST");
  });

  it("keeps the exact key check for v2", () => {
    expect(() => parseRecommendationRequest({ ...v1(), contractVersion: 2, folders: [] })).toThrow("INVALID_RECOMMENDATION_REQUEST");
    const { tripId: _tripId, ...missing } = v1();
    expect(() => parseRecommendationRequest({ ...missing, contractVersion: 2 })).toThrow("INVALID_RECOMMENDATION_REQUEST");
  });
});
