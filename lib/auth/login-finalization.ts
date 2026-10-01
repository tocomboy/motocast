import type { createServerSupabase } from "../supabase/server";

type LoginClient = Awaited<ReturnType<typeof createServerSupabase>>;
export type LoginFinalization = "accepted" | "membership_required";

export async function finalizeAuthenticatedLogin(
  supabase: LoginClient,
): Promise<LoginFinalization> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return "membership_required";
  const { data: membership, error } = await supabase.from("memberships")
    .select("user_id").eq("user_id", user.id).is("revoked_at", null).maybeSingle();
  return !error && membership ? "accepted" : "membership_required";
}
