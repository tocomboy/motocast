import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PlannerActionGate } from "./action-gate";

const source = readFileSync(new URL("../../components/planner-dashboard.tsx", import.meta.url), "utf8");
const shareSource = readFileSync(new URL("../../components/share-manager.tsx", import.meta.url), "utf8");

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
    expect(gate.canApplyCollection()).toBe(false);
    expect(gate.canPublishShare()).toBe(false);

    finishFinalization();
    await persistence;
    expect(gate.busy).toBe(false);
    expect(gate.beginPlanning()).not.toBeNull();
  });

  it("wires the execution gate to collection and planning mutations", () => {
    const finalization = source.indexOf('supabase.rpc("finalize_trip_plan"');
    const release = source.indexOf("planningLease.release()", finalization);
    expect(finalization).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(finalization);
    expect(source).toContain("actionGateRef.current.beginPlanning()");
    expect(source).toContain("actionGateRef.current.canApplyCollection()");
    expect(source).toContain('className="planner-fields" disabled={calculating}');
    expect(source).toContain("onShare={prepareCollectionShare}");
    expect(source).toContain("isFreshWeatherForSharing(selectedWeather, weatherClock ?? currentReferenceTime())");
    expect(source).toContain('tripId={!liveResultStale && shareIntentGeneration === null && shareWeatherReady ? liveTripId : null}');
    expect(source).toContain("previewRequest={sharePreviewRequest}");
    expect(source).toContain("disabled={calculating}");
    expect(source).not.toContain("select_trip_candidate");
  });

  it("starts weather refresh only after the single route is finalized and waits before direct sharing", () => {
    const finalization = source.indexOf('supabase.rpc("finalize_trip_plan"');
    const shareWeatherRefresh = source.indexOf("await loadWeather(candidate, savedTripId, calculationGeneration, true)", finalization);
    const shareIntentRelease = source.indexOf("setShareIntentGeneration(null)", shareWeatherRefresh);
    const previewOpen = source.indexOf("setSharePreviewRequest", shareIntentRelease);
    const normalWeatherRefresh = source.indexOf("void loadWeather(candidate, savedTripId, calculationGeneration)", previewOpen);
    expect(shareWeatherRefresh).toBeGreaterThan(finalization);
    expect(shareIntentRelease).toBeGreaterThan(shareWeatherRefresh);
    expect(previewOpen).toBeGreaterThan(shareIntentRelease);
    expect(normalWeatherRefresh).toBeGreaterThan(previewOpen);
    expect(source.indexOf("shareWeatherReady ? liveTripId : null")).toBeGreaterThan(normalWeatherRefresh);
    expect(source).toContain("withClientTimeout(");
  });

  it("drops late weather responses before they can update global UI state", () => {
    const requestGuard = source.indexOf("weatherRequest !== weatherRequestRef.current");
    const weatherUpdate = source.indexOf("setWeather(response)", requestGuard);
    expect(requestGuard).toBeGreaterThan(-1);
    expect(weatherUpdate).toBeGreaterThan(requestGuard);
  });

  it("clears the visible weather loading state when applying a collection invalidates the request", () => {
    const application = source.indexOf("function applyCollection");
    const invalidation = source.indexOf("weatherRequestRef.current += 1", application);
    const clear = source.indexOf("setWeatherLoading(null)", invalidation);
    const applyPoints = source.indexOf("setAppliedCollectionPoints", clear);
    expect(application).toBeGreaterThan(-1);
    expect(invalidation).toBeGreaterThan(application);
    expect(clear).toBeGreaterThan(invalidation);
    expect(applyPoints).toBeGreaterThan(clear);
  });

  it("consumes each collection-triggered share preview request once", () => {
    const guard = shareSource.indexOf("previewRequest <= handledPreviewRequestRef.current");
    const consume = shareSource.indexOf("handledPreviewRequestRef.current = previewRequest", guard);
    const start = shareSource.indexOf("void createPreview()", consume);
    expect(guard).toBeGreaterThan(-1);
    expect(consume).toBeGreaterThan(guard);
    expect(start).toBeGreaterThan(consume);
    expect(shareSource.slice(guard, start)).toContain("disabled || busy");
    expect(shareSource.slice(consume, start)).not.toContain("setTimeout");
  });

  it("renders the validated full stale age and expiry status", () => {
    expect(source).toContain("formatPlannerWeatherStatus(");
    expect(source).toContain("selectedWeatherStatus.header");
    expect(source).toContain("selectedWeatherAnnouncement");
    expect(source).toContain('<div className="stale-notice"><span>i</span>{selectedWeatherStatus.notice}</div>');
    expect(source).not.toContain("선택한 균형 경로의 날씨를 조회 중입니다.");
  });
});
