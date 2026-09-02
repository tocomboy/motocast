import type { CollectionPoint } from "../collections/contracts";
import type { PlaceSearchResult } from "../places/search";

export type WaypointRole = "waypoint" | "lunch" | "dinner" | "rest";

export type EditableWaypoint = {
  id: string;
  role: WaypointRole;
  place: PlaceSearchResult | null;
  dwellMinutes: number;
};

export const waypointRoleOptions: ReadonlyArray<{ value: WaypointRole; label: string }> = [
  { value: "waypoint", label: "경유지" },
  { value: "lunch", label: "점심" },
  { value: "dinner", label: "저녁" },
  { value: "rest", label: "휴식" },
];

export const waypointLimits = {
  total: 30,
  waypoint: 20,
  lunch: 1,
  dinner: 1,
  rest: 5,
} as const;

export function waypointRoleLabel(role: WaypointRole) {
  return waypointRoleOptions.find((option) => option.value === role)?.label ?? "경유지";
}

export function defaultDwellMinutes(role: WaypointRole) {
  if (role === "rest") return 30;
  if (role === "lunch" || role === "dinner") return 60;
  return 0;
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
    if (role === "lunch" || role === "dinner") return `${waypointRoleLabel(role)}은 하나만 추가할 수 있습니다.`;
    return `${waypointRoleLabel(role)}${role === "waypoint" ? "는" : "은"} 최대 ${waypointLimits[role]}개까지 추가할 수 있습니다.`;
  }
  return null;
}

export function editableWaypointFromCollectionPoint(point: CollectionPoint): EditableWaypoint {
  const role: WaypointRole = point.stopRole ?? "waypoint";
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
    dwellMinutes: role === "waypoint" ? 0 : point.dwellMinutes,
  };
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
