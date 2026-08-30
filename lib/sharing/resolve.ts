import "server-only";

import { parseSharedRideSnapshot } from "@/lib/sharing/contracts";
import { createServerSupabase } from "@/lib/supabase/server";

export type PublicShareResolution =
  | { status: "found"; snapshot: ReturnType<typeof parseSharedRideSnapshot> }
  | { status: "not-found" }
  | { status: "unavailable" | "invalid-snapshot" };

export async function resolvePublicShare(token: string): Promise<PublicShareResolution> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { status: "not-found" };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("resolve_share", { share_token: token });
  if (error) {
    if (error.message.includes("SHARE_NOT_FOUND")) return { status: "not-found" };
    console.error("public share resolver unavailable");
    return { status: "unavailable" };
  }
  if (!data) return { status: "not-found" };
  try {
    return { status: "found", snapshot: parseSharedRideSnapshot(data) };
  } catch {
    console.error("public share snapshot contract rejected");
    return { status: "invalid-snapshot" };
  }
}
