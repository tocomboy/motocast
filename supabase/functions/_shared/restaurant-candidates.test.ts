import { describe, expect, it } from "vitest";

import {
  avoidanceMatcher,
  buildCandidatePool,
  parseAvoidedPlaces,
  parseSharedRestaurantRead,
} from "./restaurant-candidates";

const FOLDER_A = "aaaaaaaa-0000-4000-8000-000000000001";
const FOLDER_B = "aaaaaaaa-0000-4000-8000-000000000002";
const METERS_PER_LATITUDE_DEGREE = 111_195.08;
let serial = 0;

function place(kakaoPlaceId: string, longitude = 127.75, latitude = 37.001) {
  return { kakaoPlaceId, verificationToken: "a".repeat(43), name: "공개 식당", address: "공개 주소", roadAddress: null, longitude, latitude };
}
function savedRow(kakaoPlaceId: string, longitude?: number, latitude?: number) {
  return { id: `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`, alias: null, revision: 1, place: place(kakaoPlaceId, longitude, latitude) };
}
function sharedRow(folderId: string, kakaoPlaceId: string, longitude?: number, latitude?: number) {
  return { ...savedRow(kakaoPlaceId, longitude, latitude), folder_id: folderId, created_at: "2026-10-09T00:00:00+00:00" };
}
const avoided = (kakaoPlaceId: string, longitude = 127.75, latitude = 37.001) => ({ id: "x", place: place(kakaoPlaceId, longitude, latitude) });
const keys = (pool: ReturnType<typeof buildCandidatePool>) => pool.restaurants.map((restaurant) => restaurant.key);

describe("avoided place reads", () => {
  it("accepts up to 200 avoided places", () => {
    const rows = Array.from({ length: 200 }, (_, index) => avoided(`poi-${index}`));
    expect(parseAvoidedPlaces(rows)).toHaveLength(200);
    expect(parseAvoidedPlaces([])).toEqual([]);
  });

  it.each([
    ["no data", null],
    ["more than the 200 limit", Array.from({ length: 201 }, (_, index) => avoided(`poi-${index}`))],
    ["a row without a place ID", [{ id: "x", place: { longitude: 127, latitude: 37 } }]],
    ["a row with non-numeric coordinates", [{ id: "x", place: { kakaoPlaceId: "poi", longitude: "127", latitude: 37 } }]],
  ])("fails closed on %s instead of treating it as no avoided places", (_name, rows) => {
    expect(() => parseAvoidedPlaces(rows)).toThrow("RECOMMENDATION_STORAGE_FAILED");
  });
});

describe("shared restaurant reads", () => {
  const valid = { rows: [sharedRow(FOLDER_A, "poi-1")], truncated: false, enabledTotal: 3, disabledFolders: 1 };

  it("accepts the single JSON value of recommendation_shared_restaurants", () => {
    expect(parseSharedRestaurantRead(valid)).toEqual(valid);
  });

  it.each([
    ["no data", null],
    ["a row set instead of one value", [valid]],
    ["a missing key", { rows: [], truncated: false, enabledTotal: 0 }],
    ["an extra key", { ...valid, extra: 1 }],
    ["more than 2,000 rows", { ...valid, rows: Array.from({ length: 2001 }, () => valid.rows[0]), enabledTotal: 3000 }],
    ["truncation with fewer than 2,000 rows", { ...valid, truncated: true }],
    ["fewer enabled restaurants than read rows", { ...valid, enabledTotal: 0 }],
    ["a negative disabled folder count", { ...valid, disabledFolders: -1 }],
    ["a non-boolean truncation flag", { ...valid, truncated: "false" }],
  ])("fails on %s", (_name, value) => {
    expect(() => parseSharedRestaurantRead(value)).toThrow("RECOMMENDATION_STORAGE_FAILED");
  });
});

