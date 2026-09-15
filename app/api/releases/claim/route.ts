import { NextResponse } from "next/server";
import { isAuthSessionMissingError } from "@supabase/supabase-js";

import { isTrustedSameOriginJsonRequest } from "@/lib/auth/request-policy";
import { currentVersion } from "@/lib/releases";
import { hasPublicSupabaseEnv } from "@/lib/supabase/env";
import { createServerSupabase } from "@/lib/supabase/server";

const noStoreHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "x-content-type-options": "nosniff",
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failed(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

function isMissingSession(error: { code?: string; status?: number } | null) {
  return error === null
    || isAuthSessionMissingError(error)
    || error.status === 401
    || error.status === 403
    || error.code === "session_not_found"
    || error.code === "refresh_token_not_found";
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginJsonRequest(request)) {
    return failed(400, "업데이트 요청을 확인할 수 없습니다.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (
    !body
    || typeof body !== "object"
    || Array.isArray(body)
    || Object.keys(body).length !== 2
    || !Object.hasOwn(body, "presentationId")
    || !Object.hasOwn(body, "expectedVersion")
    || typeof (body as { presentationId?: unknown }).presentationId !== "string"
    || typeof (body as { expectedVersion?: unknown }).expectedVersion !== "string"
    || !uuidPattern.test((body as { presentationId: string }).presentationId)
  ) {
    return failed(400, "업데이트 요청을 확인할 수 없습니다.");
  }
  const { expectedVersion, presentationId } = body as {
    expectedVersion: string;
    presentationId: string;
  };
  if (expectedVersion !== currentVersion) {
    return failed(409, "새 버전이 준비됐습니다. 새로고침 후 다시 확인해 주세요.");
  }

  if (!hasPublicSupabaseEnv()) {
    return new NextResponse(null, { status: 204, headers: noStoreHeaders });
  }

  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user && isMissingSession(authError)) return failed(401, "로그인이 필요합니다.");
    if (authError || !user) return failed(503, "업데이트 소식을 지금 확인할 수 없습니다.");

    const { data, error } = await supabase.rpc("claim_release_announcement", {
      target_version: currentVersion,
      target_presentation_id: presentationId,
    });
    if (error) {
      if (error.code === "P0001" && error.message === "MEMBERSHIP_REQUIRED") {
        return failed(403, "이 계정에는 서비스 이용 권한이 없습니다.");
      }
      if (error.code === "P0001" && error.message === "AUTH_REQUIRED") {
        return failed(401, "로그인이 필요합니다.");
      }
      return failed(503, "업데이트 소식을 지금 확인할 수 없습니다.");
    }
    if (typeof data !== "boolean") {
      return failed(503, "업데이트 소식을 지금 확인할 수 없습니다.");
    }

    return NextResponse.json({ show: data, version: currentVersion }, { headers: noStoreHeaders });
  } catch {
    return failed(503, "업데이트 소식을 지금 확인할 수 없습니다.");
  }
}
