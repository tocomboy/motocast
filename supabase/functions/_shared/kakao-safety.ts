export function applyMotorcycleRoutePolicy(url: URL) {
  url.searchParams.set("priority", "RECOMMEND");
  url.searchParams.set("car_type", "7");
  url.searchParams.set("avoid", "motorway");
  url.searchParams.set("roadevent", "0");
  url.searchParams.set("summary", "false");
  return url;
}
