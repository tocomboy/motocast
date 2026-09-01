import type { CollectionCourse, CollectionPoint } from "./contracts";
import type { SelectedPlace } from "../planner/input";
import type { PlaceSearchResult } from "../places/search";

type StopRole = "lunch" | "dinner" | "rest";
type WindingAction = "위로 이동" | "아래로 이동" | "제거";

export function appliedWindingActionLabel(position: number, name: string, action: WindingAction) {
  return `${position}번째 ${name} ${action}`;
}

export function selectedPlaceToPlace(point: SelectedPlace): PlaceSearchResult {
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

export function collectionPointToPlace(point: CollectionPoint): PlaceSearchResult {
  return selectedPlaceToPlace(point);
}

export function prepareCollectionApplication(course: CollectionCourse) {
  const points = course.points;
  const lunch = points.find((point) => point.stopRole === "lunch" && point.selected) ?? null;
  const dinner = points.find((point) => point.stopRole === "dinner" && point.selected) ?? null;
  const rests = points.filter((point) => point.stopRole === "rest" && point.selected);
  return {
    origin: selectedPlaceToPlace(course.origin),
    destination: selectedPlaceToPlace(course.destination),
    orderedPoints: [...points],
    lunch: lunch ? { id: lunch.id, place: collectionPointToPlace(lunch) } : null,
    dinner: dinner ? { id: dinner.id, place: collectionPointToPlace(dinner) } : null,
    rests: rests.map((point) => ({
      id: point.id,
      place: collectionPointToPlace(point),
      dwellMinutes: point.dwellMinutes,
    })),
    selectedWindingPoints: points
      .filter((point) => point.selected && point.winding)
      .map((point) => ({ id: point.id, place: collectionPointToPlace(point) })),
  };
}

export function selectedWindingCount(points: CollectionPoint[]) {
  return points.filter((point) => point.selected && point.winding).length;
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

export function insertCollectionRest<T extends CollectionPoint>(points: T[], rest: T): T[] {
  const restIndexes = points.flatMap((point, index) => point.stopRole === "rest" ? [index] : []);
  const lunchIndex = points.findIndex((point) => point.stopRole === "lunch");
  const dinnerIndex = points.findIndex((point) => point.stopRole === "dinner");
  const insertionIndex = restIndexes.length
    ? restIndexes.at(-1)! + 1
    : lunchIndex >= 0
      ? lunchIndex + 1
      : dinnerIndex >= 0 ? dinnerIndex : points.length;
  return [...points.slice(0, insertionIndex), rest, ...points.slice(insertionIndex)];
}

export function replaceCollectionOccurrence<T extends CollectionPoint>(points: T[], id: string, replacement: T): T[] {
  return points.map((point) => point.id === id ? replacement : point);
}

export function removeCollectionOccurrence<T extends CollectionPoint>(points: T[], id: string): T[] {
  return points.filter((point) => point.id !== id);
}

export function moveCollectionRest<T extends CollectionPoint>(points: T[], id: string, direction: -1 | 1): T[] {
  const restIndexes = points.flatMap((point, index) => point.stopRole === "rest" ? [index] : []);
  const currentRestIndex = restIndexes.findIndex((index) => points[index].id === id);
  const targetRestIndex = currentRestIndex + direction;
  if (currentRestIndex < 0 || targetRestIndex < 0 || targetRestIndex >= restIndexes.length) return points;
  const reordered = [...points];
  const left = restIndexes[currentRestIndex];
  const right = restIndexes[targetRestIndex];
  [reordered[left], reordered[right]] = [reordered[right], reordered[left]];
  return reordered;
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
