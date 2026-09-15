import { NextResponse } from "next/server";

import { isInviteToken } from "@/lib/auth/invite-cookie";
import { isTrustedInviteAcceptanceRequest } from "@/lib/auth/invite-request";

const noStoreHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "x-content-type-options": "nosniff",
};

function invalidRequest() {
  return NextResponse.json({ error: "초대 요청을 확인할 수 없습니다." }, {
    status: 400,
    headers: noStoreHeaders,
  });
}

export async function POST(request: Request) {
  if (!isTrustedInviteAcceptanceRequest(request)) return invalidRequest();

  let token: unknown;
  try {
    token = (await request.json() as { token?: unknown }).token;
  } catch {
    token = null;
  }
  if (typeof token !== "string" || !isInviteToken(token)) {
    return invalidRequest();
  }

  const response = NextResponse.json({ accepted: true }, {
    headers: noStoreHeaders,
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
