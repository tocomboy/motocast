import os from "node:os";
import path from "node:path";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

const repositoryRoot = process.cwd();
const canonicalRepositoryRoot = realpathSync(repositoryRoot);
const previewOrigin = "https://motocast-git-develop-tocomboys-projects.vercel.app";
const previewSupabaseProjectRef = "lehjmbgfpoemqcwxowbx";
const runMode = process.env.npm_lifecycle_event === "test:e2e:preview" ? "preview" : "local";
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
const localConnectionVariables = new Set([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_KAKAO_MAP_JS_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "KAKAO_REST_API_KEY",
  "KAKAO_LOGIN_CLIENT_SECRET",
  "KAKAO_OIDC_STATE_SECRET",
  "PLACE_VERIFICATION_SECRET",
  "KMA_APIHUB_KEY",
  "ALLOWED_ORIGINS",
  "KAKAO_LOCAL_DAILY_LIMIT",
  "KAKAO_CURRENT_DAILY_LIMIT",
  "KAKAO_FUTURE_DAILY_LIMIT",
  "KMA_DAILY_LIMIT",
]);

function isInsideRepository(candidate: string) {
  const relative = path.relative(canonicalRepositoryRoot, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validatePrivateFile(candidate: string, label: string) {
  const lexical = path.resolve(candidate);
  const link = lstatSync(lexical);
  if (!link.isFile() || link.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  const canonical = realpathSync(lexical);
  if (isInsideRepository(canonical)) throw new Error(`${label} must point outside the repository`);
  const details = statSync(canonical);
  if (process.platform !== "win32" && (details.mode & 0o077) !== 0) {
    throw new Error(`${label} must not be readable or writable by group or other users`);
  }
  if (typeof process.getuid === "function" && details.uid !== process.getuid()) {
    throw new Error(`${label} must be owned by the current user`);
  }
  return canonical;
}

function inheritedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => (
      typeof entry[1] === "string" && !nextAgentDetectionVariables.has(entry[0])
      && !localConnectionVariables.has(entry[0])
    )),
  );
}

const parsedBaseUrl = new URL(baseURL);
if (runMode === "preview") {
  if (!configuredBaseUrl || parsedBaseUrl.origin !== previewOrigin || parsedBaseUrl.pathname !== "/" || parsedBaseUrl.search || parsedBaseUrl.hash) {
    throw new Error(`Preview tests require the exact approved Preview origin: ${previewOrigin}`);
  }
  if (!storageState) throw new Error("Preview tests require MOTOCAST_E2E_STORAGE_STATE");
  const canonicalState = validatePrivateFile(storageState, "MOTOCAST_E2E_STORAGE_STATE");
  const metadataPath = validatePrivateFile(`${canonicalState}.meta.json`, "Preview storageState metadata");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as { previewOrigin?: unknown; supabaseProjectRef?: unknown };
  if (metadata.previewOrigin !== previewOrigin || metadata.supabaseProjectRef !== previewSupabaseProjectRef) {
    throw new Error("Preview storageState belongs to a different origin or Supabase project");
  }
  const state = JSON.parse(readFileSync(canonicalState, "utf8")) as {
    cookies?: Array<{ name?: unknown }>;
    origins?: Array<{ localStorage?: Array<{ name?: unknown }> }>;
  };
  const projectBound = state.cookies?.some((cookie) => typeof cookie.name === "string" && cookie.name.includes(previewSupabaseProjectRef)) ||
    state.origins?.some((origin) => origin.localStorage?.some((item) => typeof item.name === "string" && item.name.includes(previewSupabaseProjectRef)));
  if (!projectBound) throw new Error("Preview storageState does not contain the approved Supabase project session");
} else {
  if (configuredBaseUrl || storageState || process.env.MOTOCAST_E2E_LIVE_MUTATIONS === "1") {
    throw new Error("Local E2E forbids external URLs, authentication state, and live mutations");
  }
}

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: process.env.MOTOCAST_E2E_OUTPUT_DIR?.trim() || path.join(os.tmpdir(), "motocast-playwright-artifacts"),
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "line",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL,
    headless: true,
    screenshot: runMode === "preview" ? "off" : "only-on-failure",
    trace: runMode === "preview" ? "off" : "retain-on-failure",
    video: runMode === "preview" ? "off" : "retain-on-failure",
    storageState,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: runMode === "preview"
    ? undefined
    : {
        command: "npm run build && npm run start -- --hostname 127.0.0.1 --port 3100",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
          ...inheritedEnvironment(),
          ...Object.fromEntries(Array.from(nextAgentDetectionVariables, (name) => [name, ""])),
          ...Object.fromEntries(Array.from(localConnectionVariables, (name) => [name, ""])),
        },
      },
});
