import { NextResponse } from "next/server";

import {
  KAKAO_OIDC_BINDING_COOKIE,
  KAKAO_OIDC_BINDING_COOKIE_OPTIONS,
} from "@/lib/auth/kakao-oidc";
import { isTrustedSameOriginJsonRequest } from "@/lib/auth/request-policy";

export async function POST(request: Request) {
  if (!isTrustedSameOriginJsonRequest(request)) {
    return NextResponse.json({ cleared: false }, {
      status: 400,
      headers: { "cache-control": "private, no-store, max-age=0" },
    });
  }
  const response = NextResponse.json({ cleared: true }, {
    headers: { "cache-control": "private, no-store, max-age=0" },
  });
  response.cookies.set(KAKAO_OIDC_BINDING_COOKIE, "", {
    ...KAKAO_OIDC_BINDING_COOKIE_OPTIONS,
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}
