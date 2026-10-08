import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

/*
 * Issue #124 web screens. Data screens are checked from production markup rendered with
 * synthetic folder data (the local E2E server has no Supabase); the folder invite page runs
 * for real because its token handling happens before any request.
 */
let markup: Record<string, string> = {};
const TOKEN = "Tk".repeat(21) + "x";
const PENDING_KEY = "motocast.folder-invite.pending";

test.beforeAll(() => {
  const outputDirectory = mkdtempSync(path.join(os.tmpdir(), "motocast-shared-folders-markup-"));
  const outputPath = path.join(outputDirectory, "markup.json");
  try {
    execFileSync(process.execPath, [
      path.join(process.cwd(), "node_modules", "vitest", "vitest.mjs"),
      "run",
      "tests/fixtures/shared-folders-markup.test.tsx",
    ], {
      cwd: process.cwd(),
      env: { ...process.env, MOTOCAST_SHARED_FOLDERS_MARKUP_OUTPUT: outputPath },
      stdio: "pipe",
      timeout: 60_000,
    });
    markup = JSON.parse(readFileSync(outputPath, "utf8")) as Record<string, string>;
  } finally {
    if (existsSync(outputPath)) unlinkSync(outputPath);
    rmdirSync(outputDirectory);
  }
});

/*
 * Vitest renders CSS module classes as stable "_name_hash" names, so the fixture page maps them
 * back to "name" and adds the same module stylesheet with plain names. Global styles come from
 * the production build.
 */
const moduleSource = (file: string) => readFileSync(path.join(process.cwd(), "components", file), "utf8").replace(/:global\(([^)]+)\)/g, "$1");
const favoritesCss = moduleSource("saved-places-manager.module.css");
const recommendationCss = moduleSource("restaurant-recommendation-dialog.module.css");
const plainClasses = (html: string) => html.replace(/\b_([A-Za-z][A-Za-z0-9]*)_[0-9a-f]{6}\b/g, "$1");

