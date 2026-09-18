import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { launchKakaoMap } from "./kakaomap-launch";
import { kakaoMapStores } from "./kakaomap-handoff";

const url = "kakaomap://route?sp=37,127&vp=37.1,127.1&ep=37.2,127.2&by=car";
let win: EventTarget & { location: { assign: ReturnType<typeof vi.fn> }; open: ReturnType<typeof vi.fn> };
let doc: EventTarget & { visibilityState: string };
beforeEach(() => {
  vi.useFakeTimers();
  win = Object.assign(new EventTarget(), { location: { assign: vi.fn() }, open: vi.fn() });
  doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("external launch and store lifecycle", () => {
  it("preserves Android route parameters and binds only the official store fallback", () => {
    launchKakaoMap(url, "android", () => true, vi.fn());
    expect(win.location.assign).toHaveBeenCalledExactlyOnceWith(`intent://route?sp=37,127&vp=37.1,127.1&ep=37.2,127.2&by=car#Intent;scheme=kakaomap;package=net.daum.android.map;S.browser_fallback_url=${encodeURIComponent(kakaoMapStores.android)};end`);
  });
  it("attempts iOS app first then the official store while still foregrounded", () => {
    launchKakaoMap(url, "ios", () => true, vi.fn());
    expect(win.location.assign.mock.calls).toEqual([[url]]);
    vi.advanceTimersByTime(1800);
    expect(win.location.assign.mock.calls).toEqual([[url], [kakaoMapStores.ios]]);
  });
  it.each(["visibility", "pagehide", "blur", "cancel", "stale", "suspended"])("does not send a returning or detached rider to the store after %s", (event) => {
    let current = true;
    const cancel = launchKakaoMap(url, "ios", () => current, vi.fn());
    if (event === "visibility") { doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")); doc.visibilityState = "visible"; }
    if (event === "pagehide" || event === "blur") win.dispatchEvent(new Event(event));
    if (event === "cancel") cancel();
    if (event === "stale") current = false;
    if (event === "suspended") vi.setSystemTime(Date.now() + 5000);
    vi.advanceTimersByTime(2000);
    expect(win.location.assign.mock.calls).toEqual([[url]]);
  });
  it("reports a denied delayed store navigation", () => {
    const failure = vi.fn();
    win.location.assign.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw Error("denied"); });
    launchKakaoMap(url, "ios", () => true, failure);
    vi.advanceTimersByTime(1800);
    expect(failure).toHaveBeenCalledOnce();
  });
  it("does not guess the store on an unknown mobile OS", () => {
    launchKakaoMap(url, "mobile", () => true, vi.fn());
    vi.advanceTimersByTime(3000);
    expect(win.location.assign.mock.calls).toEqual([[url]]);
  });
});
