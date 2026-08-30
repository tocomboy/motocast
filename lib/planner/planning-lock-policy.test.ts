import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PlannerActionGate } from "./action-gate";

const source = readFileSync(new URL("../../components/planner-dashboard.tsx", import.meta.url), "utf8");

describe("planner persistence lock policy", () => {
  it("blocks every conflicting action until a delayed finalization releases its lease", async () => {
    const gate = new PlannerActionGate();
    const planning = gate.beginPlanning();
    expect(planning).not.toBeNull();

    let finishFinalization!: () => void;
    const delayedFinalization = new Promise<void>((resolve) => { finishFinalization = resolve; });
    const persistence = (async () => {
      try {
        await delayedFinalization;
      } finally {
        planning!.release();
      }
    })();

    expect(gate.beginPlanning()).toBeNull();
    expect(gate.beginSelection()).toBeNull();
    expect(gate.canApplyCollection()).toBe(false);
    expect(gate.canPublishShare()).toBe(false);

    finishFinalization();
    await persistence;
    expect(gate.busy).toBe(false);
    const selection = gate.beginSelection();
    expect(selection).not.toBeNull();
    selection!.release();
  });

  it("wires the execution gate to candidate, collection, and planning mutations", () => {
    const finalization = source.indexOf('supabase.rpc("finalize_trip_plan"');
    const release = source.indexOf("planningLease.release()", finalization);
    expect(finalization).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(finalization);
    expect(source).toContain("actionGateRef.current.beginPlanning()");
    expect(source).toContain("actionGateRef.current.beginSelection()");
    expect(source).toContain("actionGateRef.current.canApplyCollection()");
    expect(source).toContain("disabled={calculating || selectionPending}");
    expect(source).toContain('className="planner-fields" disabled={calculating || selectionPending}');
    expect(source).toContain("<ShareManager tripId={liveTripId} disabled={calculating || selectionPending} />");
  });

  it("releases the selection lease before starting the non-blocking weather refresh", () => {
    const selectionRpc = source.indexOf('supabase.rpc("select_trip_candidate"');
    const weatherRefresh = source.indexOf("void loadWeather(candidate, tripId, generation)", selectionRpc);
    const release = source.lastIndexOf("releaseSelection()", weatherRefresh);
    expect(selectionRpc).toBeGreaterThan(-1);
    expect(weatherRefresh).toBeGreaterThan(selectionRpc);
    expect(source.slice(selectionRpc, weatherRefresh)).not.toContain("await loadWeather");
    expect(release).toBeGreaterThan(selectionRpc);
    expect(release).toBeLessThan(weatherRefresh);
    expect(source).toContain("withClientTimeout(");
  });

  it("drops late weather responses before they can update global UI state", () => {
    const requestGuard = source.indexOf("weatherRequest !== weatherRequestRef.current");
    const weatherUpdate = source.indexOf("setWeatherByCandidate", requestGuard);
    expect(requestGuard).toBeGreaterThan(-1);
    expect(weatherUpdate).toBeGreaterThan(requestGuard);
  });

  it("renders the validated full stale age and expiry status", () => {
    expect(source).toContain("formatPlannerWeatherStatus(");
    expect(source).toContain("selectedWeatherStatus.header");
    expect(source).toContain("selectedWeatherAnnouncement");
    expect(source).toContain('<div className="stale-notice"><span>i</span>{selectedWeatherStatus.notice}</div>');
    expect(source).not.toContain("선택한 균형 경로의 날씨를 조회 중입니다.");
  });
});
