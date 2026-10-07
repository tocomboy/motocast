import { describe, expect, it } from "vitest";
import { normalizeMapPlace, normalizeRegionPlace, parseMapPointRequest, REGION_PLACE_CATEGORY } from "./map-place";
import { signPlace, verifyPlace } from "./place-verification";
import { parseCollectionSaveRequest } from "./collection-request";
import { parseRecommendationRequest } from "./restaurant-recommendation-request";
import { parseRouteRequest, withValidatedRouteRequest } from "./route-request";
import fixture from "../../../contracts/android/place-search/fixtures.json";
import recommendationFixture from "../../../contracts/android/restaurant-recommendation/fixtures.json";

const point = { mode: "coordinate" as const, latitude: 37.3388112, longitude: 127.2699521 };
const mountain = "경기 용인시 처인구 모현읍 왕산리 산 84-1";
describe("verified map point", () => {
  it("preserves mountain land-lot address and selected coordinate without a road address", async () => {
    const result = normalizeMapPlace([{ address: { address_name: mountain, mountain_yn: "Y" }, road_address: null }], point)!;
    expect(result).toMatchObject({ address: mountain, roadAddress: null, name: mountain, latitude: point.latitude, longitude: point.longitude, placeUrl: null });
    const secret = "local-fixture-only-".repeat(3);
    const token = await signPlace(result, secret);
    expect(await verifyPlace(result, token, secret)).toBe(true);
    expect(await verifyPlace({ ...result, longitude: result.longitude + 0.001 }, token, secret)).toBe(false);
    expect(await verifyPlace({ ...result, address: "임의 주소" }, token, secret)).toBe(false);
  });
  it("keeps the second reported mountain address without inventing a street", () => {
    const address = "강원특별자치도 인제군 기린면 방동리 산 282-1";
    expect(normalizeMapPlace([{ address: { address_name: address }, road_address: null }], point)?.address).toBe(address);
  });
  it.each([NaN, Infinity, "37", null, 32.79, 38.71])("rejects invalid latitude %s", latitude => {
    expect(() => parseMapPointRequest({ ...point, latitude })).toThrow("INVALID_PLACE_SEARCH_REQUEST");
  });
  it.each([{ query: "override" }, { page: 1 }, { token: "forged" }, { mode: "other" }, { longitude: 139 }])("rejects injected/mismatched fields", change => {
    expect(() => parseMapPointRequest({ ...point, ...change })).toThrow("INVALID_PLACE_SEARCH_REQUEST");
  });
  it("normalizes precision consistently for identity and signed values", () => {
    expect(parseMapPointRequest({ ...point, latitude: 37.33881123456 }).latitude).toBe(37.3388112);
  });
  it("does not invent an address for unmapped water or provider failures", () => {
    expect(normalizeMapPlace([], point)).toBeNull();
    for (const documents of [null, [{}], [{address:{address_name:""}}], [{address:{address_name:mountain},road_address:"bad"}]]) {
      expect(() => normalizeMapPlace(documents, point)).toThrow("INVALID_PLACE_PROVIDER_RESPONSE");
    }
  });
});

describe("shared Android coordinate request fixtures", () => {
  it.each(fixture.coordinateRequests)("$id", (item) => {
    if ("error" in item) expect(() => parseMapPointRequest(item.input)).toThrow(item.error);
    else expect(parseMapPointRequest(item.input)).toEqual(item.expected);
  });
});

describe("shared Android coordinate response fixtures", () => {
  type ResponseCase = { id: string; request: unknown; providerCalls: Array<{ endpoint: string; documents: unknown }>;
    response?: { places: Array<Record<string, unknown> & { verificationToken: string }> }; error?: { cause: string } };
  it.each(fixture.coordinateResponses as ResponseCase[])("$id", async (item) => {
    const request = parseMapPointRequest(item.request);
    const outcome = () => {
      let place = normalizeMapPlace(item.providerCalls[0].documents, request);
      if (!place && request.fallback === "region") place = normalizeRegionPlace(item.providerCalls[1].documents, request);
      return place;
    };
    if (item.error) {
      expect(outcome).toThrow(item.error.cause);
      return;
    }
    const place = outcome();
    const expected = item.response!.places;
    if (!place) { expect(expected).toEqual([]); return; }
    const { verificationToken, ...unsigned } = expected[0];
    expect(place).toEqual(unsigned);
    expect(await signPlace(place, fixture.coordinateSigningSecret)).toBe(verificationToken);
  });
});

