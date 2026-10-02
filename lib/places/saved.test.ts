import { expect, it } from "vitest";
import { parseSavedPlace, parseSavedPlaces, PROVINCES } from "./saved";
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
