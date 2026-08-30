import { NextResponse } from "next/server";

import { resolvePublicShare } from "@/lib/sharing/resolve";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const snapshot = await resolvePublicShare(token);
  if (!snapshot) {
    return NextResponse.json({ error: "공유 링크가 없거나 회수되었습니다." }, {
      status: 404,
      headers: { "cache-control": "private, no-store, max-age=0" },
    });
  }
  return NextResponse.json({ snapshot }, {
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
