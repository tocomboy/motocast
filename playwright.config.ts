import os from "node:os";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const repositoryRoot = process.cwd();
const configuredBaseUrl = process.env.MOTOCAST_E2E_BASE_URL?.trim();
const baseURL = configuredBaseUrl || "http://127.0.0.1:3100";
const storageStateValue = process.env.MOTOCAST_E2E_STORAGE_STATE?.trim();
const storageState = storageStateValue ? path.resolve(storageStateValue) : undefined;
const nextAgentDetectionVariables = new Set([
  "AI_AGENT",
  "ANTIGRAVITY_AGENT",
  "AUGMENT_AGENT",
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CLAUDE_CODE_IS_COWORK",
  "CODEX_CI",
  "CODEX_SANDBOX",
  "CODEX_THREAD_ID",
  "COPILOT_ALLOW_ALL",
  "COPILOT_GITHUB_TOKEN",
  "COPILOT_MODEL",
  "CURSOR_AGENT",
  "CURSOR_EXTENSION_HOST_ROLE",
  "CURSOR_TRACE_ID",
  "GEMINI_CLI",
  "OPENCODE_CLIENT",
  "REPL_ID",
]);

function isInsideRepository(candidate: string) {
  const relative = path.relative(repositoryRoot, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function inheritedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => (
      typeof entry[1] === "string" && !nextAgentDetectionVariables.has(entry[0])
    )),
  );
}

if (storageState && isInsideRepository(storageState)) {
  throw new Error("MOTOCAST_E2E_STORAGE_STATE must point outside the repository");
}

const parsedBaseUrl = new URL(baseURL);
if (
  parsedBaseUrl.protocol !== "https:" &&
  !(parsedBaseUrl.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(parsedBaseUrl.hostname))
) {
  throw new Error("MOTOCAST_E2E_BASE_URL must use HTTPS unless it is loopback");
}

if (process.env.MOTOCAST_E2E_LIVE_MUTATIONS === "1" && (!configuredBaseUrl || !storageState)) {
  throw new Error("Live mutations require an explicit Preview base URL and an external storageState file");
}

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: process.env.MOTOCAST_E2E_OUTPUT_DIR?.trim() || path.join(os.tmpdir(), "motocast-playwright-artifacts"),
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "line",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    storageState,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: configuredBaseUrl
    ? undefined
    : {
        command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
        env: {
          ...inheritedEnvironment(),
          ...Object.fromEntries(Array.from(nextAgentDetectionVariables, (name) => [name, ""])),
          NEXT_PUBLIC_SUPABASE_URL: "",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
          NEXT_PUBLIC_KAKAO_MAP_JS_KEY: "",
        },
      },
});
