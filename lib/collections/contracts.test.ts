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

describe("parseCollectionRows", () => {
  it("selects the latest immutable version", () => {
    const parsed = parseCollectionRows([{
      id: "collection-1",
      title: "북한강",
      description: "아침 코스",
      updated_at: "2026-08-31T00:00:00.000Z",
      collection_versions: [
        { id: "v1", version_number: 1, created_at: "2026-08-30T00:00:00.000Z", points: [point] },
        { id: "v2", version_number: 2, created_at: "2026-08-31T00:00:00.000Z", points: [{ ...point, label: "유명산 입구" }] },
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
      collection_versions: [{ id: "v1", version_number: 1, created_at: "2026-08-31T00:00:00.000Z", points: [{ ...point, verificationToken: "short" }] }],
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
        points: [{ ...point, kind: "stop", dwellMinutes: 60, stopRole: "lunch" }],
      }],
    }])).toThrow("INVALID_COLLECTION_POINT");
  });
});
