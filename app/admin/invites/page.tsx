import Link from "next/link";
import { redirect } from "next/navigation";

import { InviteManager } from "@/components/invite-manager";
import { hasPublicSupabaseEnv } from "@/lib/supabase/env";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function AdminInvitesPage() {
  if (!hasPublicSupabaseEnv()) redirect("/");

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();

  if (membership?.role !== "admin") redirect("/");

  return (
    <main className="admin-page">
      <nav className="admin-nav">
        <Link className="brand brand-dark" href="/" aria-label="MOTOCAST 계획 화면으로 돌아가기">
          <span className="brand-mark">M</span>
          <span>MOTOCAST</span>
        </Link>
        <Link className="text-link" href="/">계획 화면으로 돌아가기</Link>
      </nav>
      <InviteManager />
    </main>
  );
}
