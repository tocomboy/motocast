import { describe, expect, it } from "vitest";

import { parsePlaceSearchResponse } from "./search";

const place = {
  kakaoPlaceId: "123",
  verificationToken: "a".repeat(43),
  name: "팔당역",
  category: "교통 > 철도역",
  address: "경기 남양주시 와부읍 팔당리",
  roadAddress: "경기 남양주시 경강로 2227",
  phone: null,
  placeUrl: "https://place.map.kakao.com/123",
  latitude: 37.547,
  longitude: 127.243,
};

describe("parsePlaceSearchResponse", () => {
  it("accepts a browser-safe Kakao place response", () => {
    expect(parsePlaceSearchResponse({ places: [place], isEnd: true })).toEqual({
      places: [place],
      isEnd: true,
    });
  });

  it("rejects a non-Kakao URL instead of exposing it as a result link", () => {
    expect(() =>
      parsePlaceSearchResponse({ places: [{ ...place, placeUrl: "https://example.com/phishing" }], isEnd: true }),
    ).toThrow(/INVALID_PLACE_SEARCH_RESPONSE/);
  });

  it("rejects coordinates outside Korea even if the provider payload claims success", () => {
    expect(() =>
      parsePlaceSearchResponse({ places: [{ ...place, longitude: 139.6 }], isEnd: true }),
    ).toThrow(/PLACE_OUTSIDE_KOREA/);
  });
});
