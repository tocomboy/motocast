import { describe, expect, it } from "vitest";

import {
  normalizeKakaoPlaceDocuments,
  parsePlaceSearchRequest,
} from "./place-search";

describe("parsePlaceSearchRequest", () => {
  it("normalizes whitespace and applies a cost-conscious default page size", () => {
    expect(parsePlaceSearchRequest({ query: "  팔당   맛집 " })).toEqual({
      query: "팔당 맛집",
      page: 1,
      size: 10,
    });
  });

  it.each(["", "가", "x".repeat(101)])("rejects an invalid query", (query) => {
    expect(() => parsePlaceSearchRequest({ query })).toThrow(/INVALID_PLACE_SEARCH_QUERY/);
  });

  it("rejects a page size above Kakao's maximum", () => {
    expect(() => parsePlaceSearchRequest({ query: "팔당역", size: 16 })).toThrow(
      /INVALID_PLACE_SEARCH_PAGE/,
    );
  });
});

describe("normalizeKakaoPlaceDocuments", () => {
  it("maps Kakao provider fields into the browser-safe place contract", () => {
    expect(
      normalizeKakaoPlaceDocuments([
        {
          id: "123",
          place_name: "팔당역",
          category_name: "교통 > 철도역",
          address_name: "경기 남양주시 와부읍 팔당리",
          road_address_name: "경기 남양주시 경강로 2227",
          phone: "031-000-0000",
          place_url: "http://place.map.kakao.com/123",
          x: "127.243",
          y: "37.547",
        },
      ]),
    ).toEqual([
      {
        kakaoPlaceId: "123",
        name: "팔당역",
        category: "교통 > 철도역",
        address: "경기 남양주시 와부읍 팔당리",
        roadAddress: "경기 남양주시 경강로 2227",
        phone: "031-000-0000",
        placeUrl: "https://place.map.kakao.com/123",
        longitude: 127.243,
        latitude: 37.547,
      },
    ]);
  });

  it("rejects malformed or out-of-bound provider coordinates", () => {
    expect(() =>
      normalizeKakaoPlaceDocuments([
        { id: "1", place_name: "invalid", address_name: "invalid", x: "139.6", y: "35.6" },
      ]),
    ).toThrow(/PLACE_OUTSIDE_KOREA/);
  });

  it("rejects a provider detail URL outside the Kakao place host", () => {
    expect(() =>
      normalizeKakaoPlaceDocuments([
        {
          id: "123",
          place_name: "팔당역",
          address_name: "경기 남양주시 와부읍 팔당리",
          place_url: "http://example.com/123",
          x: "127.243",
          y: "37.547",
        },
      ]),
    ).toThrow(/INVALID_PLACE_PROVIDER_RESPONSE/);
  });
});
