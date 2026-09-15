import type { PlannedSegment, TimelineSegment } from "./types";

const MINUTE_MS = 60_000;

export type TimelineResult = {
  segments: TimelineSegment[];
  returnAt: string;
  rideMinutes: number;
  stopMinutes: number;
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
  segments: PlannedSegment[];
}): TimelineResult {
  const departure = asValidDate(input.departureAt, "departureAt");

  let cursor = departure;
  let rideMilliseconds = 0;
  let stopMinutes = 0;

  const segments = input.segments.map((segment) => {
    if (!Number.isFinite(segment.rideMinutes) || segment.rideMinutes <= 0) {
      throw new Error(`segment ${segment.id} must have a positive ride duration`);
    }
    if (!Number.isFinite(segment.to.dwellMinutes) || segment.to.dwellMinutes < 0) {
      throw new Error(`segment ${segment.id} must have a non-negative dwell duration`);
    }

    const exactDeparture = segment.departureAt ? asValidDate(segment.departureAt, `segment ${segment.id} departureAt`) : null;
    const exactArrival = segment.arrivalAt ? asValidDate(segment.arrivalAt, `segment ${segment.id} arrivalAt`) : null;
    if ((exactDeparture === null) !== (exactArrival === null)) {
      throw new Error(`segment ${segment.id} must provide both exact timestamps`);
    }
    const segmentDeparture = exactDeparture ?? cursor;
    if (segmentDeparture.getTime() !== cursor.getTime()) {
      throw new Error(`segment ${segment.id} must be continuous`);
    }
    const arrival = exactArrival ?? new Date(segmentDeparture.getTime() + segment.rideMinutes * MINUTE_MS);
    if (arrival <= segmentDeparture) throw new Error(`segment ${segment.id} must arrive after departure`);
    const dwellMinutes = segment.to.selected ? segment.to.dwellMinutes : 0;
    const nextDeparture = new Date(arrival.getTime() + dwellMinutes * MINUTE_MS);

    rideMilliseconds += arrival.getTime() - segmentDeparture.getTime();
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
    rideMinutes: Math.ceil(rideMilliseconds / MINUTE_MS),
    stopMinutes,
  };
}

export function formatKoreanTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(asValidDate(value, "value"));
}

function seoulDateKey(value: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(asValidDate(value, "value")).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatRideTime(departureAt: string, value: string): string {
  const departureDate = seoulDateKey(departureAt);
  const valueDate = seoulDateKey(value);
  if (valueDate === departureDate) return formatKoreanTime(value);

  const nextDay = new Date(`${departureDate}T00:00:00+09:00`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  if (valueDate === seoulDateKey(nextDay.toISOString())) {
    return `다음 날 ${formatKoreanTime(value)}`;
  }
  return formatKoreanDateTime(value);
}

export function formatKoreanDateTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(asValidDate(value, "value"));
}

export function formatElapsedAge(value: string, referenceTime: string): string {
  const elapsedMinutes = Math.max(0, Math.floor(
    (asValidDate(referenceTime, "referenceTime").getTime() - asValidDate(value, "value").getTime()) / MINUTE_MS,
  ));
  if (elapsedMinutes < 1) return "방금";
  const days = Math.floor(elapsedMinutes / (24 * 60));
  const hours = Math.floor((elapsedMinutes % (24 * 60)) / 60);
  const minutes = elapsedMinutes % 60;
  if (days) return `${days}일 ${hours}시간 전`;
  if (hours) return `${hours}시간 ${minutes}분 전`;
  return `${minutes}분 전`;
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
