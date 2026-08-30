export async function executeBudgetedProviderCall<T>(
  consume: () => Promise<number>,
  callProvider: () => Promise<T>,
) {
  const requestNumber = await consume();
  const result = await callProvider();
  return { requestNumber, result };
}
