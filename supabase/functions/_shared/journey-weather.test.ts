import { describe, expect, it } from "vitest";
import fixture from "../../../contracts/android/journey-weather/remaining.json";
import { parseJourneyWeatherRequest, remainingJourneyPlan } from "./journey-weather-request";
import { buildJourneyWeatherTimeline, type JourneyRoadLeg } from "./journey-weather-timeline";

const now = fixture.now;
const raw = () => structuredClone(fixture.request);
const request = () => parseJourneyWeatherRequest(raw(), now);
const plan = () => remainingJourneyPlan(request(), fixture.request.course, now);
const c = (longitude: number, latitude = 37.5) => ({ longitude, latitude });
function roads(): JourneyRoadLeg[] {
  return [
    { visitIndex: 2, roads: [{ durationSeconds: 1200, coordinates: [c(127.01), c(127.01, 37.51), c(127.02, 37.51), c(127.02)] }] },
    // Repeated occurrence requires a real provider road leg, not deduplication.
    { visitIndex: 3, roads: [{ durationSeconds: 600, coordinates: [c(127.02), c(127.021), c(127.02)] }] },
    { visitIndex: 4, roads: [{ durationSeconds: 5400, coordinates: [c(127.02), c(127.03)] }] },
  ];
}
describe("journey weather remaining contract", () => {
  it("preserves ordered duplicate occurrences and only residual current dwell", () => {
    expect(plan().departureAt).toBe(fixture.expected.departureAt);
    expect(plan().remaining.map(p => p.visitIndex)).toEqual(fixture.expected.remainingVisitIndices);
    expect(plan().remaining.map(p => p.id)).toEqual(["same-place", "same-place", "destination"]);
  });
  it("late dwell departs now; early actual departure removes old dwell", () => {
    const late = raw(); late.progress.arrivedAt = now - 40 * 60_000;
    expect(remainingJourneyPlan(parseJourneyWeatherRequest(late, now), late.course, now).departureAt).toBe(now);
    const early = { ...raw(), progress: { currentIndex: 2, phase: "PENDING", arrivedAt: null, skippedIndices: [] } };
    const p = remainingJourneyPlan(parseJourneyWeatherRequest(early, now), early.course, now);
    expect(p.departureAt).toBe(now); expect(p.remaining.map(v => v.visitIndex)).toEqual([2, 3, 4]);
  });
  it("keeps pending current visit; explicit completed skips never remove future duplicates", () => {
    const r = { ...raw(), progress: { currentIndex: 3, phase: "PENDING", arrivedAt: null, skippedIndices: [1, 2] } };
    expect(remainingJourneyPlan(parseJourneyWeatherRequest(r, now), r.course, now).remaining.map(v => v.visitIndex)).toEqual([3, 4]);
  });
  it("rejects edited, reordered, shortened canonical courses", () => {
    for (const course of [raw().course.slice(1), raw().course.toReversed(), raw().course.map((p, i) => i === 1 ? { ...p, dwellMinutes: 31 } : p)]) {
      expect(() => remainingJourneyPlan(request(), course, now)).toThrow("INVALID_JOURNEY_WEATHER_REQUEST");
    }
  });
  it.each([-30_001, 5001])("rejects stale or future GPS %i", delta => {
    const r = raw(); r.position.observedAt = now + delta;
    expect(() => parseJourneyWeatherRequest(r, now)).toThrow();
  });
  it("rejects inaccurate/outside coordinates, unknown fields and caller policy", () => {
    for (const position of [{ ...raw().position, accuracyMeters: 51 }, { ...raw().position, latitude: NaN }, { ...raw().position, longitude: 0 }]) {
      expect(() => parseJourneyWeatherRequest({ ...raw(), position }, now)).toThrow();
    }
    expect(() => parseJourneyWeatherRequest({ ...raw(), weatherInterval: 1 }, now)).toThrow();
    expect(() => parseJourneyWeatherRequest({ ...raw(), source: { kind: "shared", token: "x".repeat(43), tripId: "other" } }, now)).toThrow();
  });
  it.each([
    { currentIndex: 4, phase: "ARRIVED", arrivedAt: now, skippedIndices: [] },
    { currentIndex: 0, phase: "PENDING", arrivedAt: null, skippedIndices: [] },
    { currentIndex: 2, phase: "ARRIVED", arrivedAt: now + 1, skippedIndices: [] },
    { currentIndex: 2, phase: "PENDING", arrivedAt: now, skippedIndices: [] },
    { currentIndex: 3, phase: "PENDING", arrivedAt: null, skippedIndices: [1, 1] },
    { currentIndex: 3, phase: "PENDING", arrivedAt: null, skippedIndices: [2, 1] },
    { currentIndex: 3, phase: "PENDING", arrivedAt: null, skippedIndices: [0] },
    { currentIndex: 3, phase: "PENDING", arrivedAt: null, skippedIndices: [4] },
  ])("rejects impossible progress %j", progress => {
    expect(() => parseJourneyWeatherRequest({ ...raw(), progress }, now)).toThrow();
  });
  it("accepts a shared source syntactically without treating it as authorization", () => {
    expect(parseJourneyWeatherRequest({ ...raw(), source: { kind: "shared", token: "x".repeat(43) } }, now).source.kind).toBe("shared");
  });
});
describe("road based two hour forecast samples", () => {
  it("includes current dwell, road bends, repeated visits and clips at two hours", () => {
    const r = buildJourneyWeatherTimeline(plan(), roads());
    expect(r.visits.map(v => (v.arrivalAt - now) / 60_000)).toEqual([30, 40, 130]);
    expect(r.arrivalAt).toBe(now + 130 * 60_000);
    expect(r.endAt).toBe(now + 120 * 60_000);
    expect(r.samples[0]).toEqual({ at: now, ...c(127.01) });
    const turning = r.samples.find(s => s.at === now + 20 * 60_000)!;
    expect(turning.latitude).toBeCloseTo(37.51, 6); // Straight endpoint interpolation would incorrectly stay at 37.5.
    expect(turning.longitude).toBeCloseTo(127.015, 5);
    expect(r.samples.every(s => s.at <= r.endAt)).toBe(true);
  });
  it("adds full future dwell; no final dwell after journey ends", () => {
    const r = raw(); r.course[2].dwellMinutes = 20; r.course[4].dwellMinutes = 60;
    const result = buildJourneyWeatherTimeline(remainingJourneyPlan(parseJourneyWeatherRequest(r, now), r.course, now), roads());
    expect(result.visits.map(v => [(v.arrivalAt - now) / 60_000, (v.departureAt - now) / 60_000])).toEqual([[30, 50], [60, 60], [150, 150]]);
    expect(result.samples.find(s => s.at === now + 40 * 60_000)).toEqual({ at: now + 40 * 60_000, ...c(127.02) });
  });
  it("samples no travel while residual dwell exceeds horizon", () => {
    const r = raw(); r.course[1].dwellMinutes = 180;
    const result = buildJourneyWeatherTimeline(remainingJourneyPlan(parseJourneyWeatherRequest(r, now), r.course, now), roads());
    expect(result.samples).toHaveLength(13);
    expect(result.samples.every(s => s.longitude === 127.01 && s.latitude === 37.5)).toBe(true);
  });
  it("uses individual road durations rather than one uniform leg speed", () => {
    const legs = roads(); legs[0].roads = [
      { durationSeconds: 600, coordinates: [c(127.01), c(127.011)] },
      { durationSeconds: 600, coordinates: [c(127.011), c(127.02)] },
    ];
    expect(buildJourneyWeatherTimeline(plan(), legs).samples.find(s => s.at === now + 20 * 60_000)?.longitude).toBe(127.011);
  });
  it("rejects missing/reordered legs, disconnected roads, off-target endpoints and bad times", () => {
    const missing = roads().slice(1); const reorder = roads().toReversed();
    const gap = roads(); gap[1].roads[0].coordinates[0] = c(128);
    const wrongEnd = roads(); wrongEnd[2].roads[0].coordinates[1] = c(128);
    const badTime = roads(); badTime[0].roads[0].durationSeconds = -1;
    const zero = roads(); zero[0].roads[0].durationSeconds = 0;
    const empty = roads(); empty[0].roads[0].coordinates = [];
    const overDay = roads(); overDay[0].roads[0].durationSeconds = 86000;
    for (const legs of [missing, reorder, gap, wrongEnd, badTime, zero, empty, overDay]) expect(() => buildJourneyWeatherTimeline(plan(), legs)).toThrow();
  });
});
