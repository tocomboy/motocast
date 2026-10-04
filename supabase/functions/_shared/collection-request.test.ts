import { describe, expect, it } from "vitest";

import { parseCollectionSaveRequest } from "./collection-request";
import { signPlace } from "./place-verification";

const secret = "test-secret-with-at-least-thirty-two-bytes";

async function requestPoint(overrides: Record<string, unknown> = {}) {
  const place = {
    kakaoPlaceId: String(overrides.kakaoPlaceId ?? "kakao-1"),
    name: String(overrides.name ?? "팔당역"),
    address: "경기 남양주시 와부읍 팔당리",
    roadAddress: null,
    longitude: 127.243,
    latitude: 37.547,
  };
  return {
    ...place,
    id: "occurrence-1",
    label: "변조 표시",
    verificationToken: await signPlace(place, secret),
    kind: "pass-through",
    dwellMinutes: 0,
    selected: true,
    winding: false,
    ...overrides,
  };
}

async function requestBody(points?: Awaited<ReturnType<typeof requestPoint>>[]) {
  return {
    saveOperationId: "123e4567-e89b-42d3-a456-426614174000",
    collectionId: null,
    title: "  북한강  ",
    description: "테스트",
    origin: await requestPoint({ kakaoPlaceId: "origin" }),
    destination: await requestPoint({ kakaoPlaceId: "destination" }),
    points: points ?? [await requestPoint({
      id: "lunch-occurrence",
      kakaoPlaceId: "lunch",
      kind: "stop",
      dwellMinutes: 45,
      stopRole: "lunch",
    })],
  };
}

