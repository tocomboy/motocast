import { describe, expect, it } from "vitest";

import { signPlace, verifyPlace } from "./place-verification";

const place = {
  kakaoPlaceId: "123",
  name: "팔당역",
  address: "경기 남양주시 와부읍 팔당리",
  roadAddress: "경기 남양주시 경강로 2227",
  latitude: 37.547,
  longitude: 127.243,
};

const secret = "test-secret-with-at-least-thirty-two-bytes";

describe("place verification", () => {
  it("verifies an unchanged provider place", async () => {
    const signature = await signPlace(place, secret);
    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(verifyPlace(place, signature, secret)).resolves.toBe(true);
  });

  it("rejects forged coordinates and labels", async () => {
    const signature = await signPlace(place, secret);
    await expect(verifyPlace({ ...place, longitude: 128 }, signature, secret)).resolves.toBe(false);
    await expect(verifyPlace({ ...place, name: "조작된 장소" }, signature, secret)).resolves.toBe(false);
  });

  it("fails closed when the signing secret is weak", async () => {
    await expect(signPlace(place, "too-short")).rejects.toThrow(/PLACE_VERIFICATION_NOT_CONFIGURED/);
  });
});
