export type RouteResponseLeg<TPoint, TSection> = {
  from: TPoint;
  to: TPoint;
  via: TPoint[];
  departureAt: string;
  arrivalAt: string;
  dwellMinutes: number;
  distanceMeters: number;
  durationSeconds: number;
  sections: TSection[];
  providerRequestNumber: number;
  forecastTraffic: boolean;
};

export function buildSafeRouteResponse<TPoint, TSection>(input: {
  candidate: {
    id: "recommended" | "balanced" | "winding" | "short";
    label: string;
    estimatedWinding: boolean;
  };
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  returnAt: string;
  legs: Array<RouteResponseLeg<TPoint, TSection>>;
}) {
  return {
    safety: { vehicle: "motorcycle" as const, motorwayExcluded: true as const, fallbackUsed: false as const },
    ...input,
  };
}
