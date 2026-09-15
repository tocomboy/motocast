import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionMissingError } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  hasPublicSupabaseEnv: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({
  hasPublicSupabaseEnv: mocks.hasPublicSupabaseEnv,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  })),
}));

import { currentVersion } from "@/lib/releases";
import { POST } from "./route";

const presentationId = "81000000-0000-4000-8000-000000000001";
const origin = "https://preview.example";

function request(
  body: unknown = { expectedVersion: currentVersion, presentationId },
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}/api/releases/claim`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("release announcement claim route", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.hasPublicSupabaseEnv.mockReset();
    mocks.rpc.mockReset();
    mocks.hasPublicSupabaseEnv.mockReturnValue(true);
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a" } }, error: null });
  });

  it("pins the server-owned version and returns the claim decision without caching", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toEqual({ show: true, version: currentVersion });
    expect(mocks.rpc).toHaveBeenCalledWith("claim_release_announcement", {
      target_version: currentVersion,
      target_presentation_id: presentationId,
    });
  });

  it("returns false for an already claimed version", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ show: false, version: currentVersion });
  });

  it("rejects cross-site, malformed, and extra-field bodies before auth", async () => {
    const crossSite = request(undefined, {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    });
    expect((await POST(crossSite)).status).toBe(400);
    expect((await POST(request({ expectedVersion: currentVersion, presentationId: "not-a-uuid" }))).status).toBe(400);
    expect((await POST(request({ expectedVersion: currentVersion, presentationId, version: "9.9.9" }))).status).toBe(400);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an old client version before auth or RPC claim", async () => {
    const response = await POST(request({ expectedVersion: "0.1.0", presentationId }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "새 버전이 준비됐습니다. 새로고침 후 다시 확인해 주세요.",
    });
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns no content in the keyless local demo", async () => {
    mocks.hasPublicSupabaseEnv.mockReturnValue(false);
    const response = await POST(request());
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("requires a verified server user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "로그인이 필요합니다." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps auth transport failures retryable", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { code: "unexpected_failure", message: "private upstream detail", status: 503 },
    });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("upstream");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps membership denial without exposing database details", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "MEMBERSHIP_REQUIRED" } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("MEMBERSHIP_REQUIRED");
  });

  it("fails closed on internal errors and malformed RPC results", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "private SQL detail" } });
    const internal = await POST(request());
    expect(internal.status).toBe(503);
    expect(JSON.stringify(await internal.json())).not.toContain("SQL");

    mocks.rpc.mockResolvedValueOnce({ data: "true", error: null });
    const malformed = await POST(request());
    expect(malformed.status).toBe(503);
  });
});
