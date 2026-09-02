import { expect, type Page, test } from "@playwright/test";

const liveMutationsEnabled = process.env.MOTOCAST_E2E_LIVE_MUTATIONS === "1";
const liveQueries = {
  origin: process.env.MOTOCAST_E2E_ORIGIN_QUERY?.trim(),
  destination: process.env.MOTOCAST_E2E_DESTINATION_QUERY?.trim(),
  lunch: process.env.MOTOCAST_E2E_LUNCH_QUERY?.trim(),
  rest: process.env.MOTOCAST_E2E_REST_QUERY?.trim(),
  waypoint: process.env.MOTOCAST_E2E_WAYPOINT_QUERY?.trim() ?? process.env.MOTOCAST_E2E_WINDING_QUERY?.trim(),
};
const hasLiveQueries = Object.values(liveQueries).every(Boolean);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LiveCleanupState = {
  collectionMutationStarted: boolean;
  collectionId: string | null;
  shareMutationStarted: boolean;
  activeShareId: string | null;
  tripMutationStarted: boolean;
  tripId: string | null;
};

let pendingCleanup: LiveCleanupState | null = null;

// Share URLs are bearer credentials. Disable browser artifacts for this file so
// a failure cannot persist a published token in a trace, screenshot, or video.
test.use({ screenshot: "off", trace: "off", video: "off" });

function seoulDepartureIn(minutesAhead: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(Date.now() + minutesAhead * 60_000));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const hour = value("hour");
  const minute = value("minute");
  if (!year || !month || !day || !hour || !minute) throw new Error("Failed to derive a Seoul test departure");
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

