import { NextResponse } from "next/server";

import {
  createKakaoOidcBrowserBinding,
  KAKAO_OIDC_BINDING_COOKIE,
  KAKAO_OIDC_BINDING_COOKIE_OPTIONS,
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
      ...KAKAO_OIDC_BINDING_COOKIE_OPTIONS,
      maxAge: 5 * 60,
    });
    return response;
  } catch {
    const response = NextResponse.redirect(new URL("/login?error=callback", request.url));
    response.cookies.set(KAKAO_OIDC_BINDING_COOKIE, "", {
      ...KAKAO_OIDC_BINDING_COOKIE_OPTIONS,
      maxAge: 0,
      expires: new Date(0),
    });
    return response;
  }
}
