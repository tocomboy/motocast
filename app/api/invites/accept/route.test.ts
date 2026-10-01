import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("retired invitation acceptance", () => {
  it("rejects a legacy token, clears its cookie and never echoes the token", async () => {
    const token = "a".repeat(43);
    const response = await POST(new Request("https://motocast.example/api/invites/accept", {
      method: "POST",
      headers: { origin: "https://motocast.example", "content-type": "application/json", cookie: `motocast_invite=${token}` },
      body: JSON.stringify({ token }),
    }));
    expect(response.status).toBe(410);
    const body = await response.json();
    expect(body.error).toContain("앱에서 가입");
    expect(body.accepted).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(token);
    expect(response.headers.get("set-cookie")).toContain("motocast_invite=;");
    expect(response.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each<Record<string, string>>([
    { origin: "https://foreign.example", "content-type": "application/json" },
    { origin: "https://motocast.example", "content-type": "text/plain" },
    { "content-type": "application/json" },
  ])("rejects an untrusted request without changing cookies: %s", async (headers) => {
    const response = await POST(new Request("https://motocast.example/api/invites/accept", {
      method: "POST", headers, body: "{}",
    }));
    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
