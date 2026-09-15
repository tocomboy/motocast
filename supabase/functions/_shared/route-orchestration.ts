import { executeBudgetedProviderCall } from "./budgeted-call.ts";
import { assertKakaoSectionsContinuous, RouteResponseValidationError, type NormalizedKakaoRoute } from "./kakao-route.ts";
import { assertRideUnder24Hours } from "./route-deadline.ts";
import type { RoutePointRequest } from "./route-request.ts";

export type RouteOperation = "directions" | "future_directions";

export type RouteChunkRequest = {
  origin: RoutePointRequest;
  destination: RoutePointRequest;
  waypoints: RoutePointRequest[];
  departureAt: Date;
  isFuture: boolean;
};

type RouteOrchestrationDependencies = {
  now: () => number;
  limitFor: (operation: RouteOperation) => number;
  consumeBudget: (operation: RouteOperation, hardLimit: number) => Promise<number>;
  requestProvider: (input: RouteChunkRequest) => Promise<NormalizedKakaoRoute>;
};

function nextChunk(points: RoutePointRequest[], startIndex: number) {
  const furthest = Math.min(startIndex + 6, points.length - 1);
  let endIndex = furthest;
  for (let index = startIndex + 1; index <= furthest; index += 1) {
    if ((points[index].dwellMinutes ?? 0) > 0) {
      endIndex = index;
      break;
    }
  }
  return { endIndex, via: points.slice(startIndex + 1, endIndex) };
}

function responsePoint(point: RoutePointRequest) {
  return {
    id: point.id,
    label: point.label,
    longitude: point.longitude,
    latitude: point.latitude,
    kind: point.kind,
    dwellMinutes: point.dwellMinutes,
    selected: point.selected,
    winding: point.winding,
    stopRole: point.stopRole,
  };
}

export async function orchestrateRecommendedRoute(
  points: RoutePointRequest[],
  departureAt: string,
  dependencies: RouteOrchestrationDependencies,
) {
  if (points.length < 2) throw new Error("INVALID_WAYPOINTS");
  const legs = [];
  const acceptedSections: NormalizedKakaoRoute["sections"] = [];
  let cursor = 0;
  let departure = new Date(departureAt);
  let totalDistance = 0;
  let totalDuration = 0;

  while (cursor < points.length - 1) {
    const { endIndex, via } = nextChunk(points, cursor);
    const isFuture = departure.getTime() > dependencies.now() + 5 * 60_000;
    const operation: RouteOperation = isFuture ? "future_directions" : "directions";
    const hardLimit = dependencies.limitFor(operation);
    const chunkRequest = {
      origin: points[cursor],
      destination: points[endIndex],
      waypoints: via,
      departureAt: departure,
      isFuture,
    };
    const selected = await executeBudgetedProviderCall(
      () => dependencies.consumeBudget(operation, hardLimit),
      async () => {
        try {
          return await dependencies.requestProvider(chunkRequest);
        } catch (error) {
          if (error instanceof RouteResponseValidationError) {
            throw new RouteResponseValidationError(error.reason, {
              operation,
              fromPointIndex: cursor,
              toPointIndex: endIndex,
              destinationRole: endIndex === points.length - 1 ? "destination" : points[endIndex].stopRole ?? "waypoint",
            });
          }
          throw error;
        }
      },
    );
    const chunkPoints = [points[cursor], ...via, points[endIndex]];
    if (selected.result.sections.length !== chunkPoints.length - 1) {
      throw new Error("INVALID_ROUTE_PROVIDER_RESPONSE");
    }

    for (let index = 0; index < selected.result.sections.length; index += 1) {
      const section = selected.result.sections[index];
      acceptedSections.push(section);
      const from = chunkPoints[index];
      const to = chunkPoints[index + 1];
      const arrivedAt = new Date(departure.getTime() + section.duration * 1000);
      const dwellMinutes = to.dwellMinutes;
      legs.push({
        from: responsePoint(from),
        to: responsePoint(to),
        via: [],
        departureAt: departure.toISOString(),
        arrivalAt: arrivedAt.toISOString(),
        dwellMinutes,
        distanceMeters: section.distance,
        durationSeconds: section.duration,
        sections: [{
          distance: section.distance,
          duration: section.duration,
          roads: section.roads.map((road) => ({
            name: road.name,
            distance: road.distance,
            duration: road.duration,
            vertexes: road.vertexes,
          })),
        }],
        providerRequestNumber: selected.requestNumber,
        forecastTraffic: isFuture,
      });
      totalDistance += section.distance;
      totalDuration += section.duration + dwellMinutes * 60;
      departure = new Date(arrivedAt.getTime() + dwellMinutes * 60_000);
    }
    cursor = endIndex;
  }

  assertKakaoSectionsContinuous(acceptedSections);
  assertRideUnder24Hours(departureAt, departure.toISOString());
  return {
    legs,
    totalDistanceMeters: totalDistance,
    totalDurationSeconds: totalDuration,
    returnAt: departure.toISOString(),
  };
}
