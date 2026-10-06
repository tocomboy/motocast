import { expect, test } from "@playwright/test";

test("saved places tabs, region, four map layers and registration cancel work at responsive widths", async ({
  page,
}, testInfo) => {
  for (const width of [320, 384, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#home");
    await page.getByRole("button", { name: "즐겨찾기", exact: true }).click();
    const manager = page.getByRole("region", { name: "즐겨찾기", exact: true });
    await expect(manager).toContainText("곳 · 저장 장소 전체0 / 1,000");
    await manager.getByRole("button", { name: "자주 찾는 장소", exact: true }).click();
    await expect(manager.locator("p").filter({ hasText: "0 / 10" })).toContainText("자주 찾는 장소0 / 10");
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
      "현재 일정의 지점과 지도는 유지돼요.",
    );
    await spots.check();
    await restaurants.check();
    // FP01 keeps the register button in the bottom bar; FPW01 puts it next to the title.
    const add = (width >= 768 ? manager.locator("header") : manager).getByRole("button", {
      name: width >= 768 ? "장소 등록하기" : "＋ 장소 등록",
      exact: true,
    });
    await add.click();
    const dialog = page.getByRole("dialog", { name: "장소 등록", exact: true });
    await expect(dialog).toBeVisible();
    // The registration search step never lists frequent places (Issue #123).
    await expect(dialog).not.toContainText("자주 찾는 장소");
    await expect(
      dialog.getByRole("button", { name: "검색", exact: true }),
    ).toBeDisabled();
    await dialog.getByLabel("장소명 또는 주소 검색").fill("막국수");
    await expect(
      dialog.getByRole("button", { name: "검색", exact: true }),
    ).toBeEnabled();
    await dialog
      .getByRole("button", { name: "지도에서 지점 고르기", exact: true })
      .click();
    const picker = page.getByRole("dialog", {
      name: "지도에서 지점 고르기",
      exact: true,
    });
    await expect(picker).toBeVisible();
    await expect(
      picker.getByRole("button", { name: "이 지점 선택", exact: true }),
    ).toBeVisible();
    expect(
      await picker.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await picker
      .getByRole("button", { name: "지도에서 지점 고르기 뒤로", exact: true })
      .click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("장소명 또는 주소 검색")).toHaveValue("막국수");
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
    await manager
      .getByRole("button", { name: width >= 768 ? "뒤로" : "즐겨찾기 닫기", exact: true })
      .click();
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
