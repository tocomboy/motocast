import { NextResponse } from "next/server";

import { consumeKakaoOidcHandoff, isKakaoOidcHandoff } from "@/lib/auth/kakao-oidc";
import { finalizeAuthenticatedLogin } from "@/lib/auth/login-finalization";
import { isTrustedSameOriginJsonRequest } from "@/lib/auth/request-policy";
import { isSupabaseAuthCookieName, supabaseAuthCookieNames } from "@/lib/auth/session-cookies";
import { publicSupabaseEnv } from "@/lib/supabase/env";
import { createServerSupabase } from "@/lib/supabase/server";

const noStoreHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "x-content-type-options": "nosniff",
};

function completionResponse(redirect: string, status: number) {
  const response = NextResponse.json({ redirect }, { status, headers: noStoreHeaders });
  response.cookies.delete("motocast_invite");
  return response;
}

function invalidCompletion() {
  return completionResponse("/login?error=callback", 400);
}

async function deniedCompletion(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  authCookieNames: ReadonlySet<string>,
  redirect: "/login?error=invalid_invite" | "/login?error=invite_required",
) {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) console.error("local sign-out failed after denied Kakao OIDC completion");
  const response = completionResponse(redirect, 403);
  for (const name of authCookieNames) response.cookies.delete(name);
  return response;
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginJsonRequest(request)) return invalidCompletion();
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > 1024) return invalidCompletion();

  let handoff: unknown;
  try {
    handoff = (await request.json() as { handoff?: unknown }).handoff;
  } catch {
    handoff = null;
  }
  if (!isKakaoOidcHandoff(handoff)) return invalidCompletion();

  const authCookieNames = new Set(supabaseAuthCookieNames(request.headers.get("cookie")));
  const supabase = await createServerSupabase((names) => {
    names.filter(isSupabaseAuthCookieName).forEach((name) => authCookieNames.add(name));
  });

  try {
    const { url, publishableKey } = publicSupabaseEnv();
    const oidc = await consumeKakaoOidcHandoff(url, publishableKey, new URL(request.url).origin, handoff);
    const { error } = await supabase.auth.signInWithIdToken({
      provider: "kakao",
      token: oidc.idToken,
      access_token: oidc.accessToken,
      nonce: oidc.nonce,
    });
    if (error) throw new Error("OIDC_ID_TOKEN_REJECTED");

    const finalization = await finalizeAuthenticatedLogin(supabase, request.headers.get("cookie"));
    if (finalization === "invalid_invite") {
      return deniedCompletion(supabase, authCookieNames, "/login?error=invalid_invite");
    }
    if (finalization === "invite_required") {
      return deniedCompletion(supabase, authCookieNames, "/login?error=invite_required");
    }
    return completionResponse("/", 200);
  } catch {
    console.error("Kakao OIDC completion failed");
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) console.error("local sign-out failed after Kakao OIDC error");
    const response = invalidCompletion();
    for (const name of authCookieNames) response.cookies.delete(name);
    return response;
  }
}
