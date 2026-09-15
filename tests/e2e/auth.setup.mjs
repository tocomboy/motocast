import path from "node:path";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

import { chromium } from "@playwright/test";

const repositoryRoot = process.cwd();
const previewOrigin = "https://motocast-git-develop-tocomboys-projects.vercel.app";
const previewSupabaseProjectRef = "lehjmbgfpoemqcwxowbx";
const baseUrlValue = process.env.MOTOCAST_E2E_BASE_URL?.trim();
const storageStateValue = process.env.MOTOCAST_E2E_STORAGE_STATE?.trim();

if (process.platform === "win32") {
  throw new Error("Preview auth setup requires POSIX owner-only file permissions; run it from WSL or Linux");
}

if (!baseUrlValue || !storageStateValue) {
  throw new Error("Set MOTOCAST_E2E_BASE_URL and MOTOCAST_E2E_STORAGE_STATE before auth setup");
}

const baseUrl = new URL(baseUrlValue);
if (baseUrl.origin !== previewOrigin || baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash) {
  throw new Error(`Preview auth setup requires the exact approved Preview origin: ${previewOrigin}`);
}

const storageState = path.resolve(storageStateValue);
const relative = path.relative(repositoryRoot, storageState);
if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
  throw new Error("MOTOCAST_E2E_STORAGE_STATE must point outside the repository");
}
const stateDirectory = path.dirname(storageState);
mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
if (lstatSync(stateDirectory).isSymbolicLink() || !lstatSync(stateDirectory).isDirectory()) {
  throw new Error("Preview auth directory must be a regular directory");
}
const canonicalDirectory = realpathSync(stateDirectory);
const canonicalRelative = path.relative(realpathSync(repositoryRoot), canonicalDirectory);
if (canonicalRelative === "" || (!canonicalRelative.startsWith("..") && !path.isAbsolute(canonicalRelative))) {
  throw new Error("Preview auth directory must resolve outside the repository");
}
const directoryDetails = statSync(canonicalDirectory);
if (process.platform !== "win32" && (directoryDetails.mode & 0o077) !== 0) {
  throw new Error("Preview auth directory must use private permissions such as 0700");
}
if (typeof process.getuid === "function" && directoryDetails.uid !== process.getuid()) {
  throw new Error("Preview auth directory must be owned by the current user");
}
if (existsSync(storageState) && lstatSync(storageState).isSymbolicLink()) {
  throw new Error("MOTOCAST_E2E_STORAGE_STATE must not be a symlink");
}

const stateTemp = path.join(canonicalDirectory, `.${path.basename(storageState)}.${process.pid}.tmp`);
const metadata = `${storageState}.meta.json`;
const metadataTemp = path.join(canonicalDirectory, `.${path.basename(metadata)}.${process.pid}.tmp`);

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(new URL("/", baseUrl).toString());
  process.stdout.write("Kakao 로그인과 Preview 접근을 브라우저에서 완료해 주세요.\n");
  await page.waitForURL((url) => url.origin === baseUrl.origin && url.pathname === "/", { timeout: 5 * 60_000 });
  await page.getByRole("heading", { name: "라이딩 계획" }).waitFor({ state: "visible", timeout: 30_000 });
  const currentState = await context.storageState();
  const projectBound = currentState.cookies.some((cookie) => cookie.name.includes(previewSupabaseProjectRef)) ||
    currentState.origins.some((origin) => origin.localStorage.some((item) => item.name.includes(previewSupabaseProjectRef)));
  if (!projectBound) throw new Error("Login state is not bound to the approved Preview Supabase project");
  await context.storageState({ path: stateTemp });
  chmodSync(stateTemp, 0o600);
  writeFileSync(metadataTemp, JSON.stringify({
    previewOrigin,
    supabaseProjectRef: previewSupabaseProjectRef,
    createdAt: new Date().toISOString(),
  }), { mode: 0o600, flag: "wx" });
  renameSync(stateTemp, storageState);
  renameSync(metadataTemp, metadata);
  process.stdout.write("Preview 로그인 상태를 저장소 밖 파일에 저장했습니다.\n");
} finally {
  if (existsSync(stateTemp)) unlinkSync(stateTemp);
  if (existsSync(metadataTemp)) unlinkSync(metadataTemp);
  await page.close();
  await context.close();
  await browser.close();
}
