import { expect, test } from "@playwright/test";

test.describe("planner responsive shell", () => {
  test("desktop keeps the plan and route comparison visible", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "라이딩 계획" })).toBeVisible();
    await expect(page.getByText("복귀는 자동 계산", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /추천 경로 3개/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "계획 수정" })).toBeHidden();
    await expect(page.locator("body")).not.toContainText("희망 복귀");
    await expect(page.locator("body")).not.toContainText("최종 복귀");

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasHorizontalOverflow).toBe(false);
  });

  for (const viewport of [
    { name: "compact 320", width: 320, height: 800 },
    { name: "mobile 390", width: 390, height: 844 },
    { name: "tablet 820", width: 820, height: 1180 },
  ]) {
    test(`${viewport.name} opens a labelled focus-contained planner dialog`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");

    const openButton = page.getByRole("button", { name: "계획 수정" });
    await expect(openButton).toBeVisible();
    await openButton.click();

    const dialog = page.getByRole("dialog", { name: "라이딩 계획 편집" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("출발", { exact: true })).toBeVisible();
    await expect(dialog.getByText("복귀는 자동 계산", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "계획 패널 닫기" }).click();
    await expect(dialog).toBeHidden();
    await expect(openButton).toBeFocused();

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasHorizontalOverflow).toBe(false);
    });
  }

  test("PWA manifest stays installable and Korean", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toMatch(/application\/manifest\+json|application\/json/);
    const manifest = await response.json();
    expect(manifest).toMatchObject({ short_name: "MOTOCAST", display: "standalone", lang: "ko-KR" });
    expect(manifest.icons).toEqual(expect.arrayContaining([expect.objectContaining({ src: "/icon.svg" })]));
  });
});
