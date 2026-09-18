import { kakaoMapStores, type HandoffPlatform } from "./kakaomap-handoff";

/** Browser launch request, not proof that an app is installed or navigation started. */
export function launchKakaoMap(url: string, platform: HandoffPlatform, isCurrent: () => boolean, onFailure: () => void): () => void {
  if (platform === "desktop") {
    window.open(url, "_blank", "noopener,noreferrer");
    return () => {};
  }
  if (platform === "android") {
    // Chrome delegates unresolved intents to the official store, under this click's user gesture.
    const intent = `${url.replace(/^kakaomap:/, "intent:")}#Intent;scheme=kakaomap;package=net.daum.android.map;S.browser_fallback_url=${encodeURIComponent(kakaoMapStores.android)};end`;
    // Intent is an external Android scheme, never a relative Next.js destination.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    try { window.location.assign(intent); }
    catch { window.location.assign(kakaoMapStores.android); }
    return () => {};
  }
  if (platform !== "ios") {
    window.location.assign(url);
    return () => {};
  }
  // iOS has no browser installation query. Only attempt the store while the initiating
  // page stays foregrounded. Never send a rider to the store after returning from the app.
  const started = Date.now();
  let canceled = false;
  const cancel = () => {
    canceled = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", cancel);
    window.removeEventListener("blur", cancel);
  };
  const visibility = () => { if (document.visibilityState !== "visible") cancel(); };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", cancel);
  window.addEventListener("blur", cancel);
  const timer = setTimeout(() => {
    const eligible = !canceled && document.visibilityState === "visible" && Date.now() - started < 3000 && isCurrent();
    cancel();
    if (eligible) {
      try { window.location.assign(kakaoMapStores.ios); }
      catch { onFailure(); }
    }
  }, 1800);
  try { window.location.assign(url); }
  catch { cancel(); window.location.assign(kakaoMapStores.ios); }
  return cancel;
}
