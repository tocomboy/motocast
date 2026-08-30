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
  const lunch = points.find((point) => point.stopRole === "lunch") ?? null;
  const dinner = points.find((point) => point.stopRole === "dinner") ?? null;
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

export function replaceCollectionStop(
  points: CollectionPoint[],
  stopRole: StopRole,
  replacement: CollectionPoint | null,
) {
  const firstIndex = points.findIndex((point) => point.stopRole === stopRole);
  if (!replacement) return points.filter((point) => point.stopRole !== stopRole);
  if (firstIndex < 0) return [...points, replacement];
  return points.flatMap((point, index) => {
    if (point.stopRole !== stopRole) return [point];
    return index === firstIndex ? [replacement] : [];
  });
}

export function setCollectionRestSelected(points: CollectionPoint[], selected: boolean) {
  return points.map((point) => point.stopRole === "rest" ? { ...point, selected } : point);
}

export function insertCollectionWinding(points: CollectionPoint[], windingPoint: CollectionPoint) {
  const lastWinding = points.findLastIndex((point) => point.winding);
  const lunchIndex = points.findIndex((point) => point.stopRole === "lunch");
  const insertionIndex = lastWinding >= 0 ? lastWinding + 1 : lunchIndex >= 0 ? lunchIndex : points.length;
  return [...points.slice(0, insertionIndex), windingPoint, ...points.slice(insertionIndex)];
}
