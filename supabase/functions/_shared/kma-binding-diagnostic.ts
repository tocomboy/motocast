// Diagnostic-only: never use this summary to accept, normalize, or persist weather.
type Identity = { baseDate: string; baseTime: string; model: "ultra" | "short"; nx: number; ny: number };
const relations = ["EXACT", "EARLIER_WITHIN_HOUR_TEN_MINUTE", "EARLIER_WITHIN_HOUR_OTHER", "EARLIER_HOUR_OR_MORE", "LATER_WITHIN_HOUR_TEN_MINUTE", "LATER_WITHIN_HOUR_OTHER", "LATER_HOUR_OR_MORE"];
const schedules = ["REGULAR", "INTERSTITIAL_TEN_MINUTE", "OTHER"];
const grids = ["MATCH", "MISMATCH", "INVALID"];
const refreshFields = new Set(["T1H", "REH", "UUU", "VVV", "VEC", "WSD"]);
const otherFields = new Set(["LGT", "PTY", "RN1", "SKY", "POP", "TMP", "TMN", "TMX", "PCP", "SNO", "WAV"]);

function issuance(date: unknown, time: unknown): number | null {
  if (typeof date !== "string" || !/^\d{8}$/.test(date) ||
    typeof time !== "string" || !/^(?:[01]\d|2[0-3])[0-5]\d$/.test(time)) return null;
  const year = Number(date.slice(0, 4)), month = Number(date.slice(4, 6)), day = Number(date.slice(6, 8));
  const value = Date.UTC(year, month - 1, day, Number(time.slice(0, 2)), Number(time.slice(2, 4)));
  const parsed = new Date(value);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? value : null;
}

function schedule(time: string, model: Identity["model"]) {
  const hour = Number(time.slice(0, 2)), minute = Number(time.slice(2, 4));
  if (model === "ultra" ? minute === 30 : minute === 0 && [2, 5, 8, 11, 14, 17, 20, 23].includes(hour)) return "REGULAR";
  return minute % 10 === 0 ? "INTERSTITIAL_TEN_MINUTE" : "OTHER";
}

function relation(difference: number) {
  if (difference === 0) return "EXACT";
  const direction = difference < 0 ? "EARLIER" : "LATER";
  if (Math.abs(difference) >= 3_600_000) return `${direction}_HOUR_OR_MORE`;
  return `${direction}_WITHIN_HOUR_${difference % 600_000 === 0 ? "TEN_MINUTE" : "OTHER"}`;
}

function group() {
  return { present: false, valid: false, invalid: false, issuances: new Set<number>(), relations: new Set<string>(), schedules: new Set<string>(), grids: new Set<string>() };
}

function ordered(values: Set<string>, allowed: string[]) {
  return allowed.filter((value) => values.has(value)).join("+") || "NONE";
}

function render(value: ReturnType<typeof group>) {
  const shape = value.valid ? value.invalid ? "MIXED" : "VALID" : value.invalid ? "INVALID" : "NONE";
  const cardinality = value.issuances.size === 0 ? "NONE" : value.issuances.size === 1 ? "ONE" : "MULTIPLE";
  return [value.present ? "PRESENT" : "ABSENT", shape, cardinality,
    ordered(value.relations, relations), ordered(value.schedules, schedules), ordered(value.grids, grids)].join(",");
}

export function summarizeKmaBinding(items: readonly unknown[], expected: Identity): string {
  const expectedIssuance = issuance(expected.baseDate, expected.baseTime);
  const expectedSchedule = expectedIssuance !== null && schedule(expected.baseTime, expected.model) === "REGULAR" ? "VALID" : "INVALID";
  const groups = [group(), group(), group()];
  const allIssuances = new Set<number>();
  for (const value of items.slice(0, 1000)) {
    const item = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const category = typeof item.category === "string" ? item.category : "";
    const target = groups[refreshFields.has(category) ? 0 : otherFields.has(category) ? 1 : 2];
    target.present = true;
    const issued = issuance(item.baseDate, item.baseTime);
    if (issued === null) target.invalid = true;
    else {
      target.valid = true;
      // Two distinct values already prove MULTIPLE; do not retain the full set.
      if (target.issuances.size < 2) target.issuances.add(issued);
      if (allIssuances.size < 2) allIssuances.add(issued);
      if (expectedIssuance !== null) target.relations.add(relation(issued - expectedIssuance));
      target.schedules.add(schedule(item.baseTime as string, expected.model));
    }
    const gridValid = typeof item.nx === "number" && Number.isInteger(item.nx) && item.nx > 0 && item.nx <= 1000 &&
      typeof item.ny === "number" && Number.isInteger(item.ny) && item.ny > 0 && item.ny <= 1000;
    target.grids.add(!gridValid ? "INVALID" : item.nx === expected.nx && item.ny === expected.ny ? "MATCH" : "MISMATCH");
  }
  const cardinality = allIssuances.size === 0 ? "NONE" : allIssuances.size === 1 ? "ONE" : "MULTIPLE";
  return `B1 ${items.length > 1000 ? "TRUNCATED" : "COMPLETE"} ${expectedSchedule} ${cardinality} ${groups.map(render).join(" ")}`;
}

function safeSet(value: string, allowed: string[]) {
  if (value === "NONE") return true;
  const values = value.split("+");
  const indices = values.map((entry) => allowed.indexOf(entry));
  return indices.length <= allowed.length && indices.every((index, position) => index >= 0 && (position === 0 || index > indices[position - 1]));
}

export function safeKmaBindingDiagnostic(value: unknown): string {
  if (typeof value !== "string" || value.length > 1500) return "BINDING_UNKNOWN";
  const parts = value.split(" ");
  if (parts.length !== 7 || parts[0] !== "B1" || !["COMPLETE", "TRUNCATED"].includes(parts[1]) || !["VALID", "INVALID"].includes(parts[2]) ||
    !["NONE", "ONE", "MULTIPLE"].includes(parts[3])) return "BINDING_UNKNOWN";
  for (const part of parts.slice(4)) {
    const fields = part.split(",");
    if (fields.length !== 6 || !["PRESENT", "ABSENT"].includes(fields[0]) ||
      !["NONE", "VALID", "INVALID", "MIXED"].includes(fields[1]) || !["NONE", "ONE", "MULTIPLE"].includes(fields[2]) ||
      !safeSet(fields[3], relations) || !safeSet(fields[4], schedules) || !safeSet(fields[5], grids)) return "BINDING_UNKNOWN";
  }
  return value;
}
