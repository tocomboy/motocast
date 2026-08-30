import { NextResponse } from "next/server";

import { isInviteToken } from "@/lib/auth/invite-cookie";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const loginUrl = new URL("/login", request.url);
  if (!isInviteToken(token)) {
    loginUrl.searchParams.set("error", "invalid_invite");
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.redirect(loginUrl);
  response.cookies.set("motocast_invite", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 30,
    path: "/",
  });
  return response;
}
