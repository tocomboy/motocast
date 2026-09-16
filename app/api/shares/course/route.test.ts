import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }) }));

import { POST } from "./route";

const token = "a".repeat(43);
const place = { kakaoPlaceId: "1", verificationToken: "v".repeat(43), name: "장소", address: "주소", roadAddress: null, longitude: 127, latitude: 37.5 };
const course = { origin: place, destination: { ...place, kakaoPlaceId: "2", name: "도착" }, points: [] };

function request(body: unknown = { token }) {
  return new Request("https://motocast.test/api/shares/course", { method: "POST", headers: { origin: "https://motocast.test", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: "member" } }, error: null });
  mocks.rpc.mockReset().mockResolvedValue({ data: course, error: null });
});

describe("shared course bootstrap route", () => {
  it("requires a same-origin token-only request", async () => {
    expect((await POST(request({ token, extra: true }))).status).toBe(400);
    expect((await POST(request({ token: "bad" }))).status).toBe(400);
    const crossSite = request();
    crossSite.headers.set("sec-fetch-site", "cross-site");
    expect((await POST(crossSite)).status).toBe(400);
  });

  it("authenticates and returns only the validated private course without caching", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("get_shared_course", { share_token: token });
    expect(await response.json()).toEqual({ course });
  });

  it("maps anonymous, revoked, missing, and unavailable shares safely", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await POST(request())).status).toBe(401);
    for (const [message, status] of [["MEMBERSHIP_REQUIRED", 403], ["SHARE_NOT_FOUND", 404], ["SHARE_COURSE_UNAVAILABLE", 409]] as const) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message } });
      const response = await POST(request());
      expect(response.status).toBe(status);
      expect(JSON.stringify(await response.json())).not.toContain(token);
    }
  });

  it("fails closed for malformed or unknown RPC results", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...course, departureAt: "secret" }, error: null });
    expect((await POST(request())).status).toBe(200);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "raw sql" } });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("raw sql");
  });
});
