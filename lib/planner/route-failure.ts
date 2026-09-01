export type RouteFailureCode =
  | "ROUTE_INPUT_INVALID"
  | "SAFE_ROUTE_NOT_FOUND"
  | "ROUTE_PROVIDER_TEMPORARY"
  | "ROUTE_BUDGET_OR_CONFIG"
  | "ROUTE_SAVE_FAILED"
  | "ROUTE_RESPONSE_INVALID"
  | "ROUTE_LIMIT_EXCEEDED"
  | "ROUTE_REQUEST_FAILED";

const codes = new Set<RouteFailureCode>([
  "ROUTE_INPUT_INVALID",
  "SAFE_ROUTE_NOT_FOUND",
  "ROUTE_PROVIDER_TEMPORARY",
  "ROUTE_BUDGET_OR_CONFIG",
  "ROUTE_SAVE_FAILED",
  "ROUTE_RESPONSE_INVALID",
  "ROUTE_LIMIT_EXCEEDED",
  "ROUTE_REQUEST_FAILED",
]);

export async function readRouteFailureCode(error: unknown): Promise<RouteFailureCode> {
  if (!error || typeof error !== "object") return "ROUTE_REQUEST_FAILED";
  const context = (error as { context?: unknown }).context;
  if (!(context instanceof Response)) return "ROUTE_REQUEST_FAILED";
  try {
    const body = await context.clone().json() as { code?: unknown };
    return typeof body.code === "string" && codes.has(body.code as RouteFailureCode)
      ? body.code as RouteFailureCode
      : "ROUTE_REQUEST_FAILED";
  } catch {
    return "ROUTE_REQUEST_FAILED";
  }
}

export function routeFailureNotice(code: RouteFailureCode, staleRoute: boolean) {
  const suffix = staleRoute
    ? " 이전 실제 경로는 참고용으로만 유지됩니다."
    : " 예시 경로를 실제 결과로 바꾸지 않았습니다.";
  const message = {
    ROUTE_INPUT_INVALID: "장소 선택 또는 출발 시각이 유효하지 않습니다. 검색 결과를 다시 선택하고 현재 이후 시각인지 확인해 주세요.",
    SAFE_ROUTE_NOT_FOUND: "선택한 모든 지점을 지나는 오토바이 안전 경로가 없습니다. 경유지나 휴식지를 조정해 주세요.",
    ROUTE_PROVIDER_TEMPORARY: "경로 공급자가 일시적으로 응답하지 않습니다. 잠시 뒤 같은 계획으로 다시 시도해 주세요.",
    ROUTE_BUDGET_OR_CONFIG: "경로 API 사용 한도 또는 서비스 설정을 확인해야 합니다. 관리자에게 문의해 주세요.",
    ROUTE_SAVE_FAILED: "계산된 경로를 저장하지 못했습니다. 입력을 바꾸지 말고 다시 시도해 주세요.",
    ROUTE_RESPONSE_INVALID: "경로 공급자 응답을 안전하게 검증하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
    ROUTE_LIMIT_EXCEEDED: "출발 후 24시간 안에 끝나는 계획으로 정차 시간이나 경유지를 줄여 주세요.",
    ROUTE_REQUEST_FAILED: "추천 경로 계산을 완료하지 못했습니다. 입력과 연결 상태를 확인한 뒤 다시 시도해 주세요.",
  }[code];
  return `${message}${suffix}`;
}
