const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

export function parseStrictRfc3339(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = RFC3339.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", fractionText = "0", zone, sign, offsetHourText = "0", offsetMinuteText = "0"] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fractionText.padEnd(3, "0"));
  const offsetHour = Number(offsetHourText);
  const offsetMinute = Number(offsetMinuteText);

  if (
    month < 1 || month > 12 || day < 1 || day > 31 ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 23 || offsetMinute > 59
  ) return null;

  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day
  ) return null;

  const offsetMinutes = zone === "Z"
    ? 0
    : (sign === "+" ? 1 : -1) * (offsetHour * 60 + offsetMinute);
  const expected = Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offsetMinutes * 60_000;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() !== expected) return null;
  return parsed;
}

export function isStrictCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function seoulCalendarDate(value: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
