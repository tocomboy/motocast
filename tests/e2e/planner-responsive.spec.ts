import { expect, test } from "@playwright/test";

import { rawSharedRideSnapshotWithOmissions } from "../fixtures/shared-ride-snapshot";

async function expectMapInformationOutsideMap(page: import("@playwright/test").Page) {
  await page.evaluate(() => document.fonts.ready);
  const map = page.locator(".map-area");
  const meta = page.locator(".route-map-meta");
  const details = page.locator(".route-map-details");
  const legend = details.getByRole("list", { name: "지도 지점 표시 안내" });
  const summary = page.locator(".ride-summary");
  const metrics = page.locator(".summary-metrics");
  await expect(map).toBeVisible();
  await expect(meta).toBeVisible();
  await expect(legend).toBeVisible();
  await expect(summary).toBeVisible();
  await expect(metrics).toBeVisible();
  await expect(metrics.locator("span").filter({ hasText: /주행$/ })).toBeVisible();
  await expect(metrics.locator("span").filter({ hasText: /정차$/ })).toBeVisible();
  await expect(metrics.locator("span").filter({ hasText: /예상 복귀$/ })).toBeVisible();
  const layout = await page.evaluate(() => {
    const mapBox = document.querySelector(".map-area")!.getBoundingClientRect();
    const meta = document.querySelector(".route-map-meta")!;
    const details = document.querySelector(".route-map-details")!;
    const legend = details.querySelector(".map-marker-legend")!;
    const metaBox = meta.getBoundingClientRect();
    const detailsBox = details.getBoundingClientRect();
    const legendBox = legend.getBoundingClientRect();
    const summary = document.querySelector<HTMLElement>(".ride-summary")!;
    const summaryBox = summary.getBoundingClientRect();
    const overlaps = (left: DOMRect, right: DOMRect) => (
      left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top
    );
    return {
      mapContainsMeta: document.querySelector(".map-area")!.contains(meta),
      mapContainsLegend: document.querySelector(".map-area")!.contains(legend),
      mapContainsSummary: document.querySelector(".map-area")!.contains(document.querySelector(".ride-summary")!),
      metaBeforeMap: metaBox.bottom <= mapBox.top + 1,
      detailsAfterMap: detailsBox.top >= mapBox.bottom - 1,
      metaOverlapsMap: overlaps(metaBox, mapBox),
      legendOverlapsMap: overlaps(legendBox, mapBox),
      summaryOverlapsMap: overlaps(summaryBox, mapBox),
      mapHeight: mapBox.height,
      summaryClientWidth: summary.clientWidth,
      summaryScrollWidth: summary.scrollWidth,
      summaryClientHeight: summary.clientHeight,
      summaryScrollHeight: summary.scrollHeight,
      summaryLabelFontSize: Number.parseFloat(getComputedStyle(summary.querySelector(".summary-metrics span")!).fontSize),
      summaryValueFontSize: Number.parseFloat(getComputedStyle(summary.querySelector(".summary-metrics strong")!).fontSize),
      summaryStatusFontSize: Number.parseFloat(getComputedStyle(summary.querySelector(".return-status")!).fontSize),
      mapCopyFontSizes: Array.from(document.querySelectorAll<HTMLElement>(
        ".condition-banner, .example-data-badge, .live-data-badge, .map-marker-legend li",
      )).map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
      summaryHasNoInternalOverflow: summary.clientWidth >= summary.scrollWidth &&
        summary.clientHeight >= summary.scrollHeight,
      detailsHaveNoInternalOverflow: details.scrollWidth <= details.clientWidth,
      summaryInsideStage: summaryBox.right <= document.querySelector(".route-stage")!.getBoundingClientRect().right + 1,
    };
  });
  expect(layout).toMatchObject({
    mapContainsMeta: false,
    mapContainsLegend: false,
    mapContainsSummary: false,
    metaBeforeMap: true,
    detailsAfterMap: true,
    metaOverlapsMap: false,
    legendOverlapsMap: false,
    summaryOverlapsMap: false,
    summaryHasNoInternalOverflow: true,
    detailsHaveNoInternalOverflow: true,
    summaryInsideStage: true,
  });
  expect(layout.mapHeight).toBeGreaterThanOrEqual(360);
  expect(layout.summaryLabelFontSize).toBeGreaterThanOrEqual(14);
  expect(layout.summaryValueFontSize).toBeGreaterThanOrEqual(16);
  expect(layout.summaryStatusFontSize).toBeGreaterThanOrEqual(14);
  expect(layout.mapCopyFontSizes.every((fontSize) => fontSize >= 14)).toBe(true);
  await expect(summary.getByRole("heading", { name: "경로 요약" })).toHaveCount(1);
  await expect(summary.getByText("추천 경로", { exact: true })).toHaveCount(0);
  await expect(page.locator(".candidate-card, .candidate-strip, .candidate-tab")).toHaveCount(0);
}

