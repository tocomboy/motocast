import { describe, expect, it, vi } from "vitest";

import { finalizeAuthenticatedLogin } from "./login-finalization";

type LoginClient = Parameters<typeof finalizeAuthenticatedLogin>[0];

function client(options: {
  userId?: string;
  membership?: { user_id: string } | null;
  claimError?: Error | null;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: options.membership ?? null });
  const is = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ is }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn().mockResolvedValue({ error: options.claimError ?? null });
  const auth = {
    getUser: vi.fn().mockResolvedValue({
      data: { user: options.userId ? { id: options.userId } : null },
    }),
  };
  return {
    value: { auth, from, rpc } as unknown as LoginClient,
    spies: { auth, from, rpc, select, eq, is, maybeSingle },
  };
}

describe("authenticated login finalization", () => {
  it("atomically claims a valid invitation instead of trusting a membership lookup", async () => {
    const target = client({ userId: "user-1" });
    const token = "a".repeat(43);

    await expect(finalizeAuthenticatedLogin(
      target.value,
      `motocast_invite=${token}`,
    )).resolves.toBe("accepted");

    expect(target.spies.rpc).toHaveBeenCalledWith("claim_invite", {
      invite_token: token,
    });
    expect(target.spies.auth.getUser).not.toHaveBeenCalled();
  });

  it("fails a rejected invitation closed", async () => {
    const target = client({ claimError: new Error("INVITE_INVALID") });

    await expect(finalizeAuthenticatedLogin(
      target.value,
      `motocast_invite=${"b".repeat(43)}`,
    )).resolves.toBe("invalid_invite");
  });

  it("allows only an existing active member when no invitation is present", async () => {
    const active = client({ userId: "user-1", membership: { user_id: "user-1" } });
    await expect(finalizeAuthenticatedLogin(active.value, null)).resolves.toBe("accepted");
    expect(active.spies.is).toHaveBeenCalledWith("revoked_at", null);

    const missing = client({ userId: "user-2", membership: null });
    await expect(finalizeAuthenticatedLogin(missing.value, null)).resolves.toBe("invite_required");

    const unauthenticated = client({ membership: null });
    await expect(finalizeAuthenticatedLogin(unauthenticated.value, null)).resolves.toBe("invite_required");
    expect(unauthenticated.spies.from).not.toHaveBeenCalled();
  });
});
