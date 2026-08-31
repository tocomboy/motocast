import { expect, type Page, test } from "@playwright/test";

const liveMutationsEnabled = process.env.MOTOCAST_E2E_LIVE_MUTATIONS === "1";
const liveQueries = {
  origin: process.env.MOTOCAST_E2E_ORIGIN_QUERY?.trim(),
  destination: process.env.MOTOCAST_E2E_DESTINATION_QUERY?.trim(),
  lunch: process.env.MOTOCAST_E2E_LUNCH_QUERY?.trim(),
  rest: process.env.MOTOCAST_E2E_REST_QUERY?.trim(),
  winding: process.env.MOTOCAST_E2E_WINDING_QUERY?.trim(),
};
const hasLiveQueries = Object.values(liveQueries).every(Boolean);

// Share URLs are bearer credentials. Disable browser artifacts for this file so
// a failure cannot persist a published token in a trace, screenshot, or video.
test.use({ screenshot: "off", trace: "off", video: "off" });

async function selectFirstPlace(page: Page, label: string, query: string) {
  const input = page.getByLabel(new RegExp(`^${label}(?: · 필수)?$`));
  await input.fill(query);
  await input.press("Enter");
  const results = page.getByRole("list", { name: `${label} 검색 결과` });
  await expect(results).toBeVisible({ timeout: 20_000 });
  await results.getByRole("button").first().click();
  await expect(input).toHaveAttribute("aria-invalid", "false");
}

async function removeCreatedCollection(page: Page, title: string) {
  await page.goto("/");
  const item = page.locator(".collection-list li").filter({ hasText: title });
  if (await item.count()) {
    page.once("dialog", (dialog) => dialog.accept());
    await item.getByRole("button", { name: "삭제" }).click();
    await expect(item).toHaveCount(0);
  }
}

test("calculates, stores, publishes, revokes, and cleans up test-owned resources", async ({ page }) => {
  test.skip(!liveMutationsEnabled || !hasLiveQueries, "Requires explicit live mutation opt-in and five private place queries");
  const title = `MOTOCAST E2E ${Date.now()}`;
  let collectionCreated = false;
  let sharePublished = false;
  let browserErrorCount = 0;
  page.on("pageerror", () => { browserErrorCount += 1; });
  page.on("console", (message) => { if (message.type() === "error") browserErrorCount += 1; });

  try {
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    await selectFirstPlace(page, "출발지", liveQueries.origin!);
    await selectFirstPlace(page, "복귀지", liveQueries.destination!);
    await selectFirstPlace(page, "점심", liveQueries.lunch!);
    await page.getByRole("checkbox", { name: /휴식 일정에 포함/ }).check();
    await selectFirstPlace(page, "휴식 장소", liveQueries.rest!);
    await page.getByRole("button", { name: /커스텀 와인딩 경유지 추가/ }).click();
    await selectFirstPlace(page, "와인딩 경유지", liveQueries.winding!);

    await page.getByRole("button", { name: "선택 경로 다시 계산" }).click();
    await expect(page.locator(".live-data-badge")).toHaveText("실제 경로", { timeout: 90_000 });
    await expect(page.locator(".candidate-card")).toHaveCount(3);
    await expect(page.getByRole("list", { name: "지도 지점 표시 안내" })).toContainText(/출발/);
    await expect(page.getByRole("list", { name: "지도 지점 표시 안내" })).toContainText(/복귀/);
    await expect(page.getByRole("list", { name: "지도 지점 표시 안내" })).toContainText(/점심/);
    await expect(page.getByRole("list", { name: "지도 지점 표시 안내" })).toContainText(/휴식/);
    await expect(page.getByRole("list", { name: "지도 지점 표시 안내" })).toContainText(/와인딩/);
    await expect(page.getByRole("status").filter({ hasText: /균형 경로 날씨:/ })).toBeVisible({ timeout: 60_000 });

    await page.getByLabel("새 컬렉션 이름").fill(title);
    await page.getByRole("button", { name: /현재 경유지로 새 컬렉션 저장/ }).click();
    await expect(page.getByRole("status").filter({ hasText: `${title} 컬렉션의 1번째 불변 버전` })).toBeVisible();
    collectionCreated = true;

    await page.getByRole("button", { name: "전체 공유 미리보기" }).click();
    await expect(page.getByText("아직 공개되지 않았습니다.", { exact: true })).toBeVisible();
    await expect(page.locator(".share-preview")).toContainText("예상 복귀");
    await expect(page.locator(".share-preview")).not.toContainText("희망 복귀");
    await expect(page.locator(".share-preview")).not.toContainText("최종 복귀");
    await page.getByRole("button", { name: "이 전체 내용 그대로 불변 링크 발행" }).click();
    const issuedInput = page.getByLabel(/이번에 발행한 링크/);
    await expect(issuedInput).toBeVisible();
    const issuedUrl = await issuedInput.inputValue();
    expect(issuedUrl).toMatch(/^https:\/\/[^/]+\/share#[A-Za-z0-9_-]{43}$/);
    sharePublished = true;

    await page.getByRole("button", { name: "링크 회수" }).first().click();
    await expect(page.getByRole("status").filter({ hasText: "공유 링크를 회수했습니다." })).toBeVisible();
    sharePublished = false;

    await page.getByRole("button", { name: "전체 공유 미리보기" }).click();
    await page.getByRole("button", { name: "이 전체 내용 그대로 불변 링크 발행" }).click();
    await expect(issuedInput).toBeVisible();
    const reissuedUrl = await issuedInput.inputValue();
    expect(reissuedUrl).toMatch(/^https:\/\/[^/]+\/share#[A-Za-z0-9_-]{43}$/);
    expect(reissuedUrl).not.toBe(issuedUrl);
    sharePublished = true;
    await page.getByRole("button", { name: "링크 회수" }).first().click();
    await expect(page.getByRole("status").filter({ hasText: "공유 링크를 회수했습니다." })).toBeVisible();
    sharePublished = false;

    await removeCreatedCollection(page, title);
    collectionCreated = false;

    await page.goto(issuedUrl);
    await expect(page.getByRole("heading", { name: "공유 링크가 없거나 회수되었습니다." })).toBeVisible();
    await expect.poll(() => page.url()).not.toContain("#");
    await page.goto(reissuedUrl);
    await expect(page.getByRole("heading", { name: "공유 링크가 없거나 회수되었습니다." })).toBeVisible();
    await expect.poll(() => page.url()).not.toContain("#");
    expect(browserErrorCount).toBe(0);
  } finally {
    if (page.isClosed()) return;
    if (sharePublished) {
      await page.goto("/").catch(() => undefined);
      const revoke = page.getByRole("button", { name: "링크 회수" }).first();
      if (await revoke.count()) await revoke.click().catch(() => undefined);
    }
    if (collectionCreated) await removeCreatedCollection(page, title).catch(() => undefined);
  }
});
