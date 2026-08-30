import { createBrowserClient } from "@supabase/ssr";

import { hasPublicSupabaseEnv, publicSupabaseEnv } from "./env";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function getBrowserSupabase() {
  if (!hasPublicSupabaseEnv()) return null;
  if (!browserClient) {
    const { url, publishableKey } = publicSupabaseEnv();
    browserClient = createBrowserClient(url, publishableKey);
  }
  return browserClient;
}
