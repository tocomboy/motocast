import { redirect } from "next/navigation";

import { PlannerDashboard } from "@/components/planner-dashboard";
import { hasPublicSupabaseEnv } from "@/lib/supabase/env";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function HomePage() {
  const connected = hasPublicSupabaseEnv();

  if (connected) {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    const { data: membership } = await supabase
      .from("memberships")
      .select("role")
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .maybeSingle();
    if (!membership) redirect("/login?error=not_invited");
  }

  return <PlannerDashboard connected={connected} />;
}