describe("region-only map point fallback", () => {
  const secret = "local-fixture-only-".repeat(3);
  const regionPoint = { ...point, fallback: "region" as const };
  const legal = { region_type: "B", address_name: "강원특별자치도 인제군 기린면 방동리", region_1depth_name: "강원특별자치도", region_2depth_name: "인제군", region_3depth_name: "기린면 방동리", x: 128.1, y: 37.9 };
  const admin = { ...legal, region_type: "H", address_name: "강원특별자치도 인제군 기린면", region_3depth_name: "기린면" };

  it("accepts only the exact region opt-in and keeps the legacy shape without it", () => {
    expect(parseMapPointRequest(regionPoint)).toEqual(regionPoint);
    expect(parseMapPointRequest(point)).not.toHaveProperty("fallback");
    for (const fallback of ["address", "REGION", "", null, true, 1, ["region"]]) {
      expect(() => parseMapPointRequest({ ...point, fallback })).toThrow("INVALID_PLACE_SEARCH_REQUEST");
    }
  });

  it.each([[[admin, legal]], [[legal, admin]], [[legal]]])("uses the single legal region regardless of order and keeps the selected point", (documents) => {
    expect(normalizeRegionPlace(documents, regionPoint)).toEqual({
      kakaoPlaceId: "map:37.3388112:127.2699521:region",
      name: "인제군 기린면 방동리 부근",
      address: "강원특별자치도 인제군 기린면 방동리",
      roadAddress: null,
      category: REGION_PLACE_CATEGORY,
      phone: null,
      placeUrl: null,
      latitude: point.latitude,
      longitude: point.longitude,
    });
  });

  it("accepts at most ten region documents", () => {
    const ten = [legal, ...Array.from({ length: 9 }, () => admin)];
    expect(normalizeRegionPlace(ten, regionPoint)?.kakaoPlaceId).toBe("map:37.3388112:127.2699521:region");
    expect(() => normalizeRegionPlace([...ten, admin], regionPoint)).toThrow("INVALID_PLACE_PROVIDER_RESPONSE");
  });

  it("returns no place when the provider has no legal region", () => {
    expect(normalizeRegionPlace([], regionPoint)).toBeNull();
    expect(normalizeRegionPlace([admin], regionPoint)).toBeNull();
  });

  it("trims names, falls back to the address and bounds the generated name", () => {
    expect(normalizeRegionPlace([{ ...legal, address_name: "  세종특별자치시 연서면  ", region_2depth_name: "", region_3depth_name: " 연서면 " }], regionPoint))
      .toMatchObject({ address: "세종특별자치시 연서면", name: "연서면 부근" });
    expect(normalizeRegionPlace([{ region_type: "B", address_name: " 제주특별자치도 " }], regionPoint))
      .toMatchObject({ address: "제주특별자치도", name: "제주특별자치도 부근" });
    const long = normalizeRegionPlace([{ ...legal, region_2depth_name: "가".repeat(100), region_3depth_name: "나".repeat(100) }], regionPoint)!;
    expect(long.name.length).toBeLessThanOrEqual(160);
    expect(long.name.endsWith("가 부근") || long.name.endsWith("나 부근")).toBe(true);
    expect(long.kakaoPlaceId.length).toBeLessThanOrEqual(80);
  });

  it.each([
    ["not an array", { documents: [legal] }],
    ["two legal regions", [legal, { ...legal }]],
    ["unknown region type", [legal, { ...admin, region_type: "X" }]],
    ["non-object document", [legal, "B"]],
    ["missing address", [{ ...legal, address_name: undefined }]],
    ["blank address", [{ ...legal, address_name: "  " }]],
    ["control character in address", [{ ...legal, address_name: "인제군\n기린면" }]],
    ["control character in area", [{ ...legal, region_3depth_name: "기린면\u0007" }]],
    ["non-string area", [{ ...legal, region_2depth_name: 3 }]],
    ["overlong address", [{ ...legal, address_name: "가".repeat(301) }]],
  ])("rejects malformed region data: %s", (_, documents) => {
    expect(() => normalizeRegionPlace(documents, regionPoint)).toThrow("INVALID_PLACE_PROVIDER_RESPONSE");
  });

  it("signs the region identity so a changed id, name or coordinate is rejected", async () => {
    const place = normalizeRegionPlace([legal], regionPoint)!;
    const token = await signPlace(place, secret);
    expect(await verifyPlace(place, token, secret)).toBe(true);
    expect(await verifyPlace({ ...place, kakaoPlaceId: "map:37.3388112:127.2699521" }, token, secret)).toBe(false);
    expect(await verifyPlace({ ...place, name: "다른 이름" }, token, secret)).toBe(false);
    expect(await verifyPlace({ ...place, latitude: 37.3388113 }, token, secret)).toBe(false);
  });
});

