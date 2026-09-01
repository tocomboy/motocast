import { formatElapsedAge, formatKoreanDateTime } from "../planner/schedule";

import type { WeatherFailureKind, WeatherTimelineResponse } from "./provider-contract";

export type PlannerWeatherStatus = {
  header: string;
  notice: string;
  expired: boolean;
};

export function weatherFailureLabel(kind: WeatherFailureKind | undefined) {
  return {
    provider: "기상청 공급자 오류",
    budget: "무료 API 한도 소진",
    configuration: "날씨 설정 오류",
    persistence: "날씨 저장 처리 오류",
    request: "날씨 요청 확인 오류",
  }[kind ?? "request"];
}

export function isFreshWeatherForSharing(response: WeatherTimelineResponse, referenceTime: string) {
  return !response.stale && new Date(response.validUntil).getTime() > new Date(referenceTime).getTime();
}

export function formatPlannerWeatherStatus(
  response: WeatherTimelineResponse,
  referenceTime: string,
): PlannerWeatherStatus {
  const expired = new Date(response.validUntil).getTime() < new Date(referenceTime).getTime();
  const issued = `${formatKoreanDateTime(response.issuedAt)} 발행`;
  const stored = `${formatKoreanDateTime(response.generatedAt)} 저장 (${formatElapsedAge(response.generatedAt, referenceTime)})`;
  const staleLabel = weatherFailureLabel(response.failureKind);
  const failure = response.stale
    ? `${staleLabel} 후 저장본${response.staleObservedAt ? ` · ${formatKoreanDateTime(response.staleObservedAt)} 실패 확인` : ""}`
    : response.source === "cache"
      ? "최근 저장 예보"
      : "실시간 조회 예보";
  const expiry = expired
    ? `예보 유효 시각 ${formatKoreanDateTime(response.validUntil)} 만료`
    : `예보 유효 시각 ${formatKoreanDateTime(response.validUntil)}`;

  return {
    header: `${issued} · ${stored} · ${failure} · ${expiry}`,
    notice: response.stale
      ? `${staleLabel}로 ${stored}을 표시합니다. ${failure} · ${expiry}. ${response.staleReason}`
      : response.source === "cache"
        ? `${stored}을 사용했습니다. ${expiry}. 날씨는 경로 순위에 반영하지 않습니다.`
        : `${issued}를 구간 통과 예상 시각에 맞춰 저장했습니다. ${expiry}. 날씨는 경로 순위에 반영하지 않습니다.`,
    expired,
  };
}
