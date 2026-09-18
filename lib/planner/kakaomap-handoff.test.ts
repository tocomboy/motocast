import { describe, expect, it } from "vitest";
import { handoffPlatform, kakaoMapUrl, validateHandoffPlaces } from "./kakaomap-handoff";
import { ownerHandoff, sharedHandoff } from "./kakaomap-sources";
import { orderedSharedRideSnapshot, sharedRideSnapshotWithOmissions } from "../../tests/fixtures/shared-ride-snapshot";
import { sharedSnapshotRoute } from "../sharing/contracts";
import type { RouteCandidate } from "./types";
import type { CollectionCourse } from "../collections/contracts";

const place = { label: "서울 / 쉼,터? & # 🚲", latitude: 37.5, longitude: 127 };

describe("KakaoMap handoff contract", () => {
  it.each([0, 1, 5])("passes all %i visits from a historical shared snapshot without weather", (count) => {
    const input = orderedSharedRideSnapshot(count);
    const before = JSON.stringify(input);
    const result = sharedHandoff(input);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw Error("expected ready");
    expect(result.places).toHaveLength(count + 2);
    expect(result.places.slice(1, -1).map((p) => p.label)).toEqual(input.waypoints.map((p) => p.label));
    expect(JSON.stringify(input)).toBe(before);
    expect(result.places.every((p) => Object.keys(p).sort().join() === "label,latitude,longitude")).toBe(true);
  });
  it("blocks 6→5→6 without truncation", () => {
    expect([6, 5, 6].map((count) => sharedHandoff(orderedSharedRideSnapshot(count)).status)).toEqual(["blocked", "ready", "blocked"]);
    expect(sharedHandoff(orderedSharedRideSnapshot(6))).toEqual({ status: "blocked", reason: "over-limit", count: 6 });
    expect(() => kakaoMapUrl(Array.from({ length: 8 }, () => place), "android")).toThrow("INVALID_KAKAOMAP_HANDOFF");
  });
  it("keeps repeated visits and a round trip as separate occurrences", () => {
    const places = [place, place, { ...place, label: "점심", latitude: 37.6 }, place];
    const result = validateHandoffPlaces(places);
    expect(result).toEqual({ status: "ready", places });
    const url = new URL(kakaoMapUrl(places, "ios"));
    expect([...url.searchParams.keys()]).toEqual(["sp", "vp", "vp2", "ep", "by"]);
    expect(url.searchParams.get("sp")).toBe(url.searchParams.get("ep"));
    expect(url.searchParams.get("vp")).toBe("37.5,127");
  });
  it("encodes reserved characters and excludes every extra internal field", () => {
    const secretPlace = { ...place, id: "internal-id", verificationToken: "private-proof", shareToken: "private-share", weather: "old" };
    const url = kakaoMapUrl([secretPlace, place], "desktop");
    expect(url).toBe(`https://map.kakao.com/link/by/car/${encodeURIComponent(place.label)},37.5,127/${encodeURIComponent(place.label)},37.5,127`);
    expect(url).not.toMatch(/internal-id|private-proof|private-share|weather/);
    expect(new URL(url).search).toBe("");
    expect(new URL(url).hash).toBe("");
  });
  it.each([NaN, Infinity, 0, 40])("rejects invalid latitude %s", (latitude) => {
    expect(validateHandoffPlaces([place, { ...place, latitude }])).toEqual({ status: "blocked", reason: "invalid" });
  });
  it("rejects broken labels without throwing during rendering", () => {
    expect(validateHandoffPlaces([place, { ...place, label: "\ud800" }]).status).toBe("blocked");
    expect(validateHandoffPlaces([place, { ...place, label: "" }]).status).toBe("blocked");
  });
  it("allows a complete legacy route but blocks omitted visits and reordered inputs", () => {
    expect(sharedHandoff(sharedRideSnapshotWithOmissions(0)).status).toBe("ready");
    expect(sharedHandoff(sharedRideSnapshotWithOmissions(1))).toEqual({ status: "blocked", reason: "invalid" });
    const snapshot = orderedSharedRideSnapshot(2);
    snapshot.waypoints.reverse();
    expect(sharedHandoff(snapshot).status).toBe("blocked");
  });
  it("rejects disconnected legs and mismatched endpoints", () => {
    const snapshot = orderedSharedRideSnapshot(1);
    sharedSnapshotRoute(snapshot).legs[1].from = { ...sharedSnapshotRoute(snapshot).legs[1].from, latitude: 38 };
    expect(sharedHandoff(snapshot).status).toBe("blocked");
    const other = orderedSharedRideSnapshot(1);
    other.trip.origin = { ...other.trip.origin, latitude: 38 };
    expect(sharedHandoff(other).status).toBe("blocked");
  });
  it.each([
    ["Mozilla Android", 0, "android"], ["iPhone", 0, "ios"], ["Macintosh", 5, "ios"],
    ["Macintosh", 0, "desktop"], ["unknown Mobile", 1, "mobile"], ["Windows", 0, "desktop"],
  ] as const)("selects the platform for %s", (ua, touches, expected) => expect(handoffPlatform(ua, touches)).toBe(expected));
  it("uses vp through vp5 on both mobile platforms without a web fallback", () => {
    const points = Array.from({ length: 7 }, (_, index) => ({ ...place, latitude: 37 + index * 0.1 }));
    for (const platform of ["android", "ios", "mobile"] as const) {
      const url = new URL(kakaoMapUrl(points, platform));
      expect(url.protocol).toBe("kakaomap:");
      expect([...url.searchParams.keys()]).toEqual(["sp", "vp", "vp2", "vp3", "vp4", "vp5", "ep", "by"]);
      expect(url.searchParams.get("vp5")).toBe("37.5,127");
    }
  });
  it("requires an unchanged calculated owner result but accepts equivalent time offsets", () => {
    const snapshot = orderedSharedRideSnapshot(0);
    const placeInput = (p: typeof place) => ({ name: p.label, latitude: p.latitude, longitude: p.longitude, kakaoPlaceId: "test", verificationToken: "private", address: "", roadAddress: null });
    const course: CollectionCourse = { origin: placeInput(snapshot.trip.origin), destination: placeInput(snapshot.trip.destination), points: [] };
    const route = { segments: sharedSnapshotRoute(snapshot).legs } as unknown as RouteCandidate;
    const input = { course, route, departureAt: "2020-01-01T09:00:00+09:00", stale: false, busy: false };
    expect(ownerHandoff(input).status).toBe("ready");
    for (const patch of [{ stale: true }, { busy: true }, { route: null }, { departureAt: "2020-01-02T09:00:00+09:00" }]) {
      expect(ownerHandoff({ ...input, ...patch })).toEqual({ status: "blocked", reason: "stale" });
    }
    expect(ownerHandoff({ ...input, course: null }).status).toBe("blocked");
    expect(ownerHandoff({ ...input, course: { ...course, origin: { ...course.origin, latitude: 38 } } }).status).toBe("blocked");
  });
});
