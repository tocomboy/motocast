import { NextResponse } from "next/server";

import { isInviteToken } from "@/lib/auth/invite-cookie";

export async function POST(request: Request) {
  let token: unknown;
  try {
    token = (await request.json() as { token?: unknown }).token;
  } catch {
    token = null;
  }
  if (typeof token !== "string" || !isInviteToken(token)) {
    return NextResponse.json({ error: "초대 링크가 올바르지 않습니다." }, {
      status: 400,
      headers: { "cache-control": "private, no-store, max-age=0" },
    });
  }

  const response = NextResponse.json({ accepted: true }, {
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
  response.cookies.set("motocast_invite", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 30,
    path: "/",
  });
  return response;
}
