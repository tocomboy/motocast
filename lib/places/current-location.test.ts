import { describe, expect, it, vi } from "vitest";

import { CURRENT_LOCATION_OPTIONS, CurrentLocationError, findCurrentPlace, usableFix } from "./current-location";
import type { PlaceSearchResult } from "./search";

const seoul = { latitude: 37.5665, longitude: 126.978 };
const place: PlaceSearchResult = {
  kakaoPlaceId: "map:37.5665000:126.9780000", verificationToken: "a".repeat(43), name: "서울 중구 세종대로 110",
  address: "서울 중구 태평로1가 31", roadAddress: "서울 중구 세종대로 110", category: "지도에서 선택", phone: null, placeUrl: null, ...seoul,
};

type Outcome = { coords: { latitude: number; longitude: number; accuracy: number } } | { code: number };
function geolocation(outcome: Outcome) {
  const getCurrentPosition = vi.fn((success: PositionCallback, failure: PositionErrorCallback, options?: PositionOptions) => {
    void options;
    if ("coords" in outcome) success(outcome as unknown as GeolocationPosition);
    else failure?.({ code: outcome.code } as GeolocationPositionError);
  });
  return { getCurrentPosition } as unknown as Geolocation & { getCurrentPosition: typeof getCurrentPosition };
}

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(CurrentLocationError);
  return (error as CurrentLocationError).kind;
}

describe("usableFix", () => {
  it("accepts a fix up to 500 m inside Korea and keeps only the coordinate", () => {
    expect(usableFix({ ...seoul, accuracy: 500 })).toEqual(seoul);
  });

  it.each([
    ["less accurate than 500 m", { ...seoul, accuracy: 500.1 }, "position"],
    ["unknown accuracy", { ...seoul, accuracy: Number.NaN }, "position"],
    ["outside Korea", { latitude: 35.6762, longitude: 139.6503, accuracy: 20 }, "outside"],
    ["just outside the service bounds", { latitude: 38.71, longitude: 127, accuracy: 20 }, "outside"],
  ])("rejects a fix %s", (_, fix, kind) => {
    expect(() => usableFix(fix)).toThrow(expect.objectContaining({ kind }));
  });
});

describe("findCurrentPlace", () => {
  it("reads once with the confirmed options and looks up the map point with region fallback", async () => {
    const device = geolocation({ coords: { ...seoul, accuracy: 30 } });
    const resolve = vi.fn().mockResolvedValue(place);
    const onResolving = vi.fn();
    await expect(findCurrentPlace({ geolocation: device, resolve, isCurrent: () => true, onResolving })).resolves.toBe(place);
    expect(device.getCurrentPosition).toHaveBeenCalledOnce();
    expect(device.getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 });
    expect(CURRENT_LOCATION_OPTIONS).toEqual({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 });
    expect(resolve).toHaveBeenCalledExactlyOnceWith(seoul);
    expect(onResolving).toHaveBeenCalledOnce();
  });

  it.each([
    ["permission denied", { code: 1 }, "permission"],
    ["position unavailable", { code: 2 }, "position"],
    ["timeout", { code: 3 }, "position"],
    ["inaccurate fix", { coords: { ...seoul, accuracy: 900 } }, "position"],
    ["fix outside Korea", { coords: { latitude: 35.6762, longitude: 139.6503, accuracy: 10 } }, "outside"],
  ] as const)("does not look anything up after %s", async (_, outcome, kind) => {
    const resolve = vi.fn();
    expect(await failure(findCurrentPlace({ geolocation: geolocation(outcome), resolve, isCurrent: () => true, onResolving: vi.fn() }))).toBe(kind);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("re-reads the position on retry instead of accepting the cached fix", async () => {
    const device = geolocation({ coords: { ...seoul, accuracy: 30 } });
    await findCurrentPlace({ geolocation: device, retry: true, resolve: vi.fn().mockResolvedValue(place), isCurrent: () => true, onResolving: vi.fn() });
    expect(device.getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  });

  it("reports a missing geolocation API as no position", async () => {
    expect(await failure(findCurrentPlace({ geolocation: undefined, resolve: vi.fn(), isCurrent: () => true, onResolving: vi.fn() }))).toBe("position");
  });

  it.each([
    ["the exhausted daily limit (429)", () => Promise.reject(new Error("DAILY_LIMIT")), "limit"],
    ["any other lookup error", () => Promise.reject(new Error("UNAVAILABLE")), "lookup"],
    ["a point without address or region", () => Promise.resolve(null), "no-address"],
  ] as const)("classifies %s", async (_, resolve, kind) => {
    expect(await failure(findCurrentPlace({ geolocation: geolocation({ coords: { ...seoul, accuracy: 30 } }), resolve, isCurrent: () => true, onResolving: vi.fn() }))).toBe(kind);
  });

  it("never spends a lookup for a fix that arrives after the attempt was cancelled", async () => {
    const resolve = vi.fn();
    const onResolving = vi.fn();
    expect(await failure(findCurrentPlace({ geolocation: geolocation({ coords: { ...seoul, accuracy: 30 } }), resolve, isCurrent: () => false, onResolving }))).toBe("cancelled");
    expect(resolve).not.toHaveBeenCalled();
    expect(onResolving).not.toHaveBeenCalled();
  });

  it("drops a place that arrives after the attempt was cancelled", async () => {
    let current = true;
    const resolve = vi.fn(async () => { current = false; return place; });
    expect(await failure(findCurrentPlace({ geolocation: geolocation({ coords: { ...seoul, accuracy: 30 } }), resolve, isCurrent: () => current, onResolving: vi.fn() }))).toBe("cancelled");
  });
});
