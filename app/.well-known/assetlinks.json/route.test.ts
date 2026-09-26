import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const fingerprint = Array(32).fill("AB").join(":");

afterEach(() => vi.unstubAllEnvs());

describe("Android App Links certificate association", () => {
  it("returns public JSON for the Play package and all configured signing generations", async () => {
    const previous = Array(32).fill("CD").join(":");
    vi.stubEnv("MOTOCAST_ANDROID_APP_LINKS_SHA256", `${fingerprint.toLowerCase()}, ${previous},${fingerprint}`);
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.has("location")).toBe(false);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(await response.json()).toEqual([{
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "dev.motocast.android",
        sha256_cert_fingerprints: [fingerprint, previous],
      },
    }]);
  });

  it.each([undefined, "", " ", Array(20).fill("AB").join(":"), `${fingerprint},`,
    `${fingerprint},invalid`, "AB".repeat(32), Array(11).fill(fingerprint).join(",")])(
    "fails explicitly for missing, SHA-1, malformed or excessive configuration (%#)", async (value) => {
      vi.stubEnv("MOTOCAST_ANDROID_APP_LINKS_SHA256", value);
      const response = GET();
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "Android app links are not configured." });
    },
  );
});
