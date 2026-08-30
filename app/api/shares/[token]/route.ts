import { NextResponse } from "next/server";

import { resolvePublicShare } from "@/lib/sharing/resolve";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const result = await resolvePublicShare(token);
  if (result.status === "not-found") {
    return NextResponse.json({ error: "공유 링크가 없거나 회수되었습니다." }, {
      status: 404,
      headers: { "cache-control": "private, no-store, max-age=0" },
    });
  }
  if (result.status !== "found") {
    return NextResponse.json({ error: "공유 정보를 지금 불러올 수 없습니다." }, {
      status: 503,
      headers: { "cache-control": "private, no-store, max-age=0", "retry-after": "30" },
    });
  }
  return NextResponse.json({ snapshot: result.snapshot }, {
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
