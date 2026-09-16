import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { isTrustedSameOriginJsonRequest } from "@/lib/auth/request-policy";
import { createServerSupabase } from "@/lib/supabase/server";

const noStoreHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "x-content-type-options": "nosniff",
};
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failed(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

function missingSession(error: { code?: string; status?: number } | null) {
  return error === null
    || isAuthSessionMissingError(error)
    || error.status === 401
    || error.status === 403
    || error.code === "session_not_found"
    || error.code === "refresh_token_not_found";
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginJsonRequest(request)) {
    return failed(400, "저장 요청을 확인할 수 없습니다.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 3) {
    return failed(400, "저장 요청을 확인할 수 없습니다.");
  }
  const { token, saveOperationId, title } = body as Record<string, unknown>;
  if (
    typeof token !== "string" || !tokenPattern.test(token)
    || typeof saveOperationId !== "string" || !uuidPattern.test(saveOperationId)
    || typeof title !== "string" || title.trim().length < 1 || title.trim().length > 120
  ) {
    return failed(400, "저장할 컬렉션 이름과 공유 링크를 확인해 주세요.");
  }

  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user && missingSession(authError)) return failed(401, "로그인이 필요합니다.");
    if (authError || !user) return failed(503, "로그인 상태를 지금 확인할 수 없습니다.");

    const { data, error } = await supabase.rpc("save_shared_collection", {
      share_token: token,
      save_operation_id: saveOperationId,
      collection_title: title.trim(),
    });
    if (error) {
      if (error.code === "P0001" && error.message === "AUTH_REQUIRED") return failed(401, "로그인이 필요합니다.");
      if (error.code === "P0001" && error.message === "MEMBERSHIP_REQUIRED") return failed(403, "이 계정에는 서비스 이용 권한이 없습니다.");
      if (error.code === "P0001" && error.message === "SHARE_NOT_FOUND") return failed(404, "공유 링크가 없거나 회수되었습니다.");
      if (error.code === "P0001" && error.message === "SHARE_COURSE_UNAVAILABLE") {
        return failed(409, "이 공유본은 내 경로로 저장할 수 없습니다. 보낸 사람에게 경로를 다시 계산해 새 링크를 만들어 달라고 요청해 주세요.");
      }
      if (error.code === "P0001" && error.message === "COLLECTION_OPERATION_REUSED") {
        return failed(409, "저장할 이름이 바뀌었습니다. 다시 시도해 주세요.");
      }
      if (error.code === "P0001" && error.message === "INVALID_SAVE_REQUEST") {
        return failed(400, "저장할 컬렉션 이름과 공유 링크를 확인해 주세요.");
      }
      return failed(503, "내 경로로 지금 저장할 수 없습니다. 잠시 뒤 다시 시도해 주세요.");
    }
    const result = Array.isArray(data) ? data[0] : null;
    if (
      !result || typeof result !== "object"
      || typeof (result as { collection_id?: unknown }).collection_id !== "string"
      || typeof (result as { version_id?: unknown }).version_id !== "string"
      || !Number.isInteger((result as { version_number?: unknown }).version_number)
    ) {
      return failed(503, "내 경로로 지금 저장할 수 없습니다. 잠시 뒤 다시 시도해 주세요.");
    }
    return NextResponse.json({
      collectionId: (result as { collection_id: string }).collection_id,
      versionId: (result as { version_id: string }).version_id,
      versionNumber: (result as { version_number: number }).version_number,
    }, { headers: noStoreHeaders });
  } catch {
    return failed(503, "내 경로로 지금 저장할 수 없습니다. 잠시 뒤 다시 시도해 주세요.");
  }
}
