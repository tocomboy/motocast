import "server-only";

import { resolvePublicShareWithClient, type PublicShareResolution } from "@/lib/sharing/resolve-core";
import { createServerSupabase } from "@/lib/supabase/server";

export type { PublicShareResolution } from "@/lib/sharing/resolve-core";

export async function resolvePublicShare(token: string): Promise<PublicShareResolution> {
  const result = await resolvePublicShareWithClient(token, createServerSupabase);
  if (result.status === "unavailable") console.error("public share resolver unavailable");
  if (result.status === "invalid-snapshot") console.error("public share snapshot contract rejected");
  return result;
}
