import { describe, expect, it, vi } from "vitest";

import { finalizeAuthenticatedLogin } from "./login-finalization";

type LoginClient = Parameters<typeof finalizeAuthenticatedLogin>[0];

function client(options: {
  userId?: string;
  membership?: { user_id: string; role?: string } | null;
  userError?: Error;
  membershipError?: Error;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: options.membership ?? null, error: options.membershipError ?? null });
  const is = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ is }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn();
  const auth = {
    getUser: vi.fn().mockResolvedValue({
      data: { user: options.userId ? { id: options.userId } : null },
      error: options.userError ?? null,
    }),
  };
  return {
    value: { auth, from, rpc } as unknown as LoginClient,
    spies: { auth, from, rpc, select, eq, is, maybeSingle },
  };
}

describe("existing-member web login finalization", () => {
  it.each(["admin", "rider"])("allows an active %s without changing membership or requiring a profile", async (role) => {
    const active = client({ userId: "user-1", membership: { user_id: "user-1", role } });
    await expect(finalizeAuthenticatedLogin(active.value)).resolves.toBe("accepted");
    expect(active.spies.from).toHaveBeenCalledExactlyOnceWith("memberships");
    expect(active.spies.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(active.spies.is).toHaveBeenCalledWith("revoked_at", null);
    expect(active.spies.rpc).not.toHaveBeenCalled();
  });

  it("denies missing or revoked membership without claiming an invitation", async () => {
    const missing = client({ userId: "user-2", membership: null });
    await expect(finalizeAuthenticatedLogin(missing.value)).resolves.toBe("membership_required");
    expect(missing.spies.is).toHaveBeenCalledWith("revoked_at", null);
    expect(missing.spies.rpc).not.toHaveBeenCalled();
  });

  it("denies an unauthenticated or unverifiable identity before membership lookup", async () => {
    for (const target of [client({}), client({ userId: "user-1", userError: new Error("verification failed") })]) {
      await expect(finalizeAuthenticatedLogin(target.value)).resolves.toBe("membership_required");
      expect(target.spies.from).not.toHaveBeenCalled();
      expect(target.spies.rpc).not.toHaveBeenCalled();
    }
  });

  it("fails membership read errors closed even if data accompanies the error", async () => {
    const target = client({ userId: "user-1", membership: { user_id: "user-1" }, membershipError: new Error("unavailable") });
    await expect(finalizeAuthenticatedLogin(target.value)).resolves.toBe("membership_required");
    expect(target.spies.rpc).not.toHaveBeenCalled();
  });
});
