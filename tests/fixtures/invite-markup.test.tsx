import { writeFileSync } from "node:fs";
import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";
import { describe, expect, it, vi } from "vitest";

import { InviteManagerView } from "../../components/invite-manager";
import { PlannerDashboard } from "../../components/planner-dashboard";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => <a {...props}>{children}</a>,
}));

const syntheticInvite = {
  invite_token: "test-invite-token-000000000000000000000000",
  expires_at: "2026-09-23T00:00:00.000Z",
};

describe("mobile invite production markup", () => {
  it("renders the connected header and generated invite controls", () => {
    const plannerMarkup = renderToStaticMarkup(<PlannerDashboard connected />);
    const inviteMarkup = renderToStaticMarkup(
      <main className="admin-page">
        <nav className="admin-nav">
          <Link className="brand brand-dark" href="/" aria-label="MOTOCAST 계획 화면으로 돌아가기">
            <span className="brand-mark">M</span>
            <span>MOTOCAST</span>
          </Link>
          <Link className="text-link" href="/">계획 화면으로 돌아가기</Link>
        </nav>
        <InviteManagerView
          copyInvite={() => undefined}
          createInvite={() => undefined}
          invite={syntheticInvite}
          inviteUrl={`https://example.test/invite#${syntheticInvite.invite_token}`}
          status="링크를 만들었습니다. 이 화면을 떠나면 원문 토큰은 다시 조회할 수 없습니다."
          working={false}
        />
      </main>,
    );

    expect(plannerMarkup).toContain('class="ghost-button" href="/admin/invites"');
    expect(plannerMarkup).toContain(">초대 관리</a>");
    expect(inviteMarkup).toContain(">초대 링크 생성</button>");
    expect(inviteMarkup).toContain('class="ghost-button dark"');
    expect(inviteMarkup).toContain(">복사</button>");

    const outputPath = process.env.MOTOCAST_INVITE_MARKUP_OUTPUT?.trim();
    if (outputPath) writeFileSync(outputPath, JSON.stringify({ plannerMarkup, inviteMarkup }), "utf8");
  });
});
