import { writeFileSync } from "node:fs";
import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PlannerDashboard } from "../../components/planner-dashboard";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => <a {...props}>{children}</a>,
}));

describe("member home production markup", () => {
  it("keeps member navigation without retired invite controls", () => {
    const plannerMarkup = renderToStaticMarkup(<PlannerDashboard connected />);
    expect(plannerMarkup).not.toContain("/admin/invites");
    expect(plannerMarkup).not.toContain("초대 관리");
    const outputPath = process.env.MOTOCAST_INVITE_MARKUP_OUTPUT?.trim();
    if (outputPath) writeFileSync(outputPath, JSON.stringify({ plannerMarkup }), "utf8");
  });
});
