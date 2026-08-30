import { describe, expect, it } from "vitest";

import { resolvePublicShareWithClient } from "./resolve-core";

const token = "a".repeat(43);

function client(data: unknown, error: { message: string } | null = null) {
  return async () => ({ rpc: async () => ({ data, error }) });
}

describe("resolvePublicShareWithClient", () => {
  it("keeps malformed and explicitly missing shares distinct from outages", async () => {
    await expect(resolvePublicShareWithClient("bad", client(null))).resolves.toEqual({ status: "not-found" });
    await expect(resolvePublicShareWithClient(token, client(null, { message: "SHARE_NOT_FOUND" }))).resolves.toEqual({ status: "not-found" });
    await expect(resolvePublicShareWithClient(token, client(null))).resolves.toEqual({ status: "unavailable" });
  });

  it("maps client creation, RPC, and malformed snapshot failures to retryable or invalid states", async () => {
    await expect(resolvePublicShareWithClient(token, async () => { throw new Error("missing env"); })).resolves.toEqual({ status: "unavailable" });
    await expect(resolvePublicShareWithClient(token, async () => ({ rpc: async () => { throw new Error("network"); } }))).resolves.toEqual({ status: "unavailable" });
    await expect(resolvePublicShareWithClient(token, client({ version: 999 }))).resolves.toEqual({ status: "invalid-snapshot" });
  });
});
