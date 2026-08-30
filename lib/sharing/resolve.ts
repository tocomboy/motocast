import "server-only";

import { parseSharedRideSnapshot } from "@/lib/sharing/contracts";
import { createServerSupabase } from "@/lib/supabase/server";

export async function resolvePublicShare(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("resolve_share", { share_token: token });
  if (error || !data) return null;
  try {
    return parseSharedRideSnapshot(data);
  } catch {
    return null;
  }
}
