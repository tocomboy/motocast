import type { CollectionCourse } from "./contracts";
import type { SelectedPlace } from "../planner/input";
import type { PlaceSearchResult } from "../places/search";

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

export function prepareCollectionApplication(course: CollectionCourse) {
  return {
    origin: selectedPlaceToPlace(course.origin),
    destination: selectedPlaceToPlace(course.destination),
    orderedPoints: [...course.points],
  };
}
