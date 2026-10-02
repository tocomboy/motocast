import { expect, test } from "@playwright/test";

test("home opens dedicated favorites and registration returns with X and Escape at responsive widths", async ({ page }, testInfo) => {
  for (const width of [320, 384, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#home");
    await page.getByRole("button", { name: "즐겨찾기", exact: true }).click();
    await expect(page).toHaveURL(/#favorites$/);
    const favorites = page.getByRole("region", { name: "즐겨찾기", exact: true });
    await expect(favorites.getByRole("heading", { name: "공용 즐겨찾기 0 / 3" })).toBeVisible();
    await expect(favorites).toContainText("저장한 즐겨찾기가 없어요.");
    expect(await favorites.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const add = favorites.getByRole("button", { name: "+ 즐겨찾기 추가", exact: true });
    await add.click();
    const dialog = page.getByRole("dialog", { name: "즐겨찾기 추가", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("즐겨찾기 검색어")).toBeFocused();
    await expect(dialog.getByRole("button", { name: /로 선택$/ })).toHaveCount(0);
    await dialog.getByLabel("즐겨찾기 검색어").fill("공개 장소");
    await dialog.getByRole("button", { name: "장소 검색", exact: true }).click();
    await expect(dialog).toContainText("장소 검색 연결이 설정되지 않았습니다.");
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (width === 384) await page.screenshot({ path: testInfo.outputPath("favorites-registration-384.png") });
    await dialog.getByRole("button", { name: "즐겨찾기 추가 닫기", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(add).toBeFocused();
    if (width === 384) await page.screenshot({ path: testInfo.outputPath("favorites-empty-384.png") });
    await add.click();
    await expect(dialog.getByLabel("즐겨찾기 검색어")).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(add).toBeFocused();
    await favorites.getByRole("button", { name: "즐겨찾기에서 뒤로", exact: true }).click();
    await expect(page.getByRole("heading", { name: "오늘은 어디로 달려볼까요?" })).toBeVisible();
  }
});

test("favorites honors browser history and 320px large text without saving demo data", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/#home");
  await page.getByRole("button", { name: "즐겨찾기", exact: true }).click();
  await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
  const favorites = page.getByRole("region", { name: "즐겨찾기", exact: true });
  expect(await favorites.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await favorites.getByRole("heading", { name: "공용 즐겨찾기 0 / 3" }).evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(18);
  await favorites.getByRole("button", { name: "+ 즐겨찾기 추가", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "즐겨찾기 추가", exact: true });
  await expect(dialog).toContainText("데모 모드에서는 즐겨찾기를 저장하지 않습니다.");
  await expect(dialog.getByRole("button", { name: "즐겨찾기 추가 닫기", exact: true })).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.goBack();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "오늘은 어디로 달려볼까요?" })).toBeVisible();
  await page.goForward();
  await expect(favorites).toBeVisible();
  await expect(dialog).toBeHidden();
});