async function setProductionMarkup(page: Page, rawBody: string, moduleCss = favoritesCss) {
  const body = `<style>${moduleCss}</style>${plainClasses(rawBody)}`;
  await page.goto("/#home");
  const stylesheetUrls = await page.locator('link[rel="stylesheet"][href]').evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  expect(stylesheetUrls.length).toBeGreaterThan(0);
  const links = stylesheetUrls.map((href) => `<link rel="stylesheet" href="${href.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">`).join("");
  // The service worker bypasses /admin/, so this script-free page is never replaced by the app shell.
  const fixturePath = "/admin/__motocast_shared_folders_fixture";
  await page.route(`**${fixturePath}`, (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: `<!doctype html><html lang="ko"><head>${links}</head><body>${body}</body></html>` }));
  await page.goto(fixturePath);
  await page.waitForFunction((expected) => expected.every((href) => Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).some((link) => link.href === href && link.sheet !== null)), stylesheetUrls);
  await page.evaluate(() => document.fonts.ready);
}
/** Static markup has closed dialogs; open the last one as a modal, as the app does. */
async function openLastDialog(page: Page) {
  await page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll("dialog"));
    const dialog = dialogs[dialogs.length - 1];
    if (dialog.open) dialog.close();
    dialog.showModal();
  });
}
const noPageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const viewport of [
  { name: "320 with 1.3x text", width: 320, height: 800, scale: true },
  { name: "390", width: 390, height: 844, scale: false },
  { name: "820", width: 820, height: 1180, scale: false },
  { name: "1440", width: 1440, height: 900, scale: false },
]) {
  test.describe(`shared folders at ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: viewport.width, height: viewport.height }); });
    const textScale = async (page: Page) => { if (viewport.scale) await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; }); };

    test("places, folder list, avoided list and folder detail fit without horizontal scroll", async ({ page }, testInfo) => {
      for (const name of ["places", "folders", "avoided", "folderDetail"]) {
        await setProductionMarkup(page, markup[name]);
        await textScale(page);
        expect(await noPageOverflow(page), `${name} overflows`).toBe(true);
        // Every action stays at least 48 px tall and its label fits.
        const cramped = await page.locator("button:visible").evaluateAll((buttons) => buttons
          .filter((button) => button.getBoundingClientRect().height < 47.5 || button.scrollWidth > button.clientWidth + 1)
          .map((button) => (button.getAttribute("aria-label") ?? button.textContent ?? "").trim()));
        expect(cramped, `${name} cramped buttons`).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`${name}-${viewport.width}.png`), fullPage: true });
      }
      await setProductionMarkup(page, markup.places);
      await expect(page.getByText("공유 · 남한강 맛집 외 1")).toBeVisible();
      await expect(page.locator("p").filter({ hasText: "내 저장 장소" }).first()).toContainText("(공유 2)");
      await expect(page.getByRole("button", { name: "공유 폴더 2 / 3 켬, 고르기" })).toBeVisible();
    });

    test("centered confirmation popups keep the UI-001 width and stack their buttons", async ({ page }, testInfo) => {
      for (const name of ["folderPopup", "starPopup", "deletePopup"]) {
        await setProductionMarkup(page, markup[name]);
        await textScale(page);
        await openLastDialog(page);
        const box = await page.locator("dialog[open]").boundingBox();
        expect(box).not.toBeNull();
        expect(Math.round(box!.width)).toBe(Math.min(336, viewport.width - 48));
        expect(Math.round(box!.x + box!.width / 2)).toBe(Math.round(viewport.width / 2));
        const actions = await page.locator("dialog[open] button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect()));
        const wide = actions.filter((rect) => rect.width > 200);
        expect(wide.length).toBeGreaterThanOrEqual(2);
        expect(wide.every((rect, index) => index === 0 || rect.top >= wide[index - 1].bottom - 1)).toBe(true);
        expect(await page.locator("dialog[open]").evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`${name}-${viewport.width}.png`) });
      }
    });

    test("member management shows a permission control per member", async ({ page }, testInfo) => {
      await setProductionMarkup(page, markup.members);
      await textScale(page);
      await openLastDialog(page);
      await expect(page.getByText("전체 권한")).toBeVisible();
      await expect(page.getByRole("button", { name: /새벽바이크님 권한 편집 가능/ })).toBeVisible();
      expect(await page.locator("dialog[open]").evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`members-${viewport.width}.png`) });
    });

    test("restaurant recommendations show sources, exclusions and the settings-changed notice (SRC02–SRC07)", async ({ page }, testInfo) => {
      for (const name of ["recommendResult", "recommendChanged", "recommendNone", "recommendAllExcluded", "recommendTruncated", "recommendTruncatedNone", "recommendRefused", "recommendUnreadable"]) {
        await setProductionMarkup(page, markup[name], recommendationCss);
        await textScale(page);
        await openLastDialog(page);
        expect(await page.locator("dialog[open]").evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth), `${name} overflows`).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`${name}-${viewport.width}.png`) });
      }
      await setProductionMarkup(page, markup.recommendResult, recommendationCss);
      await openLastDialog(page);
      await expect(page.getByText("공유 · 주말 라이더 외 1")).toBeVisible();
      await expect(page.getByText("기피 장소 2곳과 꺼 둔 공유 폴더 1개(동호회 정모 코스)의 식당은 후보에서 뺐어요.")).toBeVisible();
      await expect(page.getByRole("button", { name: "공유 폴더 설정" })).toBeVisible();
      await setProductionMarkup(page, markup.recommendChanged, recommendationCss);
      await openLastDialog(page);
      await expect(page.getByText("공유 폴더 설정이 바뀌었어요")).toBeVisible();
      await expect(page.getByRole("button", { name: "다시 추천 받기" })).toBeVisible();
    });

    test("an invite opened before login hides the folder and removes the token from the address", async ({ page }, testInfo) => {
      const sent: string[] = [];
      page.on("request", (request) => sent.push(`${request.url()} ${request.postData() ?? ""}`));
      await page.goto(`/folder-invite#t=${TOKEN}`);
      await expect(page.getByText("공유 폴더에 초대받았어요")).toBeVisible();
      await textScale(page);
      expect(new URL(page.url()).hash).toBe("");
      expect(await noPageOverflow(page)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`invite-login-${viewport.width}.png`), fullPage: true });
      await page.getByRole("button", { name: "로그인하고 계속" }).click();
      await expect(page).toHaveURL(/\/login$/);
      const stored = await page.evaluate((key) => window.sessionStorage.getItem(key), PENDING_KEY);
      expect(JSON.parse(stored ?? "null")).toEqual({ token: TOKEN, savedAt: expect.any(Number) });
      expect(sent.filter((line) => line.includes(TOKEN))).toEqual([]);
    });
  });
}

