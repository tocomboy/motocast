import { expect, test, type Locator, type Page } from "@playwright/test";

import { rawSharedRideSnapshotWithOmissions } from "../fixtures/shared-ride-snapshot";

// Issue #137. The keyless local server has no Supabase client, so a fix that passes the
// accuracy and Korea checks always ends in the address-lookup failure card (B04). The
// lookup success, region and 429 cards are covered by the component tests; GPS here is
// Playwright's synthetic geolocation (LOCAL_UI).
const selectedPlace = (kakaoPlaceId: string, name: string, longitude: number) => ({
  kakaoPlaceId,
  verificationToken: "a".repeat(43),
  name,
  address: `경기도 ${name} 지번 주소`,
  roadAddress: `경기도 ${name} 도로명 주소`,
  longitude,
  latitude: 37.5,
});
const course = { origin: selectedPlace("loc-origin", "팔당역", 127.0), destination: selectedPlace("loc-destination", "양평역", 127.2), points: [] };
const seoul = { latitude: 37.5665, longitude: 126.978 };

async function openEditor(page: Page) {
  await page.route("**/api/shares/resolve", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ snapshot: rawSharedRideSnapshotWithOmissions(0) }) }));
  await page.route("**/api/shares/course", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course }) }));
  // The mobile schedule dialog is named "출발 날짜·시간" (desktop: "언제 출발할까요?").
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/share#${"a".repeat(43)}`);
  await page.getByRole("button", { name: "새 일정으로 출발" }).click();
  await page.getByRole("dialog", { name: "출발 날짜·시간" }).getByRole("button", { name: "일정 선택 닫기", exact: true }).click();
  const editor = page.locator(".shared-planner-embed .workspace.is-editor-view .planner-panel");
  await expect(editor).toBeVisible();
  return editor;
}

async function openPicker(page: Page, editor: Locator, role: "출발지" | "도착지") {
  await editor.locator(".place-picker-trigger").filter({ hasText: role === "출발지" ? "팔당역" : "양평역" }).click();
  const dialog = page.getByRole("dialog", { name: `${role} 선택` });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function expectContained(dialog: Locator) {
  expect(await dialog.evaluate((element) => {
    const card = element.querySelector<HTMLElement>(".current-location")!;
    const box = card.getBoundingClientRect();
    const frame = element.getBoundingClientRect();
    return element.scrollWidth <= element.clientWidth && card.scrollWidth <= card.clientWidth &&
      box.left >= frame.left - 1 && box.right <= frame.right + 1 && document.documentElement.scrollWidth <= window.innerWidth;
  })).toBe(true);
}

test("current location sits under the search box at every width and a denied permission keeps the origin", async ({ page }, testInfo) => {
  const editor = await openEditor(page);
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    const dialog = await openPicker(page, editor, "출발지");
    const entry = dialog.getByRole("button", { name: "현재 위치를 출발지로 설정", exact: true });
    await expect(entry).toBeVisible();
    await expect(entry).toContainText("현재 위치로 설정지금 있는 곳을 출발지로 넣어요");
    const [search, button, favorites] = await Promise.all([
      dialog.getByLabel("출발지 검색어").boundingBox(),
      entry.boundingBox(),
      dialog.getByRole("heading", { name: "자주 찾는 장소" }).boundingBox(),
    ]);
    expect(button!.y).toBeGreaterThanOrEqual(search!.y + search!.height);
    expect(favorites!.y).toBeGreaterThanOrEqual(button!.y + button!.height);
    expect(button!.height).toBeGreaterThanOrEqual(56);
    await expectContained(dialog);
    if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`a01-entry-${width}.png`) });

    // No permission was granted to this context, so the browser denies it.
    await entry.click();
    const card = dialog.locator(".current-location-card");
    await expect(card.getByRole("alert")).toHaveText("위치 권한이 필요해요");
    await expect(card).toContainText("브라우저 주소창의 사이트 설정에서 위치를 허용한 뒤 다시 시도해 주세요.");
    await expect(card).toContainText("출발지는 그대로예요 · 팔당역");
    await expect(card).toHaveClass(/is-settings/);
    await expect(card.getByRole("button", { name: "다시 시도", exact: true })).toBeFocused();
    await expect(dialog.getByLabel("출발지 검색어")).toBeEnabled();
    await expectContained(dialog);
    if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`mw-permission-${width}.png`) });
    await dialog.getByRole("button", { name: "출발지 검색 닫기" }).first().click();
    await expect(dialog).toBeHidden();
    await expect(editor.locator(".place-picker-trigger").first()).toContainText("팔당역");
  }
  await expect(page.locator(".current-location-applied")).toHaveCount(0);
});

test("an inaccurate fix is not applied and retry reads a fresh fix", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  const editor = await openEditor(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await context.setGeolocation({ ...seoul, accuracy: 900 });
  const dialog = await openPicker(page, editor, "출발지");
  await dialog.getByRole("button", { name: "현재 위치를 출발지로 설정", exact: true }).click();
  const card = dialog.locator(".current-location-card");
  await expect(card.getByRole("alert")).toHaveText("현재 위치를 정확히 잡지 못했어요");
  await expect(card).toHaveClass(/is-failed/);
  await expect(card).toContainText("출발지는 그대로예요 · 팔당역");
  await page.screenshot({ path: test.info().outputPath("b03-accuracy-390.png") });
  // Within a minute the browser may answer the first read from its cache; retry may not.
  await context.setGeolocation({ latitude: 35.6762, longitude: 139.6503, accuracy: 10 });
  await card.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(card.getByRole("alert")).toHaveText("한국 안에서만 쓸 수 있어요");
  await dialog.getByRole("button", { name: "출발지 검색 닫기" }).first().click();
  await expect(editor.locator(".place-picker-trigger").first()).toContainText("팔당역");
});

