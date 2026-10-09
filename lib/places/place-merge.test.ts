import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchesAvoided, mergePlaces, sourceLabel, type MergeAvoidedInput, type MergeSavedInput, type MergeSharedInput } from "./place-merge";

type Fixture = {
  mergeCases: Array<{
    name: string;
    input: { folders: Record<string, string>; enabledFolderIds: string[]; saved: MergeSavedInput[]; shared: MergeSharedInput[] };
    expected: Array<Record<string, unknown>>;
  }>;
  avoidedCases: Array<{
    name: string;
    place: { kakaoPlaceId: string; latitude: number; longitude: number };
    avoided: MergeAvoidedInput[];
    expected: string | null;
  }>;
};

// The same bytes are used by the Android client (contracts/android/shared-folders/README.md).
const fixture = JSON.parse(
  readFileSync(new URL("../../contracts/android/shared-folders/merge-fixtures.json", import.meta.url), "utf8"),
) as Fixture;

describe("shared folder merged view fixture", () => {
  it("has cases", () => {
    expect(fixture.mergeCases.length).toBeGreaterThan(5);
    expect(fixture.avoidedCases.length).toBeGreaterThan(4);
  });
  for (const testCase of fixture.mergeCases) {
    it(testCase.name, () => {
      const { folders, enabledFolderIds, saved, shared } = testCase.input;
      const merged = mergePlaces(saved, shared, enabledFolderIds);
      expect(merged.map((entry) => ({ ...entry, label: sourceLabel(entry, (id) => folders[id]) }))).toEqual(testCase.expected);
    });
  }
  for (const testCase of fixture.avoidedCases) {
    it(testCase.name, () => {
      expect(matchesAvoided(testCase.place, testCase.avoided)?.id ?? null).toBe(testCase.expected);
    });
  }
  it("does not depend on the order shared rows arrive in", () => {
    const { saved, shared, enabledFolderIds } = fixture.mergeCases[1].input;
    expect(mergePlaces(saved, [...shared].reverse(), enabledFolderIds)).toEqual(mergePlaces(saved, shared, enabledFolderIds));
  });
});
