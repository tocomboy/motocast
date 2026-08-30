import { afterEach, describe, expect, it, vi } from "vitest";

import { withClientTimeout } from "./client-timeout";

afterEach(() => vi.useRealTimers());

describe("withClientTimeout", () => {
  it("fails a hung client operation at the configured deadline", async () => {
    vi.useFakeTimers();
    const result = withClientTimeout(new Promise<never>(() => undefined), 12_000);
    const rejection = expect(result).rejects.toThrow("CLIENT_REQUEST_TIMEOUT");
    await vi.advanceTimersByTimeAsync(12_000);
    await rejection;
  });

  it("returns a completed operation without waiting for the deadline", async () => {
    await expect(withClientTimeout(Promise.resolve("ok"), 12_000)).resolves.toBe("ok");
  });
});
