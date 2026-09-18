import { expect, test, type Page } from "@playwright/test";
import { orderedSharedRideSnapshot } from "../fixtures/shared-ride-snapshot";

async function openShared(page: Page, count = 1) {
  const requests: string[] = [];
  await page.route("**/api/shares/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path === "/api/shares/resolve") await route.fulfill({ json: { snapshot: orderedSharedRideSnapshot(count) } });
    else await route.fulfill({ status: 401, json: { error: "로그인 후 다시 시도해 주세요." } });
  });
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, "__kakaoCalls", { value: calls });
    window.open = (url) => { calls.push(String(url)); return null; };
  });
  await page.goto(`/share#${"k".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "공유받은 라이딩 요약" })).toBeVisible();
  return requests;
}

async function externalCalls(page: Page) {
  return page.evaluate(() => (window as unknown as { __kakaoCalls: string[] }).__kakaoCalls);
}

for (const viewport of [{ width: 320, height: 800 }, { width: 384, height: 824 }, { width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 900 }, { width: 844, height: 390 }]) {
  test(`shared handoff layout and cancel at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const requests = await openShared(page);
    const run = page.getByRole("button", { name: "경로 실행", exact: true });
    for (const label of ["경로 실행", "새 일정으로 출발", "내 경로로 저장"]) {
      const action = page.getByRole("button", { name: label, exact: true });
      await expect(action).toBeVisible();
      const box = await action.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    await expect(page.locator(".shared-home-link")).toHaveText("홈으로");
    await expect(run).toHaveCSS("background-color", "rgb(24, 34, 29)");
    await expect(page.getByRole("button", { name: "새 일정으로 출발", exact: true })).toHaveCSS("background-color", "rgb(255, 253, 248)");
    await expect(page.getByRole("button", { name: "내 경로로 저장", exact: true })).toHaveCSS("background-color", "rgb(255, 253, 248)");
    await expect(page.locator(".shared-handoff-history")).toContainText("현재 주행 기준이 아니에요");
    if (testInfo.project.use.baseURL === "http://127.0.0.1:3100") await page.screenshot({ path: testInfo.outputPath("summary.png"), fullPage: true });
    await run.click();
    const dialog = page.getByRole("dialog", { name: "카카오맵에서 경로 옵션을 확인해 주세요" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("strong")).toHaveText(["경유지 최대 5개", "자동차전용도로 제외"]);
    await expect(dialog.getByRole("button")).toHaveCount(2);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.height).toBeLessThanOrEqual(viewport.height);
    if (testInfo.project.use.baseURL === "http://127.0.0.1:3100") await page.screenshot({ path: testInfo.outputPath("confirmation.png") });
    await dialog.getByRole("button", { name: "취소", exact: true }).focus();
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(run).toBeFocused();
    expect(await externalCalls(page)).toEqual([]);
    expect(requests).toEqual(["/api/shares/resolve"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}

test("shared direct execution requests no save/course/recalculation and retries explicitly", async ({ page }) => {
  const requests = await openShared(page, 5);
  await page.getByRole("button", { name: "경로 실행", exact: true }).click();
  await page.getByRole("button", { name: "확인하고 카카오맵 열기" }).click();
  const calls = await externalCalls(page);
  expect(calls).toHaveLength(1);
  const url = new URL(calls[0]);
  expect(url.origin).toBe("https://map.kakao.com");
  expect(url.pathname.split("/").slice(4)).toHaveLength(7);
  expect(url.hash).toBe("");
  expect(url.search).toBe("");
  expect(calls[0]).not.toContain("k".repeat(43));
  await expect(page.getByRole("dialog")).toContainText("팝업 차단");
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  expect(await externalCalls(page)).toHaveLength(1);
  await page.getByRole("button", { name: "확인하고 카카오맵 열기" }).click();
  expect(await externalCalls(page)).toHaveLength(2);
  expect(requests).toEqual(["/api/shares/resolve"]);
});

test("six visits block execution and offer the existing authenticated new-schedule flow", async ({ page }) => {
  const requests = await openShared(page, 6);
  await page.getByRole("button", { name: "경로 실행", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("현재 경유지 6개 - 경유지 5개 제한 초과");
  await expect(dialog.getByRole("button", { name: "확인하고 카카오맵 열기" })).toHaveCount(0);
  expect(await externalCalls(page)).toEqual([]);
  expect(requests).toEqual(["/api/shares/resolve"]);
  await dialog.getByRole("button", { name: "새 일정으로 출발" }).click();
  await expect(page.locator(".shared-course-error")).toContainText("로그인 후");
  expect(requests).toEqual(["/api/shares/resolve", "/api/shares/course"]);
});

test("demo owner result cannot be executed and retains the edit entry", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "경로 실행", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "경로를 다시 계산해 주세요" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "경로 편집으로" }).click();
  await expect(page.locator(".workspace.is-editor-view")).toBeVisible();
});

test("a replacement share token discards a pending confirmation", async ({ page }) => {
  await openShared(page);
  await page.getByRole("button", { name: "경로 실행", exact: true }).click();
  await page.evaluate(() => { window.location.hash = "j".repeat(43); });
  await expect(page.getByRole("heading", { name: "공유받은 라이딩 요약" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await externalCalls(page)).toEqual([]);
  await page.getByRole("button", { name: "경로 실행", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "카카오맵에서 경로 옵션을 확인해 주세요" })).toBeVisible();
});

test("mobile launch offers store recovery only after attempting the app", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "userAgent", { value: "Mozilla Android Mobile" }));
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = await openShared(page);
  await page.getByRole("button", { name: "경로 실행", exact: true }).click();
  await expect(page.getByRole("button", { name: "카카오맵 설치 안내" })).toHaveCount(0);
  await expect(page.getByRole("dialog").getByRole("link")).toHaveCount(0);
  await page.getByRole("button", { name: "확인하고 카카오맵 열기" }).click();
  const dialog = page.getByRole("dialog", { name: "카카오맵에서 경로를 확인해 주세요" });
  await expect(dialog.getByRole("link", { name: "Google Play에서 카카오맵 설치" })).toHaveAttribute("href", "https://play.google.com/store/apps/details?id=net.daum.android.map");
  await expect(dialog).toContainText("공유 링크를 다시 열어 주세요");
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "카카오맵에서 경로 옵션을 확인해 주세요" })).toBeVisible();
  expect(await externalCalls(page)).toEqual([]);
  expect(requests).toEqual(["/api/shares/resolve"]);
});
