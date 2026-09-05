import { describe, expect, it } from "vitest";
import { safeKmaBindingDiagnostic, summarizeKmaBinding } from "./kma-binding-diagnostic";

const expected = { baseDate: "20260905", baseTime: "0030", model: "ultra" as const, nx: 60, ny: 127 };
const item = { baseDate: expected.baseDate, baseTime: expected.baseTime, category: "T1H", nx: 60, ny: 127 };
const absent = "ABSENT,NONE,NONE,NONE,NONE,NONE";

describe("rejected KMA binding summary", () => {
  it("emits only a fixed, sanitized cohort summary", () => {
    const summary = summarizeKmaBinding([item], expected);
    expect(summary).toBe(`B1 COMPLETE VALID ONE PRESENT,VALID,ONE,EXACT,REGULAR,MATCH ${absent} ${absent}`);
    expect(safeKmaBindingDiagnostic(summary)).toBe(summary);
    for (const secret of [item.baseDate, item.baseTime, "T1H", "ultra", "127"]) expect(summary).not.toContain(secret);
  });

  it.each([
    ["20260905", "0020", "EARLIER_WITHIN_HOUR_TEN_MINUTE"],
    ["20260905", "0021", "EARLIER_WITHIN_HOUR_OTHER"],
    ["20260904", "2330", "EARLIER_HOUR_OR_MORE"],
    ["20260905", "0040", "LATER_WITHIN_HOUR_TEN_MINUTE"],
    ["20260905", "0041", "LATER_WITHIN_HOUR_OTHER"],
    ["20260905", "0130", "LATER_HOUR_OR_MORE"],
  ])("classifies whole-date relation %# without retaining its value", (baseDate, baseTime, relation) => {
    const summary = summarizeKmaBinding([{ ...item, baseDate, baseTime }], expected);
    expect(summary.split(" ")[4].split(",")[3]).toBe(relation);
    expect(safeKmaBindingDiagnostic(summary)).toBe(summary);
  });

  it.each([
    ["20260101", "20251231"], ["20260301", "20260228"], ["20240301", "20240229"],
  ])("handles previous-day calendar boundaries %#", (baseDate, previousDate) => {
    const summary = summarizeKmaBinding([{ ...item, baseDate: previousDate, baseTime: "2350" }], { ...expected, baseDate });
    expect(summary).toContain("EARLIER_WITHIN_HOUR_TEN_MINUTE");
  });

  it("distinguishes mixed issuances across and within cohorts, including the same relation bucket", () => {
    const summary = summarizeKmaBinding([
      { ...item, baseTime: "0040" }, { ...item, category: "SKY", baseTime: "0050" },
    ], expected);
    expect(summary.split(" ").slice(0, 4)).toEqual(["B1", "COMPLETE", "VALID", "MULTIPLE"]);
    expect(summary.split(" ")[4]).toContain("PRESENT,VALID,ONE,LATER_WITHIN_HOUR_TEN_MINUTE");
    expect(summary.split(" ")[5]).toContain("PRESENT,VALID,ONE,LATER_WITHIN_HOUR_TEN_MINUTE");
    const within = summarizeKmaBinding([item, { ...item, baseTime: "0040" }], expected);
    expect(within).toContain("PRESENT,VALID,MULTIPLE,EXACT+LATER_WITHIN_HOUR_TEN_MINUTE,REGULAR+INTERSTITIAL_TEN_MINUTE,MATCH");
  });

  it("reports malformed later fields and mixed grid states without reflecting them", () => {
    const summary = summarizeKmaBinding([
      item, { ...item, baseTime: "fixture-private-detail", nx: 1 }, { ...item, nx: "60" },
      { ...item, category: "fixture-private-detail" }, null, [],
    ], expected);
    expect(summary).toContain("PRESENT,MIXED,ONE,EXACT,REGULAR,MATCH+MISMATCH+INVALID");
    expect(summary.split(" ")[6]).toBe("PRESENT,MIXED,ONE,EXACT,REGULAR,MATCH+INVALID");
    expect(summary).not.toContain("fixture-private-detail");
    expect(safeKmaBindingDiagnostic(summary)).toBe(summary);
  });

  it.each([null, 30, "003", "2460", "fixture-private-detail"])("does not coerce invalid time %#", (baseTime) => {
    expect(summarizeKmaBinding([{ ...item, baseTime }], expected)).toContain("PRESENT,INVALID,NONE,NONE,NONE,MATCH");
  });

  it.each(["20260230", "20261301", "00000101", "2026011"])("rejects invalid calendar date %# in diagnostics", (baseDate) => {
    expect(summarizeKmaBinding([{ ...item, baseDate }], expected)).toContain("PRESENT,INVALID,NONE,NONE,NONE,MATCH");
  });

  it("distinguishes regular, interstitial, and other schedules without emitting the model", () => {
    const summary = summarizeKmaBinding([
      { ...item, baseTime: "0200" }, { ...item, baseTime: "0210" }, { ...item, baseTime: "0201" },
    ], { ...expected, model: "short", baseTime: "0200" });
    expect(summary).toContain("REGULAR+INTERSTITIAL_TEN_MINUTE+OTHER");
    expect(summary).not.toContain("short");
    expect(summarizeKmaBinding([], { ...expected, baseTime: "0040" })).toContain("COMPLETE INVALID NONE");
  });

  it("labels the scan boundary without reading unexamined entries", () => {
    const values: unknown[] = Array.from({ length: 1000 }, () => item);
    expect(summarizeKmaBinding(values, expected)).toContain("B1 COMPLETE");
    values.push({ get category() { throw new Error("must not read truncated entry"); } });
    expect(summarizeKmaBinding(values, expected)).toContain("B1 TRUNCATED");
  });

  it.each([
    null, {}, "fixture-private-detail", "B1 " + "X".repeat(1600),
  ])("rejects foreign summary %#", (summary) => expect(safeKmaBindingDiagnostic(summary)).toBe("BINDING_UNKNOWN"));

  it("rejects forged fields, duplicate sets, extra keys and noncanonical lists", () => {
    const summary = summarizeKmaBinding([item], expected);
    for (const forged of [
      summary.replace("REGULAR", "fixture-private-detail"), summary + " extra=value",
      summary.replace("EXACT", "EXACT+EXACT"), summary.replace("MATCH", "INVALID+MATCH"),
      summary.replace("VALID ONE", "VALID 20260905"), summary.replace("COMPLETE", "PRIVATE"),
    ]) expect(safeKmaBindingDiagnostic(forged)).toBe("BINDING_UNKNOWN");
  });
});
