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
    await expect(summary.getByRole("heading", { name: "라이딩 결과" })).toBeVisible();
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
      const insideViewport = (box: DOMRect) => box.left >= -1 && box.right <= window.innerWidth + 1;
      return {
        summaryNoOverflow: element.scrollWidth <= element.clientWidth,
        metricsNoOverflow: metrics.scrollWidth <= metrics.clientWidth,
        mapNoOverflow: map.scrollWidth <= map.clientWidth,
        weatherNoOverflow: weather.scrollWidth <= weather.clientWidth,
        metricsBeforeMap: metricsBox.bottom <= mapBox.top + 1,
        mapBeforeWeather: mapBox.bottom <= weatherBox.top + 1,
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
      metricsBeforeMap: true,
      mapBeforeWeather: true,
      allInsideViewport: true,
    });
    expect(geometry.metricFonts.every((fontSize) => fontSize >= 14)).toBe(true);
    expect(geometry.weatherFonts.length).toBeGreaterThan(0);
    expect(geometry.weatherFonts.every((fontSize) => fontSize >= 14)).toBe(true);
    expect(await weather.locator(".riding-weather-card").evaluateAll((cards) => cards.every((card) => (
      card.scrollWidth <= card.clientWidth && card.getBoundingClientRect().right <= window.innerWidth + 1
    )))).toBe(true);
    await expectNoHorizontalOverflow(page);

    const navigation = page.getByRole("navigation", { name: "주요 화면" });
    const navButtons = navigation.getByRole("button");
    await expect(navigation).toBeVisible();
    expect(await navButtons.evaluateAll((buttons) => buttons.every((button) => {
      const box = button.getBoundingClientRect();
      return box.height >= 44 && box.left >= 0 && box.right <= window.innerWidth;
    }))).toBe(true);
    await navigation.getByRole("button", { name: "홈", exact: true }).click();
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
    const editor = page.locator(".shared-planner-embed .planner-panel");
    await expect(editor.getByRole("heading", { name: "라이딩 계획" })).toBeVisible();

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
    await placeDialog.getByRole("button", { name: "출발지 검색 닫기" }).first().click();
    await expect(placeDialog).toBeHidden();
    await expect(originTrigger).toBeFocused();

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
    await expect(page.getByRole("dialog", { name: "새 일정 선택" })).toBeVisible();
    const enabledDates = scheduleDialog.locator(".calendar-grid button:not([disabled])");
    await enabledDates.last().click();

    const timeButtons = scheduleDialog.locator(".schedule-time-rows button");
    const hourTrigger = timeButtons.first();
    const minuteTrigger = timeButtons.last();
    await hourTrigger.click();
    await expect(page.getByRole("heading", { name: "출발 시 선택" })).toBeVisible();
    expect(await scheduleDialog.locator(".schedule-dialog-shell").evaluate((shell) => shell.scrollHeight > shell.clientHeight)).toBe(true);
    await scheduleDialog.getByRole("button", { name: "취소", exact: true }).click();
    await expect(hourTrigger).toBeFocused();

    await hourTrigger.click();
    await scheduleDialog.locator(".hour-grid").getByRole("button", { name: "09", exact: true }).click();
    await expect(hourTrigger).toBeFocused();
    await minuteTrigger.click();
    await expect(page.getByRole("heading", { name: "출발 분 선택" })).toBeVisible();
    expect(await scheduleDialog.locator(".schedule-dialog-shell").evaluate((shell) => shell.scrollHeight > shell.clientHeight)).toBe(true);
    await scheduleDialog.getByRole("button", { name: "취소", exact: true }).click();
    await expect(minuteTrigger).toBeFocused();

    await minuteTrigger.click();
    await scheduleDialog.locator(".minute-grid").getByRole("button", { name: "30", exact: true }).click();
    await expect(minuteTrigger).toBeFocused();
    await scheduleDialog.getByRole("button", { name: "취소", exact: true }).click();
    await expect(scheduleDialog).toBeHidden();
    await expect(scheduleTrigger).toBeFocused();
    await expectNoHorizontalOverflow(page);
  });
});
