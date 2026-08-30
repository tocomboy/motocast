import { inviteTokenFromCookieHeader } from "./invite-cookie";
import type { createServerSupabase } from "../supabase/server";

type LoginClient = Awaited<ReturnType<typeof createServerSupabase>>;
export type LoginFinalization = "accepted" | "invalid_invite" | "invite_required";

export async function finalizeAuthenticatedLogin(
  supabase: LoginClient,
  cookieHeader: string | null,
): Promise<LoginFinalization> {
  const token = inviteTokenFromCookieHeader(cookieHeader);
  if (token) {
    const { error } = await supabase.rpc("claim_invite", { invite_token: token });
    return error ? "invalid_invite" : "accepted";
  }

  const { data: { user } } = await supabase.auth.getUser();
  const { data: membership } = user
    ? await supabase.from("memberships").select("user_id").eq("user_id", user.id).is("revoked_at", null).maybeSingle()
    : { data: null };
  return membership ? "accepted" : "invite_required";
}
