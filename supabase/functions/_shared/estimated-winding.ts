import type { NormalizedKakaoRoute } from "./kakao-route.ts";
import type { KakaoRoutePriority } from "./kakao-safety.ts";
import { curvatureScore, routeFingerprint, selectEstimatedWindingRoute } from "./winding.ts";

export type BudgetedRoutePool = {
  requestNumber: number;
  result: NormalizedKakaoRoute[];
};

export type BudgetedRoute = {
  requestNumber: number;
  result: NormalizedKakaoRoute;
};

type PoolCall = (priority: KakaoRoutePriority, requestAlternatives: boolean) => Promise<BudgetedRoutePool>;

function isSafeRouteAbsence(error: unknown) {
  return error instanceof Error && error.message === "SAFE_ROUTE_NOT_FOUND";
}

function distinctFromBaseline(pool: BudgetedRoutePool, baseline: NormalizedKakaoRoute): BudgetedRoute | null {
  const selected = selectEstimatedWindingRoute(
    pool.result,
    new Set([routeFingerprint(baseline)]),
  );
  return selected && curvatureScore(selected) > curvatureScore(baseline)
    ? { requestNumber: pool.requestNumber, result: selected }
    : null;
}

export async function selectEstimatedWindingChunk(callPool: PoolCall): Promise<{
  selected: BudgetedRoute;
  distinct: boolean;
}> {
  const baselinePool = await callPool("RECOMMEND", false);
  const baseline = baselinePool.result[0];
  if (!baseline) throw new Error("INVALID_ROUTE_PROVIDER_RESPONSE");

  try {
    const recommended = await callPool("RECOMMEND", true);
    const recommendedAlternative = distinctFromBaseline(recommended, baseline);
    if (recommendedAlternative) return { selected: recommendedAlternative, distinct: true };
  } catch (error) {
    if (!isSafeRouteAbsence(error)) throw error;
  }

  try {
    const fastest = await callPool("TIME", true);
    const fastestAlternative = distinctFromBaseline(fastest, baseline);
    if (fastestAlternative) return { selected: fastestAlternative, distinct: true };
  } catch (error) {
    if (!isSafeRouteAbsence(error)) throw error;
  }

  return {
    selected: { requestNumber: baselinePool.requestNumber, result: baseline },
    distinct: false,
  };
}

export function assertEstimatedWindingAvailable(estimatedWinding: boolean, chunkDistinctness: boolean[]) {
  if (estimatedWinding && !chunkDistinctness.some(Boolean)) {
    throw new Error("WINDING_ROUTE_UNAVAILABLE");
  }
}
