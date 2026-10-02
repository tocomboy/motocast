import { expect, test } from "@playwright/test";

test("saved places tabs, region, four map layers and registration cancel work at responsive widths", async ({
  page,
}, testInfo) => {
  for (const width of [320, 384, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#home");
    await page.getByRole("button", { name: "즐겨찾기", exact: true }).click();
    const manager = page.getByRole("region", { name: "즐겨찾기", exact: true });
    await expect(manager).toContainText("전체 0/1,000");
    await manager.getByRole("button", { name: "자주 찾는 곳", exact: true }).click();
    await expect(manager).toContainText("자주 찾는 곳 0/5");
    await expect(
      manager.getByRole("combobox", { name: "시·도" }).getByRole("option"),
    ).toHaveCount(19);
    await manager.getByRole("button", { name: "식당", exact: true }).click();
    await expect(
      manager.getByRole("region", { name: "식당 목록" }),
    ).toBeVisible();
    const spots = manager.getByRole("checkbox", {
        name: "라이딩 스팟",
        exact: true,
      }),
      restaurants = manager.getByRole("checkbox", {
        name: "식당",
        exact: true,
      });
    await spots.uncheck();
    await restaurants.uncheck();
    await expect(manager).toContainText(
      "현재 일정의 지점과 지도는 유지됩니다.",
    );
    await spots.check();
    await restaurants.check();
    const add = manager.getByRole("button", {
      name: "＋ 장소 등록",
      exact: true,
    });
    await add.click();
    const dialog = page.getByRole("dialog", { name: "장소 등록", exact: true });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "저장 내용 확인" }),
    ).toBeDisabled();
    await dialog
      .getByRole("button", { name: "저장할 장소, 장소명 또는 주소 검색" })
      .click();
    const search = page.getByRole("dialog", {
      name: "저장할 장소 선택",
      exact: true,
    });
    await expect(search).toBeVisible();
    await search.getByRole("button", { name: "저장할 장소 검색 닫기" }).click();
    await expect(dialog).toBeVisible();
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    if (width === 384)
      await page.screenshot({
        path: testInfo.outputPath("saved-registration-384.png"),
      });
    await dialog.getByRole("button", { name: "장소 등록 닫기" }).click();
    await expect(add).toBeFocused();
    await add.click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(add).toBeFocused();
    expect(
      await manager.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    if (width === 384) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath("saved-places-384.png"),
        fullPage: true,
      });
    }
    await manager.getByRole("button", { name: "뒤로", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "오늘은 어디로 달려볼까요?" }),
    ).toBeVisible();
  }
});
test("saved places preserves browser history and large text without persisting demo data", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/#home");
  await page.getByRole("button", { name: "즐겨찾기", exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "130%";
  });
  const manager = page.getByRole("region", { name: "즐겨찾기", exact: true });
  await expect(manager).toContainText(
    "데모 모드에서는 저장 장소를 저장하지 않습니다.",
  );
  expect(await manager.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await manager
    .getByRole("button", { name: "＋ 장소 등록", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "장소 등록", exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.goBack();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "오늘은 어디로 달려볼까요?" }),
  ).toBeVisible();
  await page.goForward();
  await expect(manager).toBeVisible();
  await expect(dialog).toBeHidden();
});
