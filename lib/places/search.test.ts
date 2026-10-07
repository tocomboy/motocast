import { describe, expect, it } from "vitest";

import { parsePlaceSearchResponse, selectedMapPointPlace } from "./search";
import contract from "../../contracts/android/place-search/fixtures.json";

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

describe("selectedMapPointPlace", () => {
  const point = { latitude: 37.338811234, longitude: 127.269952145 };
  const mapPlace = (kakaoPlaceId: string, change: Record<string, unknown> = {}) => ({
    ...place, kakaoPlaceId, name: "인제군 기린면 방동리 부근", category: "지도에서 선택 · 상세 주소 없음",
    roadAddress: null, placeUrl: null, latitude: 37.3388112, longitude: 127.2699521, ...change,
  });
  const response = (...places: unknown[]) => parsePlaceSearchResponse({ places, isEnd: true });

  it("accepts the exact address or region id only for an opted-in request", () => {
    expect(selectedMapPointPlace(response(mapPlace("map:37.3388112:127.2699521")), point, false)?.kakaoPlaceId).toBe("map:37.3388112:127.2699521");
    expect(selectedMapPointPlace(response(mapPlace("map:37.3388112:127.2699521")), point, true)?.kakaoPlaceId).toBe("map:37.3388112:127.2699521");
    expect(selectedMapPointPlace(response(mapPlace("map:37.3388112:127.2699521:region")), point, true)?.kakaoPlaceId).toBe("map:37.3388112:127.2699521:region");
    expect(selectedMapPointPlace(response(), point, true)).toBeNull();
  });

  it.each([
    ["region without opt-in", mapPlace("map:37.3388112:127.2699521:region"), false],
    ["arbitrary suffix", mapPlace("map:37.3388112:127.2699521:regions"), true],
    ["other suffix", mapPlace("map:37.3388112:127.2699521:poi"), true],
    ["other coordinate id", mapPlace("map:37.3388113:127.2699521:region"), true],
    ["moved coordinate", mapPlace("map:37.3388112:127.2699521:region", { latitude: 37.3388113 }), true],
    ["provider place id", mapPlace("123"), true],
  ])("rejects %s", (_, candidate, regionFallback) => {
    expect(() => selectedMapPointPlace(response(candidate), point, regionFallback as boolean)).toThrow("WRONG_SELECTED_POINT");
  });

  it("keeps the single-result and end-of-list checks", () => {
    const valid = mapPlace("map:37.3388112:127.2699521:region");
    expect(() => selectedMapPointPlace(response(valid, valid), point, true)).toThrow("WRONG_SELECTED_POINT");
    expect(() => selectedMapPointPlace(parsePlaceSearchResponse({ places: [valid], isEnd: false }), point, true)).toThrow("WRONG_SELECTED_POINT");
  });
});

describe("shared Android coordinate client checks", () => {
  type ClientCheck = { id: string; regionFallback: boolean; point: { latitude: number; longitude: number }; place: unknown; accepted: boolean };
  it.each(contract.coordinateClientChecks as ClientCheck[])("$id", ({ regionFallback, point, place, accepted }) => {
    const response = parsePlaceSearchResponse({ places: [place], isEnd: true });
    if (accepted) expect(selectedMapPointPlace(response, point, regionFallback)).toEqual(response.places[0]);
    else expect(() => selectedMapPointPlace(response, point, regionFallback)).toThrow("WRONG_SELECTED_POINT");
  });
});
