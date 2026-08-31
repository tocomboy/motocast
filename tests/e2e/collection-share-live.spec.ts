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
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

async function startCollectionDeletion(page: Page, collectionId: string) {
  await page.goto("/");
  const item = page.locator(`[data-collection-id="${collectionId}"]`);
  await expect(item).toHaveCount(1, { timeout: 20_000 });
  page.once("dialog", (dialog) => dialog.accept());
  const deletion = page.waitForResponse((response) => (
    response.url().includes("/rest/v1/rpc/delete_riding_collection") && response.request().method() === "POST"
  ), { timeout: 30_000 });
  await item.getByRole("button", { name: "삭제" }).click();
  const response = await deletion;
  if (!response.ok()) throw new Error("test-owned collection deletion rejected");
  return item;
}

async function startShareRevocation(page: Page, shareId: string) {
  const item = page.locator(`[data-share-id="${shareId}"]`);
  await expect(item).toHaveCount(1, { timeout: 20_000 });
  const revocation = page.waitForResponse((response) => (
    response.url().includes("/rest/v1/rpc/revoke_share") && response.request().method() === "POST"
  ), { timeout: 30_000 });
  await item.getByRole("button", { name: "링크 회수" }).click();
  const response = await revocation;
  if (!response.ok()) throw new Error("test-owned share revocation rejected");
}

async function verifyRevokedShare(page: Page, revokedUrl: string) {
  await page.evaluate((target) => window.location.assign(target), revokedUrl);
  await expect(page.getByRole("heading", { name: "공유 링크가 없거나 회수되었습니다." })).toBeVisible();
  await expect.poll(() => !page.url().includes("#")).toBe(true);
}

