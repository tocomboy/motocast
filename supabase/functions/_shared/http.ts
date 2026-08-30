export const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

export function corsHeaders(request: Request): HeadersInit | null {
  const origin = request.headers.get("origin");
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:3000")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (origin && !allowed.includes(origin)) return null;
  return {
    "access-control-allow-origin": origin ?? allowed[0],
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "Origin",
  };
}

export function jsonResponse(body: unknown, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...cors } });
}

export function safeErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "요청을 처리하지 못했습니다.";
  if (error.message.includes("API_DAILY_BUDGET_EXHAUSTED")) return "오늘의 무료 API 사용 한도를 모두 사용했습니다.";
  if (error.message.includes("API_BUDGET_NOT_CONFIGURED")) return "무료 API 사용 한도가 설정되지 않았습니다.";
  if (error.message.includes("MEMBERSHIP_REQUIRED")) return "서비스 이용 권한이 없습니다.";
  if (error.message === "INVALID_PLACE_PROVIDER_RESPONSE") return "장소 검색 공급자의 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (error.message === "INVALID_ROUTE_PROVIDER_RESPONSE") return "경로 공급자의 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (error.message.startsWith("INVALID_")) return "입력값을 확인해 주세요.";
  if (error.message === "PLACE_OUTSIDE_KOREA") return "대한민국 안의 장소만 선택할 수 있습니다.";
  if (error.message === "KAKAO_PLACE_SEARCH_FAILED") return "장소 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  if (error.message === "PLACE_VERIFICATION_NOT_CONFIGURED") return "장소 검증 설정이 완료되지 않았습니다.";
  if (error.message === "UNVERIFIED_PLACE") return "검색 결과에서 장소를 다시 선택해 주세요.";
  if (error.message === "SAFE_ROUTE_NOT_FOUND") return "오토바이 안전 조건을 만족하는 경로를 찾지 못했습니다.";
  if (error.message === "ROUTE_EXCEEDS_HARD_RETURN") return "최종 복귀 시각 안에 도착하는 경로를 찾지 못했습니다.";
  if (error.message === "PROVIDER_NOT_CONFIGURED") return "경로 공급자 설정이 완료되지 않았습니다.";
  if (["PROVIDER_AUTH_FAILED", "PROVIDER_RATE_LIMITED", "PROVIDER_UNAVAILABLE", "PROVIDER_REQUEST_REJECTED"].includes(error.message)) {
    return "경로 공급자에 일시적인 문제가 있습니다. 기존 저장 계획은 유지됩니다.";
  }
  return "외부 서비스 요청에 실패했습니다. 기존 저장 계획은 유지됩니다.";
}

export function safeErrorStatus(error: unknown) {
  if (!(error instanceof Error)) return 500;
  if (error.message.includes("AUTH_REQUIRED")) return 401;
  if (error.message.includes("MEMBERSHIP_REQUIRED")) return 403;
  if (error.message.includes("API_DAILY_BUDGET_EXHAUSTED")) return 429;
  if (error.message === "ROUTE_EXCEEDS_HARD_RETURN") return 422;
  if (
    error.message.includes("NOT_CONFIGURED") ||
    error.message === "PROVIDER_NOT_CONFIGURED"
  ) return 503;
  if (
    error.message === "INVALID_PLACE_PROVIDER_RESPONSE" ||
    error.message === "INVALID_ROUTE_PROVIDER_RESPONSE" ||
    error.message === "KAKAO_PLACE_SEARCH_FAILED" ||
    error.message === "SAFE_ROUTE_NOT_FOUND"
  ) return 502;
  if (["PROVIDER_AUTH_FAILED", "PROVIDER_RATE_LIMITED", "PROVIDER_UNAVAILABLE"].includes(error.message)) return 503;
  if (error.message === "PROVIDER_REQUEST_REJECTED") return 502;
  if (error.message.startsWith("INVALID_") || error.message === "UNVERIFIED_PLACE") return 400;
  return 502;
}
