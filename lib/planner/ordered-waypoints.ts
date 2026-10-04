import type { CollectionPoint } from "../collections/contracts";
import type { PlaceSearchResult } from "../places/search";

export type WaypointRole = "waypoint" | "meal" | "lunch" | "dinner" | "rest";

export type EditableWaypoint = {
  id: string;
  role: WaypointRole;
  place: PlaceSearchResult | null;
  dwellMinutes: number;
};

export const waypointRoleOptions: ReadonlyArray<{ value: WaypointRole; label: string }> = [
  { value: "waypoint", label: "경유지" },
  { value: "meal", label: "식사" },
  { value: "rest", label: "휴식" },
];

export const waypointLimits = {
  total: 30,
  waypoint: 20,
  meal: 30,
  lunch: 1,
  dinner: 1,
  rest: 5,
} as const;

export function waypointRoleLabel(role: WaypointRole) {
  if (role === "lunch" || role === "dinner") return "식사";
  return waypointRoleOptions.find((option) => option.value === role)?.label ?? "경유지";
}

// PLAN-003 amendment (2026-10-05): every meal stop takes a fixed 45 minutes
// on every screen; rest stays editable (default 30) and pass-through is 0.
export const MEAL_DWELL_MINUTES = 45;
export const MEAL_DWELL_NOTE = "식사는 45분으로 계산해요.";
export const REST_DWELL_ERROR = "휴식 시간은 1~1440분 사이의 정수로 입력해 주세요.";

export function isMealRole(role: WaypointRole | CollectionPoint["stopRole"]) {
  return role === "meal" || role === "lunch" || role === "dinner";
}

export function defaultDwellMinutes(role: WaypointRole) {
  if (role === "rest") return 30;
  if (isMealRole(role)) return MEAL_DWELL_MINUTES;
  return 0;
}

// The dwell actually stored for a role: pass-through 0, meals fixed, rest as entered.
export function dwellForRole(role: WaypointRole, entered: number) {
  if (role === "waypoint") return 0;
  return isMealRole(role) ? MEAL_DWELL_MINUTES : entered;
}

export function dwellError(role: WaypointRole, dwellMinutes: number): string | null {
  if (role === "waypoint") return dwellMinutes === 0 ? null : "통과 지점은 머무는 시간이 없어요.";
  if (isMealRole(role)) return dwellMinutes === MEAL_DWELL_MINUTES ? null : MEAL_DWELL_NOTE;
  return Number.isInteger(dwellMinutes) && dwellMinutes >= 1 && dwellMinutes <= 1440 ? null : REST_DWELL_ERROR;
}

export function roleAssignmentError(
  waypoints: EditableWaypoint[],
  role: WaypointRole,
  replacingId?: string,
) {
  if (!replacingId && waypoints.length >= waypointLimits.total) {
    return `경유지는 전체 ${waypointLimits.total}개까지 추가할 수 있습니다.`;
  }
  const assigned = waypoints.filter((waypoint) => waypoint.id !== replacingId && waypoint.role === role).length;
  if (assigned >= waypointLimits[role]) {
    if (role === "lunch" || role === "dinner") return "기존 식사 구분은 하나만 추가할 수 있습니다.";
    return `${waypointRoleLabel(role)}${role === "waypoint" ? "는" : "은"} 최대 ${waypointLimits[role]}개까지 추가할 수 있습니다.`;
  }
  return null;
}

// Applying a saved or received course normalizes the draft only: legacy
// lunch/dinner become meal and every meal takes the fixed 45 minutes. The
// stored collection and immutable shares are not rewritten.
export function editableWaypointFromCollectionPoint(point: CollectionPoint): EditableWaypoint {
  const role: WaypointRole = point.stopRole === "lunch" || point.stopRole === "dinner" ? "meal" : point.stopRole ?? "waypoint";
  return {
    id: point.id,
    role,
    place: {
      kakaoPlaceId: point.kakaoPlaceId,
      verificationToken: point.verificationToken,
      name: point.name,
      address: point.address,
      roadAddress: point.roadAddress,
      longitude: point.longitude,
      latitude: point.latitude,
      category: "",
      phone: null,
      placeUrl: null,
    },
    dwellMinutes: dwellForRole(role, point.dwellMinutes),
  };
}

// True when applying these points changes at least one meal's dwell to 45.
export function mealDwellNormalized(points: CollectionPoint[]) {
  return points.some((point) => isMealRole(point.stopRole) && point.dwellMinutes !== MEAL_DWELL_MINUTES);
}

export function collectionPointFromEditableWaypoint(waypoint: EditableWaypoint): CollectionPoint | null {
  if (!waypoint.place) return null;
  const stopRole = waypoint.role === "waypoint" ? undefined : waypoint.role;
  const kind = waypoint.role === "waypoint"
    ? "pass-through"
    : waypoint.role === "rest" ? "optional" : "stop";
  return {
    ...waypoint.place,
    id: waypoint.id,
    label: waypoint.place.name,
    kind,
    dwellMinutes: waypoint.role === "waypoint" ? 0 : waypoint.dwellMinutes,
    selected: true,
    // The persisted `winding` bit is retained as the legacy marker for a
    // rider-authored mandatory pass-through. The current product calls it a
    // route waypoint and never promises provider-derived winding behavior.
    winding: waypoint.role === "waypoint",
    ...(stopRole ? { stopRole } : {}),
  };
}

export function moveWaypoint<T>(waypoints: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (index < 0 || index >= waypoints.length || target < 0 || target >= waypoints.length) return waypoints;
  const reordered = [...waypoints];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  return reordered;
}