test("calculates, stores, publishes, revokes, and cleans up test-owned resources", async ({ page, context }) => {
  test.setTimeout(240_000);
  test.skip(!liveMutationsEnabled || !hasLiveQueries, "Requires explicit live mutation opt-in and five private place queries");
  const title = `MOTOCAST E2E ${Date.now()}`;
  let collectionMutationStarted = false;
  let collectionId: string | null = null;
  let shareMutationStarted = false;
  let activeShareId: string | null = null;
  let tripMutationStarted = false;
  let tripId: string | null = null;
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

    const finalizedTrip = page.waitForResponse((response) => (
      response.url().includes("/rest/v1/rpc/finalize_trip_plan") && response.request().method() === "POST"
    ), { timeout: 120_000 });
    tripMutationStarted = true;
    await page.getByRole("button", { name: "선택 경로 다시 계산" }).click();
    const finalizedResponse = await finalizedTrip;
    if (!finalizedResponse.ok()) {
      tripMutationStarted = false;
      throw new Error("Live trip finalization rejected");
    }
    const finalizedBody: unknown = await finalizedResponse.json();
    if (typeof finalizedBody !== "string" || !uuidPattern.test(finalizedBody)) throw new Error("Live trip cleanup identity was not returned");
    tripId = finalizedBody;
    await expect(page.locator(".live-data-badge")).toHaveText("실제 경로", { timeout: 90_000 });
    await expect(page.locator(".candidate-card")).toHaveCount(3);
    await expect(page.getByRole("list", { name: "지도 지점 표시 안내" })).toContainText(/출발/);
    await expect(page.getByRole("list", { name: "지도 지점 표시 안내" })).toContainText(/복귀/);
    await expect(page.getByRole("list", { name: "지도 지점 표시 안내" })).toContainText(/점심/);
    await expect(page.getByRole("list", { name: "지도 지점 표시 안내" })).toContainText(/휴식/);
    await expect(page.getByRole("list", { name: "지도 지점 표시 안내" })).toContainText(/와인딩/);
    await expect(page.getByRole("status").filter({ hasText: /균형 경로 날씨:/ })).toBeVisible({ timeout: 60_000 });

    await page.getByLabel("새 컬렉션 이름").fill(title);
    const savedCollection = page.waitForResponse((response) => (
      response.url().includes("/functions/v1/save-collection") && response.request().method() === "POST"
    ), { timeout: 30_000 });
    collectionMutationStarted = true;
    await page.getByRole("button", { name: /현재 경유지로 새 컬렉션 저장/ }).click();
    const savedCollectionResponse = await savedCollection;
    if (!savedCollectionResponse.ok()) {
      collectionMutationStarted = false;
      throw new Error("Live collection persistence rejected");
    }
    const savedCollectionBody: unknown = await savedCollectionResponse.json();
    const savedCollectionId = savedCollectionBody && typeof savedCollectionBody === "object"
      ? (savedCollectionBody as { collectionId?: unknown }).collectionId
      : null;
    if (typeof savedCollectionId !== "string" || !uuidPattern.test(savedCollectionId)) throw new Error("Live collection cleanup identity was not returned");
    collectionId = savedCollectionId;
    await expect(page.getByRole("status").filter({ hasText: `${title} 컬렉션의 1번째 불변 버전` })).toBeVisible();

    await page.getByRole("button", { name: "전체 공유 미리보기" }).click();
    await expect(page.getByText("아직 공개되지 않았습니다.", { exact: true })).toBeVisible();
    await expect(page.locator(".share-preview")).toContainText("예상 복귀");
    await expect(page.locator(".share-preview")).not.toContainText("희망 복귀");
    await expect(page.locator(".share-preview")).not.toContainText("최종 복귀");
    const publishedShare = page.waitForResponse((response) => (
      response.url().includes("/rest/v1/rpc/publish_trip_share") && response.request().method() === "POST"
    ), { timeout: 30_000 });
    shareMutationStarted = true;
    await page.getByRole("button", { name: "이 전체 내용 그대로 불변 링크 발행" }).click();
    const publishedShareResponse = await publishedShare;
    if (!publishedShareResponse.ok()) {
      shareMutationStarted = false;
      throw new Error("Live share publication rejected");
    }
    const publishedShareBody: unknown = await publishedShareResponse.json();
    const publishedShareId = Array.isArray(publishedShareBody) && publishedShareBody.length === 1
      ? (publishedShareBody[0] as { share_id?: unknown }).share_id
      : null;
    if (typeof publishedShareId !== "string" || !uuidPattern.test(publishedShareId)) throw new Error("Live share cleanup identity was not returned");
    activeShareId = publishedShareId;
    const issuedInput = page.getByLabel(/이번에 발행한 링크/);
    await expect(issuedInput).toBeVisible();
    const issuedUrl = await issuedInput.inputValue();
    expect(/^https:\/\/[^/]+\/share#[A-Za-z0-9_-]{43}$/.test(issuedUrl)).toBe(true);

    await startShareRevocation(page, activeShareId);
    activeShareId = null;
    shareMutationStarted = false;
    await expect(page.getByRole("status").filter({ hasText: "공유 링크를 회수했습니다." })).toBeVisible();

    await page.getByRole("button", { name: "전체 공유 미리보기" }).click();
    const republishedShare = page.waitForResponse((response) => (
      response.url().includes("/rest/v1/rpc/publish_trip_share") && response.request().method() === "POST"
    ), { timeout: 30_000 });
    shareMutationStarted = true;
    await page.getByRole("button", { name: "이 전체 내용 그대로 불변 링크 발행" }).click();
    const republishedShareResponse = await republishedShare;
    if (!republishedShareResponse.ok()) {
      shareMutationStarted = false;
      throw new Error("Live share republication rejected");
    }
    const republishedShareBody: unknown = await republishedShareResponse.json();
    const republishedShareId = Array.isArray(republishedShareBody) && republishedShareBody.length === 1
      ? (republishedShareBody[0] as { share_id?: unknown }).share_id
      : null;
    if (typeof republishedShareId !== "string" || !uuidPattern.test(republishedShareId)) throw new Error("Live reissued share cleanup identity was not returned");
    activeShareId = republishedShareId;
    await expect(issuedInput).toBeVisible();
    const reissuedUrl = await issuedInput.inputValue();
    expect(/^https:\/\/[^/]+\/share#[A-Za-z0-9_-]{43}$/.test(reissuedUrl)).toBe(true);
    expect(reissuedUrl !== issuedUrl).toBe(true);
    await startShareRevocation(page, activeShareId);
    activeShareId = null;
    shareMutationStarted = false;
    await expect(page.getByRole("status").filter({ hasText: "공유 링크를 회수했습니다." })).toBeVisible();

    const collectionItem = await startCollectionDeletion(page, collectionId);
    collectionId = null;
    collectionMutationStarted = false;
    await expect(collectionItem).toHaveCount(0);

    await verifyRevokedShare(page, issuedUrl);
    await verifyRevokedShare(page, reissuedUrl);
    if (!tripId) throw new Error("Live trip cleanup identity was not captured");
    const deleted = await page.evaluate(async (ownedTripId) => {
      const response = await fetch(`/api/trips/${ownedTripId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = await response.json().catch(() => null) as { deleted?: unknown } | null;
      return response.ok && body?.deleted === true;
    }, tripId);
    expect(deleted).toBe(true);
    tripId = null;
    tripMutationStarted = false;
    expect(browserErrorCount).toBe(0);
  } finally {
    const cleanupFailures: string[] = [];
    const cleanupPage = page.isClosed() ? await context.newPage() : page;
    if (shareMutationStarted) {
      try {
        if (!activeShareId) throw new Error("active share identity unavailable");
        await cleanupPage.goto("/");
        await startShareRevocation(cleanupPage, activeShareId);
        activeShareId = null;
        shareMutationStarted = false;
      } catch {
        cleanupFailures.push("share revoke");
      }
    }
    if (collectionMutationStarted) {
      try {
        if (!collectionId) throw new Error("collection identity unavailable");
        await startCollectionDeletion(cleanupPage, collectionId);
        collectionId = null;
        collectionMutationStarted = false;
      } catch {
        cleanupFailures.push("collection delete");
      }
    }
    if (tripMutationStarted) {
      try {
        if (!tripId) throw new Error("trip identity unavailable");
        await cleanupPage.goto("/");
        const deleted = await cleanupPage.evaluate(async (ownedTripId) => {
          const response = await fetch(`/api/trips/${ownedTripId}`, {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          const body = await response.json().catch(() => null) as { deleted?: unknown } | null;
          return response.ok && body?.deleted === true;
        }, tripId);
        if (!deleted) throw new Error("trip cleanup rejected");
        tripId = null;
        tripMutationStarted = false;
      } catch {
        cleanupFailures.push("trip delete");
      }
    }
    if (cleanupPage !== page) await cleanupPage.close();
    if (cleanupFailures.length) throw new Error(`Live cleanup failed: ${cleanupFailures.join(", ")}`);
  }
});
