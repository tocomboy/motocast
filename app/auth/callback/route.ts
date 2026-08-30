import { NextResponse } from "next/server";

import { inviteTokenFromCookieHeader } from "@/lib/auth/invite-cookie";
import { createServerSupabase } from "@/lib/supabase/server";

async function deniedResponse(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  url: URL,
  error: "callback" | "invalid_invite" | "invite_required",
) {
  await supabase.auth.signOut();
  const response = NextResponse.redirect(new URL(`/login?error=${error}`, url));
  response.cookies.delete("motocast_invite");
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?error=callback", url));

  const supabase = await createServerSupabase();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) return deniedResponse(supabase, url, "callback");

  const token = inviteTokenFromCookieHeader(request.headers.get("cookie"));

  if (token) {
    const { error: claimError } = await supabase.rpc("claim_invite", { invite_token: token });
    if (claimError) {
      return deniedResponse(supabase, url, "invalid_invite");
    }
  } else {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: membership } = user
      ? await supabase.from("memberships").select("user_id").eq("user_id", user.id).is("revoked_at", null).maybeSingle()
      : { data: null };
    if (!membership) return deniedResponse(supabase, url, "invite_required");
  }

  const response = NextResponse.redirect(new URL("/", url));
  response.cookies.delete("motocast_invite");
  return response;
}
