export type RouteGeometry = {
  summary: { distance: number; duration: number };
  sections?: Array<{ roads?: Array<{ vertexes: number[] }> }>;
};

function radians(value: number) {
  return value * Math.PI / 180;
}

function distanceKm(from: [number, number], to: [number, number]) {
  const earthKm = 6371.0088;
  const latitudeDelta = radians(to[1] - from[1]);
  const longitudeDelta = radians(to[0] - from[0]);
  const fromLatitude = radians(from[1]);
  const toLatitude = radians(to[1]);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function heading(from: [number, number], to: [number, number]) {
  const averageLatitude = radians((from[1] + to[1]) / 2);
  return Math.atan2(
    (to[0] - from[0]) * Math.cos(averageLatitude),
    to[1] - from[1],
  );
}

function headingChange(previous: number, current: number) {
  let change = current - previous;
  while (change > Math.PI) change -= 2 * Math.PI;
  while (change < -Math.PI) change += 2 * Math.PI;
  return Math.abs(change);
}

function coordinates(route: RouteGeometry): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (const section of route.sections ?? []) {
    for (const road of section.roads ?? []) {
      for (let index = 0; index + 1 < road.vertexes.length; index += 2) {
        const point: [number, number] = [road.vertexes[index], road.vertexes[index + 1]];
        const previous = result.at(-1);
        if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) result.push(point);
      }
    }
  }
  return result;
}

export function curvatureScore(route: RouteGeometry) {
  const points = coordinates(route);
  if (points.length < 3) return 0;
  let travelledKm = 0;
  let totalTurn = 0;
  let previousHeading: number | null = null;

  for (let index = 1; index < points.length; index += 1) {
    const segmentKm = distanceKm(points[index - 1], points[index]);
    if (segmentKm < 0.005) continue;
    const currentHeading = heading(points[index - 1], points[index]);
    if (previousHeading !== null) totalTurn += headingChange(previousHeading, currentHeading);
    previousHeading = currentHeading;
    travelledKm += segmentKm;
  }

  if (travelledKm <= 0) return 0;
  return totalTurn / travelledKm;
}

export function routeFingerprint(route: RouteGeometry) {
  const points = coordinates(route);
  if (!points.length) return `empty:${route.summary.distance}:${route.summary.duration}`;
  return points.map(([longitude, latitude]) => `${coordinateMicros(longitude)},${coordinateMicros(latitude)}`).join("|");
}

function coordinateMicros(value: number) {
  const [whole, fraction = ""] = String(value).split(".");
  const sixDigits = `${fraction}000000`.slice(0, 6);
  const micros = Number(whole) * 1_000_000 + Number(sixDigits);
  return micros + (Number(fraction[6] ?? "0") >= 5 ? 1 : 0);
}

export function selectEstimatedWindingRoute<T extends RouteGeometry>(routes: T[], excludedFingerprints: Set<string>) {
  const candidates = routes
    .filter((route) => route.summary.distance > 0 && route.summary.duration > 0)
    .map((route) => ({ route, fingerprint: routeFingerprint(route), score: curvatureScore(route) }))
    .filter((candidate) => !excludedFingerprints.has(candidate.fingerprint))
    .sort((left, right) => right.score - left.score || right.route.summary.distance - left.route.summary.distance);
  return candidates[0]?.route ?? null;
}
