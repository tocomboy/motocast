import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => vi.importActual("react-native-web"));

import { ReleaseHistory, type ReleaseNote } from "@motocast/shared-ui";

const releases = Object.freeze([
  Object.freeze({
    version: "0.8.1",
    date: "2026-10-02",
    title: "앱 홈 개선",
    summary: "앱 전용 과거 소식도 그대로 표시합니다.",
    bullets: Object.freeze(["앱의 로그아웃 위치를 다듬었어요.", "동일 항목", "동일 항목"]),
  }),
  Object.freeze({
    version: "0.8.0",
    date: "2026-10-01",
    title: "웹과 앱",
    summary: "두 플랫폼의 업데이트",
    bullets: Object.freeze(["경유지를 추가하기 전에 지도에서 위치를 확인해요."]),
  }),
]) satisfies readonly ReleaseNote[];

describe("shared release history", () => {
  it("preserves readonly platform history, bullet order, and the actual current version", () => {
    const html = renderToStaticMarkup(<ReleaseHistory releases={releases} currentVersion="0.8.0" />);

    expect(html).toContain("앱 전용 과거 소식도 그대로 표시합니다.");
    expect(html.indexOf("앱 홈 개선")).toBeLessThan(html.indexOf("웹과 앱"));
    expect(html.match(/<article/g)).toHaveLength(2);
    expect(html.match(/<h2/g)).toHaveLength(2);
    expect(html.match(/<ul/g)).toHaveLength(2);
    expect(html.match(/<li/g)).toHaveLength(4);
    expect(html.match(/동일 항목/g)).toHaveLength(2);
    const cards = html.split("<article").slice(1);
    expect(cards[0]).not.toContain("현재 버전");
    expect(cards[1]).toContain("현재 버전");
  });

  it("escapes note text and does not invent a current note when it is absent", () => {
    const html = renderToStaticMarkup(<ReleaseHistory
      releases={[{ ...releases[0], title: "<script>내용</script>" }]}
      currentVersion="0.9.0"
    />);

    expect(html).toContain("&lt;script&gt;내용&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("현재 버전");
    expect(renderToStaticMarkup(<ReleaseHistory releases={[]} currentVersion="0.8.1" />))
      .not.toContain("<article");
  });
});
