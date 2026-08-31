import { expect, test } from "@playwright/test";

test.describe("route comparison", () => {
  test("shows three honest candidates with an expected return for each", async ({ page }) => {
    await page.goto("/");

    const candidates = page.locator(".candidate-card");
    await expect(candidates).toHaveCount(3);
    for (const candidate of await candidates.all()) {
      await expect(candidate).toContainText("예상 복귀");
    }

    await candidates.nth(1).click();
    await expect(page.locator(".ride-summary h2")).toContainText("와인딩");
    await expect(page.locator(".ride-summary")).toContainText("예상 복귀");
    await expect(page.getByText("날씨는 순위에 반영하지 않고 구간 정보로만 표시합니다.")).toBeVisible();
  });

  test("never presents the connected live badge in deterministic demo mode", async ({ page }) => {
    test.skip(Boolean(process.env.MOTOCAST_E2E_BASE_URL), "Connected Preview has its own authenticated live gate");
    await page.goto("/");

    await expect(page.locator(".example-data-badge")).toHaveText("예시 데이터");
    await expect(page.locator(".live-data-badge")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "예시 경로 개요 표시 중" })).toBeVisible();
  });
});
