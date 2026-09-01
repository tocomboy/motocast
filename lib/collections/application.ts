import type { CollectionPoint } from "./contracts";
import type { PlaceSearchResult } from "../places/search";

type StopRole = "lunch" | "dinner" | "rest";

export function collectionPointToPlace(point: CollectionPoint): PlaceSearchResult {
  return {
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
  };
}

export function prepareCollectionApplication(points: CollectionPoint[]) {
  const lunch = points.find((point) => point.stopRole === "lunch" && point.selected) ?? null;
  const dinner = points.find((point) => point.stopRole === "dinner" && point.selected) ?? null;
  const rest = points.find((point) => point.stopRole === "rest") ?? null;
  return {
    orderedPoints: [...points],
    lunch: lunch ? collectionPointToPlace(lunch) : null,
    dinner: dinner ? collectionPointToPlace(dinner) : null,
    rest: rest ? collectionPointToPlace(rest) : null,
    includeRest: rest?.selected === true,
    selectedWindingPoints: points
      .filter((point) => point.selected && point.winding)
      .map(collectionPointToPlace),
  };
}

export function replaceCollectionStop<T extends CollectionPoint>(
  points: T[],
  stopRole: StopRole,
  replacement: T | null,
): T[] {
  const firstIndex = points.findIndex((point) => point.stopRole === stopRole);
  if (!replacement) return points.filter((point) => point.stopRole !== stopRole);
  if (firstIndex < 0) return [...points, replacement];
  return points.flatMap((point, index) => {
    if (point.stopRole !== stopRole) return [point];
    return index === firstIndex ? [replacement] : [];
  });
}

export function setCollectionRestSelected<T extends CollectionPoint>(points: T[], selected: boolean): T[] {
  return points.map((point) => point.stopRole === "rest" ? { ...point, selected } as T : point);
}

export function insertCollectionWinding<T extends CollectionPoint>(points: T[], windingPoint: T): T[] {
  const lastWinding = points.findLastIndex((point) => point.winding);
  const lunchIndex = points.findIndex((point) => point.stopRole === "lunch");
  const insertionIndex = lastWinding >= 0 ? lastWinding + 1 : lunchIndex >= 0 ? lunchIndex : points.length;
  return [...points.slice(0, insertionIndex), windingPoint, ...points.slice(insertionIndex)];
}

export function moveCollectionWinding<T extends CollectionPoint>(points: T[], index: number, direction: -1 | 1): T[] {
  const target = points[index];
  const nextIndex = index + direction;
  if (!target?.winding || nextIndex < 0 || nextIndex >= points.length) return points;
  const reordered = [...points];
  [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
  return reordered;
}

export function removeCollectionWinding<T extends CollectionPoint & { uiKey: string }>(points: T[], uiKey: string): T[] {
  return points.filter((point) => !point.winding || point.uiKey !== uiKey);
}
