import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

let plannerMarkup = "";

test.beforeAll(() => {
  const outputDirectory = mkdtempSync(path.join(os.tmpdir(), "motocast-invite-markup-"));
  const outputPath = path.join(outputDirectory, "markup.json");
  try {
    execFileSync(process.execPath, [
      path.join(process.cwd(), "node_modules", "vitest", "vitest.mjs"),
      "run",
      "tests/fixtures/invite-markup.test.tsx",
    ], {
      cwd: process.cwd(),
      env: { ...process.env, MOTOCAST_INVITE_MARKUP_OUTPUT: outputPath },
      stdio: "pipe",
      timeout: 30_000,
    });
    ({ plannerMarkup } = JSON.parse(readFileSync(outputPath, "utf8")) as {
      plannerMarkup: string;
    });
  } finally {
    if (existsSync(outputPath)) unlinkSync(outputPath);
    rmdirSync(outputDirectory);
  }
});

async function setProductionMarkup(page: import("@playwright/test").Page, markup: string) {
  await page.goto("/#home");
  const stylesheetUrls = await page.locator('link[rel="stylesheet"][href]').evaluateAll((links) => (
    links.map((link) => (link as HTMLLinkElement).href)
  ));
  expect(stylesheetUrls.length).toBeGreaterThan(0);
  const stylesheetLinks = stylesheetUrls.map((href) => (
    `<link rel="stylesheet" href="${href.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">`
  )).join("");
  // The app service worker intentionally bypasses sensitive paths, which keeps
  // this script-free fixture from being replaced by a cached app navigation.
  const fixturePath = "/admin/__motocast_static_fixture";
  await page.route(`**${fixturePath}`, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: `<!doctype html><html lang="ko"><head>${stylesheetLinks}</head><body>${markup}</body></html>`,
  }));
  await page.goto(fixturePath);
  await page.waitForFunction((expectedUrls) => expectedUrls.every((href) => (
    Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).some((link) => link.href === href && link.sheet !== null)
  )), stylesheetUrls);
  await page.evaluate(() => document.fonts.ready);
}

for (const viewport of [
  { name: "compact 320", width: 320, height: 800 },
  { name: "Galaxy width 384", width: 384, height: 832 },
  { name: "mobile 390", width: 390, height: 844 },
  { name: "tablet 820", width: 820, height: 1180 },
  { name: "desktop 1440", width: 1440, height: 900 },
]) {
  test(`${viewport.name} keeps member navigation and saved routes without retired invite actions`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await setProductionMarkup(page, plannerMarkup);

    await expect(page.getByRole("link", { name: "초대 관리" })).toHaveCount(0);
    expect(await page.locator(".app-header").evaluate(header =>
      header.scrollWidth <= header.clientWidth && document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const homeCollectionFrame = await page.locator(".planner-home-collections .collection-manager-home").evaluate((manager) => {
      const style = getComputedStyle(manager);
      return {
        background: style.backgroundColor,
        borderTopWidth: style.borderTopWidth,
        borderRadius: style.borderRadius,
        padding: style.padding,
      };
    });
    expect(homeCollectionFrame).toEqual({
      background: "rgba(0, 0, 0, 0)",
      borderTopWidth: "0px",
      borderRadius: "0px",
      padding: "0px",
    });

    const savedRoutes = page.locator(".planner-home-collections");
    const savedRoutesHeading = savedRoutes.getByRole("heading", { name: viewport.width <= 767 ? "저장한 경로" : "최근 저장한 경로", exact: true });
    const showAll = savedRoutes.getByRole("button", { name: "전체 보기", exact: true });
    await expect(savedRoutesHeading).toBeVisible();
    await expect(showAll).toBeVisible();
    const savedRoutesLayout = await savedRoutes.locator(".planner-home-section-heading").evaluate((heading) => {
      const title = heading.querySelector<HTMLElement>("h2")!;
      const description = heading.querySelector<HTMLElement>("p")!;
      const button = heading.querySelector<HTMLElement>("button")!;
      const titleBox = title.getBoundingClientRect();
      const descriptionBox = description.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      const buttonTextRange = document.createRange();
      buttonTextRange.selectNodeContents(button);
      return {
        noHorizontalOverflow: heading.scrollWidth <= heading.clientWidth,
        titleAndButtonDoNotOverlap: titleBox.right <= buttonBox.left,
        descriptionIsNextRow: descriptionBox.top >= Math.max(titleBox.bottom, buttonBox.bottom),
        descriptionUsesFullRow: descriptionBox.left <= titleBox.left + 1 && descriptionBox.right >= buttonBox.right - 1,
        buttonHeight: buttonBox.height,
        buttonTextFits: button.scrollWidth <= button.clientWidth,
        buttonLineCount: new Set(Array.from(buttonTextRange.getClientRects()).map((rect) => Math.round(rect.top))).size,
        loadedNotoFaces: Array.from(document.fonts).filter((face) => face.family.includes("Noto Sans KR Variable") && face.status === "loaded").length,
      };
    });
    expect(savedRoutesLayout).toMatchObject({
      noHorizontalOverflow: true,
      titleAndButtonDoNotOverlap: true,
      descriptionIsNextRow: true,
      descriptionUsesFullRow: true,
      buttonTextFits: true,
    });
    expect(savedRoutesLayout.buttonHeight).toBeGreaterThanOrEqual(48);
    expect(savedRoutesLayout.buttonLineCount).toBe(1);
    expect(savedRoutesLayout.loadedNotoFaces).toBeGreaterThan(0);
    const saveNote = page.locator(".planner-home-save-note");
    if (viewport.width <= 767) {
      await expect(saveNote).toBeVisible();
      await expect(saveNote).toContainText("마음에 드는 경로를 모아두세요");
      await expect(saveNote).toContainText("라이딩 결과 화면의 공유 · 저장에서");
      await expect(saveNote).toContainText("경로를 저장할 수 있어요.");
    } else {
      await expect(saveNote).toBeHidden();
    }
  });

  test(`${viewport.name} explains app-first membership on web login`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/login?error=membership_required");
    await expect(page.getByText("앱에서 먼저 가입해 주세요", { exact: true })).toBeVisible();
    await expect(page.locator(".login-error[role=alert]")).toContainText("MOTOCAST 앱");
    await expect(page.getByRole("button", { name: "카카오로 계속하기" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("legacy invitation bookmarks never redeem a token", async ({ page }) => {
  let accepts = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/invites/accept") accepts++; });
  await page.goto("/invite#retired-synthetic-fixture");
  await expect(page).toHaveURL(/\/login\?error=membership_required$/);
  expect(accepts).toBe(0);
});
