import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KakaoMapHandoff } from "./kakaomap-handoff";
import type { HandoffResult } from "../lib/planner/kakaomap-handoff";

afterEach(() => vi.unstubAllGlobals());

async function setup(ua = "Windows") {
  const open = vi.fn();
  const assign = vi.fn();
  const onPrepare = vi.fn();
  const focus = vi.fn();
  const modal = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const source: { identity: string; result: HandoffResult } = { identity: "1", result: { status: "ready", places: [
    { label: "출발", latitude: 37, longitude: 127 }, { label: "도착", latitude: 37.1, longitude: 127.1 },
  ] } };
  vi.stubGlobal("navigator", { userAgent: ua, maxTouchPoints: 0 });
  vi.stubGlobal("window", { open, location: { assign } });
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<KakaoMapHandoff context="shared" readSource={() => source} onPrepare={onPrepare} />, {
    createNodeMock: (node) => node.type === "dialog" ? modal : { focus },
  }); });
  const click = async (label: string) => {
    const button = renderer.root.findAllByType("button").find((b) => b.children.join("") === label);
    if (!button) throw new Error(`Missing button: ${label}`);
    await act(async () => button.props.onClick());
  };
  return { renderer, source, open, assign, onPrepare, focus, modal, click };
}

describe("KakaoMap confirmation lifecycle", () => {
  it("opens once per confirmation and never interprets a blocked popup as navigation success", async () => {
    const s = await setup();
    await s.click("경로 실행");
    const execute = s.renderer.root.findAllByType("button").find((b) => b.children.includes("확인하고 카카오맵 열기"))!;
    await act(async () => { execute.props.onClick(); execute.props.onClick(); });
    expect(s.open).toHaveBeenCalledTimes(1);
    expect(s.open).toHaveBeenCalledWith("https://map.kakao.com/link/by/car/%EC%B6%9C%EB%B0%9C,37,127/%EB%8F%84%EC%B0%A9,37.1,127.1", "_blank", "noopener,noreferrer");
    expect(JSON.stringify(s.renderer.toJSON())).toContain("팝업 차단");
    await s.click("다시 실행");
    expect(s.open).toHaveBeenCalledTimes(1);
    await s.click("확인하고 카카오맵 열기");
    expect(s.open).toHaveBeenCalledTimes(2);
    await act(async () => s.renderer.unmount());
  });
  it.each(["identity", "coordinates", "over-limit"])("rechecks %s at confirmation", async (change) => {
    const s = await setup();
    await s.click("경로 실행");
    if (change === "identity") s.source.identity = "2";
    else if (change === "over-limit") s.source.result = { status: "blocked", reason: "over-limit", count: 6 };
    else if (s.source.result.status === "ready") s.source.result.places[0].latitude = 37.2;
    await s.click("확인하고 카카오맵 열기");
    expect(s.open).not.toHaveBeenCalled();
    expect(s.assign).not.toHaveBeenCalled();
    await s.click("새 일정으로 출발");
    expect(s.onPrepare).toHaveBeenCalledTimes(1);
    await act(async () => s.renderer.unmount());
  });
  it.each(["Android", "iPhone"])("keeps %s installation explicit and retries through confirmation", async (ua) => {
    const s = await setup(ua);
    await s.click("경로 실행");
    await s.click("카카오맵 설치 안내");
    const link = s.renderer.root.findByType("a");
    expect(link.props.href).toMatch(ua === "Android" ? /^https:\/\/play.google.com\// : /^https:\/\/apps.apple.com\//);
    expect(s.assign).not.toHaveBeenCalled();
    await s.click("다시 실행");
    expect(s.assign).not.toHaveBeenCalled();
    await s.click("확인하고 카카오맵 열기");
    expect(s.assign).toHaveBeenCalledExactlyOnceWith("kakaomap://route?sp=37,127&ep=37.1,127.1&by=car");
    expect(s.open).not.toHaveBeenCalled();
    await s.click("요약으로 돌아가기");
    expect(s.focus).toHaveBeenCalled();
    await act(async () => s.renderer.unmount());
  });
  it("exposes installation recovery when a mobile scheme throws", async () => {
    const s = await setup("Android");
    s.assign.mockImplementation(() => { throw Error("Unsupported scheme"); });
    await s.click("경로 실행");
    await s.click("확인하고 카카오맵 열기");
    expect(s.renderer.root.findByType("h2").children).toEqual(["카카오맵 앱이 필요합니다"]);
    expect(s.open).not.toHaveBeenCalled();
    await act(async () => s.renderer.unmount());
  });
  it("cancels with Escape without navigation and restores focus", async () => {
    const s = await setup();
    await s.click("경로 실행");
    await act(async () => s.renderer.root.findByType("dialog").props.onCancel({ preventDefault: vi.fn() }));
    expect(s.modal.open).toBe(false);
    expect(s.focus).toHaveBeenCalled();
    expect(s.open).not.toHaveBeenCalled();
    await act(async () => s.renderer.unmount());
  });
});
