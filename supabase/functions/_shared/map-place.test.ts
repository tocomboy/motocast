import { describe, expect, it } from "vitest";
import { normalizeMapPlace, parseMapPointRequest } from "./map-place";
import { signPlace, verifyPlace } from "./place-verification";
import fixture from "../../../contracts/android/place-search/fixtures.json";

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