async function selectFirstPlace(
  page: Page,
  label: string,
  query: string,
  selectedListName?: string,
) {
  const input = page.getByLabel(new RegExp(`^${label}(?: · 필수)?$`));
  await input.fill(query);
  await input.press("Enter");
  const results = page.getByRole("list", { name: `${label} 검색 결과` });
  await expect(results).toBeVisible({ timeout: 20_000 });
  const firstResult = results.getByRole("button").first();
  const selectedName = (await firstResult.locator("strong").innerText()).trim();
  await firstResult.click();
  if (selectedListName) {
    await expect(
      page.getByRole("list", { name: selectedListName }).getByText(selectedName, { exact: true }),
    ).toBeVisible();
  } else {
    await expect(input).toHaveAttribute("aria-invalid", "false");
  }
  return selectedName;
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

async function deleteOwnedTrip(page: Page, tripId: string) {
  return page.evaluate(async (ownedTripId) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`/api/trips/${ownedTripId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null) as { deleted?: unknown } | null;
      return response.ok && body?.deleted === true;
    } finally {
      window.clearTimeout(timeout);
    }
  }, tripId);
}

test.afterEach(async ({ context }, testInfo) => {
  // The three worst-case cleanup paths total 180 seconds; keep another full
  // minute for page creation/closure and Playwright hook bookkeeping.
  testInfo.setTimeout(240_000);
  const cleanup = pendingCleanup;
  pendingCleanup = null;
  if (!cleanup) return;
  if (!cleanup.shareMutationStarted && !cleanup.collectionMutationStarted && !cleanup.tripMutationStarted) return;

  const cleanupFailures: string[] = [];
  const cleanupPage = await context.newPage();
  cleanupPage.setDefaultTimeout(20_000);
  cleanupPage.setDefaultNavigationTimeout(20_000);
  try {
    if (cleanup.shareMutationStarted) {
      try {
        if (!cleanup.activeShareId) throw new Error("active share identity unavailable");
        await cleanupPage.goto("/");
        await startShareRevocation(cleanupPage, cleanup.activeShareId);
        cleanup.activeShareId = null;
        cleanup.shareMutationStarted = false;
      } catch {
        cleanupFailures.push("share revoke");
      }
    }
    if (cleanup.collectionMutationStarted) {
      try {
        if (!cleanup.collectionId) throw new Error("collection identity unavailable");
        await startCollectionDeletion(cleanupPage, cleanup.collectionId);
        cleanup.collectionId = null;
        cleanup.collectionMutationStarted = false;
      } catch {
        cleanupFailures.push("collection delete");
      }
    }
    if (cleanup.tripMutationStarted) {
      try {
        if (!cleanup.tripId) throw new Error("trip identity unavailable");
        await cleanupPage.goto("/");
        const deleted = await deleteOwnedTrip(cleanupPage, cleanup.tripId);
        if (!deleted) throw new Error("trip cleanup rejected");
        cleanup.tripId = null;
        cleanup.tripMutationStarted = false;
      } catch {
        cleanupFailures.push("trip delete");
      }
    }
  } finally {
    await cleanupPage.close();
  }
  if (cleanupFailures.length) throw new Error(`Live cleanup failed: ${cleanupFailures.join(", ")}`);
});

test("calculates, stores, publishes, revokes, and cleans up test-owned resources", async ({ page }) => {
  test.setTimeout(360_000);
  test.skip(!liveMutationsEnabled || !hasLiveQueries, "Requires explicit live mutation opt-in and five place queries");
  const title = `MOTOCAST E2E ${Date.now()}`;
  const cleanup: LiveCleanupState = {
    collectionMutationStarted: false,
    collectionId: null,
    shareMutationStarted: false,
    activeShareId: null,
    tripMutationStarted: false,
    tripId: null,
  };
  pendingCleanup = cleanup;
  let browserErrorCount = 0;
  let planRouteRequestCount = 0;
  let finalizeRequestCount = 0;
  let weatherRequestCount = 0;
  let previewRequestCount = 0;
  let publishRequestCount = 0;
  page.on("pageerror", () => { browserErrorCount += 1; });
  page.on("console", (message) => { if (message.type() === "error") browserErrorCount += 1; });
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (request.url().includes("/functions/v1/plan-route")) planRouteRequestCount += 1;
    if (request.url().includes("/rest/v1/rpc/finalize_trip_plan")) finalizeRequestCount += 1;
    if (request.url().includes("/functions/v1/weather-timeline")) weatherRequestCount += 1;
    if (request.url().includes("/rest/v1/rpc/preview_trip_share")) previewRequestCount += 1;
    if (request.url().includes("/rest/v1/rpc/publish_trip_share")) publishRequestCount += 1;
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    await page.getByRole("button", { name: "계획 수정" }).click();
    await expect(page.getByRole("dialog", { name: "라이딩 계획 편집" })).toBeVisible();
    const departure = seoulDepartureIn(30);
    await page.getByLabel("라이딩 날짜").fill(departure.date);
    await page.getByLabel("출발", { exact: true }).fill(departure.time);
    await selectFirstPlace(page, "출발지", liveQueries.origin!);
    await selectFirstPlace(page, "복귀지", liveQueries.destination!);
    const waypointType = page.getByLabel("추가할 종류");
    const addWaypoint = page.getByRole("button", { name: /^\+ 경유지 추가/ });
    await waypointType.selectOption("lunch");
    await addWaypoint.click();
    await expect(page.getByLabel("1번째 점심 장소")).toBeFocused();
    const lunchName = await selectFirstPlace(page, "1번째 점심 장소", liveQueries.lunch!);
    await waypointType.selectOption("waypoint");
    await addWaypoint.click();
    await expect(page.getByLabel("2번째 경유지 장소")).toBeFocused();
    const waypointName = await selectFirstPlace(page, "2번째 경유지 장소", liveQueries.waypoint!);
    await page.getByRole("button", { name: "2번째 경유지 위로 이동" }).click();
    await expect(page.getByRole("button", { name: "1번째 경유지 위로 이동" })).toBeFocused();
    await page.getByRole("button", { name: "1번째 경유지 아래로 이동" }).click();
    await expect(page.getByRole("button", { name: "2번째 경유지 아래로 이동" })).toBeFocused();
    await waypointType.selectOption("rest");
    await addWaypoint.click();
    await expect(page.getByLabel("3번째 휴식 장소")).toBeFocused();
    const restName = await selectFirstPlace(page, "3번째 휴식 장소", liveQueries.rest!);
    const thirdRole = page.getByLabel("3번째 경유지 종류");
    await thirdRole.selectOption("lunch");
    const duplicateRoleError = page.getByRole("alert");
    await expect(duplicateRoleError).toBeFocused();
    await expect(duplicateRoleError).toContainText("점심은 하나만 추가할 수 있습니다.");
    await expect(thirdRole).toHaveValue("rest");
    await thirdRole.selectOption("dinner");
    await expect(page.getByLabel("3번째 저녁 머무는 시간 · 분")).toHaveValue("60");
    await thirdRole.selectOption("rest");
    await expect(page.getByLabel("3번째 휴식 머무는 시간 · 분")).toHaveValue("30");
    const orderedItems = page.getByRole("list", { name: "경유지 방문 순서" }).getByRole("listitem");
    await expect(orderedItems.nth(0)).toContainText(lunchName);
    await expect(orderedItems.nth(1)).toContainText(waypointName);
    await expect(orderedItems.nth(2)).toContainText(restName);

    for (const viewport of [
      { width: 320, height: 800 },
      { width: 390, height: 844 },
      { width: 820, height: 1180 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      const cards = page.locator(".ordered-waypoint");
      await expect(cards).toHaveCount(3);
      expect(await cards.evaluateAll((items) => items.every((item) => (
        item.scrollWidth <= item.clientWidth && item.getBoundingClientRect().right <= window.innerWidth
      )))).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });

    const plannedRoute = page.waitForRequest((request) => (
      request.url().includes("/functions/v1/plan-route") && request.method() === "POST"
    ), { timeout: 120_000 });
    const finalizationStarted = page.waitForRequest((request) => (
      request.url().includes("/rest/v1/rpc/finalize_trip_plan") && request.method() === "POST"
    ), { timeout: 120_000 });
    const finalizedTrip = page.waitForResponse((response) => (
      response.url().includes("/rest/v1/rpc/finalize_trip_plan") && response.request().method() === "POST"
    ), { timeout: 120_000 });
    await page.getByRole("button", { name: "추천 경로 다시 계산" }).click();
    const plannedRouteBody = (await plannedRoute).postDataJSON() as {
      waypoints?: Array<{ id: string; stopRole?: string; dwellMinutes: number }>;
    };
    const expectedWaypointSequence = plannedRouteBody.waypoints?.map((point) => ({
      id: point.id,
      role: point.stopRole ?? "waypoint",
      dwellMinutes: point.dwellMinutes,
    }));
    expect(expectedWaypointSequence?.map((point) => point.role)).toEqual(["lunch", "waypoint", "rest"]);
    await finalizationStarted;
    cleanup.tripMutationStarted = true;
    const finalizedResponse = await finalizedTrip;
    if (!finalizedResponse.ok()) {
      throw new Error("Live trip finalization rejected");
    }
    const finalizedBody: unknown = await finalizedResponse.json();
    if (typeof finalizedBody !== "string" || !uuidPattern.test(finalizedBody)) throw new Error("Live trip cleanup identity was not returned");
    cleanup.tripId = finalizedBody;
    await expect(page.locator(".live-data-badge")).toHaveText("실제 경로", { timeout: 90_000 });
    await expect(page.locator(".candidate-card")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "지도 지점 표시 안내" })).toContainText(/출발/);
    await expect(page.getByRole("list", { name: "지도 지점 표시 안내" })).toContainText(/복귀/);
    await expect(page.getByRole("list", { name: "지도 지점 표시 안내" })).toContainText(/점심/);
    await expect(page.getByRole("list", { name: "지도 지점 표시 안내" })).toContainText(/휴식/);
    await expect(page.getByRole("list", { name: "지도 지점 표시 안내" })).toContainText(/경유/);
    await expect(page.getByRole("status").filter({ hasText: /추천 경로 날씨:/ })).toBeVisible({ timeout: 60_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByRole("list", { name: "지도 지점 표시 안내" })).toContainText(/경유/);
    await expect(page.locator(".live-data-badge")).toHaveText("실제 경로");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

    await page.getByLabel("새 컬렉션 이름").fill(title);
    const collectionSaveStarted = page.waitForRequest((request) => (
      request.url().includes("/functions/v1/save-collection") && request.method() === "POST"
    ), { timeout: 30_000 });
    const savedCollection = page.waitForResponse((response) => (
      response.url().includes("/functions/v1/save-collection") && response.request().method() === "POST"
    ), { timeout: 30_000 });
    await page.getByRole("button", { name: /현재 전체 코스로 새 컬렉션 저장/ }).click();
    await collectionSaveStarted;
    cleanup.collectionMutationStarted = true;
    const savedCollectionResponse = await savedCollection;
    if (!savedCollectionResponse.ok()) {
      throw new Error("Live collection persistence rejected");
    }
    const savedCollectionBody: unknown = await savedCollectionResponse.json();
    const savedCollectionId = savedCollectionBody && typeof savedCollectionBody === "object"
      ? (savedCollectionBody as { collectionId?: unknown }).collectionId
      : null;
    if (typeof savedCollectionId !== "string" || !uuidPattern.test(savedCollectionId)) throw new Error("Live collection cleanup identity was not returned");
    cleanup.collectionId = savedCollectionId;
    await expect(page.getByRole("status").filter({ hasText: `${title} 컬렉션의 1번째 불변 버전` })).toBeVisible();

    const restDwell = page.getByLabel("3번째 휴식 머무는 시간 · 분");
    await restDwell.fill("45");
    await expect(restDwell).toHaveValue("45");

    const routeCountBeforePreparation = planRouteRequestCount;
    const finalizeCountBeforePreparation = finalizeRequestCount;
    const weatherCountBeforePreparation = weatherRequestCount;
    const previewCountBeforePreparation = previewRequestCount;
    const publishCountBeforePreparation = publishRequestCount;
    const collectionItem = page.locator(`[data-collection-id="${cleanup.collectionId}"]`);
    await collectionItem.getByRole("button", { name: `${title} 공유 준비` }).click();
    const manualPreviewButton = page.getByRole("button", { name: "공유 요약 미리보기" });
    await expect(manualPreviewButton).toBeDisabled();
    await expect(page.locator(".share-preview")).toHaveCount(0);
    await expect(restDwell).toHaveValue("30");
    await expect(orderedItems.nth(0)).toContainText(lunchName);
    await expect(orderedItems.nth(1)).toContainText(waypointName);
    await expect(orderedItems.nth(2)).toContainText(restName);
    await expect(page.getByLabel("1번째 경유지 종류")).toHaveValue("lunch");
    await expect(page.getByLabel("2번째 경유지 종류")).toHaveValue("waypoint");
    await expect(page.getByLabel("3번째 경유지 종류")).toHaveValue("rest");
    await expect(page.getByLabel("3번째 휴식 머무는 시간 · 분")).toHaveValue("30");
    expect(planRouteRequestCount).toBe(routeCountBeforePreparation);
    expect(finalizeRequestCount).toBe(finalizeCountBeforePreparation);
    expect(weatherRequestCount).toBe(weatherCountBeforePreparation);
    expect(previewRequestCount).toBe(previewCountBeforePreparation);
    expect(publishRequestCount).toBe(publishCountBeforePreparation);

    const preparedRouteRequest = page.waitForRequest((request) => (
      request.url().includes("/functions/v1/plan-route") && request.method() === "POST"
    ), { timeout: 120_000 });
    const preparedRoute = page.waitForResponse((response) => (
      response.url().includes("/functions/v1/plan-route") && response.request().method() === "POST"
    ), { timeout: 120_000 });
    const preparedFinalization = page.waitForResponse((response) => (
      response.url().includes("/rest/v1/rpc/finalize_trip_plan") && response.request().method() === "POST"
    ), { timeout: 120_000 });
    const preparedWeather = page.waitForResponse((response) => (
      response.url().includes("/functions/v1/weather-timeline") && response.request().method() === "POST"
    ), { timeout: 120_000 });
    const preparedPreview = page.waitForResponse((response) => (
      response.url().includes("/rest/v1/rpc/preview_trip_share") && response.request().method() === "POST"
    ), { timeout: 120_000 });
    await page.getByRole("button", { name: "추천 경로 다시 계산" }).click();
    const preparedRouteBody = (await preparedRouteRequest).postDataJSON() as {
      waypoints?: Array<{ id: string; stopRole?: string; dwellMinutes: number }>;
    };
    expect(preparedRouteBody.waypoints?.map((point) => ({
      id: point.id,
      role: point.stopRole ?? "waypoint",
      dwellMinutes: point.dwellMinutes,
    }))).toEqual(expectedWaypointSequence);
    const preparedResponses = await Promise.all([preparedRoute, preparedFinalization, preparedWeather, preparedPreview]);
    if (preparedResponses.some((response) => !response.ok())) throw new Error("Collection share preparation rejected");
    const preparedTripId: unknown = await preparedResponses[1].json();
    if (preparedTripId !== cleanup.tripId) throw new Error("Collection share preparation replaced the owned trip identity");
    expect(planRouteRequestCount).toBe(routeCountBeforePreparation + 1);
    expect(finalizeRequestCount).toBe(finalizeCountBeforePreparation + 1);
    expect(weatherRequestCount).toBe(weatherCountBeforePreparation + 1);
    expect(previewRequestCount).toBe(previewCountBeforePreparation + 1);
    expect(publishRequestCount).toBe(publishCountBeforePreparation);

    await expect(page.getByText("아직 공개되지 않았습니다.", { exact: true })).toBeVisible();
    const sharedLegs = page.locator(".share-preview .shared-legs li");
    await expect(sharedLegs.nth(0)).toContainText(lunchName);
    await expect(sharedLegs.nth(1)).toContainText(waypointName);
    await expect(sharedLegs.nth(2)).toContainText(restName);
    await expect(page.locator(".share-preview")).toContainText("예상 복귀");
    await expect(page.locator(".share-preview")).not.toContainText("희망 복귀");
    await expect(page.locator(".share-preview")).not.toContainText("최종 복귀");
    await expect(page.locator(".share-preview")).not.toContainText("선택 경로 미통과");

    for (const viewport of [
      { width: 320, height: 800 },
      { width: 390, height: 844 },
      { width: 820, height: 1180 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      if (viewport.width <= 820) {
        const dialog = page.getByRole("dialog", { name: "라이딩 계획 편집" });
        if (await dialog.isVisible()) await page.keyboard.press("Escape");
      }
      await page.locator(".management-grid").scrollIntoViewIfNeeded();
      await expect(page.getByRole("heading", { name: "라이딩 컬렉션" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "라이딩 공유" })).toBeVisible();
      await expect(collectionItem).toBeVisible();
      await expect(page.locator(".share-preview")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    const sharePublishStarted = page.waitForRequest((request) => (
      request.url().includes("/rest/v1/rpc/publish_trip_share") && request.method() === "POST"
    ), { timeout: 30_000 });
    const publishedShare = page.waitForResponse((response) => (
      response.url().includes("/rest/v1/rpc/publish_trip_share") && response.request().method() === "POST"
    ), { timeout: 30_000 });
    await page.getByRole("button", { name: "이 요약으로 불변 링크 발행" }).click();
    await sharePublishStarted;
    cleanup.shareMutationStarted = true;
    const publishedShareResponse = await publishedShare;
    if (!publishedShareResponse.ok()) {
      throw new Error("Live share publication rejected");
    }
    const publishedShareBody: unknown = await publishedShareResponse.json();
    const publishedShareId = Array.isArray(publishedShareBody) && publishedShareBody.length === 1
      ? (publishedShareBody[0] as { share_id?: unknown }).share_id
      : null;
    if (typeof publishedShareId !== "string" || !uuidPattern.test(publishedShareId)) throw new Error("Live share cleanup identity was not returned");
    cleanup.activeShareId = publishedShareId;
    const issuedInput = page.getByLabel(/이번에 발행한 링크/);
    await expect(issuedInput).toBeVisible();
    const issuedUrl = await issuedInput.inputValue();
    expect(/^https:\/\/[^/]+\/share#[A-Za-z0-9_-]{43}$/.test(issuedUrl)).toBe(true);

    await startShareRevocation(page, cleanup.activeShareId);
    cleanup.activeShareId = null;
    cleanup.shareMutationStarted = false;
    await expect(page.getByRole("status").filter({ hasText: "공유 링크를 회수했습니다." })).toBeVisible();

    await page.getByRole("button", { name: "공유 요약 미리보기" }).click();
    const shareRepublishStarted = page.waitForRequest((request) => (
      request.url().includes("/rest/v1/rpc/publish_trip_share") && request.method() === "POST"
    ), { timeout: 30_000 });
    const republishedShare = page.waitForResponse((response) => (
      response.url().includes("/rest/v1/rpc/publish_trip_share") && response.request().method() === "POST"
    ), { timeout: 30_000 });
    await page.getByRole("button", { name: "이 요약으로 불변 링크 발행" }).click();
    await shareRepublishStarted;
    cleanup.shareMutationStarted = true;
    const republishedShareResponse = await republishedShare;
    if (!republishedShareResponse.ok()) {
      throw new Error("Live share republication rejected");
    }
    const republishedShareBody: unknown = await republishedShareResponse.json();
    const republishedShareId = Array.isArray(republishedShareBody) && republishedShareBody.length === 1
      ? (republishedShareBody[0] as { share_id?: unknown }).share_id
      : null;
    if (typeof republishedShareId !== "string" || !uuidPattern.test(republishedShareId)) throw new Error("Live reissued share cleanup identity was not returned");
    cleanup.activeShareId = republishedShareId;
    await expect(issuedInput).toBeVisible();
    const reissuedUrl = await issuedInput.inputValue();
    expect(/^https:\/\/[^/]+\/share#[A-Za-z0-9_-]{43}$/.test(reissuedUrl)).toBe(true);
    expect(reissuedUrl !== issuedUrl).toBe(true);
    await startShareRevocation(page, cleanup.activeShareId);
    cleanup.activeShareId = null;
    cleanup.shareMutationStarted = false;
    await expect(page.getByRole("status").filter({ hasText: "공유 링크를 회수했습니다." })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "계획 수정" }).click();
    const plannerDialog = page.getByRole("dialog", { name: "라이딩 계획 편집" });
    await expect(plannerDialog).toBeVisible();
    const addRest = plannerDialog.getByRole("button", { name: /^\+ 경유지 추가/ });
    await plannerDialog.getByLabel("추가할 종류").selectOption("rest");
    for (let index = 0; index < 4; index += 1) await addRest.click();
    await addRest.click();
    const restLimitError = plannerDialog.getByRole("alert");
    await expect(restLimitError).toBeFocused();
    await expect(restLimitError).toContainText("휴식은 최대 5개까지 추가할 수 있습니다.");
    await expect(plannerDialog.getByLabel("추가할 종류")).toHaveValue("rest");
    const firstRestDwell = plannerDialog.getByLabel("3번째 휴식 머무는 시간 · 분");
    await firstRestDwell.fill("45");
    await expect(firstRestDwell).toHaveValue("45");
    await plannerDialog.getByRole("button", { name: "4번째 휴식 위로 이동" }).click();
    await plannerDialog.getByRole("button", { name: "추천 경로 다시 계산" }).click();
    const errorNotice = plannerDialog.getByRole("alert");
    await expect(errorNotice).toBeFocused();
    await expect(errorNotice).toContainText("추가한 모든 경유지에서 검색 결과 장소를 선택해 주세요.");
    expect(await errorNotice.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.right <= window.innerWidth && element.scrollWidth <= element.clientWidth;
    })).toBe(true);
    for (let remaining = 5; remaining > 0; remaining -= 1) {
      await plannerDialog.getByRole("button", { name: /번째 휴식 제거/ }).first().click();
      if (remaining > 1) {
        await expect(plannerDialog.getByRole("button", { name: "3번째 휴식 제거" })).toBeFocused();
      } else {
        await expect(plannerDialog.getByRole("button", { name: "2번째 경유지 제거" })).toBeFocused();
      }
    }
    await expect(addRest).toBeEnabled();

    if (!cleanup.collectionId) throw new Error("Live collection cleanup identity was not captured");
    const deletedCollectionItem = await startCollectionDeletion(page, cleanup.collectionId);
    cleanup.collectionId = null;
    cleanup.collectionMutationStarted = false;
    await expect(deletedCollectionItem).toHaveCount(0);

    await verifyRevokedShare(page, issuedUrl);
    await verifyRevokedShare(page, reissuedUrl);
    if (!cleanup.tripId) throw new Error("Live trip cleanup identity was not captured");
    const deleted = await deleteOwnedTrip(page, cleanup.tripId);
    expect(deleted).toBe(true);
    cleanup.tripId = null;
    cleanup.tripMutationStarted = false;
    expect(browserErrorCount).toBe(0);
});
