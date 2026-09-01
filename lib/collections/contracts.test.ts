import { describe, expect, it } from "vitest";

import { parseCollectionRows } from "./contracts";

const point = {
  id: "123",
  label: "유명산",
  kakaoPlaceId: "123",
  verificationToken: "a".repeat(43),
  name: "유명산",
  address: "경기 가평군",
  roadAddress: null,
  longitude: 127.5,
  latitude: 37.5,
  kind: "pass-through",
  dwellMinutes: 0,
  selected: true,
  winding: true,
};
const endpoint = {
  kakaoPlaceId: "endpoint",
  verificationToken: "b".repeat(43),
  name: "팔당역",
  address: "경기 남양주시",
  roadAddress: null,
  longitude: 127.2,
  latitude: 37.5,
};

describe("parseCollectionRows", () => {
  it("selects the latest immutable version", () => {
    const parsed = parseCollectionRows([{
      id: "collection-1",
      title: "북한강",
      description: "아침 코스",
      updated_at: "2026-08-31T00:00:00.000Z",
      collection_versions: [
        { id: "v1", version_number: 1, created_at: "2026-08-30T00:00:00.000Z", origin: endpoint, destination: { ...endpoint, kakaoPlaceId: "destination" }, points: [point] },
        { id: "v2", version_number: 2, created_at: "2026-08-31T00:00:00.000Z", origin: endpoint, destination: { ...endpoint, kakaoPlaceId: "destination" }, points: [{ ...point, label: "유명산 입구" }] },
      ],
    }]);
    expect(parsed[0].latestVersion).toMatchObject({ number: 2 });
  });

  it("rejects a point whose verification proof is malformed", () => {
    expect(() => parseCollectionRows([{
      id: "collection-1",
      title: "북한강",
      description: "",
      updated_at: "2026-08-31T00:00:00.000Z",
      collection_versions: [{ id: "v1", version_number: 1, created_at: "2026-08-31T00:00:00.000Z", origin: endpoint, destination: { ...endpoint, kakaoPlaceId: "destination" }, points: [{ ...point, verificationToken: "short" }] }],
    }])).toThrow();
  });

  it("rejects persisted winding points that also carry stop semantics", () => {
    expect(() => parseCollectionRows([{
      id: "collection-1",
      title: "북한강",
      description: "",
      updated_at: "2026-08-31T00:00:00.000Z",
      collection_versions: [{
        id: "v1",
        version_number: 1,
        created_at: "2026-08-31T00:00:00.000Z",
        origin: endpoint,
        destination: { ...endpoint, kakaoPlaceId: "destination" },
        points: [{ ...point, kind: "stop", dwellMinutes: 60, stopRole: "lunch" }],
      }],
    }])).toThrow("INVALID_COLLECTION_POINT");
  });

  it.each([
    { selected: false },
    { kind: "pass-through", dwellMinutes: 30, winding: false },
    { kind: "optional", dwellMinutes: 30, winding: false },
    { kind: "stop", dwellMinutes: 60, winding: false },
  ])("rejects a persisted occurrence with route-incompatible semantics %#", (overrides) => {
    expect(() => parseCollectionRows([{
      id: "collection-1",
      title: "북한강",
      description: "",
      updated_at: "2026-08-31T00:00:00.000Z",
      collection_versions: [{
        id: "v1",
        version_number: 1,
        created_at: "2026-08-31T00:00:00.000Z",
        origin: endpoint,
        destination: { ...endpoint, kakaoPlaceId: "destination" },
        points: [{ ...point, ...overrides }],
      }],
    }])).toThrow("INVALID_COLLECTION_POINT");
  });

  it("keeps repeated physical places as distinct ordered occurrences", () => {
    const parsed = parseCollectionRows([{
      id: "collection-1",
      title: "반복 코스",
      description: "",
      updated_at: "2026-08-31T00:00:00.000Z",
      collection_versions: [{
        id: "v1",
        version_number: 1,
        created_at: "2026-08-31T00:00:00.000Z",
        origin: endpoint,
        destination: { ...endpoint, kakaoPlaceId: "destination" },
        points: [{ ...point, id: "first" }, { ...point, id: "second" }],
      }],
    }]);
    expect(parsed[0].latestVersion.course.points.map((item) => item.id)).toEqual(["first", "second"]);
  });

  it("ignores Preview-era waypoint-only versions without pretending they are complete courses", () => {
    expect(parseCollectionRows([{
      id: "legacy",
      title: "경유지만 있던 컬렉션",
      description: "",
      updated_at: "2026-08-31T00:00:00.000Z",
      collection_versions: [{ id: "v1", version_number: 1, created_at: "2026-08-31T00:00:00.000Z", points: [point] }],
    }])).toEqual([]);
  });
});
