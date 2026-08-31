export type KakaoRoutePriority = "RECOMMEND" | "TIME" | "DISTANCE";

export function applyMotorcycleRoutePolicy(
  url: URL,
  priority: KakaoRoutePriority,
  requestAlternatives: boolean,
) {
  url.searchParams.set("priority", priority);
  if (requestAlternatives) url.searchParams.set("alternatives", "true");
  url.searchParams.set("car_type", "7");
  url.searchParams.set("avoid", "motorway");
  url.searchParams.set("roadevent", "0");
  url.searchParams.set("summary", "false");
  return url;
}
