import { expect, type Page } from "@playwright/test";

/**
 * Favorites section pages (공유 폴더, 기피 장소): the heading and the body fill the column's
 * content box, and the title stays on one line. A side padding taken from the parent width once
 * left them about 20px wide on wide windows (Preview, 2026-10-09).
 */
export async function expectSectionPageFills(page: Page, label: string) {
  const layout = await page.evaluate(() => {
    const section = document.querySelector<HTMLElement>('section[aria-labelledby="saved-places-title"]');
    if (!section) return null;
    const style = getComputedStyle(section);
    const content = section.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const width = (element: Element | null) => (element ? element.getBoundingClientRect().width : -1);
    const title = section.querySelector("h1");
    const titleStyle = title ? getComputedStyle(title) : null;
    const lineHeight = titleStyle ? parseFloat(titleStyle.lineHeight) || parseFloat(titleStyle.fontSize) * 1.35 : 0;
    const body = section.querySelector(":scope > [class*='sectionBody']");
    return {
      content,
      heading: width(section.querySelector(":scope > header")),
      body: width(body),
      firstCard: width(body?.querySelector("li, [class*='stateCard']") ?? null),
      titleLines: title ? Math.round(title.getBoundingClientRect().height / lineHeight) : 0,
    };
  });
  expect(layout, `${label}: section page`).not.toBeNull();
  const { content, heading, body, firstCard, titleLines } = layout!;
  expect(content, `${label}: content width`).toBeGreaterThan(200);
  expect(Math.abs(heading - content), `${label}: heading ${heading} vs ${content}`).toBeLessThanOrEqual(1);
  expect(Math.abs(body - content), `${label}: body ${body} vs ${content}`).toBeLessThanOrEqual(1);
  expect(firstCard, `${label}: first card`).toBeGreaterThan(content * 0.9);
  expect(titleLines, `${label}: title lines`).toBe(1);
}
