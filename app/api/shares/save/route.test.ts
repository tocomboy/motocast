import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));

import { POST } from "./route";

const token = "a".repeat(43);
const saveOperationId = "10000000-0000-4000-8000-000000000001";
function request(body: unknown = { token, saveOperationId, title: "북한강 새 일정" }, origin = "https://motocast.test") {
  return new Request(`${origin}/api/shares/save`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: "member" } }, error: null });
  mocks.rpc.mockReset().mockResolvedValue({ data: [{ collection_id: "c", version_id: "v", version_number: 1 }], error: null });
});

describe("shared collection save route", () => {
  it("requires a same-origin bounded JSON request", async () => {
    expect((await POST(request({ token, saveOperationId, title: "" }))).status).toBe(400);
    const wrongOrigin = request({ token, saveOperationId, title: "코스" });
    wrongOrigin.headers.set("origin", "https://other.test");
    expect((await POST(wrongOrigin)).status).toBe(400);
    const crossSite = request();
    crossSite.headers.set("sec-fetch-site", "cross-site");
    expect((await POST(crossSite)).status).toBe(400);
  });

  it("authenticates then copies through the narrow RPC", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("save_shared_collection", {
      share_token: token,
      save_operation_id: saveOperationId,
      collection_title: "북한강 새 일정",
    });
    expect(await response.json()).toEqual({ collectionId: "c", versionId: "v", versionNumber: 1 });
  });

  it("maps missing auth, revoked membership, missing share, and legacy share safely", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await POST(request())).status).toBe(401);
    for (const [message, status] of [["MEMBERSHIP_REQUIRED", 403], ["SHARE_NOT_FOUND", 404], ["SHARE_COURSE_UNAVAILABLE", 409]] as const) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message } });
      const response = await POST(request());
      expect(response.status).toBe(status);
      expect(JSON.stringify(await response.json())).not.toContain(token);
    }
  });

  it("fails closed for unknown database errors and malformed responses", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "raw sql" } });
    const failed = await POST(request());
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain("raw sql");
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect((await POST(request())).status).toBe(503);
  });
});