async function expectReadableWeatherTimeline(page: import("@playwright/test").Page) {
  const layout = await page.locator(".timeline-row").evaluateAll((rows) => rows.map((row) => {
    const chip = row.querySelector<HTMLElement>(".weather-chip")!;
    const segment = row.querySelector<HTMLElement>(".segment-copy strong")!;
    const rowBox = row.getBoundingClientRect();
    const chipBox = chip.getBoundingClientRect();
    return {
      rowHasNoOverflow: row.scrollWidth <= row.clientWidth,
      chipHasNoOverflow: chip.scrollWidth <= chip.clientWidth,
      chipInsideRow: chipBox.left >= rowBox.left && chipBox.right <= rowBox.right + 1,
      segmentFontSize: Number.parseFloat(getComputedStyle(segment).fontSize),
      copyFontSizes: Array.from(row.querySelectorAll<HTMLElement>(
        ".timeline-time span, .segment-copy span, .weather-word, .weather-chip small, .risk-label",
      )).map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    };
  }));
  expect(layout.every((item) => item.rowHasNoOverflow && item.chipHasNoOverflow && item.chipInsideRow)).toBe(true);
  expect(layout.every((item) => item.segmentFontSize >= 14)).toBe(true);
  expect(layout.every((item) => item.copyFontSizes.every((fontSize) => fontSize >= 14))).toBe(true);
}