test("an invite whose fragment cannot be removed sends nothing", async ({ page }) => {
  await page.addInitScript((token) => {
    const original = History.prototype.replaceState;
    History.prototype.replaceState = function (state, title, url) {
      // Refuse only the cleanup that drops the invite fragment.
      if (window.location.hash.startsWith("#t=") && typeof url === "string" && !url.includes("#")) throw new DOMException("blocked", "SecurityError");
      return original.call(this, state, title, url);
    };
    void token;
  }, TOKEN);
  const sent: string[] = [];
  page.on("request", (request) => sent.push(`${request.url()} ${request.postData() ?? ""}`));
  await page.goto(`/folder-invite#t=${TOKEN}`);
  await expect(page.getByText("초대 링크를 열지 못했어요")).toBeVisible();
  // Only the page and its static assets were fetched; the token reached no request.
  expect(sent.filter((line) => line.includes(TOKEN))).toEqual([]);
  expect(sent.filter((line) => /\/rest\/v1\/|\/functions\/v1\/|\/api\//.test(line))).toEqual([]);
});

test("a token that cannot be kept for the login return shows the reopen screen (G29), without navigating", async ({ page }) => {
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("blocked", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, PENDING_KEY);
  await page.goto(`/folder-invite#t=${TOKEN}`);
  await page.getByRole("button", { name: "로그인하고 계속" }).click();
  await expect(page.getByText("초대 링크를 다시 열어 주세요")).toBeVisible();
  await expect(page.getByRole("link", { name: "즐겨찾기로 가기" })).toBeVisible();
  await expect(page).toHaveURL(/\/folder-invite$/);
});

test("the login return reads the stored token once, and stale or failed-login values are removed", async ({ page }) => {
  await page.goto("/login");
  // A fresh value is consumed by the invite page as soon as it opens.
  await page.evaluate(([key, token]) => window.sessionStorage.setItem(key, JSON.stringify({ token, savedAt: Date.now() })), [PENDING_KEY, TOKEN]);
  await page.goto("/folder-invite");
  await expect(page.getByText("공유 폴더에 초대받았어요")).toBeVisible();
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), PENDING_KEY)).toBeNull();
  // Older than 30 minutes: any page drops it on its first run.
  await page.evaluate(([key, token]) => window.sessionStorage.setItem(key, JSON.stringify({ token, savedAt: Date.now() - 31 * 60_000 })), [PENDING_KEY, TOKEN]);
  await page.goto("/updates");
  await expect.poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), PENDING_KEY)).toBeNull();
  // A failed or cancelled login drops a fresh value too.
  await page.evaluate(([key, token]) => window.sessionStorage.setItem(key, JSON.stringify({ token, savedAt: Date.now() })), [PENDING_KEY, TOKEN]);
  await page.goto("/login?error=callback");
  await expect.poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), PENDING_KEY)).toBeNull();
});

test("a malformed invite fragment is removed and shown as an unusable link", async ({ page }) => {
  await page.goto("/folder-invite#t=not-a-real-token");
  await expect(page.getByText("이 초대 링크는 쓸 수 없어요")).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
});