test("a fix outside Korea is blocked before any lookup", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 35.6762, longitude: 139.6503, accuracy: 10 });
  const editor = await openEditor(page);
  const dialog = await openPicker(page, editor, "도착지");
  await expect(dialog.locator(".current-location-card")).toHaveCount(0);
  await dialog.getByRole("button", { name: "현재 위치를 도착지로 설정", exact: true }).click();
  const card = dialog.locator(".current-location-card");
  await expect(card.getByRole("alert")).toHaveText("한국 안에서만 쓸 수 있어요");
  await expect(card).toContainText("도착지는 그대로예요 · 양평역");
  await expect(card.getByRole("button")).toHaveCount(0);
  await dialog.getByRole("button", { name: "도착지 검색 닫기" }).first().click();
  await expect(editor.locator(".place-picker-trigger").last()).toContainText("양평역");
});

test("a usable fix reaches the address lookup and its failure keeps the destination (keyless B04)", async ({ page, context }, testInfo) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ ...seoul, accuracy: 30 });
  const editor = await openEditor(page);
  for (const [width, height] of [[390, 844], [1440, 900], [1440, 720]]) {
    await page.setViewportSize({ width, height });
    const dialog = await openPicker(page, editor, "도착지");
    await dialog.getByRole("button", { name: "현재 위치를 도착지로 설정", exact: true }).click();
    const card = dialog.locator(".current-location-card");
    await expect(card.getByRole("alert")).toHaveText("현재 위치의 주소를 확인하지 못했어요");
    await expect(card).toContainText("도착지는 그대로예요 · 양평역");
    await expect(card.getByRole("button", { name: "다시 시도", exact: true })).toBeVisible();
    await expectContained(dialog);
    // The added card must not push the picker's own controls out of a short window.
    expect(await dialog.evaluate((element) => {
      const frame = element.getBoundingClientRect();
      const clear = element.querySelector(".current-place-clear")!.getBoundingClientRect();
      return frame.bottom <= window.innerHeight + 1 && clear.bottom <= frame.bottom + 1;
    })).toBe(true);
    if (height !== 720) await page.screenshot({ path: testInfo.outputPath(`b04-lookup-${width}.png`) });
    await dialog.getByRole("button", { name: "도착지 검색 닫기" }).first().click();
  }
  await expect(editor.locator(".place-picker-trigger").last()).toContainText("양평역");
});

test("waypoint selection does not offer current location", async ({ page }) => {
  const editor = await openEditor(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.getByRole("button", { name: "+ 경유지 추가", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "경유지 설정" });
  await settings.getByRole("button", { name: "통과", exact: true }).click();
  await settings.getByRole("button", { name: "추가하고 장소 선택", exact: true }).click();
  const waypointPicker = page.locator("dialog.place-picker-dialog[open]");
  await expect(waypointPicker).toBeVisible();
  await expect(waypointPicker.getByLabel(/검색어$/)).toBeVisible();
  await expect(waypointPicker.getByRole("button", { name: /현재 위치/ })).toHaveCount(0);
  await expect(waypointPicker.locator(".current-location")).toHaveCount(0);
});

test("while locating, search and frequent places are locked and cancel or back drops the late fix", async ({ page }, testInfo) => {
  // Hold the browser's answer so the in-progress card (A02) can be observed and cancelled.
  await page.addInitScript(() => {
    const held: PositionCallback[] = [];
    Object.assign(window, { heldFixes: held });
    navigator.geolocation.getCurrentPosition = (success) => { held.push(success); };
  });
  const editor = await openEditor(page);
  const deliverHeldFixes = () => page.evaluate(({ latitude, longitude }) => {
    for (const success of (window as unknown as { heldFixes: PositionCallback[] }).heldFixes.splice(0)) {
      success({ coords: { latitude, longitude, accuracy: 20 }, timestamp: Date.now() } as GeolocationPosition);
    }
  }, seoul);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    const dialog = await openPicker(page, editor, "출발지");
    const entry = dialog.getByRole("button", { name: "현재 위치를 출발지로 설정", exact: true });
    await entry.click();
    const card = dialog.locator(".current-location-card");
    await expect(card).toContainText("현재 위치현재 위치를 확인하고 있어요");
    await expect(card).toContainText("출발지는 아직 바뀌지 않았어요.");
    await expect(card.getByRole("progressbar")).toBeVisible();
    await expect(card.getByRole("button", { name: "취소", exact: true })).toBeFocused();
    await expect(dialog.getByLabel("출발지 검색어")).toBeDisabled();
    await expect(dialog.locator(".place-favorites .place-saved-all")).toBeDisabled();
    expect(await dialog.locator(".place-favorites").evaluate((element) => getComputedStyle(element).opacity)).toBe("0.4");
    await expectContained(dialog);
    await page.screenshot({ path: testInfo.outputPath(`a02-locating-${width}.png`) });

    await card.getByRole("button", { name: "취소", exact: true }).click();
    await expect(entry).toBeFocused();
    await expect(dialog.getByLabel("출발지 검색어")).toBeEnabled();
    await deliverHeldFixes();
    await expect(dialog.locator(".current-location-card")).toHaveCount(0);

    if (width === 390) {
      // Mobile back (and Escape) cancels the request and stays in the picker.
      await entry.click();
      await expect(card).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await expect(entry).toBeVisible();
      await deliverHeldFixes();
      await expect(dialog.locator(".current-location-card")).toHaveCount(0);
    }
    await dialog.getByRole("button", { name: "출발지 검색 닫기" }).first().click();
    await expect(editor.locator(".place-picker-trigger").first()).toContainText("팔당역");
  }
});
