"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { clearPendingInvite, hasPendingInvite, INVITE_PATH } from "@/lib/places/folder-invite-token";

const sessionStore = () => window.sessionStorage;
const LOGIN_PATH = "/login";

/** Paths that continue a login started on /login: the OAuth callback and the invite it returns to. */
const continuesLogin = (path: string) => path === LOGIN_PATH || path === INVITE_PATH || path.startsWith("/auth/");

/**
 * Removes a stored folder-invite token (contract §8): on every page entry, including in-app
 * navigation, when it is older than 30 minutes or malformed; when the login screen is left for
 * anything but the login itself; on sign-out; and when another account signs in.
 * `clearOnMount` is for login failure and cancel screens.
 */
export function InviteTokenSweeper({ clearOnMount = false }: { clearOnMount?: boolean }) {
  const pathname = usePathname() ?? "";
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (clearOnMount) { clearPendingInvite(sessionStore); return; }
    const from = previous.current;
    previous.current = pathname;
    if (from === LOGIN_PATH && !continuesLogin(pathname)) clearPendingInvite(sessionStore);
    else hasPendingInvite(sessionStore);
  }, [pathname, clearOnMount]);

  useEffect(() => {
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