describe("region-only place in existing consumers", () => {
  const secret = "test-secret-with-at-least-thirty-two-bytes";
  const now = () => new Date("2026-08-30T00:00:00.000Z");
  const regionPlace = normalizeRegionPlace(
    [{ region_type: "B", address_name: "강원특별자치도 인제군 기린면 방동리", region_2depth_name: "인제군", region_3depth_name: "기린면 방동리" }],
    { ...point, fallback: "region" },
  )!;
  const asPoint = (place: Record<string, unknown>, id: string) => ({
    ...place, id, label: String(place.name), kind: "pass-through", dwellMinutes: 0, selected: true, winding: false,
  });

  // A saved original holds only the seven signed fields and is reused after a JSON round trip.
  async function savedOriginal(): Promise<Record<string, unknown>> {
    const signed = {
      kakaoPlaceId: regionPlace.kakaoPlaceId, name: regionPlace.name, address: regionPlace.address,
      roadAddress: regionPlace.roadAddress, latitude: regionPlace.latitude, longitude: regionPlace.longitude,
    };
    return JSON.parse(JSON.stringify({ ...signed, verificationToken: await signPlace(signed, secret) }));
  }
  async function endpoint(kakaoPlaceId: string) {
    const place = { kakaoPlaceId, name: "팔당역", address: "경기 남양주시 와부읍 팔당리", roadAddress: null, latitude: 37.547, longitude: 127.243 };
    return asPoint({ ...place, verificationToken: await signPlace(place, secret) }, kakaoPlaceId);
  }
  async function routeBody(original: Record<string, unknown>) {
    return {
      planningId: "123e4567-e89b-42d3-a456-426614174000",
      origin: await endpoint("origin"),
      destination: await endpoint("destination"),
      waypoints: [asPoint(original, "region-occurrence")],
      serviceDate: "2026-08-31",
      departureAt: "2026-08-31T07:30:00+09:00",
    };
  }
  const forgeries = [{ kakaoPlaceId: "map:37.3388112:127.2699521:regionx" }, { name: "변조 이름" }, { longitude: 127.27 }];

  it("plan-route and journey-route accept the saved region place and reject a forged one", async () => {
    const original = await savedOriginal();
    const parsed = await parseRouteRequest(await routeBody(original), secret, now);
    expect(parsed.waypoints[0]).toMatchObject({ kakaoPlaceId: regionPlace.kakaoPlaceId, address: regionPlace.address, roadAddress: null });
    await expect(withValidatedRouteRequest(await routeBody(original), secret, async () => "provider", now)).resolves.toBe("provider");
    for (const forged of forgeries) {
      await expect(parseRouteRequest(await routeBody({ ...original, ...forged }), secret, now)).rejects.toThrow("UNVERIFIED_PLACE");
    }
  });

  it("save-collection accepts the saved region place and rejects a forged one", async () => {
    const original = await savedOriginal();
    const body = async (place: Record<string, unknown>) => ({
      saveOperationId: "123e4567-e89b-42d3-a456-426614174000", collectionId: null, title: "지역 지점", description: "",
      origin: await endpoint("origin"), destination: asPoint(place, "destination"), points: [],
    });
    expect((await parseCollectionSaveRequest(await body(original), secret)).destination.kakaoPlaceId).toBe(regionPlace.kakaoPlaceId);
    for (const forged of forgeries) {
      await expect(parseCollectionSaveRequest(await body({ ...original, ...forged }), secret)).rejects.toThrow("UNVERIFIED_PLACE");
    }
  });

  it("recommend-restaurants keeps its existing format-only point id check", () => {
    const accepted = (recommendationFixture.requests as Array<{ input: unknown; expected?: unknown }>).find(item => item.expected)!;
    const input = structuredClone(accepted.input) as { basis: { pointIds: string[] } };
    input.basis.pointIds[0] = regionPlace.kakaoPlaceId;
    expect(parseRecommendationRequest(input).basis.pointIds[0]).toBe(regionPlace.kakaoPlaceId);
  });
});
