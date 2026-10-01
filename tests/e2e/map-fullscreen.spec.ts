import { expect, test } from "@playwright/test";
import { orderedSharedRideSnapshot } from "../fixtures/shared-ride-snapshot";

for (const viewport of [
  { width: 320, height: 800 }, { width: 384, height: 832 }, { width: 390, height: 844 },
  { width: 820, height: 1180 }, { width: 1440, height: 900 }, { width: 832, height: 384 },
]) {
  test(`fullscreen keeps the map, focus, and readable status at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const trigger = page.getByRole("button", { name: "전체화면", exact: true });
    const originalMap = await page.locator(".map-canvas").elementHandle();
    expect(originalMap).not.toBeNull();
    await expect(trigger).toBeVisible();
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "경로 지도", exact: true });
    const close = dialog.getByRole("button", { name: "닫기", exact: true });
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await expect(dialog.getByRole("status")).toContainText("카카오 지도 키 미설정");
    await expect(dialog.getByRole("button", { name: "지도 중심에서 경유지 선택" })).toHaveCount(0);
    expect(await originalMap!.evaluate(node => node === document.querySelector(".map-canvas"))).toBe(true);
    const layout = await dialog.evaluate(node => {
      const box = node.getBoundingClientRect();
      const header = node.querySelector("header")!.getBoundingClientRect();
      const map = node.querySelector(".map-viewport")!.getBoundingClientRect();
      const close = node.querySelector("header button")!.getBoundingClientRect();
      const status = node.querySelector('[role="status"]')!;
      const statusBox = status.getBoundingClientRect();
      return {
        x: box.x, y: box.y, width: box.width, height: box.height,
        closeHeight: close.height, closeWidth: close.width, mapHeight: map.height,
        noHorizontalOverflow: node.scrollWidth <= node.clientWidth,
        headerBeforeMap: header.bottom <= map.top + 1,
        statusInsideMap: statusBox.top >= map.top && statusBox.bottom <= map.bottom + 1,
        statusReadable: status.scrollHeight <= status.clientHeight,
      };
    });
    expect(layout).toMatchObject({ x: 0, y: 0, width: viewport.width, height: viewport.height,
      noHorizontalOverflow: true, headerBeforeMap: true, statusInsideMap: true, statusReadable: true });
    expect(layout.closeHeight).toBeGreaterThanOrEqual(48);
    expect(layout.closeWidth).toBeGreaterThanOrEqual(80);
    expect(layout.mapHeight).toBeGreaterThanOrEqual(120);
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
    if (testInfo.project.use.baseURL === "http://127.0.0.1:3100") await page.screenshot({ path: testInfo.outputPath("fullscreen.png") });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
    expect(await originalMap!.evaluate(node => node === document.querySelector(".map-canvas"))).toBe(true);
    await trigger.click();
    await close.click();
    await expect(trigger).toBeFocused();
  });
}

test("readonly shared fullscreen stays truthful through orientation and large text", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/shares/**", async route => {
    requests.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: { snapshot: orderedSharedRideSnapshot(1) } });
  });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/share#${"k".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "공유받은 라이딩 요약" })).toBeVisible();
  await page.addStyleTag({ content: "html { font-size: 150%; } .map-surface { font-size: 1.5rem; }" });
  const trigger = page.getByRole("button", { name: "전체화면", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "경로 지도", exact: true });
  await expect(dialog.getByRole("status")).toContainText("실제 경로 선을 표시할 수 없습니다");
  await expect(dialog.locator(".route-sketch")).toHaveCount(0);
  await expect(dialog.getByRole("button")).toHaveCount(1);
  for (const viewport of [{ width: 320, height: 800 }, { width: 832, height: 384 }]) {
    await page.setViewportSize(viewport);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(dialog.getByRole("button", { name: "닫기" })).toBeVisible();
    await expect(dialog.getByRole("status")).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  expect(requests).toEqual(["/api/shares/resolve"]);
});
