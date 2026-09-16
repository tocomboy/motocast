import { describe, expect, it } from "vitest";

import { allocateDurationByWeight, allocateRouteDurations, RouteDurationAllocationError } from "./route-duration-allocation";

function sections() {
  return [
    {
      id: "first",
      duration: 300,
      roads: [
        { name: "zero", duration: 0, vertexes: [127, 37, 127.01, 37.01] },
        { name: "first", duration: 300, vertexes: [127.01, 37.01, 127.05, 37.05] },
      ],
    },
    {
      id: "second",
      duration: 420,
      roads: [{ name: "second", duration: 420, vertexes: [127.05, 37.05, 127.1, 37.1] }],
    },
  ];
}

describe("route duration allocation", () => {
  it.each([
    { total: 840, expected: [350, 490] },
    { total: 600, expected: [250, 350] },
  ])("allocates positive and negative mismatches exactly: %#", ({ total, expected }) => {
    const result = allocateRouteDurations(total, sections());
    expect(result.map((section) => section.duration)).toEqual(expected);
    expect(result.flatMap((section) => section.roads).reduce((sum, road) => sum + road.duration, 0)).toBe(total);
  });

  it("uses stable input order to break equal largest remainders", () => {
    expect(allocateDurationByWeight(4, [1, 1, 1])).toEqual([2, 1, 1]);
  });

  it("does not mutate input and preserves geometry, names, order, and zero road weights", () => {
    const input = sections();
    const original = structuredClone(input);
    const result = allocateRouteDurations(840, input);
    expect(input).toEqual(original);
    expect(result.map((section) => section.id)).toEqual(["first", "second"]);
    expect(result.flatMap((section) => section.roads).map((road) => road.name)).toEqual(["zero", "first", "second"]);
    expect(result.flatMap((section) => section.roads).map((road) => road.vertexes)).toEqual(
      original.flatMap((section) => section.roads).map((road) => road.vertexes),
    );
    expect(result[0].roads.map((road) => road.duration)).toEqual([0, 350]);
  });

  it("preserves already equal durations exactly", () => {
    expect(allocateRouteDurations(720, sections())).toEqual(sections());
  });

  it.each([
    () => allocateDurationByWeight(1.5, [1]),
    () => allocateDurationByWeight(-1, [1]),
    () => allocateDurationByWeight(1, [Number.MAX_SAFE_INTEGER + 1]),
    () => allocateDurationByWeight(1, [Number.MAX_SAFE_INTEGER, 1]),
    () => allocateDurationByWeight(1, [0]),
    () => allocateRouteDurations(1, sections()),
    () => allocateRouteDurations(1, [{ duration: 1, roads: [{ duration: -1 }] }]),
  ])("rejects unsafe arithmetic or zero allocated sections %#", (run) => {
    expect(run).toThrow(RouteDurationAllocationError);
  });
});
