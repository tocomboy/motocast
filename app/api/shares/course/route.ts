import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { parseCollectionCourse } from "@/lib/collections/contracts";
import { isTrustedSameOriginJsonRequest } from "@/lib/auth/request-policy";
import { createServerSupabase } from "@/lib/supabase/server";

const headers = { "cache-control": "private, no-store, max-age=0", "x-content-type-options": "nosniff" };
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

function failed(status: number, error: string) { return NextResponse.json({ error }, { status, headers }); }
function missingSession(error: { code?: string; status?: number } | null) {
  return error === null || isAuthSessionMissingError(error) || error.status === 401 || error.status === 403 || error.code === "session_not_found" || error.code === "refresh_token_not_found";
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginJsonRequest(request)) return failed(400, "새 일정 요청을 확인할 수 없습니다.");
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1) return failed(400, "공유 링크를 확인해 주세요.");
  const token = (body as Record<string, unknown>).token;
  if (typeof token !== "string" || !tokenPattern.test(token)) return failed(400, "공유 링크를 확인해 주세요.");
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user && missingSession(authError)) return failed(401, "로그인이 필요합니다.");
    if (authError || !user) return failed(503, "로그인 상태를 지금 확인할 수 없습니다.");
    const { data, error } = await supabase.rpc("get_shared_course", { share_token: token });
    if (error) {
      if (error.code === "P0001" && error.message === "AUTH_REQUIRED") return failed(401, "로그인이 필요합니다.");
      if (error.code === "P0001" && error.message === "MEMBERSHIP_REQUIRED") return failed(403, "이 계정에는 서비스 이용 권한이 없습니다.");
      if (error.code === "P0001" && error.message === "SHARE_NOT_FOUND") return failed(404, "공유 링크가 없거나 회수되었습니다.");
      if (error.code === "P0001" && error.message === "SHARE_COURSE_UNAVAILABLE") return failed(409, "이 공유본은 새 일정으로 사용할 수 없습니다. 새 공유 링크를 요청해 주세요.");
      return failed(503, "새 일정을 지금 시작할 수 없습니다. 잠시 뒤 다시 시도해 주세요.");
    }
    try {
      return NextResponse.json({ course: parseCollectionCourse(data) }, { headers });
    } catch {
      return failed(503, "새 일정 경로를 안전하게 확인할 수 없습니다.");
    }
  } catch {
    return failed(503, "새 일정을 지금 시작할 수 없습니다. 잠시 뒤 다시 시도해 주세요.");
  }
}
