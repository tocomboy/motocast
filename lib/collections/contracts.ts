import { parseSelectedPlace, type SelectedPlace } from "../planner/input";
import type { WaypointKind } from "../planner/types";

export type CollectionPoint = SelectedPlace & {
  id: string;
  label: string;
  kind: WaypointKind;
  dwellMinutes: number;
  selected: boolean;
  winding: boolean;
  stopRole?: "lunch" | "dinner" | "rest";
};

export type RidingCollection = {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
  latestVersion: {
    id: string;
    number: number;
    createdAt: string;
    points: CollectionPoint[];
  };
};

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function timestamp(value: unknown, code: string) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(code);
  return new Date(value).toISOString();
}

export function parseCollectionPoint(value: unknown): CollectionPoint {
  const raw = record(value, "INVALID_COLLECTION_POINT");
  const place = parseSelectedPlace(raw);
  if (
    typeof raw.id !== "string" || raw.id.length < 1 || raw.id.length > 100 ||
    typeof raw.label !== "string" || raw.label.length < 1 || raw.label.length > 160 ||
    !["pass-through", "stop", "optional"].includes(String(raw.kind)) ||
    !Number.isInteger(raw.dwellMinutes) || Number(raw.dwellMinutes) < 0 || Number(raw.dwellMinutes) > 1440 ||
    typeof raw.selected !== "boolean" || typeof raw.winding !== "boolean" ||
    (raw.stopRole !== undefined && !["lunch", "dinner", "rest"].includes(String(raw.stopRole)))
  ) throw new Error("INVALID_COLLECTION_POINT");
  return {
    ...place,
    id: raw.id,
    label: raw.label,
    kind: raw.kind as WaypointKind,
    dwellMinutes: Number(raw.dwellMinutes),
    selected: raw.selected,
    winding: raw.winding,
    stopRole: raw.stopRole as CollectionPoint["stopRole"],
  };
}

export function parseCollectionRows(value: unknown): RidingCollection[] {
  if (!Array.isArray(value)) throw new Error("INVALID_COLLECTION_RESPONSE");
  return value.map((item) => {
    const raw = record(item, "INVALID_COLLECTION_RESPONSE");
    if (
      typeof raw.id !== "string" ||
      typeof raw.title !== "string" || raw.title.trim().length < 1 || raw.title.length > 120 ||
      typeof raw.description !== "string" || raw.description.length > 2000 ||
      !Array.isArray(raw.collection_versions) || raw.collection_versions.length === 0
    ) throw new Error("INVALID_COLLECTION_RESPONSE");
    const versions = raw.collection_versions.map((version) => {
      const parsed = record(version, "INVALID_COLLECTION_VERSION");
      if (
        typeof parsed.id !== "string" ||
        !Number.isInteger(parsed.version_number) || Number(parsed.version_number) <= 0 ||
        !Array.isArray(parsed.points)
      ) throw new Error("INVALID_COLLECTION_VERSION");
      return {
        id: parsed.id,
        number: Number(parsed.version_number),
        createdAt: timestamp(parsed.created_at, "INVALID_COLLECTION_VERSION"),
        points: parsed.points.map(parseCollectionPoint),
      };
    }).sort((left, right) => right.number - left.number);
    return {
      id: raw.id,
      title: raw.title.trim(),
      description: raw.description,
      updatedAt: timestamp(raw.updated_at, "INVALID_COLLECTION_RESPONSE"),
      latestVersion: versions[0],
    };
  });
}
