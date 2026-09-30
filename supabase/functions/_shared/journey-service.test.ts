import { describe, it, expect, vi } from "vitest";
import { calculateJourneyRoute, forecastJourneySamples, recheckJourneySource } from "./journey-service";
import { signPlace } from "./place-verification";
import { forecastTarget } from "./weather-forecast";
import type { RouteChunkRequest } from "./route-orchestration";
import type { WeatherBundleKey } from "./weather-bundle";
import { writeFileSync } from "node:fs";
const now = Date.parse("2026-09-22T01:00:00Z"), secret = "local-synthetic-proof-".repeat(3);
async function setup() {
  const points = await Promise.all([0,1,2].map(async i => {
    const p = { id: `p${i}`, kakaoPlaceId: `p${i}`, name: `Synthetic ${i}`, label: `Synthetic ${i}`, address: "synthetic", roadAddress: null,
      longitude: 127+i*.001, latitude: 37.5, kind: "pass-through", dwellMinutes: 0, selected: true };
    return {...p, verificationToken: await signPlace(p, secret)};
  }));
  const course = { origin: points[0], points: [points[1]], destination: points[2] };
  const request = { schemaVersion: 1, journeyId: crypto.randomUUID(), requestId: crypto.randomUUID(), routeRevision: 0,
    source: {kind: "owned", tripId: crypto.randomUUID()}, course: points.map(({id,longitude,latitude,dwellMinutes}) => ({id,longitude,latitude,dwellMinutes})),
    position: {longitude: 127, latitude: 37.5, accuracyMeters: 10, observedAt: now},
    progress: {currentIndex: 0, phase: "ARRIVED", arrivedAt: now, skippedIndices: []} };
  const provider = vi.fn(async (r: RouteChunkRequest) => {
    const p = [r.origin,...r.waypoints,r.destination];
    const sections = p.slice(1).map((to,i) => ({distance: 100, duration: 3600, roads: [{name: "Synthetic road", distance: 100, duration: 3600,
      vertexes: [p[i].longitude,p[i].latitude,to.longitude,to.latitude]}]}));
    return {summary:{distance: sections.length*100,duration:sections.length*3600,origin:p[0],destination:p.at(-1)!,waypoints:p.slice(1,-1)},sections};
  });
  const budget = vi.fn(async () => 1), read = vi.fn(async () => course);
  const deps = { now: () => now, readSource: read, verificationSecret: secret,
    routing: {now: () => now,limitFor:()=>10,consumeBudget:budget,requestProvider:provider} };
  return {course,request,provider,budget,read,deps};
}
describe("authorized journey orchestration", () => {
  it("authorizes before budget and routes from GPS with ordered visits", async () => {
    const s = await setup(); const r = await calculateJourneyRoute(s.request,s.deps);
    expect(s.read).toHaveBeenCalledTimes(2); expect(s.budget).toHaveBeenCalledTimes(1);
    expect(s.provider.mock.calls[0][0].origin.id).toBe("journey-current-position");
    expect(r.timeline.visits.map(v=>v.visitIndex)).toEqual([1,2]); expect(r.timeline.samples).toHaveLength(13);
  });
  it("denies revoked/foreign sources and edited/unverified courses before budget", async () => {
    const s = await setup(); s.read.mockRejectedValueOnce(new Error("INVALID_JOURNEY_SOURCE"));
    await expect(calculateJourneyRoute(s.request,s.deps)).rejects.toThrow(); expect(s.provider).not.toHaveBeenCalled(); expect(s.budget).not.toHaveBeenCalled();
    s.request.course[1].longitude += .01;
    await expect(calculateJourneyRoute(s.request,s.deps)).rejects.toThrow(); expect(s.budget).not.toHaveBeenCalled();
    s.course.origin.verificationToken = "x".repeat(43);
    await expect(calculateJourneyRoute(s.request,s.deps)).rejects.toThrow(); expect(s.provider).not.toHaveBeenCalled();
  });
  it("discards source revocation during roads and edits during weather", async () => {
    const s = await setup(); s.read.mockImplementationOnce(async()=>s.course).mockRejectedValueOnce(new Error("INVALID_JOURNEY_SOURCE"));
    await expect(calculateJourneyRoute(s.request,s.deps)).rejects.toThrow("INVALID_JOURNEY_SOURCE");
    const t=await setup(); const result=await calculateJourneyRoute(t.request,t.deps);
    t.course.points=[]; await expect(recheckJourneySource(result,t.read,secret,now)).rejects.toThrow("INVALID_JOURNEY_SOURCE");
  });
  it("reuses one grid issue for thirteen samples and preserves missing probability", async () => {
    const s=await setup(); const result=await calculateJourneyRoute(s.request,s.deps);
    const bundle=vi.fn(async (key: WeatherBundleKey)=>({fetchedAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString(),items:
      [...new Map(result.timeline.samples.map(p=>{const t=forecastTarget(new Date(p.at));return [t.date+t.time,t]})).values()].flatMap(t=>
        Object.entries({T1H:"21",PTY:"1",SKY:"4",WSD:"2"}).map(([category,fcstValue])=>({...key,category,fcstValue,fcstDate:t.date,fcstTime:t.time}))) }));
    const actual=await forecastJourneySamples(result.timeline,bundle,new Date(now));
    expect(bundle).toHaveBeenCalledTimes(1); expect(actual.metrics).toEqual({sampleCount:13,uniqueBundles:1});
    expect(actual.forecasts.every(p=>p.condition==="rain"&&p.precipitationProbability===null)).toBe(true);
    expect(actual.forecasts.at(-1)?.at).toBe(now+7200000);
    if (process.env.EXPORT_JOURNEY_FIXTURE === "1") writeFileSync(".supabase/journey-service-fixture.json", JSON.stringify({ now, request: s.request,
      response: { schemaVersion: 1, journeyId: s.request.journeyId, requestId: s.request.requestId, routeRevision: 0,
        route: result.route, timeline: result.timeline, forecasts: actual.forecasts } }, null, 2));
  });
});
