import { expect, it } from "vitest";
import { isRegionOnlyPlace, parseSavedPlace, parseSavedPlaceEntries, parseSavedPlaceEntry, parseSavedPlaces, PROVINCES } from "./saved";
const row = {
  id: "00000000-0000-4000-8000-000000000001",
  place: {
    kakaoPlaceId: "1",
    verificationToken: "a".repeat(43),
    name: "원래 장소",
    address: "서울 중구",
    roadAddress: null,
    latitude: 37.55,
    longitude: 127.24,
  },
  alias: null,
  kind: "riding_spot",
  province: "서울",
  star_slot: null,
  revision: 1,
  created_at: "2026-10-02T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
};
it("accepts all 17 provinces and a full 1000 private places while rejecting impossible lists", () => {
  expect(parseSavedPlace({ ...row, alias: "🏍".repeat(80) }).alias).toBe("🏍".repeat(80));
  expect(() => parseSavedPlace({ ...row, alias: "🏍".repeat(81) })).toThrow();
  expect(parseSavedPlace({ ...row, alias: "\u00a0별명\u00a0" }).alias).toBe("\u00a0별명\u00a0");
  expect(
    parseSavedPlace({ ...row, place: { ...row.place, roadAddress: "" } }).place
      .roadAddress,
  ).toBe("");
  for (const province of [...PROVINCES, null])
    expect(parseSavedPlace({ ...row, province }).province).toBe(province);
  const rows = Array.from({ length: 1000 }, (_, n) => ({
    ...row,
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    place: { ...row.place, kakaoPlaceId: String(n) },
  }));
  expect(parseSavedPlaces(rows)).toHaveLength(1000);
  expect(() => parseSavedPlaces([...rows, row])).toThrow();
  expect(() => parseSavedPlaces([row, row])).toThrow();
  expect(() => parseSavedPlace({ ...row, star_slot: 6 })).toThrow();
  expect(() => parseSavedPlace({ ...row, alias: "x".repeat(81) })).toThrow();
  expect(() => parseSavedPlace({ ...row, province: "서울시 전체" })).toThrow();
});

const withoutPosition = (value: Record<string, unknown>) => {
  const copy = { ...value };
  delete copy.star_position;
  return copy;
};
const entry = (n: number, position: number | null) => ({
  ...row,
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  place: { ...row.place, kakaoPlaceId: `entry-${n}` },
  star_slot: position !== null && position <= 5 ? position : null,
  star_position: position,
});
it("accepts ten view stars with the 1..5 mirror and keeps the legacy table parser at five", () => {
  const rows = Array.from({ length: 12 }, (_, n) => entry(n, n < 10 ? n + 1 : null));
  const parsed = parseSavedPlaceEntries(rows);
  expect(parsed.map((item) => item.starPosition)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, null, null]);
  expect(parsed.map((item) => item.starSlot)).toEqual([1, 2, 3, 4, 5, null, null, null, null, null, null, null]);
  // The same rows read through the old table select still satisfy the old parser.
  expect(parseSavedPlaces(rows.map(withoutPosition))).toHaveLength(12);
  expect(() => parseSavedPlace({ ...row, star_slot: 6 })).toThrow();
});
it.each([
  ["position 0", { ...entry(1, null), star_position: 0 }],
  ["position 11", { ...entry(1, null), star_position: 11 }],
  ["fractional position", { ...entry(1, null), star_position: 1.5 }],
  ["string position", { ...entry(1, null), star_position: "1" }],
  ["missing position", withoutPosition(entry(1, 1))],
  ["mirror missing for 1..5", { ...entry(1, 3), star_slot: null }],
  ["mirror for hidden star", { ...entry(1, 7), star_slot: 2 }],
  ["mirror disagrees", { ...entry(1, 2), star_slot: 3 }],
])("rejects an inconsistent view row: %s", (_, value) => {
  expect(() => parseSavedPlaceEntry(value)).toThrow("INVALID_SAVED_PLACE");
});
it("rejects an eleventh star, duplicate positions and duplicate places in one view snapshot", () => {
  const ten = Array.from({ length: 10 }, (_, n) => entry(n, n + 1));
  expect(() => parseSavedPlaceEntries([...ten, { ...entry(10, 10), star_slot: null }])).toThrow("INVALID_SAVED_PLACES");
  expect(() => parseSavedPlaceEntries([entry(1, 7), entry(2, 7)])).toThrow("INVALID_SAVED_PLACES");
  expect(() => parseSavedPlaceEntries([entry(1, 1), { ...entry(2, null), place: entry(1, 1).place }])).toThrow("INVALID_SAVED_PLACES");
  expect(() => parseSavedPlaceEntries(Array.from({ length: 1001 }, (_, n) => entry(n, null)))).toThrow("INVALID_SAVED_PLACES");
});
it("recognizes only the exact region-only map id", () => {
  expect(isRegionOnlyPlace({ kakaoPlaceId: "map:37.3388112:127.2699521:region" })).toBe(true);
  for (const kakaoPlaceId of ["map:37.3388112:127.2699521", "map:37.3388112:127.2699521:regions", "123:region", "map:37.33:127.2699521:region"]) {
    expect(isRegionOnlyPlace({ kakaoPlaceId })).toBe(false);
  }
});
