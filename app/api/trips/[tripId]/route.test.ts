import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({ rpc })),
}));

import { DELETE } from "./route";

const tripId = "71000000-0000-4000-8000-000000000001";

function request(origin = "https://preview.example") {
  return new Request(`${origin}/api/trips/${tripId}`, {
    method: "DELETE",
    headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: "{}",
  });
}

describe("owned trip deletion route", () => {
  beforeEach(() => rpc.mockReset());

  it("delegates an exact UUID to the ownership-enforcing RPC", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const response = await DELETE(request(), { params: Promise.resolve({ tripId }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(rpc).toHaveBeenCalledWith("delete_owned_trip", { target_trip_id: tripId });
  });

  it("rejects cross-site and malformed requests before the RPC", async () => {
    const crossSite = new Request(`https://preview.example/api/trips/${tripId}`, {
      method: "DELETE",
      headers: { origin: "https://attacker.example", "content-type": "application/json", "sec-fetch-site": "cross-site" },
      body: "{}",
    });
    expect((await DELETE(crossSite, { params: Promise.resolve({ tripId }) })).status).toBe(400);
    expect((await DELETE(request(), { params: Promise.resolve({ tripId: "not-a-uuid" }) })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not expose database errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "private SQL detail" } });
    const response = await DELETE(request(), { params: Promise.resolve({ tripId }) });
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain("SQL");
  });
});
