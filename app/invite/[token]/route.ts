import { NextResponse } from "next/server";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,160}$/;

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const loginUrl = new URL("/login", request.url);
  if (!TOKEN_PATTERN.test(token)) {
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
