import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { publicSupabaseEnv } from "./env";

export async function createServerSupabase() {
  const cookieStore = await cookies();
  const { url, publishableKey } = publicSupabaseEnv();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(items) {
        try {
          items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot set cookies. Route handlers refresh sessions.
        }
      },
    },
  });
}
