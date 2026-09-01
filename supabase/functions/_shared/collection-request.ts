import { verifyPlace, type VerifiablePlace } from "./place-verification.ts";
import { isWindingOnlyWaypoint } from "./route-request.ts";

export type CollectionSavePoint = VerifiablePlace & {
  id: string;
  label: string;
  verificationToken: string;
  kind: "pass-through" | "stop" | "optional";
  dwellMinutes: number;
  selected: boolean;
  winding: boolean;
  stopRole?: "lunch" | "dinner" | "rest";
};

export type CollectionSaveRequest = {
  collectionId: string | null;
  title: string;
  description: string;
  origin: VerifiablePlace & { verificationToken: string };
  destination: VerifiablePlace & { verificationToken: string };
  points: CollectionSavePoint[];
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseVerifiedPlace(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_COLLECTION");
  const point = value as Partial<CollectionSavePoint>;
  if (
    typeof point.kakaoPlaceId !== "string" || point.kakaoPlaceId.length < 1 || point.kakaoPlaceId.length > 80 ||
    typeof point.verificationToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(point.verificationToken) ||
    typeof point.name !== "string" || point.name.trim().length < 1 || point.name.length > 160 ||
    typeof point.address !== "string" || point.address.trim().length < 1 || point.address.length > 300 ||
    !(point.roadAddress === null || (typeof point.roadAddress === "string" && point.roadAddress.length <= 300)) ||
    typeof point.longitude !== "number" || !Number.isFinite(point.longitude) || point.longitude < 124.5 || point.longitude > 132 ||
    typeof point.latitude !== "number" || !Number.isFinite(point.latitude) || point.latitude < 32.8 || point.latitude > 38.7
  ) throw new Error("INVALID_COLLECTION");
  return {
    kakaoPlaceId: point.kakaoPlaceId,
    verificationToken: point.verificationToken,
    name: point.name.trim(),
    address: point.address.trim(),
    roadAddress: point.roadAddress,
    longitude: point.longitude,
    latitude: point.latitude,
  };
}

function parsePoint(value: unknown): CollectionSavePoint {
  const place = parseVerifiedPlace(value);
  const point = value as Partial<CollectionSavePoint>;
  if (
    typeof point.id !== "string" || point.id.trim().length < 1 || point.id.length > 100 ||
    !["pass-through", "stop", "optional"].includes(String(point.kind)) ||
    !Number.isInteger(point.dwellMinutes) || Number(point.dwellMinutes) < 0 || Number(point.dwellMinutes) > 1440 ||
    typeof point.selected !== "boolean" || typeof point.winding !== "boolean" ||
    (point.stopRole !== undefined && !["lunch", "dinner", "rest"].includes(point.stopRole))
  ) throw new Error("INVALID_COLLECTION");
  if (point.winding && !isWindingOnlyWaypoint({
    kind: point.kind as CollectionSavePoint["kind"],
    dwellMinutes: Number(point.dwellMinutes),
    winding: point.winding,
    stopRole: point.stopRole,
  })) throw new Error("INVALID_COLLECTION");
  return {
    ...place,
    id: point.id.trim(),
    label: place.name,
    kind: point.kind as CollectionSavePoint["kind"],
    dwellMinutes: Number(point.dwellMinutes),
    selected: point.selected,
    winding: point.winding,
    ...(point.stopRole ? { stopRole: point.stopRole } : {}),
  };
}

export async function parseCollectionSaveRequest(value: unknown, verificationSecret: string): Promise<CollectionSaveRequest> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_COLLECTION");
  const raw = value as { collectionId?: unknown; title?: unknown; description?: unknown; origin?: unknown; destination?: unknown; points?: unknown };
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (
    !(raw.collectionId === null || raw.collectionId === undefined || (typeof raw.collectionId === "string" && uuidPattern.test(raw.collectionId))) ||
    title.length < 1 || title.length > 120 || typeof raw.description !== "string" || raw.description.length > 2000 ||
    !Array.isArray(raw.points) || raw.points.length > 30
  ) throw new Error("INVALID_COLLECTION");
  const origin = parseVerifiedPlace(raw.origin);
  const destination = parseVerifiedPlace(raw.destination);
  const points = raw.points.map(parsePoint);
  const selected = points.filter((point) => point.selected);
  const lunches = selected.filter((point) => point.stopRole === "lunch");
  const dinners = selected.filter((point) => point.stopRole === "dinner");
  const rests = selected.filter((point) => point.stopRole === "rest");
  if (
    selected.length !== points.length || new Set(points.map((point) => point.id)).size !== points.length ||
    lunches.length > 1 || lunches.some((point) => point.kind !== "stop") ||
    dinners.length > 1 || dinners.some((point) => point.kind !== "stop") ||
    rests.length > 5 || rests.some((point) => point.kind !== "optional") ||
    selected.filter((point) => point.winding).length > 20
  ) throw new Error("INVALID_COLLECTION");
  const verified = await Promise.all([origin, destination, ...points].map((point) => (
    verifyPlace(point, point.verificationToken, verificationSecret)
  )));
  if (verified.some((result) => !result)) throw new Error("UNVERIFIED_PLACE");
  return {
    collectionId: typeof raw.collectionId === "string" ? raw.collectionId : null,
    title,
    description: raw.description,
    origin,
    destination,
    points,
  };
}
