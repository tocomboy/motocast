import { expect, test } from "@playwright/test";

import { rawSharedRideSnapshotWithOmissions } from "../fixtures/shared-ride-snapshot";

async function expectMapChromeNotToOverlap(page: import("@playwright/test").Page) {
  await page.locator(".map-shell").evaluate((shell) => {
    const legend = document.createElement("ul");
    legend.className = "map-marker-legend";
    legend.setAttribute("aria-label", "테스트 지도 지점 표시 안내");
    legend.innerHTML = "<li>출발</li><li>복귀</li><li>점심</li><li>휴식</li><li>와인딩</li>";
    shell.appendChild(legend);
  });
  const overlap = await page.evaluate(() => {
    const topbar = document.querySelector(".map-topbar")!.getBoundingClientRect();
    const legend = document.querySelector(".map-marker-legend")!.getBoundingClientRect();
    return topbar.left < legend.right && topbar.right > legend.left && topbar.top < legend.bottom && topbar.bottom > legend.top;
  });
  expect(overlap).toBe(false);
}

async function expectRouteSummaryVisibleInsideMap(page: import("@playwright/test").Page) {
  const map = page.locator(".map-area");
  const summary = page.locator(".ride-summary");
  const metrics = page.locator(".summary-metrics");
  await expect(map).toBeVisible();
  await expect(summary).toBeVisible();
  await expect(metrics).toBeVisible();
  await expect(metrics.locator("span").filter({ hasText: /주행$/ })).toBeVisible();
  await expect(metrics.locator("span").filter({ hasText: /정차$/ })).toBeVisible();
  await expect(metrics.locator("span").filter({ hasText: /예상 복귀$/ })).toBeVisible();
  const layout = await page.evaluate(() => {
    const mapBox = document.querySelector(".map-area")!.getBoundingClientRect();
    const summaryBox = document.querySelector(".ride-summary")!.getBoundingClientRect();
    const topbarBox = document.querySelector(".map-topbar")!.getBoundingClientRect();
    const overlaps = (left: DOMRect, right: DOMRect) => (
      left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top
    );
    return {
      insideMap: summaryBox.left >= mapBox.left && summaryBox.right <= mapBox.right &&
        summaryBox.top >= mapBox.top && summaryBox.bottom <= mapBox.bottom,
      overlapsTopbar: overlaps(summaryBox, topbarBox),
      summaryHasNoInternalOverflow: summaryBox.width >= document.querySelector(".ride-summary")!.scrollWidth &&
        summaryBox.height >= document.querySelector(".ride-summary")!.scrollHeight,
    };
  });
  expect(layout).toEqual({ insideMap: true, overlapsTopbar: false, summaryHasNoInternalOverflow: true });
  await expect(page.locator(".candidate-card, .candidate-strip, .candidate-tab")).toHaveCount(0);
}

test.describe("planner responsive shell", () => {
  test("desktop keeps the plan and single recommended route visible", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "라이딩 계획" })).toBeVisible();
    await expect(page.getByText("복귀는 자동 계산", { exact: true })).toBeVisible();
    await expect(page.locator(".ride-summary h2")).toHaveText("추천 경로");
    await expectRouteSummaryVisibleInsideMap(page);
    await expect(page.getByRole("button", { name: "계획 수정" })).toBeHidden();
    await expect(page.locator("body")).not.toContainText("희망 복귀");
    await expect(page.locator("body")).not.toContainText("최종 복귀");

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasHorizontalOverflow).toBe(false);
    await expectMapChromeNotToOverlap(page);
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
    await openButton.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "라이딩 계획 편집" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("출발", { exact: true })).toBeVisible();
    await expect(dialog.getByText("복귀는 자동 계산", { exact: true })).toBeVisible();
    const focusable = dialog.locator("input:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])");
    const first = focusable.first();
    const last = focusable.last();
    await last.focus();
    await page.keyboard.press("Tab");
    await expect(first).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(last).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(openButton).toBeFocused();
    await expect(page.locator(".ride-summary h2")).toHaveText("추천 경로");
    await expectRouteSummaryVisibleInsideMap(page);
    await expect(page.getByRole("heading", { name: "시간에 따른 구간 날씨" })).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasHorizontalOverflow).toBe(false);
    await expectMapChromeNotToOverlap(page);
    });
  }

  for (const viewport of [
    { name: "compact 320", width: 320, height: 800 },
    { name: "mobile 390", width: 390, height: 844 },
    { name: "tablet 820", width: 820, height: 1180 },
    { name: "desktop 1440", width: 1440, height: 900 },
  ]) {
    test(`${viewport.name} keeps twenty omitted route points in normal document flow`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.route("**/api/shares/resolve", async (request) => {
        await request.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ snapshot: rawSharedRideSnapshotWithOmissions(20) }),
        });
      });
      await page.goto(`/share#${"a".repeat(43)}`);

      const notice = page.locator(".shared-snapshot > .map-omissions");
      const items = notice.getByRole("listitem");
      await expect(items).toHaveCount(20);
      const layout = await notice.evaluate((element) => {
        const list = element.querySelector("ul")!;
        const map = element.previousElementSibling!;
        return {
          parentIsSnapshot: element.parentElement?.classList.contains("shared-snapshot") ?? false,
          previousSiblingIsMap: map.classList.contains("shared-map"),
          noticeOutsideMap: !map.contains(element),
          noticeHasNoInternalOverflow: element.scrollHeight <= element.clientHeight,
          listHasNoInternalOverflow: list.scrollHeight <= list.clientHeight,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      expect(layout).toEqual({
        parentIsSnapshot: true,
        previousSiblingIsMap: true,
        noticeOutsideMap: true,
        noticeHasNoInternalOverflow: true,
        listHasNoInternalOverflow: true,
        horizontalOverflow: false,
      });
      await expect(items.last()).toBeVisible();
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

  test("production browser run registers the current service worker", async ({ page }) => {
    await page.goto("/");
    const scriptUrl = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return (registration.active ?? registration.waiting ?? registration.installing)?.scriptURL ?? "";
    });
    expect(new URL(scriptUrl).pathname).toBe("/sw.js");
  });
});
