export type PlannerFunctionErrorCode = "WINDING_ROUTE_UNAVAILABLE";

export function windingUnavailableNotice(hasLiveCandidates: boolean) {
  return hasLiveCandidates
    ? "서로 다른 와인딩 경로가 없어 이전 실제 경로를 유지했습니다. 와인딩 경유지를 추가해 다시 계산해 주세요."
    : "서로 다른 와인딩 경로가 없습니다. 와인딩 경유지를 추가하면 안전 조건으로 세 후보를 다시 계산합니다.";
}

export async function plannerFunctionErrorCode(error: unknown): Promise<PlannerFunctionErrorCode | null> {
  if (!error || typeof error !== "object" || !("context" in error)) return null;
  const context = (error as { context?: unknown }).context;
  if (!(context instanceof Response)) return null;

  try {
    const body: unknown = await context.clone().json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return (body as { code?: unknown }).code === "WINDING_ROUTE_UNAVAILABLE"
      ? "WINDING_ROUTE_UNAVAILABLE"
      : null;
  } catch {
    return null;
  }
}
