import { describe, expect, it } from "vitest";
import {
  clusterBadge,
  clusterPins,
  clusterRadiusForLevel,
  clusterZoomLevel,
  type ClusterPinInput,
} from "./clustering";

const pin = (id: string, x: number, y: number, extra: Partial<ClusterPinInput> = {}): ClusterPinInput => ({
  id,
  x,
  y,
  latitude: 37 + y / 1000,
  longitude: 127 + x / 1000,
  starred: false,
  ...extra,
});

describe("clusterRadiusForLevel", () => {
  it("uses 0 / 48 / 56 / 72 by Kakao web level band", () => {
    expect([1, 2, 3].map(clusterRadiusForLevel)).toEqual([0, 0, 0]);
    expect([4, 5, 6].map(clusterRadiusForLevel)).toEqual([48, 48, 48]);
    expect([7, 8, 9].map(clusterRadiusForLevel)).toEqual([56, 56, 56]);
    expect([10, 11, 14].map(clusterRadiusForLevel)).toEqual([72, 72, 72]);
    expect(() => clusterRadiusForLevel(Number.NaN)).toThrow("INVALID_MAP_LEVEL");
  });
});

describe("clusterBadge", () => {
  it("sizes S/M/L and caps the label at 999+", () => {
    expect(clusterBadge(2)).toEqual({ size: 44, label: "2" });
    expect(clusterBadge(9)).toEqual({ size: 44, label: "9" });
    expect(clusterBadge(10)).toEqual({ size: 50, label: "10" });
    expect(clusterBadge(99)).toEqual({ size: 50, label: "99" });
    expect(clusterBadge(100)).toEqual({ size: 56, label: "100" });
    expect(clusterBadge(999)).toEqual({ size: 56, label: "999" });
    expect(clusterBadge(1000)).toEqual({ size: 56, label: "999+" });
    expect(() => clusterBadge(1)).toThrow("INVALID_CLUSTER_COUNT");
  });
});

describe("clusterPins", () => {
  it("groups pins within the level radius and keeps distant pins single", () => {
    const pins = [pin("a", 0, 0), pin("b", 40, 0), pin("c", 200, 0)];
    const groups = clusterPins(pins, 5);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ kind: "cluster", ids: ["a", "b"], count: 2, size: 44, label: "2", sameCoordinates: false });
    expect(groups[1]).toMatchObject({ kind: "pin", pin: { id: "c" } });
  });

  it("applies the wider radius at higher levels", () => {
    const pins = [pin("a", 0, 0), pin("b", 60, 0)];
    expect(clusterPins(pins, 6).every((group) => group.kind === "pin")).toBe(true);
    expect(clusterPins(pins, 9).every((group) => group.kind === "pin")).toBe(true);
    expect(clusterPins(pins, 10)).toMatchObject([{ kind: "cluster", count: 2 }]);
  });

  it("only groups identical coordinates at levels 1..3 even when pixels overlap", () => {
    const same = { latitude: 37.5, longitude: 127.1 };
    const pins = [pin("a", 0, 0, same), pin("b", 0, 0, same), pin("c", 1, 1, { latitude: 37.5000001, longitude: 127.1 })];
    const groups = clusterPins(pins, 3);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ kind: "cluster", ids: ["a", "b"], sameCoordinates: true, latitude: 37.5, longitude: 127.1 });
    expect(groups[1]).toMatchObject({ kind: "pin", pin: { id: "c" } });
  });

  it("needs two pins and never groups a single visible pin", () => {
    expect(clusterPins([pin("a", 0, 0)], 12)).toEqual([{ kind: "pin", pin: pin("a", 0, 0) }]);
    expect(clusterPins([], 12)).toEqual([]);
  });

  it("keeps excluded (selected) pins single and out of nearby clusters", () => {
    const pins = [pin("a", 0, 0), pin("b", 10, 0), pin("c", 20, 0)];
    const groups = clusterPins(pins, 8, new Set(["b"]));
    expect(groups).toEqual([
      expect.objectContaining({ kind: "cluster", ids: ["a", "c"] }),
      { kind: "pin", pin: pins[1] },
    ]);
  });

  it("marks a cluster starred when any member is a frequent place", () => {
    const groups = clusterPins([pin("a", 0, 0), pin("b", 5, 5, { starred: true }), pin("c", 300, 0), pin("d", 305, 0)], 8);
    expect(groups.map((group) => group.kind === "cluster" && group.starred)).toEqual([true, false]);
  });

  it("is independent of input order and uses the member mean position", () => {
    const pins = [pin("b", 10, 0), pin("a", 0, 0), pin("c", 20, 0)];
    const forward = clusterPins(pins, 5);
    const reversed = clusterPins([...pins].reverse(), 5);
    expect(forward).toEqual(reversed);
    expect(forward[0]).toMatchObject({ ids: ["a", "b", "c"], latitude: 37 });
    expect(forward[0].kind === "cluster" && forward[0].longitude).toBeCloseTo(127.01, 9);
  });

  it("measures distance from the seed so a chain does not merge into one cluster", () => {
    // a-b and b-c are 40px apart, a-c is 80px: c starts its own group at radius 48.
    const groups = clusterPins([pin("a", 0, 0), pin("b", 40, 0), pin("c", 80, 0)], 4);
    expect(groups).toMatchObject([{ kind: "cluster", ids: ["a", "b"] }, { kind: "pin", pin: { id: "c" } }]);
  });

  it("labels very large clusters", () => {
    const pins = Array.from({ length: 1000 }, (_, index) => pin(String(index).padStart(4, "0"), index % 10, 0));
    expect(clusterPins(pins, 12)).toMatchObject([{ kind: "cluster", count: 1000, size: 56, label: "999+" }]);
  });
});

describe("clusterZoomLevel", () => {
  it("zooms at least two levels and never below level 1", () => {
    expect(clusterZoomLevel(9, 8)).toBe(7);
    expect(clusterZoomLevel(9, 4)).toBe(4);
    expect(clusterZoomLevel(4, 4)).toBe(2);
    expect(clusterZoomLevel(2, 2)).toBe(1);
  });
});
