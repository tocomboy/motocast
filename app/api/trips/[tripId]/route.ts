import { NextResponse } from "next/server";

import { isTrustedSameOriginJsonRequest } from "@/lib/auth/request-policy";
import { createServerSupabase } from "@/lib/supabase/server";

const headers = {
  "cache-control": "private, no-store, max-age=0",
  "x-content-type-options": "nosniff",
};

function failed(status: number) {
  return NextResponse.json({ deleted: false }, { status, headers });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  if (!isTrustedSameOriginJsonRequest(request)) return failed(400);
  const { tripId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tripId)) {
    return failed(400);
  }

  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("delete_owned_trip", { target_trip_id: tripId });
    if (error || data !== true) return failed(404);
    return NextResponse.json({ deleted: true }, { headers });
  } catch {
    return failed(503);
  }
}
