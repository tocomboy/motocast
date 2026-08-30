import { NextResponse } from "next/server";

import {
  createKakaoOidcBrowserBinding,
  KAKAO_OIDC_BINDING_COOKIE,
  kakaoOidcBindingHash,
  kakaoOidcStartUrl,
} from "@/lib/auth/kakao-oidc";
import { publicSupabaseEnv } from "@/lib/supabase/env";

export async function GET(request: Request) {
  try {
    const binding = createKakaoOidcBrowserBinding();
    const bindingHash = await kakaoOidcBindingHash(binding);
    const { url } = publicSupabaseEnv();
    const destination = kakaoOidcStartUrl(url, new URL(request.url).origin, bindingHash);
    const response = NextResponse.redirect(destination, {
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
    response.cookies.set(KAKAO_OIDC_BINDING_COOKIE, binding, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 5 * 60,
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/login?error=callback", request.url));
  }
}
