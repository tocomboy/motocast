import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// Issue #123 renamed "자주 찾는 곳" to "자주 찾는 장소" everywhere a rider can see or hear it.
// Published release notes (lib/releases.ts) keep their original wording.
it("uses the frequent-place name in every screen source", () => {
  const roots = ["components", "app"];
  const offenders = roots.flatMap((root) =>
    readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(tsx?|css)$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) => readFileSync(join(root, file), "utf8").includes("자주 찾는 곳"))
      .map((file) => join(root, file)),
  );
  expect(offenders).toEqual([]);
});
