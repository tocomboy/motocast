import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

const styles = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
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
  await page.setContent(`<style>${styles}</style>${markup}`);
  await page.evaluate(() => document.fonts.ready);
}

for (const viewport of [
  { name: "compact 320", width: 320, height: 800 },
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
