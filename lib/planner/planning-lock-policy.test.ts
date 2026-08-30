import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../components/planner-dashboard.tsx", import.meta.url), "utf8");

describe("planner persistence lock policy", () => {
  it("keeps the synchronous planning lock until finalization has returned", () => {
    const finalization = source.indexOf('supabase.rpc("finalize_trip_plan"');
    const unlock = source.indexOf("calculatingRef.current = false", finalization);
    expect(finalization).toBeGreaterThan(-1);
    expect(unlock).toBeGreaterThan(finalization);
    expect(source).toContain("if (calculatingRef.current)");
    expect(source).toContain("liveTripIdRef.current !== targetTripId");
  });

  it("blocks candidate, collection, and share actions while plan persistence is pending", () => {
    expect(source).toContain("disabled={calculating || selectionPending}");
    expect(source).toContain('className="planner-fields" disabled={calculating}');
    expect(source).toContain("<ShareManager tripId={liveTripId} disabled={calculating || selectionPending} />");
  });

  it("drops late weather responses before they can update global UI state", () => {
    const requestGuard = source.indexOf("weatherRequest !== weatherRequestRef.current");
    const weatherUpdate = source.indexOf("setWeatherByCandidate", requestGuard);
    expect(requestGuard).toBeGreaterThan(-1);
    expect(weatherUpdate).toBeGreaterThan(requestGuard);
  });
});
