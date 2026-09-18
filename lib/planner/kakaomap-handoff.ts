import { isKoreanCoordinate } from "./input";

export type HandoffPlace = { label: string; latitude: number; longitude: number };
export type HandoffResult =
  | { status: "ready"; places: HandoffPlace[] }
  | { status: "blocked"; reason: "stale" | "invalid" | "changed" }
  | { status: "blocked"; reason: "over-limit"; count: number };
export type HandoffPlatform = "desktop" | "android" | "ios" | "mobile";

export const kakaoMapStores = {
  android: "https://play.google.com/store/apps/details?id=net.daum.android.map",
  ios: "https://apps.apple.com/kr/app/id304608425",
} as const;

export function sameHandoffPlace(a: HandoffPlace, b: HandoffPlace) {
  return Math.abs(a.latitude - b.latitude) <= 0.000001 && Math.abs(a.longitude - b.longitude) <= 0.000001;
}

export function validateHandoffPlaces(places: readonly HandoffPlace[]): HandoffResult {
  if (places.length < 2 || places.some((p) => !p || typeof p.label !== "string" || !p.label.trim()
    || p.label.length > 160 || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(p.label)
    || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || !isKoreanCoordinate(p))) {
    return { status: "blocked", reason: "invalid" };
  }
  if (places.length > 7) return { status: "blocked", reason: "over-limit", count: places.length - 2 };
  // Explicit projection: never retain internal IDs, proofs, schedule or weather.
  return { status: "ready", places: places.map(({ label, latitude, longitude }) => ({ label, latitude, longitude })) };
}

export function handoffPlatform(userAgent: string, touchPoints = 0): HandoffPlatform {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && touchPoints > 1)) return "ios";
  if (/mobile|tablet/i.test(userAgent)) return "mobile";
  return "desktop";
}

export function kakaoMapUrl(places: readonly HandoffPlace[], platform: HandoffPlatform): string {
  const checked = validateHandoffPlaces(places);
  if (checked.status !== "ready") throw new Error("INVALID_KAKAOMAP_HANDOFF");
  const coordinate = (p: HandoffPlace) => `${p.latitude},${p.longitude}`;
  if (platform === "desktop") {
    return `https://map.kakao.com/link/by/car/${checked.places.map((p) => `${encodeURIComponent(p.label)},${coordinate(p)}`).join("/")}`;
  }
  const points = checked.places;
  const via = points.slice(1, -1).map((p, index) => `vp${index === 0 ? "" : index + 1}=${coordinate(p)}`);
  return `kakaomap://route?${[`sp=${coordinate(points[0])}`, ...via, `ep=${coordinate(points.at(-1)!)}`, "by=car"].join("&")}`;
}
