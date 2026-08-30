export type WeatherFailureKind = "provider" | "budget" | "configuration" | "persistence" | "request";

export function weatherFailureKind(error: unknown): WeatherFailureKind {
  const code = error instanceof Error ? error.message : "";
  if (code.includes("API_DAILY_BUDGET_EXHAUSTED")) return "budget";
  if (code === "API_BUDGET_ACCOUNTING_FAILED") return "persistence";
  if (code.includes("NOT_CONFIGURED")) return "configuration";
  if (code === "WEATHER_PERSIST_FAILED") return "persistence";
  if (code.startsWith("KMA_")) return "provider";
  return "request";
}