describe("parseCollectionSaveRequest", () => {
  it("round-trips thirty ordered 45-minute meals at one physical place", async () => {
    const meals = await Promise.all(Array.from({ length: 31 }, (_, index) => requestPoint({
      id: `meal-${index}`, kakaoPlaceId: "same-restaurant", kind: "stop",
      dwellMinutes: 45, stopRole: "meal",
    })));
    const parsed = await parseCollectionSaveRequest(await requestBody(meals.slice(0, 30)), secret);
    expect(parsed.points.map(({ id, dwellMinutes, stopRole }) => ({ id, dwellMinutes, stopRole })))
      .toEqual(meals.slice(0, 30).map(({ id, dwellMinutes, stopRole }) => ({ id, dwellMinutes, stopRole })));
    await expect(parseCollectionSaveRequest(await requestBody(meals), secret)).rejects.toThrow("INVALID_COLLECTION");
  });

  it.each([
    { dwellMinutes: 0 }, { dwellMinutes: -1 }, { dwellMinutes: 1.5 },
    { kind: "optional" }, { kind: "pass-through" }, { winding: true }, { selected: false },
  ])("rejects invalid immutable meal semantics %#", async (overrides) => {
    const meal = await requestPoint({ kind: "stop", dwellMinutes: 45, stopRole: "meal", ...overrides });
    await expect(parseCollectionSaveRequest(await requestBody([meal]), secret)).rejects.toThrow("INVALID_COLLECTION");
  });

  it("verifies every Kakao place and canonicalizes browser display identity", async () => {
    const result = await parseCollectionSaveRequest(await requestBody(), secret);
    expect(result.title).toBe("북한강");
    expect(result.origin.kakaoPlaceId).toBe("origin");
    expect(result.points[0]).toMatchObject({ id: "lunch-occurrence", label: "팔당역", selected: true });
  });

  it("accepts a complete endpoint-only course without a lunch stop", async () => {
    await expect(parseCollectionSaveRequest(await requestBody([]), secret))
      .resolves.toMatchObject({ points: [] });
  });

  it("rejects a forged coordinate even when the token shape is valid", async () => {
    const input = await requestBody();
    input.origin = { ...input.origin, longitude: 127.5 };
    await expect(parseCollectionSaveRequest(input, secret)).rejects.toThrow("UNVERIFIED_PLACE");
  });

  it("rejects a collection point that combines a winding flag with stop semantics", async () => {
    const point = {
      ...await requestPoint(),
      selected: true,
      kind: "stop",
      dwellMinutes: 45,
      stopRole: "lunch",
      winding: true,
    };
    await expect(parseCollectionSaveRequest(await requestBody([point]), secret)).rejects.toThrow("INVALID_COLLECTION");
  });

  it("accepts five ordered rests with distinct occurrence ids and rejects a sixth", async () => {
    const lunch = await requestPoint({ id: "lunch", kakaoPlaceId: "lunch", kind: "stop", dwellMinutes: 45, stopRole: "lunch" });
    const rests = await Promise.all(Array.from({ length: 6 }, (_, index) => requestPoint({
      id: `rest-occurrence-${index}`,
      kakaoPlaceId: "same-rest-place",
      kind: "optional",
      dwellMinutes: 30,
      stopRole: "rest",
    })));
    await expect(parseCollectionSaveRequest(await requestBody([lunch, ...rests.slice(0, 5)]), secret))
      .resolves.toMatchObject({ points: expect.arrayContaining([expect.objectContaining({ id: "rest-occurrence-4" })]) });
    await expect(parseCollectionSaveRequest(await requestBody([lunch, ...rests]), secret))
      .rejects.toThrow("INVALID_COLLECTION");
  });

  it("canonicalizes and limits semantic mandatory waypoints independently of the legacy winding bit", async () => {
    const points = await Promise.all(Array.from({ length: 21 }, (_, index) => requestPoint({
      id: `waypoint-occurrence-${index}`,
      kakaoPlaceId: `waypoint-${index}`,
      winding: false,
    })));
    await expect(parseCollectionSaveRequest(await requestBody(points.slice(0, 20)), secret))
      .resolves.toMatchObject({
        points: expect.arrayContaining([expect.objectContaining({ id: "waypoint-occurrence-19", winding: true })]),
      });
    await expect(parseCollectionSaveRequest(await requestBody(points), secret))
      .rejects.toThrow("INVALID_COLLECTION");
  });

  it("rejects duplicate occurrence ids even when the Kakao places differ", async () => {
    const lunch = await requestPoint({ id: "same-occurrence", kakaoPlaceId: "lunch", kind: "stop", dwellMinutes: 45, stopRole: "lunch" });
    const rest = await requestPoint({ id: "same-occurrence", kakaoPlaceId: "rest", kind: "optional", dwellMinutes: 30, stopRole: "rest" });
    await expect(parseCollectionSaveRequest(await requestBody([lunch, rest]), secret))
      .rejects.toThrow("INVALID_COLLECTION");
  });

  it("rejects more than one lunch occurrence", async () => {
    const lunches = await Promise.all(["lunch-a", "lunch-b"].map((kakaoPlaceId, index) => requestPoint({
      id: `lunch-occurrence-${index}`,
      kakaoPlaceId,
      kind: "stop",
      dwellMinutes: 45,
      stopRole: "lunch",
    })));
    await expect(parseCollectionSaveRequest(await requestBody(lunches), secret))
      .rejects.toThrow("INVALID_COLLECTION");
  });

  it.each([
    { kind: "stop", dwellMinutes: 60 },
    { kind: "stop", dwellMinutes: 0, stopRole: "lunch" },
    { kind: "pass-through", dwellMinutes: 30 },
  ])("rejects route-incompatible immutable stop semantics %#", async (overrides) => {
    const point = await requestPoint({ id: "invalid-semantics", ...overrides });
    await expect(parseCollectionSaveRequest(await requestBody([point]), secret))
      .rejects.toThrow("INVALID_COLLECTION");
  });

  it.each(["meal", "lunch", "dinner"] as const)("accepts a %s with the fixed 45-minute dwell", async (stopRole) => {
    const point = await requestPoint({ id: `${stopRole}-occurrence`, kakaoPlaceId: stopRole, kind: "stop", dwellMinutes: 45, stopRole });
    await expect(parseCollectionSaveRequest(await requestBody([point]), secret))
      .resolves.toMatchObject({ points: [{ stopRole, dwellMinutes: 45 }] });
  });

  it.each([
    ["meal", 44], ["meal", 46], ["meal", 60], ["lunch", 60], ["dinner", 60], ["dinner", 1],
  ] as const)("rejects a %s dwell of %i minutes as an outdated client before place verification", async (stopRole, dwellMinutes) => {
    const point = await requestPoint({ id: `${stopRole}-occurrence`, kakaoPlaceId: stopRole, kind: "stop", dwellMinutes, stopRole });
    // A forged token proves the dwell check runs before verification and any storage work.
    const forged = { ...point, verificationToken: "b".repeat(43) };
    await expect(parseCollectionSaveRequest(await requestBody([forged]), secret)).rejects.toThrow("MEAL_DWELL_FIXED");
  });

  it.each([30, 60, 5])("keeps rest dwell editable (%i minutes)", async (dwellMinutes) => {
    const rest = await requestPoint({ id: "rest-occurrence", kakaoPlaceId: "rest", kind: "optional", dwellMinutes, stopRole: "rest" });
    await expect(parseCollectionSaveRequest(await requestBody([rest]), secret))
      .resolves.toMatchObject({ points: [{ stopRole: "rest", dwellMinutes }] });
  });
});
