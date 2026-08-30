import { describe, expect, it } from "vitest";

import { parseCollectionSaveRequest } from "./collection-request";
import { signPlace } from "./place-verification";

const secret = "test-secret-with-at-least-thirty-two-bytes";

async function requestPoint() {
  const place = {
    kakaoPlaceId: "kakao-1",
    name: "팔당역",
    address: "경기 남양주시 와부읍 팔당리",
    roadAddress: null,
    longitude: 127.243,
    latitude: 37.547,
  };
  return {
    ...place,
    id: "forged-browser-id",
    label: "변조 표시",
    verificationToken: await signPlace(place, secret),
    kind: "pass-through",
    dwellMinutes: 0,
    selected: false,
    winding: true,
  };
}

describe("parseCollectionSaveRequest", () => {
  it("verifies every Kakao place and canonicalizes browser display identity", async () => {
    const result = await parseCollectionSaveRequest({
      collectionId: null,
      title: "  북한강  ",
      description: "테스트",
      points: [await requestPoint()],
    }, secret);
    expect(result.title).toBe("북한강");
    expect(result.points[0]).toMatchObject({ id: "kakao-1", label: "팔당역", selected: false, winding: true });
  });

  it("rejects a forged coordinate even when the token shape is valid", async () => {
    const point = { ...await requestPoint(), longitude: 127.5 };
    await expect(parseCollectionSaveRequest({
      collectionId: null,
      title: "북한강",
      description: "",
      points: [point],
    }, secret)).rejects.toThrow("UNVERIFIED_PLACE");
  });

  it("rejects a collection point that combines a winding flag with stop semantics", async () => {
    const point = {
      ...await requestPoint(),
      selected: true,
      kind: "stop",
      dwellMinutes: 60,
      stopRole: "lunch",
    };
    await expect(parseCollectionSaveRequest({
      collectionId: null,
      title: "잘못된 중첩",
      description: "",
      points: [point],
    }, secret)).rejects.toThrow("INVALID_COLLECTION");
  });
});
