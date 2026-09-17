export function formatRideDuration(minutes: number) {
  const rounded = Math.max(0, Math.ceil(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (!hours) return `${remainder}분`;
  return remainder ? `${hours}시간 ${remainder}분` : `${hours}시간`;
}

export function formatSummaryDeparture(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "출발 시각 확인 필요";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${Number(parts.month)}월 ${Number(parts.day)}일 · ${parts.hour}:${parts.minute} 출발`;
}
