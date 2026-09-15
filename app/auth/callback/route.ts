import { NextResponse } from "next/server";

import { finalizeAuthenticatedLogin } from "@/lib/auth/login-finalization";
import { isSupabaseAuthCookieName, supabaseAuthCookieNames } from "@/lib/auth/session-cookies";
import { createServerSupabase } from "@/lib/supabase/server";

function callbackErrorResponse(url: URL) {
  const response = NextResponse.redirect(new URL("/login?error=callback", url));
  response.cookies.delete("motocast_invite");
  return response;
}

async function deniedAfterExchange(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  authCookieNames: ReadonlySet<string>,
  url: URL,
  error: "invalid_invite" | "invite_required",
) {
  const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
  if (signOutError) console.error("local sign-out failed after denied OAuth callback");
  const response = NextResponse.redirect(new URL(`/login?error=${error}`, url));
  response.cookies.delete("motocast_invite");
  for (const name of authCookieNames) {
    response.cookies.delete(name);
  }
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return callbackErrorResponse(url);

  const authCookieNames = new Set(supabaseAuthCookieNames(request.headers.get("cookie")));
  const supabase = await createServerSupabase((names) => {
    names.filter(isSupabaseAuthCookieName).forEach((name) => authCookieNames.add(name));
  });
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) return callbackErrorResponse(url);

  const finalization = await finalizeAuthenticatedLogin(supabase, request.headers.get("cookie"));
  if (finalization !== "accepted") {
    return deniedAfterExchange(supabase, authCookieNames, url, finalization);
  }

  const response = NextResponse.redirect(new URL("/", url));
  response.cookies.delete("motocast_invite");
  return response;
}
