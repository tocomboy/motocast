const MINUTE_MS = 60_000;

function seoulParts(value: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}-${parts.minute}`.replace("-", ":"),
  };
}

export function minimumDeparture(now: Date = new Date()) {
  const rounded = new Date(Math.ceil(now.getTime() / MINUTE_MS) * MINUTE_MS);
  return seoulParts(rounded);
}

export function isPastDeparture(rideDate: string, departureTime: string, now: Date = new Date()) {
  const departure = new Date(`${rideDate}T${departureTime}:00+09:00`);
  return Number.isNaN(departure.getTime()) || departure.getTime() < now.getTime();
}
