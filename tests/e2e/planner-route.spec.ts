import { expect, test } from "@playwright/test";

test.describe("single recommended route", () => {
  test("shows one route summary without candidate selection UI", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".candidate-card")).toHaveCount(0);
    await expect(page.locator(".candidate-strip")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("와인딩 추정");
    await expect(page.locator("body")).not.toContainText("최단 경로");
    await expect(page.getByRole("heading", { name: "라이딩 결과" })).toBeVisible();
    await expect(page.locator(".riding-summary-layout").getByText("추천 경로", { exact: true })).toHaveCount(0);
    await expect(page.locator(".riding-summary-metrics")).toContainText("예상 도착");
    await expect(page.locator(".riding-summary-metrics")).toContainText("휴식");
    await expect(page.getByText("도착 시각은 추정값입니다. 전체 시간과 구간 합계가 다르면 전체 시간을 기준으로 구간별 시간을 비례 배분합니다.")).toHaveCount(0);
  });

  test("never presents the connected live badge in deterministic demo mode", async ({ page }) => {
    test.skip(Boolean(process.env.MOTOCAST_E2E_BASE_URL), "Connected Preview has its own authenticated live gate");
    await page.goto("/");

    await expect(page.locator(".example-data-badge")).toHaveText("예시 데이터");
    await expect(page.locator(".live-data-badge")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "예시 경로 개요 표시 중" })).toBeVisible();
  });
});
