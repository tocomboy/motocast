import path from "node:path";

import { chromium } from "@playwright/test";

const repositoryRoot = process.cwd();
const baseUrlValue = process.env.MOTOCAST_E2E_BASE_URL?.trim();
const storageStateValue = process.env.MOTOCAST_E2E_STORAGE_STATE?.trim();

if (!baseUrlValue || !storageStateValue) {
  throw new Error("Set MOTOCAST_E2E_BASE_URL and MOTOCAST_E2E_STORAGE_STATE before auth setup");
}

const baseUrl = new URL(baseUrlValue);
if (baseUrl.protocol !== "https:") throw new Error("Preview auth setup requires an HTTPS base URL");

const storageState = path.resolve(storageStateValue);
const relative = path.relative(repositoryRoot, storageState);
if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
  throw new Error("MOTOCAST_E2E_STORAGE_STATE must point outside the repository");
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(new URL("/", baseUrl).toString());
  process.stdout.write("Kakao 로그인과 Preview 접근을 브라우저에서 완료해 주세요.\n");
  await page.waitForURL((url) => url.origin === baseUrl.origin && url.pathname === "/", { timeout: 5 * 60_000 });
  await page.getByRole("heading", { name: "라이딩 계획" }).waitFor({ state: "visible", timeout: 30_000 });
  await context.storageState({ path: storageState });
  process.stdout.write("Preview 로그인 상태를 저장소 밖 파일에 저장했습니다.\n");
} finally {
  await page.close();
  await context.close();
  await browser.close();
}
