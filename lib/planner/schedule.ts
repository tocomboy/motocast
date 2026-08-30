import type { PlannedSegment, TimelineSegment } from "./types";

const MINUTE_MS = 60_000;

export type TimelineResult = {
  segments: TimelineSegment[];
  returnAt: string;
  rideMinutes: number;
  stopMinutes: number;
  fitsDesiredReturn: boolean;
  fitsHardReturn: boolean;
};

function asValidDate(value: string, field: string): Date {
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) {
    throw new Error(`${field} must be a valid ISO date-time`);
  }
  return result;
}

export function buildTimeline(input: {
  departureAt: string;
  desiredReturnAt: string;
  hardReturnAt: string;
  segments: PlannedSegment[];
}): TimelineResult {
  const departure = asValidDate(input.departureAt, "departureAt");
  const desiredReturn = asValidDate(input.desiredReturnAt, "desiredReturnAt");
  const hardReturn = asValidDate(input.hardReturnAt, "hardReturnAt");

  if (desiredReturn > hardReturn) {
    throw new Error("desiredReturnAt must not be later than hardReturnAt");
  }

  let cursor = departure;
  let rideMinutes = 0;
  let stopMinutes = 0;

  const segments = input.segments.map((segment) => {
    if (!Number.isFinite(segment.rideMinutes) || segment.rideMinutes <= 0) {
      throw new Error(`segment ${segment.id} must have a positive ride duration`);
    }
    if (!Number.isFinite(segment.to.dwellMinutes) || segment.to.dwellMinutes < 0) {
      throw new Error(`segment ${segment.id} must have a non-negative dwell duration`);
    }

    const segmentDeparture = cursor;
    const arrival = new Date(segmentDeparture.getTime() + segment.rideMinutes * MINUTE_MS);
    const dwellMinutes = segment.to.selected ? segment.to.dwellMinutes : 0;
    const nextDeparture = new Date(arrival.getTime() + dwellMinutes * MINUTE_MS);

    rideMinutes += segment.rideMinutes;
    stopMinutes += dwellMinutes;
    cursor = nextDeparture;

    return {
      ...segment,
      departureAt: segmentDeparture.toISOString(),
      arrivalAt: arrival.toISOString(),
      nextDepartureAt: nextDeparture.toISOString(),
    };
  });

  return {
    segments,
    returnAt: cursor.toISOString(),
    rideMinutes,
    stopMinutes,
    fitsDesiredReturn: cursor <= desiredReturn,
    fitsHardReturn: cursor <= hardReturn,
  };
}

export function formatKoreanTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(asValidDate(value, "value"));
}

export function weatherRiskLabel(segment: PlannedSegment): {
  level: "calm" | "watch" | "danger" | "unknown";
  label: string;
} {
  const weather = segment.weather;
  if (weather.condition === "unknown") return { level: "unknown", label: "예보 확인 필요" };
  if (weather.condition === "snow") return { level: "danger", label: "적설 가능" };
  if (
    weather.condition === "rain" ||
    (weather.precipitationProbability ?? 0) >= 60 ||
    (weather.windSpeedMps ?? 0) >= 10
  ) {
    return { level: "danger", label: "주행 주의" };
  }
  if ((weather.precipitationProbability ?? 0) >= 30 || (weather.windSpeedMps ?? 0) >= 7) {
    return { level: "watch", label: "변화 관찰" };
  }
  return { level: "calm", label: "양호" };
}
