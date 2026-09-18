import { expect, test } from "@playwright/test";

import { rawSharedRideSnapshotWithOmissions } from "../fixtures/shared-ride-snapshot";

async function expectMapInformationOutsideMap(page: import("@playwright/test").Page) {
  await page.evaluate(() => document.fonts.ready);
  const map = page.locator(".map-area");
  const meta = page.locator(".route-map-meta");
  const details = page.locator(".route-map-details");
  const legend = details.getByRole("list", { name: "지도 지점 표시 안내" });
  const summary = page.locator(".riding-summary-layout");
  const metrics = page.locator(".riding-summary-metrics");
  await expect(map).toBeVisible();
  await expect(meta).toBeVisible();
  await expect(legend).toBeVisible();
  await expect(summary).toBeVisible();
  await expect(metrics).toBeVisible();
  await expect(metrics.getByText("주행", { exact: true })).toBeVisible();
  await expect(metrics.getByText("휴식", { exact: true })).toBeVisible();
  await expect(metrics.getByText("예상 도착", { exact: true })).toBeVisible();
  const layout = await page.evaluate(() => {
    const mapBox = document.querySelector(".map-area")!.getBoundingClientRect();
    const meta = document.querySelector(".route-map-meta")!;
    const details = document.querySelector(".route-map-details")!;
    const legend = details.querySelector(".map-marker-legend")!;
    const header = document.querySelector<HTMLElement>(".riding-summary-header")!;
    const metrics = document.querySelector<HTMLElement>(".riding-summary-metrics")!;
    const metaBox = meta.getBoundingClientRect();
    const detailsBox = details.getBoundingClientRect();
    const legendBox = legend.getBoundingClientRect();
    const headerBox = header.getBoundingClientRect();
    const metricsBox = metrics.getBoundingClientRect();
    const summary = document.querySelector<HTMLElement>(".riding-summary-layout")!;
    const summaryBox = summary.getBoundingClientRect();
    const overlaps = (left: DOMRect, right: DOMRect) => (
      left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top
    );
    return {
      mapContainsMeta: document.querySelector(".map-area")!.contains(meta),
      mapContainsLegend: document.querySelector(".map-area")!.contains(legend),
      mapContainsSummary: document.querySelector(".map-area")!.contains(summary),
      mapContainsHeader: document.querySelector(".map-area")!.contains(header),
      mapContainsMetrics: document.querySelector(".map-area")!.contains(metrics),
      metaBeforeMap: metaBox.bottom <= mapBox.top + 1,
      headerBeforeMap: headerBox.bottom <= mapBox.top + 1,
      metricsBeforeMap: metricsBox.bottom <= mapBox.top + 1,
      mapBeforeMetrics: mapBox.bottom <= metricsBox.top + 1,
      detailsAfterMap: detailsBox.top >= mapBox.bottom - 1,
      metaOverlapsMap: overlaps(metaBox, mapBox),
      legendOverlapsMap: overlaps(legendBox, mapBox),
      mapHeight: mapBox.height,
      summaryClientWidth: summary.clientWidth,
      summaryScrollWidth: summary.scrollWidth,
      summaryClientHeight: summary.clientHeight,
      summaryScrollHeight: summary.scrollHeight,
      summaryLabelFontSize: Number.parseFloat(getComputedStyle(summary.querySelector(".riding-summary-metrics dt")!).fontSize),
      summaryValueFontSize: Number.parseFloat(getComputedStyle(summary.querySelector(".riding-summary-metrics dd")!).fontSize),
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
    mapContainsHeader: false,
    mapContainsMetrics: false,
    metaBeforeMap: true,
    headerBeforeMap: true,
    detailsAfterMap: true,
    metaOverlapsMap: false,
    legendOverlapsMap: false,
    summaryHasNoInternalOverflow: true,
    detailsHaveNoInternalOverflow: true,
    summaryInsideStage: true,
  });
  if ((page.viewportSize()?.width ?? 1440) <= 1023) {
    expect(layout.mapBeforeMetrics).toBe(true);
  } else {
    expect(layout.metricsBeforeMap).toBe(true);
  }
  expect(layout.mapHeight).toBeGreaterThanOrEqual(360);
  expect(layout.summaryLabelFontSize).toBeGreaterThanOrEqual(14);
  expect(layout.summaryValueFontSize).toBeGreaterThanOrEqual(16);
  expect(layout.mapCopyFontSizes.every((fontSize) => fontSize >= 14)).toBe(true);
  await expect(summary.getByRole("heading", { name: "라이딩 결과" })).toHaveCount(1);
  await expect(summary.getByText("추천 경로", { exact: true })).toHaveCount(0);
  await expect(page.locator(".candidate-card, .candidate-strip, .candidate-tab")).toHaveCount(0);
}

async function expectReadableWeatherTimeline(page: import("@playwright/test").Page) {
  const layout = await page.locator(".riding-weather-card").evaluateAll((rows) => rows.map((row) => {
    const place = row.querySelector<HTMLElement>(".riding-weather-place")!;
    const values = row.querySelector<HTMLElement>(".riding-weather-values")!;
    const rowBox = row.getBoundingClientRect();
    const valuesBox = values.getBoundingClientRect();
    return {
      rowHasNoOverflow: row.scrollWidth <= row.clientWidth,
      valuesHasNoOverflow: values.scrollWidth <= values.clientWidth,
      valuesInsideRow: valuesBox.left >= rowBox.left && valuesBox.right <= rowBox.right + 1,
      placeFontSize: Number.parseFloat(getComputedStyle(place.querySelector("strong")!).fontSize),
      copyFontSizes: Array.from(row.querySelectorAll<HTMLElement>(
        ".riding-weather-time strong, .riding-weather-time small, .riding-weather-place strong, .riding-weather-place span, .riding-weather-place small, .riding-weather-values strong, .riding-weather-values span",
      )).map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    };
  }));
  expect(layout.every((item) => item.rowHasNoOverflow && item.valuesHasNoOverflow && item.valuesInsideRow)).toBe(true);
  expect(layout.every((item) => item.placeFontSize >= 14)).toBe(true);
  expect(layout.every((item) => item.copyFontSizes.every((fontSize) => fontSize >= 14))).toBe(true);
}

test.describe("planner responsive shell", () => {
  test("home matches the Figma typography and spacing at supported widths", async ({ page }) => {
    for (const viewport of [
      { width: 320, height: 800 },
      { width: 384, height: 832 },
      { width: 390, height: 844 },
      { width: 820, height: 1180 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/#home");
      await expect(page.getByRole("button", { name: "MOTOCAST 홈" })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      const home = page.locator(".planner-home");
      const title = home.getByRole("heading", { name: "오늘은 어디로 달려볼까요?" });
      const primary = home.getByRole("button", { name: /새 경로 만들기/ }).first();
      await expect(title).toBeVisible();
      await expect(primary).toBeVisible();

      const layout = await home.evaluate((element) => {
        const header = document.querySelector<HTMLElement>(".app-header")!;
        const title = element.querySelector<HTMLElement>("#planner-home-title")!;
        const titleSpans = Array.from(title.querySelectorAll<HTMLElement>("span"));
        const titleLines = titleSpans.map((span) => span.getBoundingClientRect());
        const titleTextRects = titleSpans.flatMap((span) => {
          const range = document.createRange();
          range.selectNodeContents(span);
          return Array.from(range.getClientRects());
        });
        const motorcycle = element.querySelector<HTMLElement>(".planner-home-motorcycle")!;
        const motorcycleBox = motorcycle.getBoundingClientRect();
        const primary = element.querySelector<HTMLElement>(".planner-home-entry-grid .primary-button")!;
        const primaryBox = primary.getBoundingClientRect();
        const overlaps = (left: DOMRect, right: DOMRect) => left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
        return {
          bodyFontFamily: getComputedStyle(document.body).fontFamily,
          loadedNotoFaces: Array.from(document.fonts).filter((face) => face.family.includes("Noto Sans KR Variable") && face.status === "loaded").length,
          documentHasNoHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
          headerHasNoHorizontalOverflow: header.scrollWidth <= header.clientWidth,
          homeHasNoHorizontalOverflow: element.scrollWidth <= element.clientWidth,
          titleFontSize: Number.parseFloat(getComputedStyle(title).fontSize),
          titleLineCount: new Set(titleTextRects.map((line) => Math.round(line.top))).size,
          titleOverlapsMotorcycle: titleLines.some((line) => overlaps(line, motorcycleBox)),
          motorcycleRightGap: window.innerWidth - motorcycleBox.right,
          primaryHeight: primaryBox.height,
          primaryInsideViewport: primaryBox.left >= 0 && primaryBox.right <= window.innerWidth,
          brandMarkCount: header.querySelectorAll(".brand-mark").length,
          navigationDisplay: getComputedStyle(header.querySelector<HTMLElement>(".app-navigation")!).display,
        };
      });
      expect(layout.bodyFontFamily).toContain("Noto Sans KR Variable");
      expect(layout.loadedNotoFaces).toBeGreaterThan(0);
      expect(layout).toMatchObject({
        documentHasNoHorizontalOverflow: true,
        headerHasNoHorizontalOverflow: true,
        homeHasNoHorizontalOverflow: true,
        titleOverlapsMotorcycle: false,
        primaryInsideViewport: true,
        brandMarkCount: 0,
      });
      expect(layout.primaryHeight).toBeGreaterThanOrEqual(48);
      if (viewport.width <= 767) {
        expect(layout.titleFontSize).toBe(28);
        expect(layout.titleLineCount).toBe(2);
        expect(layout.motorcycleRightGap).toBeGreaterThanOrEqual(39);
        expect(layout.navigationDisplay).toBe("none");
      } else {
        expect(layout.navigationDisplay).not.toBe("none");
      }
      if (viewport.width === 1440) {
        expect(layout.titleFontSize).toBe(40);
        expect(layout.titleLineCount).toBe(1);
        expect(layout.motorcycleRightGap).toBeGreaterThanOrEqual(191);
      }
    }
  });

  test("intermediate desktop widths keep all route facts unclipped", async ({ page }) => {
    await page.goto("/");
    for (const width of [821, 900, 901, 957, 958, 1000, 1024, 1120, 1121]) {
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
        const routeOrder = details.querySelector<HTMLElement>(".summary-route-order")!;
        const routeOrderBox = routeOrder.getBoundingClientRect();
        const items = Array.from(legend.querySelectorAll("li"));
        return {
          itemCount: items.length,
          noOverflow: [details, legend, routeOrder].every((item) => item.scrollWidth <= item.clientWidth),
          noOverlap: items.every((item) => {
            const box = item.getBoundingClientRect();
            return box.right <= routeOrderBox.left || box.left >= routeOrderBox.right ||
              box.bottom <= routeOrderBox.top || box.top >= routeOrderBox.bottom;
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
    await page.getByRole("button", { name: "MOTOCAST 홈" }).click();
    const action = page.locator(".planner-home-entry-grid .primary-button").first();
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
    expect(await contrast()).toBeGreaterThanOrEqual(4.5);
    await action.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    expect(await contrast()).toBeGreaterThanOrEqual(4.5);
    await page.mouse.move(0, 0);
    expect(await contrast()).toBeGreaterThanOrEqual(4.5);
    await action.focus();
    await expect(action).toBeFocused();
    await action.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    expect(await contrast()).toBeGreaterThanOrEqual(4.5);
  });

  test("desktop keeps the single recommended route summary visible", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "라이딩 결과" })).toBeVisible();
    await expectMapInformationOutsideMap(page);
    await expectReadableWeatherTimeline(page);
    await expect(page.getByRole("button", { name: "경로 실행" }).last()).toBeVisible();
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
    test(`${viewport.name} opens the editor and a focus-contained schedule dialog`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");

    const openButton = page.getByRole("button", { name: "경로 편집으로" }).first();
    await expect(openButton).toBeVisible();
    const closedLayout = await openButton.evaluate((button) => {
      const summary = document.querySelector(".riding-summary-layout")!;
      const buttonBox = button.getBoundingClientRect();
      return {
        buttonInsideSummaryActions: Boolean(button.closest(".riding-summary-actions")),
        buttonInsideSummary: summary.contains(button),
        buttonHeight: buttonBox.height,
      };
    });
    expect(closedLayout).toMatchObject({ buttonInsideSummaryActions: false, buttonInsideSummary: true });
    expect(closedLayout.buttonHeight).toBeGreaterThanOrEqual(44);
    await openButton.focus();
    await page.keyboard.press("Enter");

    const editorView = page.locator(".workspace.is-editor-view");
    const editor = editorView.locator(".planner-panel");
    await expect(editor).toBeVisible();
    await expect(editorView.getByRole("heading", { name: viewport.width <= 767 ? "어디로 떠날까요?" : "경로 편집" })).toBeVisible();
    const plannerCopyFontSizes = await editor.locator(
      ".section-label, .planner-form label > span, .time-estimate-note strong, .time-estimate-note small, .ordered-waypoint strong, .ordered-waypoint small",
    ).evaluateAll((elements) => elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)));
    expect(plannerCopyFontSizes.every((fontSize) => fontSize >= 14)).toBe(true);
    await editor.locator(".schedule-trigger").click();
    const dialog = page.getByRole("dialog", {
      name: viewport.width <= 767 ? "출발 날짜·시간" : "언제 출발할까요?",
    });
    await expect(dialog).toBeVisible();
    const visibleButtons = await dialog.locator("button").evaluateAll((buttons) => buttons
      .map((button) => ({
        name: button.getAttribute("aria-label") ?? button.textContent?.trim(),
        className: button.className,
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
      }))
      .filter((button) => button.width > 0 && button.height > 0));
    expect(visibleButtons.length).toBeGreaterThan(0);
    expect(visibleButtons.filter((button) => button.height < 44)).toEqual([]);
    const focusable = dialog.locator("input:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])");
    const last = focusable.last();
    await last.focus();
    await page.keyboard.press("Tab");
    await expect.poll(() => dialog.evaluate((element) => element === document.activeElement || element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => dialog.evaluate((element) => element === document.activeElement || element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(editor.locator(".schedule-trigger")).toBeFocused();

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
      let saveRequests = 0;
      await page.route("**/api/shares/save", async (request) => {
        saveRequests += 1;
        const body = request.request().postDataJSON() as { title?: unknown; saveOperationId?: unknown };
        expect(body.title).toBe("공유 경로 복사 테스트");
        expect(body.saveOperationId).toMatch(/^[0-9a-f-]{36}$/i);
        await request.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ collectionId: "collection", versionId: "version", versionNumber: 1 }),
        });
      });
      await page.goto(`/share#${"a".repeat(43)}`);

      const notice = page.locator(".shared-snapshot .map-omissions");
      const items = notice.getByRole("listitem");
      await expect(items).toHaveCount(20);
      const layout = await notice.evaluate((element) => {
        const list = element.querySelector("ul")!;
        const snapshot = element.closest(".shared-snapshot")!;
        const map = snapshot.querySelector(".shared-map")!;
        const details = snapshot.querySelector(".shared-map-details")!;
        return {
          insideSnapshot: snapshot.contains(element),
          detailsOutsideMap: !map.contains(details),
          detailsAfterMap: details.getBoundingClientRect().top >= map.getBoundingClientRect().bottom - 1,
          noticeOutsideMap: !map.contains(element),
          noticeHasNoInternalOverflow: element.scrollHeight <= element.clientHeight,
          listHasNoInternalOverflow: list.scrollHeight <= list.clientHeight,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
          readableShareCopy: Array.from(snapshot.querySelectorAll<HTMLElement>(
            ".map-marker-legend li, .map-omissions li, .shared-map-summary span, .shared-routes span, .shared-routes small, .shared-legs li, .shared-weather-list li, .shared-weather-state",
          )).every((item) => Number.parseFloat(getComputedStyle(item).fontSize) >= 14),
        };
      });
      expect(layout).toEqual({
        insideSnapshot: true,
        detailsOutsideMap: true,
        detailsAfterMap: true,
        noticeOutsideMap: true,
        noticeHasNoInternalOverflow: true,
        listHasNoInternalOverflow: true,
        horizontalOverflow: false,
        readableShareCopy: true,
      });
      await expect(items.last()).toBeVisible();

      await page.getByRole("button", { name: "내 경로로 저장" }).click();
      const saveDialog = page.getByRole("dialog", { name: "내 경로로 저장" });
      await expect(saveDialog).toBeVisible();
      await saveDialog.getByLabel("컬렉션 이름").fill("공유 경로 복사 테스트");
      const dialogLayout = await saveDialog.evaluate((dialog) => ({
        horizontalOverflow: dialog.scrollWidth > dialog.clientWidth,
        viewportOverflow: dialog.getBoundingClientRect().right > window.innerWidth + 1,
        fullHeightOnMobile: window.innerWidth > 560 || Math.abs(dialog.getBoundingClientRect().height - window.innerHeight) <= 1,
      }));
      expect(dialogLayout).toEqual({ horizontalOverflow: false, viewportOverflow: false, fullHeightOnMobile: true });
      await saveDialog.getByRole("button", { name: "저장", exact: true }).click();
      await expect(saveDialog.getByRole("status")).toContainText("내 라이딩 컬렉션에 저장했습니다");
      expect(saveRequests).toBe(1);
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
