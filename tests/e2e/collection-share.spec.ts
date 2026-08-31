import { expect, test } from "@playwright/test";

test.describe("collection and sharing boundaries", () => {
  test("removes an invalid public share fragment before showing the safe error", async ({ page }) => {
    await page.goto("/share#not-a-valid-token");
    await expect(page.getByRole("heading", { name: "공유 링크 형식을 확인해 주세요." })).toBeVisible();
    await expect.poll(() => page.url()).not.toContain("#");
  });

  test("connected state exposes owner-only management surfaces", async ({ page }) => {
    test.skip(!process.env.MOTOCAST_E2E_BASE_URL || !process.env.MOTOCAST_E2E_STORAGE_STATE, "Requires external Preview auth state");
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "라이딩 컬렉션" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "라이딩 공유" })).toBeVisible();
  });
});
