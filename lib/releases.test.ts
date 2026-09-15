import lockfile from "@/package-lock.json";
import packageMetadata from "@/package.json";
import { describe, expect, it } from "vitest";

import { currentVersion, releaseNotes } from "./releases";

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function numericVersion(version: string) {
  return version.split(".").map(Number);
}

describe("release notes", () => {
  it("keeps package metadata, lockfile metadata, and the latest release aligned", () => {
    expect(currentVersion).toBe(packageMetadata.version);
    expect(lockfile.version).toBe(packageMetadata.version);
    expect(lockfile.packages[""].version).toBe(packageMetadata.version);
    expect(releaseNotes[0]?.version).toBe(currentVersion);
  });

  it("uses unique strict SemVer versions in descending numeric order", () => {
    const versions = releaseNotes.map((release) => release.version);
    expect(versions.every((version) => semverPattern.test(version))).toBe(true);
    expect(new Set(versions).size).toBe(versions.length);

    for (let index = 1; index < versions.length; index += 1) {
      const previous = numericVersion(versions[index - 1]);
      const current = numericVersion(versions[index]);
      const comparison = previous.findIndex((part, partIndex) => part !== current[partIndex]);
      expect(comparison).toBeGreaterThanOrEqual(0);
      expect(previous[comparison]).toBeGreaterThan(current[comparison]);
    }
  });

  it("keeps every dated release readable and concise", () => {
    for (let index = 0; index < releaseNotes.length; index += 1) {
      const release = releaseNotes[index];
      const date = new Date(`${release.date}T00:00:00Z`);
      expect(Number.isNaN(date.valueOf())).toBe(false);
      expect(date.toISOString().slice(0, 10)).toBe(release.date);
      expect(release.title.trim()).not.toBe("");
      expect(release.summary.trim()).not.toBe("");
      expect(release.bullets.length).toBeGreaterThanOrEqual(2);
      expect(release.bullets.length).toBeLessThanOrEqual(4);
      expect(release.bullets.every((bullet) => bullet.trim().length > 0)).toBe(true);

      if (index > 0) {
        expect(releaseNotes[index - 1].date >= release.date).toBe(true);
      }
    }
  });
});
