"use client";

import { useEffect } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { clearPendingInvite, hasPendingInvite } from "@/lib/places/folder-invite-token";

const sessionStore = () => window.sessionStorage;

/**
 * Removes a stored folder-invite token (contract §8): on every page's first run when it is older
 * than 30 minutes or malformed, on sign-out, and when another account signs in.
 * `clearOnMount` is for login failure and cancel screens.
 */
export function InviteTokenSweeper({ clearOnMount = false }: { clearOnMount?: boolean }) {
  useEffect(() => {
    if (clearOnMount) clearPendingInvite(sessionStore);
    else hasPendingInvite(sessionStore);
    if (clearOnMount) return;
    const client = getBrowserSupabase();
    if (!client?.auth) return;
    let known: string | null = null;
    const { data } = client.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      const id = session?.user.id ?? null;
      if (event === "SIGNED_OUT" || (known && id && known !== id)) clearPendingInvite(sessionStore);
      if (id) known = id;
    });
    return () => data.subscription.unsubscribe();
  }, [clearOnMount]);
  return null;
}
