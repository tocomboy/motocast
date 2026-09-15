export async function executeBudgetedProviderCall<T>(
  consume: () => Promise<number>,
  callProvider: () => Promise<T>,
) {
  const requestNumber = await consume();
  if (!Number.isInteger(requestNumber) || requestNumber <= 0) {
    throw new Error("API_BUDGET_ACCOUNTING_FAILED");
  }
  const result = await callProvider();
  return { requestNumber, result };
}
