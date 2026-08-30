import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?error=callback", url));

  const supabase = await createServerSupabase();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) return NextResponse.redirect(new URL("/login?error=callback", url));

  const inviteToken = url.searchParams.get("invite") ?? undefined;
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieToken = cookieHeader.match(/(?:^|;\s*)motocast_invite=([^;]+)/)?.[1];
  const token = inviteToken ?? (cookieToken ? decodeURIComponent(cookieToken) : undefined);

  if (token) {
    const { error: claimError } = await supabase.rpc("claim_invite", { invite_token: token });
    if (claimError) {
      const response = NextResponse.redirect(new URL("/login?error=invalid_invite", url));
      response.cookies.delete("motocast_invite");
      return response;
    }
  } else {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: membership } = user
      ? await supabase.from("memberships").select("user_id").eq("user_id", user.id).is("revoked_at", null).maybeSingle()
      : { data: null };
    if (!membership) return NextResponse.redirect(new URL("/login?error=invite_required", url));
  }

  const response = NextResponse.redirect(new URL("/", url));
  response.cookies.delete("motocast_invite");
  return response;
}