describe("avoidance matching", () => {
  const near = (meters: number) => 37.001 + meters / METERS_PER_LATITUDE_DEGREE;

  it("matches a POI only by its exact kakaoPlaceId, never by distance or a normalized ID", () => {
    const isAvoided = avoidanceMatcher(parseAvoidedPlaces([avoided("12345")]));
    expect(isAvoided({ kakaoPlaceId: "12345", longitude: 128, latitude: 36 })).toBe(true);
    expect(isAvoided({ kakaoPlaceId: "012345", longitude: 127.75, latitude: 37.001 })).toBe(false);
    expect(isAvoided({ kakaoPlaceId: "other", longitude: 127.75, latitude: 37.001 })).toBe(false);
  });

  it.each(["map:37.0010000:127.7500000", "map:37.0010000:127.7500000:region"])(
    "matches %s by ID or any candidate within 30 m (inclusive) of it",
    (id) => {
      const isAvoided = avoidanceMatcher(parseAvoidedPlaces([avoided(id)]));
      expect(isAvoided({ kakaoPlaceId: id, longitude: 128, latitude: 36 })).toBe(true);
      expect(isAvoided({ kakaoPlaceId: "poi", longitude: 127.75, latitude: near(29.9) })).toBe(true);
      expect(isAvoided({ kakaoPlaceId: "poi", longitude: 127.75, latitude: near(30.1) })).toBe(false);
      expect(isAvoided({ kakaoPlaceId: "map:37.0012000:127.7500000", longitude: 127.75, latitude: near(30.1) })).toBe(false);
    },
  );
});

describe("candidate pool", () => {
  it("keeps mine first, then the earliest shared row, and lists the other folders of a merged place", () => {
    const mine = savedRow("poi-1");
    const a1 = sharedRow(FOLDER_A, "poi-1");
    const a2 = sharedRow(FOLDER_A, "poi-2");
    const b2 = sharedRow(FOLDER_B, "poi-2");
    const b3 = sharedRow(FOLDER_B, "poi-3");
    const pool = buildCandidatePool([mine], [], [a1, a2, b2, b3]);
    expect(keys(pool)).toEqual([`saved:${mine.id}`, `shared:${a2.id}`, `shared:${b3.id}`]);
    expect(pool.restaurants.map((restaurant) => restaurant.otherFolderIds)).toEqual([[FOLDER_A], [FOLDER_B], []]);
    expect(pool).toMatchObject({ savedRestaurants: 1, sharedRestaurants: 4, duplicateMerged: 2, avoidedExcluded: 0, invalid: 0 });
  });

  it("compares the whole place ID: a region point differs from the map point at the same coordinates", () => {
    const pool = buildCandidatePool(
      [savedRow("map:37.0010000:127.7500000")],
      [],
      [sharedRow(FOLDER_A, "map:37.0010000:127.7500000:region"), sharedRow(FOLDER_A, "0123"), sharedRow(FOLDER_B, "123")],
    );
    expect(pool.restaurants.map((restaurant) => restaurant.kakaoPlaceId)).toEqual([
      "map:37.0010000:127.7500000", "map:37.0010000:127.7500000:region", "0123", "123",
    ]);
    expect(pool).toMatchObject({ duplicateMerged: 0, invalid: 0 });
  });

  it("counts invalid rows from both sources and keeps two of my rows with the same place ID (v1 behaviour)", () => {
    const missingFolder = { ...sharedRow(FOLDER_A, "poi-9"), folder_id: "not-a-uuid" };
    const noPlaceId = { ...savedRow("poi-8"), place: { ...place("poi-8"), kakaoPlaceId: "" } };
    const pool = buildCandidatePool([savedRow("poi-1"), savedRow("poi-1"), noPlaceId], [], [missingFolder]);
    expect(pool.restaurants).toHaveLength(2);
    expect(pool).toMatchObject({ savedRestaurants: 2, sharedRestaurants: 0, invalid: 2, duplicateMerged: 0 });
  });

  it("applies avoidance to the merged representatives", () => {
    const mine = savedRow("poi-1");
    const pool = buildCandidatePool([mine], parseAvoidedPlaces([avoided("poi-1")]), [sharedRow(FOLDER_A, "poi-1"), sharedRow(FOLDER_A, "poi-2")]);
    expect(pool.restaurants.map((restaurant) => restaurant.kakaoPlaceId)).toEqual(["poi-2"]);
    expect(pool).toMatchObject({ duplicateMerged: 1, avoidedExcluded: 1 });
  });
});
