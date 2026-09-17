import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

let plannerMarkup = "";
let inviteMarkup = "";

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
    ({ plannerMarkup, inviteMarkup } = JSON.parse(readFileSync(outputPath, "utf8")) as {
      plannerMarkup: string;
      inviteMarkup: string;
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
  test(`${viewport.name} keeps the connected invite header action visible and unclipped`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await setProductionMarkup(page, plannerMarkup);

    const inviteLink = page.getByRole("link", { name: "초대 관리" });
    await expect(inviteLink).toBeVisible();
    await expect(inviteLink).toHaveAttribute("href", "/admin/invites");

    const layout = await page.locator(".app-header").evaluate((header) => {
      const invite = header.querySelector<HTMLElement>(".ghost-button")!;
      const inviteBox = invite.getBoundingClientRect();
      return {
        documentHasNoHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        headerHasNoHorizontalOverflow: header.scrollWidth <= header.clientWidth,
        inviteHeight: inviteBox.height,
        inviteInsideViewport: inviteBox.left >= 0 && inviteBox.right <= window.innerWidth,
        inviteIsClickable: getComputedStyle(invite).pointerEvents !== "none",
      };
    });
    expect(layout).toMatchObject({
      documentHasNoHorizontalOverflow: true,
      headerHasNoHorizontalOverflow: true,
      inviteInsideViewport: true,
      inviteIsClickable: true,
    });
    expect(layout.inviteHeight).toBeGreaterThanOrEqual(44);

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

  test(`${viewport.name} keeps invite creation and copy actions visible and unclipped`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await setProductionMarkup(page, inviteMarkup);

    const createButton = page.getByRole("button", { name: "초대 링크 생성" });
    const copyButton = page.getByRole("button", { name: "복사" });
    await expect(createButton).toBeVisible();
    await expect(copyButton).toBeVisible();

    const layout = await page.locator(".admin-page").evaluate((adminPage) => {
      const controls = Array.from(adminPage.querySelectorAll<HTMLElement>(".primary-button, .ghost-button.dark"));
      const nav = adminPage.querySelector<HTMLElement>(".admin-nav")!;
      return {
        controls: controls.map((control) => {
          const box = control.getBoundingClientRect();
          return {
            height: box.height,
            insideViewport: box.left >= 0 && box.right <= window.innerWidth,
            visible: box.width > 0 && box.height > 0 && getComputedStyle(control).visibility === "visible",
          };
        }),
        documentHasNoHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        navHasNoHorizontalOverflow: nav.scrollWidth <= nav.clientWidth,
      };
    });
    expect(layout.documentHasNoHorizontalOverflow).toBe(true);
    expect(layout.navHasNoHorizontalOverflow).toBe(true);
    expect(layout.controls).toHaveLength(2);
    expect(layout.controls.every((control) => control.visible && control.insideViewport && control.height >= 44)).toBe(true);
  });
}
