import { expect, test, type Page } from "@playwright/test";

import { rawSharedRideSnapshotWithOmissions } from "../fixtures/shared-ride-snapshot";

const galaxyS23Plus = {
  viewport: { width: 384, height: 832 },
  deviceScaleFactor: 2.8125,
  isMobile: true,
  hasTouch: true,
};

const selectedPlace = (kakaoPlaceId: string, name: string, longitude: number) => ({
  kakaoPlaceId,
  verificationToken: "a".repeat(43),
  name,
  address: `경기도 ${name} 지번 주소`,
  roadAddress: `경기도 ${name} 도로명 주소`,
  longitude,
  latitude: 37.5,
});

const sharedCourse = {
  origin: selectedPlace("s23-origin", "S23 출발지", 127.0),
  destination: selectedPlace("s23-destination", "S23 도착지", 127.2),
  points: [],
};

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.describe("Galaxy S23+ CSS viewport emulation", () => {
  test.use(galaxyS23Plus);

  test("portrait keeps the real summary renderer readable and navigation reachable", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    expect(await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      touchPoints: navigator.maxTouchPoints,
      portrait: matchMedia("(orientation: portrait)").matches,
    }))).toMatchObject({ width: 384, height: 832, touchPoints: 1, portrait: true });
    expect(await page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(2.8125, 4);

    const summary = page.locator(".riding-summary-layout");
    const metrics = summary.locator(".riding-summary-metrics");
    const map = summary.locator(".riding-summary-map");
    const weather = summary.locator(".riding-summary-weather");
    await expect(summary.getByRole("heading", { name: "라이딩 요약" })).toBeVisible();
    await expect(metrics).toBeVisible();
    await expect(map).toBeVisible();
    await expect(weather).toBeVisible();

    const geometry = await summary.evaluate((element) => {
      const metrics = element.querySelector<HTMLElement>(".riding-summary-metrics")!;
      const map = element.querySelector<HTMLElement>(".riding-summary-map")!;
      const weather = element.querySelector<HTMLElement>(".riding-summary-weather")!;
      const metricsBox = metrics.getBoundingClientRect();
      const mapBox = map.getBoundingClientRect();
      const weatherBox = weather.getBoundingClientRect();
      const documentWidth = document.documentElement.clientWidth;
      const insideViewport = (box: DOMRect) => box.left >= -1 && box.right <= window.innerWidth + 1;
      return {
        summaryNoOverflow: element.scrollWidth <= element.clientWidth,
        metricsNoOverflow: metrics.scrollWidth <= metrics.clientWidth,
        mapNoOverflow: map.scrollWidth <= map.clientWidth,
        weatherNoOverflow: weather.scrollWidth <= weather.clientWidth,
        mapBeforeMetrics: mapBox.bottom <= metricsBox.top + 1,
        mapBeforeWeather: mapBox.bottom <= weatherBox.top + 1,
        mapUsesSingleMobileGutter: Math.abs(mapBox.left - 20) <= 1 && Math.abs(mapBox.width - (documentWidth - 40)) <= 1,
        allInsideViewport: [metricsBox, mapBox, weatherBox].every(insideViewport),
        metricFonts: Array.from(metrics.querySelectorAll<HTMLElement>("dt, dd"))
          .map((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
        weatherFonts: Array.from(weather.querySelectorAll<HTMLElement>(
          ".riding-weather-time strong, .riding-weather-time small, .riding-weather-place strong, .riding-weather-place span, .riding-weather-place small, .riding-weather-values strong, .riding-weather-values span",
        )).map((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
      };
    });
    expect(geometry).toMatchObject({
      summaryNoOverflow: true,
      metricsNoOverflow: true,
      mapNoOverflow: true,
      weatherNoOverflow: true,
      mapBeforeMetrics: true,
      mapBeforeWeather: true,
      mapUsesSingleMobileGutter: true,
      allInsideViewport: true,
    });
    expect(geometry.metricFonts.every((fontSize) => fontSize >= 14)).toBe(true);
    expect(geometry.weatherFonts.length).toBeGreaterThan(0);
    expect(geometry.weatherFonts.every((fontSize) => fontSize >= 14)).toBe(true);
    expect(await weather.locator(".riding-weather-card").evaluateAll((cards) => cards.every((card) => (
      card.scrollWidth <= card.clientWidth && card.getBoundingClientRect().right <= window.innerWidth + 1
    )))).toBe(true);
    await expectNoHorizontalOverflow(page);

    const summaryActions = summary.locator(".riding-summary-actions");
    await expect(summaryActions).toBeVisible();
    expect(await summaryActions.getByRole("button").evaluateAll((buttons) => buttons.every((button) => {
      const box = button.getBoundingClientRect();
      return box.height >= 44 && box.left >= 0 && box.right <= window.innerWidth;
    }))).toBe(true);
    await summaryActions.getByRole("button", { name: "경로 수정", exact: true }).click();
    const homeButton = page.getByRole("button", { name: "홈으로" });
    await expect(homeButton).toBeVisible();
    await homeButton.click();
    await expect(page.getByRole("heading", { name: "오늘은 어디로 달려볼까요?" })).toBeVisible();
  });

  test("portrait place picker and landscape schedule dialogs restore focus and expose bottom controls", async ({ page }) => {
    const snapshot = rawSharedRideSnapshotWithOmissions(0);
    await page.route("**/api/shares/resolve", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ snapshot }),
    }));
    await page.route("**/api/shares/course", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ course: sharedCourse }),
    }));

    await page.goto(`/share#${"a".repeat(43)}`);
    await page.getByRole("button", { name: "새 일정으로 출발" }).click();
    const initialScheduleDialog = page.getByRole("dialog", { name: "출발 날짜·시간" });
    await expect(initialScheduleDialog).toBeVisible();
    await initialScheduleDialog.locator(".schedule-time-rows button").first().click();
    const mobileHourDialog = page.getByRole("dialog", { name: "시 선택" });
    await expect(mobileHourDialog.locator(".clock-grid")).toHaveCSS("height", "240px");
    await mobileHourDialog.getByRole("button", { name: "취소", exact: true }).click();
    await initialScheduleDialog.getByRole("button", { name: "일정 선택 닫기", exact: true }).click();
    const editorView = page.locator(".shared-planner-embed .workspace.is-editor-view");
    const editor = editorView.locator(".planner-panel");
    await expect(editorView.getByRole("heading", { name: "어디로 떠날까요?" })).toBeVisible();

    const originTrigger = editor.locator(".place-picker-trigger").filter({ hasText: "S23 출발지" });
    await originTrigger.click();
    const placeDialog = page.getByRole("dialog", { name: "출발지 선택" });
    await expect(placeDialog).toBeVisible();
    await expect(placeDialog.getByLabel("출발지 검색어")).toBeFocused();
    const placeLayout = await placeDialog.evaluate((dialog) => ({
      width: dialog.getBoundingClientRect().width,
      height: dialog.getBoundingClientRect().height,
      horizontalOverflow: dialog.scrollWidth > dialog.clientWidth,
    }));
    expect(placeLayout).toEqual({ width: 384, height: 832, horizontalOverflow: false });
    await placeDialog.getByRole("button", { name: "관리", exact: true }).click();
    const manageDialog = page.getByRole("dialog", { name: "즐겨찾기 관리" });
    await manageDialog.getByRole("button", { name: "즐겨찾기 등록", exact: true }).click();
    const registerDialog = page.getByRole("dialog", { name: "즐겨찾기 등록" });
    await expect(registerDialog.getByRole("button", { name: /로 선택$/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(manageDialog).toBeVisible();
    await manageDialog.getByRole("button", { name: "출발지 선택으로 돌아가기" }).first().click();
    await expect(placeDialog).toBeVisible();
    await placeDialog.getByRole("button", { name: "출발지 검색 닫기" }).first().click();
    await expect(placeDialog).toBeHidden();
    await expect(originTrigger).toBeFocused();

    await page.setViewportSize({ width: 1440, height: 900 });
    await originTrigger.click();
    const desktopPlaceDialog = page.locator("dialog.place-picker-dialog[open]");
    const desktopSearchLayout = await desktopPlaceDialog.evaluate((dialog) => {
      const shell = dialog.querySelector<HTMLElement>(".mode-search")!;
      const header = shell.querySelector<HTMLElement>(".place-picker-header")!;
      const favorites = shell.querySelector<HTMLElement>(".place-favorites")!;
      const content = shell.querySelector<HTMLElement>(".place-picker-content")!;
      const searchInput = shell.querySelector<HTMLInputElement>(".place-picker-search input")!;
      const searchAction = shell.querySelector<HTMLElement>(".place-picker-search .place-search-button, .place-picker-search .place-query-clear")!;
      const inputBox = searchInput.getBoundingClientRect();
      const actionBox = searchAction.getBoundingClientRect();
      return {
        dialogWidth: dialog.getBoundingClientRect().width,
        titleLeft: header.querySelector("h2")!.getBoundingClientRect().left - dialog.getBoundingClientRect().left - Number.parseFloat(getComputedStyle(dialog).borderLeftWidth),
        favoritesWidth: favorites.getBoundingClientRect().width,
        contentGap: getComputedStyle(content).columnGap,
        hasNoHorizontalOverflow: dialog.scrollWidth <= dialog.clientWidth,
        searchActionInsideInput: actionBox.top >= inputBox.top - 1
          && actionBox.bottom <= inputBox.bottom + 1
          && actionBox.left >= inputBox.left - 1
          && actionBox.right <= inputBox.right + 1,
      };
    });
    expect(desktopSearchLayout).toMatchObject({
      dialogWidth: 960,
      favoritesWidth: 280,
      contentGap: "24px",
      hasNoHorizontalOverflow: true,
      searchActionInsideInput: true,
    });
    expect(desktopSearchLayout.titleLeft).toBeCloseTo(32, 0);
    await expect(desktopPlaceDialog.getByRole("button", { name: "즐겨찾기 관리", exact: true })).toBeVisible();
    await desktopPlaceDialog.getByRole("button", { name: "출발지 검색 닫기" }).click();
    await page.setViewportSize({ width: 384, height: 832 });

    await editor.getByRole("button", { name: "+ 경유지 추가", exact: true }).click();
    const waypointSettings = page.getByRole("dialog", { name: "경유지 설정" });
    await waypointSettings.getByRole("button", { name: "추가하고 장소 선택", exact: true }).click();
    const waypointPicker = page.locator("dialog.place-picker-dialog[open]");
    await expect(waypointPicker).toBeVisible();
    await waypointPicker.getByRole("button", { name: /검색 닫기$/ }).click();

    for (const viewport of [
      { width: 320, height: 800 },
      { width: 384, height: 832 },
      { width: 390, height: 844 },
      { width: 820, height: 1180 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(50);
      const lineCounts = await editorView.evaluate((view) => {
        const countLines = (element: Element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return new Set(Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => Math.round(rect.top))).size;
        };
        const visible = (selector: string) => Array.from(view.querySelectorAll<HTMLElement>(selector)).filter((element) => getComputedStyle(element).display !== "none");
        return {
          waypointLabel: countLines(view.querySelector(".waypoint-heading strong")!),
          roleChip: countLines(view.querySelector(".waypoint-settings")!),
          scheduleParts: visible(".schedule-trigger span, .schedule-trigger strong").map(countLines),
          calculateLabels: visible(".desktop-calculate-label, .mobile-calculate-label").map((element) => ({ lines: countLines(element), text: element.textContent?.trim() })),
          noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
        };
      });
      expect(lineCounts.waypointLabel).toBe(1);
      expect(lineCounts.roleChip).toBe(1);
      expect(lineCounts.scheduleParts.every((count) => count === 1)).toBe(true);
      expect(lineCounts.calculateLabels).toEqual([{ lines: 1, text: viewport.width <= 767 ? "이 경로로 날씨 확인" : "라이딩 날씨 확인" }]);
      expect(lineCounts.noHorizontalOverflow).toBe(true);
    }

    await editor.getByRole("button", { name: "경유 1 설정", exact: true }).click();
    await page.getByRole("dialog", { name: "경유지 설정" }).getByRole("button", { name: "경유지 삭제", exact: true }).click();
    await expect(editor.locator(".editor-favorites-heading")).toContainText("장소를 다시 선택해 주세요");
    expect(await editor.locator(".editor-favorite-slots button").evaluateAll((buttons) => buttons.every((button) => (button as HTMLButtonElement).disabled))).toBe(true);
    await expect(originTrigger).toContainText("S23 출발지");

    await page.setViewportSize({ width: 832, height: 384 });
    expect(await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      landscape: matchMedia("(orientation: landscape)").matches,
      devicePixelRatio,
      touchPoints: navigator.maxTouchPoints,
    }))).toMatchObject({ width: 832, height: 384, landscape: true, touchPoints: 1 });
    expect(await page.evaluate(() => devicePixelRatio)).toBeCloseTo(2.8125, 4);

    const scheduleTrigger = editor.locator(".schedule-trigger");
    await scheduleTrigger.click();
    const scheduleDialog = page.locator("dialog.schedule-dialog");
    await expect(page.getByRole("dialog", { name: "언제 출발할까요?" })).toBeVisible();
    const enabledDates = scheduleDialog.locator(".calendar-grid button:not([disabled])");
    await enabledDates.last().click();

    const timeButtons = scheduleDialog.locator(".schedule-time-rows button");
    const hourTrigger = timeButtons.first();
    const minuteTrigger = timeButtons.last();
    await hourTrigger.click();
    await expect(page.getByRole("heading", { name: "시 선택" })).toBeVisible();
    expect(await scheduleDialog.locator(".schedule-dialog-shell").evaluate((shell) => shell.scrollHeight > shell.clientHeight)).toBe(true);
    await page.getByRole("dialog", { name: "시 선택" }).getByRole("button", { name: "취소", exact: true }).click();
    await expect(hourTrigger).toBeFocused();

    await hourTrigger.click();
    const selectedHour = page.getByRole("dialog", { name: "시 선택" }).getByRole("button", { name: "09시", exact: true });
    await selectedHour.click();
    await expect(hourTrigger).toBeFocused();
    await hourTrigger.click();
    await expect(selectedHour).toBeFocused();
    await selectedHour.click();
    await minuteTrigger.click();
    await expect(page.getByRole("heading", { name: "분 선택" })).toBeVisible();
    expect(await scheduleDialog.locator(".schedule-dialog-shell").evaluate((shell) => shell.scrollHeight > shell.clientHeight)).toBe(true);
    await page.getByRole("dialog", { name: "분 선택" }).getByRole("button", { name: "취소", exact: true }).click();
    await expect(minuteTrigger).toBeFocused();

    await minuteTrigger.click();
    await page.getByRole("dialog", { name: "분 선택" }).getByRole("button", { name: "30분", exact: true }).click();
    await expect(minuteTrigger).toBeFocused();
    await scheduleDialog.getByRole("button", { name: "일정 선택 닫기", exact: true }).click();
    await expect(scheduleDialog).toBeHidden();
    await expect(scheduleTrigger).toBeFocused();
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 384, height: 832 });
    const destinationTrigger = editor.locator(".place-picker-trigger").last();
    await expect(destinationTrigger).toHaveAccessibleName("도착지, S23 도착지");
    await destinationTrigger.click();
    const destinationDialog = page.getByRole("dialog", { name: "도착지 선택" });
    const clearSelection = destinationDialog.getByRole("button", { name: "현재 장소 선택 해제", exact: true });
    await expect(clearSelection).toBeVisible();
    await clearSelection.click();
    await expect(destinationTrigger).toContainText("예: 양평역");
  });
});
