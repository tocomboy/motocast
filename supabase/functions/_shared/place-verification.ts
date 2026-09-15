export type VerifiablePlace = {
  kakaoPlaceId: string;
  name: string;
  address: string;
  roadAddress: string | null;
  latitude: number;
  longitude: number;
};

function canonicalPlace(place: VerifiablePlace) {
  return JSON.stringify([
    place.kakaoPlaceId,
    place.name,
    place.address,
    place.roadAddress,
    place.latitude.toFixed(7),
    place.longitude.toFixed(7),
  ]);
}

function base64Url(bytes: Uint8Array) {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesFromBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=";
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(secret: string) {
  if (secret.length < 32) throw new Error("PLACE_VERIFICATION_NOT_CONFIGURED");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signPlace(place: VerifiablePlace, secret: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(canonicalPlace(place)),
  );
  return base64Url(new Uint8Array(signature));
}

export async function verifyPlace(place: VerifiablePlace, signature: string, secret: string) {
  const decoded = bytesFromBase64Url(signature);
  if (!decoded) return false;
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    decoded,
    new TextEncoder().encode(canonicalPlace(place)),
  );
}
