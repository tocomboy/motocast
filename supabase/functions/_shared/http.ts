import { MEAL_DWELL_FIXED, MEAL_DWELL_FIXED_MESSAGE } from "./meal-dwell.ts";

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

const routePointMessages = {
  ROUTE_WAYPOINT_ROAD_NOT_FOUND: "경유지 주변에서 연결할 수 있는 도로를 찾지 못했습니다. 경유지를 도로 가까운 장소로 바꿔 주세요.",
  ROUTE_ORIGIN_ROAD_NOT_FOUND: "출발지 주변에서 연결할 수 있는 도로를 찾지 못했습니다. 출발지를 도로 가까운 장소로 바꿔 주세요.",
  ROUTE_DESTINATION_ROAD_NOT_FOUND: "도착지 주변에서 연결할 수 있는 도로를 찾지 못했습니다. 도착지를 도로 가까운 장소로 바꿔 주세요.",
  ROUTE_POINTS_TOO_CLOSE: "출발지와 도착지가 너무 가깝습니다. 서로 떨어진 장소로 바꿔 주세요.",
  ROUTE_ORIGIN_BLOCKED: "출발지 주변 도로의 교통 장애로 경로를 찾지 못했습니다. 다른 출발지를 선택해 주세요.",
  ROUTE_DESTINATION_BLOCKED: "도착지 주변 도로의 교통 장애로 경로를 찾지 못했습니다. 다른 도착지를 선택해 주세요.",
  ROUTE_WAYPOINT_BLOCKED: "경유지 주변 도로의 교통 장애로 경로를 찾지 못했습니다. 다른 경유지를 선택해 주세요.",
} as const;

function routePointMessage(error: Error) {
  return Object.hasOwn(routePointMessages, error.message)
    ? routePointMessages[error.message as keyof typeof routePointMessages]
    : null;
}

export function safeErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "요청을 처리하지 못했습니다.";
  const pointMessage = routePointMessage(error);
  if (pointMessage) return pointMessage;
  if (error.message === MEAL_DWELL_FIXED) return MEAL_DWELL_FIXED_MESSAGE;
  if (error.message === "WEATHER_STORAGE_CAPACITY") return "현재 날씨 정보를 갱신할 수 없습니다. 잠시 후 다시 시도해 주세요.";
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
  if (error.message === "PAST_DEPARTURE") return "지난 출발 시각은 사용할 수 없습니다. 현재 이후 시각을 선택해 주세요.";
  if (error.message === "SAFE_ROUTE_NOT_FOUND") return "오토바이 안전 조건을 만족하는 경로를 찾지 못했습니다.";
  if (error.message === "ROUTE_EXCEEDS_24_HOURS") return "출발 후 24시간 안에 끝나는 경로를 찾지 못했습니다.";
  if (error.message === "CLIENT_ROUTE_POLICY_FORBIDDEN") return "지원하지 않는 경로 설정입니다. 화면을 새로고침한 뒤 다시 시도해 주세요.";
  if (error.message === "PROVIDER_NOT_CONFIGURED") return "경로 공급자 설정이 완료되지 않았습니다.";
  if (error.message === "PROVIDER_AUTH_FAILED") return "경로 공급자 인증 설정을 확인해 주세요. 기존 저장 계획은 유지됩니다.";
  if (["PROVIDER_RATE_LIMITED", "PROVIDER_UNAVAILABLE", "PROVIDER_REQUEST_REJECTED"].includes(error.message)) {
    return "경로 공급자에 일시적인 문제가 있습니다. 기존 저장 계획은 유지됩니다.";
  }
  return "외부 서비스 요청에 실패했습니다. 기존 저장 계획은 유지됩니다.";
}

export function safeErrorCode(error: unknown) {
  if (!(error instanceof Error)) return "ROUTE_REQUEST_FAILED";
  if (routePointMessage(error)) return error.message;
  if (error.message === MEAL_DWELL_FIXED) return MEAL_DWELL_FIXED;
  if (error.message === "SAFE_ROUTE_NOT_FOUND") return "SAFE_ROUTE_NOT_FOUND";
  if (error.message === "ROUTE_EXCEEDS_24_HOURS") return "ROUTE_LIMIT_EXCEEDED";
  if (error.message === "ROUTE_PERSIST_FAILED" || error.message === "INVALID_TRIP_TARGET") return "ROUTE_SAVE_FAILED";
  if (error.message === "INVALID_ROUTE_PROVIDER_RESPONSE") return "ROUTE_RESPONSE_INVALID";
  if (
    error.message.includes("API_DAILY_BUDGET_EXHAUSTED") ||
    error.message.includes("API_BUDGET") ||
    error.message.includes("NOT_CONFIGURED") ||
    error.message === "PROVIDER_AUTH_FAILED"
  ) return "ROUTE_BUDGET_OR_CONFIG";
  if (["PROVIDER_RATE_LIMITED", "PROVIDER_UNAVAILABLE", "PROVIDER_REQUEST_REJECTED"].includes(error.message)) {
    return "ROUTE_PROVIDER_TEMPORARY";
  }
  if (
    error.message.startsWith("INVALID_") ||
    error.message === "UNVERIFIED_PLACE" ||
    error.message === "PAST_DEPARTURE" ||
    error.message === "CLIENT_ROUTE_POLICY_FORBIDDEN"
  ) {
    return "ROUTE_INPUT_INVALID";
  }
  return "ROUTE_REQUEST_FAILED";
}

export function safeErrorStatus(error: unknown) {
  if (!(error instanceof Error)) return 500;
  if (routePointMessage(error)) return 422;
  if (error.message === MEAL_DWELL_FIXED) return 400;
  if (error.message === "WEATHER_STORAGE_CAPACITY") return 503;
  if (error.message.includes("AUTH_REQUIRED")) return 401;
  if (error.message.includes("MEMBERSHIP_REQUIRED")) return 403;
  if (error.message.includes("API_DAILY_BUDGET_EXHAUSTED")) return 429;
  if (error.message === "ROUTE_EXCEEDS_24_HOURS") return 422;
  if (error.message === "CLIENT_ROUTE_POLICY_FORBIDDEN") return 400;
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
  if (error.message.startsWith("INVALID_") || error.message === "UNVERIFIED_PLACE" || error.message === "PAST_DEPARTURE") return 400;
  return 502;
}