test.describe("planner responsive shell", () => {
  test("intermediate desktop widths keep all route facts unclipped", async ({ page }) => {
    await page.goto("/");
    for (const width of [821, 900, 901, 957, 958, 1000, 1120, 1121]) {
      await page.setViewportSize({ width, height: 900 });
      await expectMapInformationOutsideMap(page);
    }
  });

  test("shared renderer fits the narrow owner-preview container", async ({ page }) => {
    const snapshot = structuredClone(rawSharedRideSnapshotWithOmissions(0));
    snapshot.trip.origin.label = "공개출발지긴이름".repeat(5);
    await page.route("**/api/shares/resolve", (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({ snapshot }),
    }));
    await page.goto(`/share#${"a".repeat(43)}`);
    await expect(page.locator(".shared-snapshot")).toBeVisible();
    const markup = await page.locator(".shared-snapshot").evaluate((element) => element.outerHTML);
    await page.goto("/");
    // Exercise the production snapshot renderer inside the owner page's nesting.
    // Only the layout shell is a fixture; this does not claim connected sharing.
    await page.locator(".route-stage").evaluate((stage, html) => {
      const management = document.createElement("div");
      management.className = "management-grid";
      const manager = document.createElement("section");
      manager.className = "share-manager";
      const preview = document.createElement("div");
      preview.className = "share-preview";
      preview.innerHTML = html;
      manager.append(preview);
      management.append(manager);
      stage.append(management);
    }, markup);
    for (const width of [320, 390, 820, 901, 950, 1000, 1050, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.locator(".shared-map-details").evaluate((details) => {
        const legend = details.querySelector<HTMLElement>(".map-marker-legend")!;
        const summary = details.querySelector<HTMLElement>(".shared-map-summary")!;
        const summaryBox = summary.getBoundingClientRect();
        const items = Array.from(legend.querySelectorAll("li"));
        return {
          itemCount: items.length,
          noOverflow: [details, legend, summary].every((item) => item.scrollWidth <= item.clientWidth),
          noOverlap: items.every((item) => {
            const box = item.getBoundingClientRect();
            return box.right <= summaryBox.left || box.left >= summaryBox.right ||
              box.bottom <= summaryBox.top || box.top >= summaryBox.bottom;
          }),
        };
      });
      expect(layout.itemCount).toBeGreaterThan(0);
      expect(layout).toMatchObject({ noOverflow: true, noOverlap: true });
    }
  });

  test("primary action remains readable on hover and keyboard focus", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const action = page.locator(".primary-button").first();
    await expect(action).toBeVisible();
    const contrast = () => action.evaluate((element) => {
      const luminance = (color: string) => {
        const values = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      const style = getComputedStyle(element);
      const text = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
    });
    expect(await contrast()).toBeGreaterThanOrEqual(4.5);
    await action.hover();
    await action.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    expect(await contrast()).toBeGreaterThanOrEqual(4.5);
    await page.mouse.move(0, 0);
    await action.focus();
    await expect(action).toBeFocused();
    await action.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    expect(await contrast()).toBeGreaterThanOrEqual(4.5);
  });

  test("desktop keeps the plan and single recommended route visible", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "라이딩 계획" })).toBeVisible();
    await expect(page.getByText("복귀는 자동 계산", { exact: true })).toBeVisible();
    await expect(page.getByLabel("추가할 종류")).toHaveValue("waypoint");
    await expect(page.getByLabel("추가할 종류")).toBeDisabled();
    await expect(page.getByText("추가한 경유지가 없습니다.", { exact: false })).toBeVisible();
    await expectMapInformationOutsideMap(page);
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
    const closedLayout = await page.evaluate(() => {
      const header = document.querySelector(".app-header")!;
      const button = document.querySelector(".mobile-plan-button")!;
      const summary = document.querySelector(".ride-summary")!;
      const buttonBox = button.getBoundingClientRect();
      const summaryBox = summary.getBoundingClientRect();
      return {
        buttonInsideHeader: header.contains(button),
        buttonOverlapsSummary: buttonBox.left < summaryBox.right && buttonBox.right > summaryBox.left
          && buttonBox.top < summaryBox.bottom && buttonBox.bottom > summaryBox.top,
        buttonHeight: buttonBox.height,
      };
    });
    expect(closedLayout).toMatchObject({ buttonInsideHeader: true, buttonOverlapsSummary: false });
    expect(closedLayout.buttonHeight).toBeGreaterThanOrEqual(44);
    await openButton.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "라이딩 계획 편집" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("출발", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("추가할 종류")).toHaveValue("waypoint");
    await expect(dialog.getByLabel("추가할 종류")).toBeDisabled();
    await expect(dialog.getByText("복귀는 자동 계산", { exact: true })).toBeVisible();
    const plannerCopyFontSizes = await dialog.locator(
      ".section-label, .planner-form label > span, .selected-place strong, .selected-place small, .place-status, .time-estimate-note strong, .time-estimate-note small, .ordered-waypoint strong, .ordered-waypoint small, .toggle-row strong, .toggle-row small",
    ).evaluateAll((elements) => elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)));
    expect(plannerCopyFontSizes.every((fontSize) => fontSize >= 14)).toBe(true);
    const visibleButtonHeights = await dialog.locator("button").evaluateAll((buttons) => buttons
      .map((button) => button.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0)
      .map((box) => box.height));
    expect(visibleButtonHeights.every((height) => height >= 44)).toBe(true);
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
    await expectMapInformationOutsideMap(page);
    await expectReadableWeatherTimeline(page);
    await expect(page.getByRole("heading", { level: 1, name: "라이딩 계획 결과" })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "시간에 따른 구간 날씨" })).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasHorizontalOverflow).toBe(false);
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
        const map = element.parentElement!.querySelector(".shared-map")!;
        const details = element.parentElement!.querySelector(".shared-map-details")!;
        return {
          parentIsSnapshot: element.parentElement?.classList.contains("shared-snapshot") ?? false,
          detailsOutsideMap: !map.contains(details),
          detailsAfterMap: details.getBoundingClientRect().top >= map.getBoundingClientRect().bottom - 1,
          noticeOutsideMap: !map.contains(element),
          noticeHasNoInternalOverflow: element.scrollHeight <= element.clientHeight,
          listHasNoInternalOverflow: list.scrollHeight <= list.clientHeight,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
          readableShareCopy: Array.from(element.parentElement!.querySelectorAll<HTMLElement>(
            ".map-marker-legend li, .map-omissions li, .shared-map-summary span, .shared-routes span, .shared-routes small, .shared-legs li, .shared-weather-list li, .shared-weather-state",
          )).every((item) => Number.parseFloat(getComputedStyle(item).fontSize) >= 14),
        };
      });
      expect(layout).toEqual({
        parentIsSnapshot: true,
        detailsOutsideMap: true,
        detailsAfterMap: true,
        noticeOutsideMap: true,
        noticeHasNoInternalOverflow: true,
        listHasNoInternalOverflow: true,
        horizontalOverflow: false,
        readableShareCopy: true,
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

  test("mobile recovery and support text remain readable and tappable", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.route("**/api/auth/kakao/cancel", (route) => route.fulfill({ status: 204 }));
    await page.goto("/auth/kakao/callback#bad");
    const recoveryLink = page.getByRole("link", { name: "로그인으로 돌아가기" });
    await expect(recoveryLink).toBeVisible();
    expect((await recoveryLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await page.goto("/login");
    const footnote = page.locator(".login-footnote");
    await expect(footnote).toBeVisible();
    expect(await footnote.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);

    await page.route("**/api/invites/accept", (route) => route.abort("failed"));
    await page.goto(`/invite#${"a".repeat(43)}`);
    const memberLogin = page.getByRole("link", { name: "기존 멤버 로그인" });
    await expect(memberLogin).toBeVisible();
    expect((await memberLogin.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page).not.toHaveURL(/#/);
  });
});
