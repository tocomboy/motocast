import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import { RollbackCollectionNotice } from "./planner-dashboard";

describe("RollbackCollectionNotice", () => {
  it("closes every collection mutation and apply control visibly", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RollbackCollectionNotice pointCount={3} />);
    });
    expect(renderer.root.findAllByType("button")).toHaveLength(0);
    expect(renderer.root.findByProps({ role: "status" }).children.join(" ")).toContain("저장·새 버전·적용을 일시 중지");
    expect(renderer.root.findByProps({ role: "status" }).children.join(" ")).toMatch(/3\s*개 경유지/);
    await act(async () => renderer.unmount());
  });
});
