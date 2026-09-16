import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const currentVersion = (JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string }).version;

test.describe("public update notes", () => {
  test("shows one current-version announcement per server identity decision", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const decisions = [true, false, true, true];
    const presentationIds: string[] = [];
    await page.route("**/api/releases/claim", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["expectedVersion", "presentationId"]);
      expect(body.expectedVersion).toBe(currentVersion);
      expect(body.presentationId).toMatch(/^[0-9a-f-]{36}$/i);
      presentationIds.push(String(body.presentationId));
      await route.fulfill({
        body: JSON.stringify({ show: decisions[presentationIds.length - 1], version: currentVersion }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/");
    const dialog = page.getByRole("dialog", { name: "새로운 소식을 확인해 보세요" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(`현재 v${currentVersion}`)).toBeVisible();
    await expect(dialog.getByText("일부 경로 계획 오류는 원인을 확인 중이에요.")).toBeVisible();
    const layout = await dialog.evaluate((element) => ({
      dialogHasNoHorizontalOverflow: element.scrollWidth <= element.clientWidth,
      documentHasNoHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      fitsViewport: element.getBoundingClientRect().height <= window.innerHeight - 20,
    }));
    expect(layout).toEqual({
      dialogHasNoHorizontalOverflow: true,
      documentHasNoHorizontalOverflow: true,
      fitsViewport: true,
    });

    const closeButton = dialog.getByRole("button", { name: "업데이트 소식 닫기" });
    await expect(closeButton).toBeFocused();
    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await closeButton.click();
    await expect(dialog).toBeHidden();

    // The server represents the same user on reload and returns the persisted false decision.
    const repeatedClaim = page.waitForResponse((response) => response.url().includes("/api/releases/claim"));
    await page.reload();
    const repeatedResponse = await repeatedClaim;
    expect(await repeatedResponse.json()).toEqual({ show: false, version: currentVersion });
    expect(presentationIds).toHaveLength(2);
    await expect(dialog).toBeHidden();

    // A different authenticated identity receives its independent first-presentation decision.
    await page.goto("/");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.goto("/");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("link", { name: "자세히 보기" }).click();
    await expect(page).toHaveURL("/updates");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "업데이트 소식" })).toBeVisible();
    expect(presentationIds).toHaveLength(4);
  });

  test("opens from the global version footer and shows the current release history", async ({ page }) => {
    await page.goto("/");

    const releaseLink = page.getByRole("link", { name: `업데이트 소식 · v${currentVersion}` });
    await expect(releaseLink).toBeVisible();
    await releaseLink.click();

    await expect(page).toHaveURL("/updates");
    await expect(page).toHaveTitle("업데이트 소식 | MOTOCAST");
    await expect(page.getByRole("heading", { level: 1, name: "업데이트 소식" })).toBeVisible();

    const releases = page.getByRole("article");
    await expect(releases).toHaveCount(4);
    await expect(releases.nth(0)).toContainText(`v${currentVersion}`);
    await expect(releases.nth(0).getByText("현재 버전", { exact: true })).toBeVisible();
    await expect(releases.nth(1)).toContainText("v0.2.1");
    await expect(releases.nth(1).getByText("현재 버전", { exact: true })).toHaveCount(0);
    await expect(releases.nth(2)).toContainText("v0.2.0");
    await expect(releases.nth(2).getByText("현재 버전", { exact: true })).toHaveCount(0);
    await expect(releases.nth(3)).toContainText("v0.1.0");
    await expect(releases.nth(3).getByText("현재 버전", { exact: true })).toHaveCount(0);

    const backLink = page.getByRole("link", { name: "플래너로 돌아가기" });
    await backLink.focus();
    await expect(backLink).toBeFocused();
    await backLink.click();
    await expect(page).toHaveURL("/");
  });

  for (const viewport of [
    { name: "mobile 320", width: 320, height: 800 },
    { name: "desktop 1440", width: 1440, height: 900 },
  ]) {
    test(`${viewport.name} keeps update notes visible without horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/updates");
      await page.evaluate(() => document.fonts.ready);

      await expect(page.getByRole("heading", { level: 1, name: "업데이트 소식" })).toBeVisible();
      await expect(page.getByRole("article")).toHaveCount(4);
      await expect(page.getByText("일부 경로 계획 오류는 원인을 확인 중이에요.")).toBeVisible();
      await expect(page.getByText("모바일에서 초대 관리와 링크 복사 버튼이 보이도록 고쳤어요.")).toBeVisible();
      await expect(page.getByText("새 버전의 주요 소식을 처음 접속할 때 한 번만 알려드려요.")).toBeVisible();
      await expect(page.getByText("코스를 저장해 다시 불러오고, 준비한 라이딩 정보를 링크로 공유해요.")).toBeVisible();

      const layout = await page.evaluate(() => ({
        documentHasNoHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        articlesHaveNoHorizontalOverflow: Array.from(document.querySelectorAll("article"))
          .every((article) => article.scrollWidth <= article.clientWidth),
      }));
      expect(layout).toEqual({
        documentHasNoHorizontalOverflow: true,
        articlesHaveNoHorizontalOverflow: true,
      });
    });
  }
});
