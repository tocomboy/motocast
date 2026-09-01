import { describe, expect, it, vi } from "vitest";

import { executeBudgetedProviderCall } from "./budgeted-call";

describe("executeBudgetedProviderCall", () => {
  it("consumes budget before the provider request", async () => {
    const order: string[] = [];
    const result = await executeBudgetedProviderCall(
      async () => { order.push("budget"); return 7; },
      async () => { order.push("provider"); return "ok"; },
    );
    expect(order).toEqual(["budget", "provider"]);
    expect(result).toEqual({ requestNumber: 7, result: "ok" });
  });

  it("does not run the provider when budget consumption fails", async () => {
    const provider = vi.fn(async () => "ok");
    await expect(executeBudgetedProviderCall(
      async () => { throw new Error("API_DAILY_BUDGET_EXHAUSTED"); },
      provider,
    )).rejects.toThrow("API_DAILY_BUDGET_EXHAUSTED");
    expect(provider).not.toHaveBeenCalled();
  });

  it("fails closed and conservatively keeps a reservation when its receipt is lost", async () => {
    let committedReservations = 0;
    const provider = vi.fn(async () => "ok");
    await expect(executeBudgetedProviderCall(
      async () => {
        committedReservations += 1;
        throw new Error("BUDGET_RECEIPT_LOST");
      },
      provider,
    )).rejects.toThrow("BUDGET_RECEIPT_LOST");
    expect(committedReservations).toBe(1);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([null, 0, -1, 1.5, Number.NaN])("fails closed on an invalid budget receipt: %s", async (receipt) => {
    const provider = vi.fn(async () => "ok");
    await expect(executeBudgetedProviderCall(
      async () => receipt as number,
      provider,
    )).rejects.toThrow("API_BUDGET_ACCOUNTING_FAILED");
    expect(provider).not.toHaveBeenCalled();
  });

  it("does not refund a consumed call when the provider fails", async () => {
    let consumed = 0;
    await expect(executeBudgetedProviderCall(
      async () => ++consumed,
      async () => { throw new Error("PROVIDER_TIMEOUT"); },
    )).rejects.toThrow("PROVIDER_TIMEOUT");
    expect(consumed).toBe(1);
  });
});
