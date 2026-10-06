/**
 * Saved-place pin clustering shared by web and Android (Issue #123).
 *
 * Rules (Figma node 374:11242):
 * - Radius by Kakao web map level: 1..3 → 0 (identical coordinates only),
 *   4..6 → 48, 7..9 → 56, 10+ → 72 container pixels (dp on Android).
 * - A cluster needs at least two pins. Callers pass only the visible layers and
 *   list pins that must stay single (selected pin) in `excludedIds`; route
 *   points, numbered search pins and avoid pins never enter this function.
 * - Deterministic greedy grouping: pins are visited in ascending `id` order and
 *   each unassigned pin seeds a group that absorbs every unassigned pin within
 *   the radius of the seed. The group position is the mean of its members.
 */
export type ClusterPinInput = {
  id: string;
  /** Container pixel position at the current level. */
  x: number;
  y: number;
  latitude: number;
  longitude: number;
  starred: boolean;
};

export type ClusterSize = 44 | 50 | 56;

export type PinGroup =
  | { kind: "pin"; pin: ClusterPinInput }
  | {
      kind: "cluster";
      ids: string[];
      count: number;
      label: string;
      size: ClusterSize;
      starred: boolean;
      latitude: number;
      longitude: number;
      /** Every member shares one coordinate, so zooming never separates them. */
      sameCoordinates: boolean;
    };

export const MIN_MAP_LEVEL = 1;
export const CLUSTER_ZOOM_STEPS = 2;
export const CLUSTER_FIT_PADDING = 48;
export const CLUSTER_RECALCULATE_DELAY_MS = 150;

export function clusterRadiusForLevel(level: number): number {
  if (!Number.isFinite(level)) throw new Error("INVALID_MAP_LEVEL");
  if (level <= 3) return 0;
  if (level <= 6) return 48;
  if (level <= 9) return 56;
  return 72;
}

/** S 44 for 2..9, M 50 for 10..99, L 56 for 100+ (label caps at 999+). */
export function clusterBadge(count: number): { size: ClusterSize; label: string } {
  if (!Number.isInteger(count) || count < 2) throw new Error("INVALID_CLUSTER_COUNT");
  return {
    size: count < 10 ? 44 : count < 100 ? 50 : 56,
    label: count > 999 ? "999+" : String(count),
  };
}

const sameCoordinate = (a: ClusterPinInput, b: ClusterPinInput) =>
  a.latitude === b.latitude && a.longitude === b.longitude;

export function clusterPins(
  pins: readonly ClusterPinInput[],
  level: number,
  excludedIds: ReadonlySet<string> = new Set(),
): PinGroup[] {
  const radius = clusterRadiusForLevel(level);
  const ordered = [...pins].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const assigned = new Set<string>();
  const groups: PinGroup[] = [];
  for (const seed of ordered) {
    if (assigned.has(seed.id)) continue;
    assigned.add(seed.id);
    if (excludedIds.has(seed.id)) {
      groups.push({ kind: "pin", pin: seed });
      continue;
    }
    const members = [seed];
    for (const candidate of ordered) {
      if (assigned.has(candidate.id) || excludedIds.has(candidate.id)) continue;
      const near =
        radius === 0
          ? sameCoordinate(seed, candidate)
          : Math.hypot(candidate.x - seed.x, candidate.y - seed.y) <= radius;
      if (near) {
        members.push(candidate);
        assigned.add(candidate.id);
      }
    }
    if (members.length === 1) {
      groups.push({ kind: "pin", pin: seed });
      continue;
    }
    const badge = clusterBadge(members.length);
    groups.push({
      kind: "cluster",
      ids: members.map((pin) => pin.id),
      count: members.length,
      label: badge.label,
      size: badge.size,
      starred: members.some((pin) => pin.starred),
      latitude: members.reduce((sum, pin) => sum + pin.latitude, 0) / members.length,
      longitude: members.reduce((sum, pin) => sum + pin.longitude, 0) / members.length,
      sameCoordinates: members.every((pin) => sameCoordinate(seed, pin)),
    });
  }
  return groups;
}

/**
 * Level after tapping a cluster: the level that fits its members (with 48px
 * padding) but at least two steps closer than the current one, never below 1.
 */
export function clusterZoomLevel(currentLevel: number, fittedLevel: number): number {
  return Math.max(MIN_MAP_LEVEL, Math.min(fittedLevel, currentLevel - CLUSTER_ZOOM_STEPS));
}
