import { expect, test } from "@playwright/test";

test.describe("single recommended route", () => {
  test("shows one route summary without candidate selection UI", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".candidate-card")).toHaveCount(0);
    await expect(page.locator(".candidate-strip")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("와인딩 추정");
    await expect(page.locator("body")).not.toContainText("최단 경로");
    await expect(page.locator(".ride-summary h2")).toHaveText("경로 요약");
    await expect(page.locator(".ride-summary").getByText("추천 경로", { exact: true })).toHaveCount(0);
    await expect(page.locator(".ride-summary")).toContainText("예상 복귀");
    await expect(page.locator(".ride-summary")).toContainText("정차");
  });

  test("never presents the connected live badge in deterministic demo mode", async ({ page }) => {
    test.skip(Boolean(process.env.MOTOCAST_E2E_BASE_URL), "Connected Preview has its own authenticated live gate");
    await page.goto("/");

    await expect(page.locator(".example-data-badge")).toHaveText("예시 데이터");
    await expect(page.locator(".live-data-badge")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "예시 경로 개요 표시 중" })).toBeVisible();
  });
});
