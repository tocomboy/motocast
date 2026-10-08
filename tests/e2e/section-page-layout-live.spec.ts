import { expect, test } from "@playwright/test";
import { expectSectionPageFills } from "./section-page-layout";

// The real favorites screens need a signed-in account with shared folders enabled, which only the
// authenticated Preview run has (local E2E strips Supabase settings). Read-only: it only opens tabs.
test.skip(!process.env.MOTOCAST_E2E_BASE_URL || !process.env.MOTOCAST_E2E_STORAGE_STATE, "Requires external Preview auth state");
test.use({ screenshot: "off", trace: "off", video: "off" });

for (const width of [320, 390, 820, 1440, 1920]) {
  test(`favorites section pages fill their column at ${width} (real app)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#favorites");
    await expect(page.getByRole("heading", { name: "즐겨찾기" })).toBeVisible({ timeout: 30_000 });
    for (const tab of ["공유 폴더", "기피 장소"]) {
      await page.getByRole("button", { name: tab, exact: true }).first().click();
      await expectSectionPageFills(page, `${tab} ${width}`);
    }
  });
}
