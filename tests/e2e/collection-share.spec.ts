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
    await page.getByRole("button", { name: "저장한 경로", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: /저장한 경로(?: 모음)?/ }).first()).toBeVisible();
    const view = page.locator(".collections-view");
    const manager = view.locator(":scope > .collection-manager");
    await expect(manager).toBeVisible();
    await expect(view.locator(":scope > .view-heading > .primary-button")).toHaveCount(0);
    const framing = await view.evaluate((collectionsView) => {
      const manager = collectionsView.querySelector<HTMLElement>(":scope > .collection-manager")!;
      const viewStyle = getComputedStyle(collectionsView);
      const managerStyle = getComputedStyle(manager);
      return {
        viewWidth: collectionsView.getBoundingClientRect().width,
        expectedDesktopWidth: Math.min(1280, document.documentElement.clientWidth - 64),
        viewPaddingLeft: viewStyle.paddingLeft,
        managerBackground: managerStyle.backgroundColor,
        managerBorderTopWidth: managerStyle.borderTopWidth,
        managerBorderRadius: managerStyle.borderRadius,
        managerPadding: managerStyle.padding,
      };
    });
    expect(framing).toMatchObject({
      viewPaddingLeft: "0px",
      managerBackground: "rgba(0, 0, 0, 0)",
      managerBorderTopWidth: "0px",
      managerBorderRadius: "0px",
      managerPadding: "0px",
    });
    expect(framing.viewWidth).toBeCloseTo(framing.expectedDesktopWidth, 0);
    await expect(page.locator(".collection-share-management > summary")).toHaveText("공유 링크 관리");
  });
});
