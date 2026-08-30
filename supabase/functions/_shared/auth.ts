import { createClient } from "npm:@supabase/supabase-js@2.100.1";

export function authenticatedClient(request: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = request.headers.get("authorization");
  if (!url || !anonKey || !authorization) throw new Error("AUTH_REQUIRED");
  return createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
}

export function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) throw new Error("SERVER_STORAGE_NOT_CONFIGURED");
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireMember(request: Request) {
  const supabase = authenticatedClient(request);
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("AUTH_REQUIRED");
  const { data: membership, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (error || !membership) throw new Error("MEMBERSHIP_REQUIRED");
  return { supabase, user, membership };
}

export async function consumeBudget(
  memberId: string,
  provider: string,
  operation: string,
  configuredLimit: number,
) {
  const { data, error } = await serviceClient().rpc("consume_daily_api_budget_internal", {
    api_provider: provider,
    api_operation: operation,
    configured_limit: configuredLimit,
    member_id: memberId,
  });
  if (error) throw new Error(error.message);
  return data as number;
}
