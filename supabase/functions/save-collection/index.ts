import { corsHeaders, jsonResponse } from "../_shared/http.ts";

export async function handleRollbackCollectionSave(request: Request) {
  const cors = corsHeaders(request);
  if (!cors) return jsonResponse({ error: "ORIGIN_NOT_ALLOWED" }, 403, {});
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405, cors);

  return jsonResponse({
    error: "롤백 안전 모드에서는 컬렉션 변경을 일시적으로 사용할 수 없습니다.",
  }, 503, cors);
}

Deno.serve(handleRollbackCollectionSave);
