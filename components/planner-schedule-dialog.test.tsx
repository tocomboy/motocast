import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlannerScheduleDialog } from "./planner-schedule-dialog";

function buttonWithText(renderer: ReactTestRenderer, text: string) {
  const renderedText = (value: ReactTestRenderer["root"]): string => value.children.map((child) => typeof child === "string" ? child : renderedText(child)).join("");
  return renderer.root.findAllByType("button").find((button) => renderedText(button) === text);
}

describe("PlannerScheduleDialog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T01:30:00.000Z"));
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => { callback(); return 1; } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("rejects an explicitly chosen past time for today", async () => {
    const onConfirm = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PlannerScheduleDialog date="" time="" minimumDate="2026-09-17" minimumTime="10:31" onConfirm={onConfirm} />, { createNodeMock: (element) => element.type === "dialog" ? { showModal: vi.fn(), close: vi.fn() } : String((element.props as { className?: unknown }).className ?? "").includes("clock-grid") ? { querySelector: vi.fn(() => null) } : { focus: vi.fn() } }); });
    await act(async () => renderer.root.findByProps({ className: "schedule-trigger" }).props.onClick());
    await act(async () => buttonWithText(renderer, "17")!.props.onClick());
    await act(async () => renderer.root.findByProps({ className: "schedule-time-rows" }).findAllByType("button")[0].props.onClick());
    await act(async () => buttonWithText(renderer, "08시")!.props.onClick());
    await act(async () => renderer.root.findByProps({ className: "schedule-time-rows" }).findAllByType("button")[1].props.onClick());
    await act(async () => buttonWithText(renderer, "00분")!.props.onClick());
    await act(async () => renderer.root.findByProps({ className: "primary-button" }).props.onClick());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain("현재 이후");
    await act(async () => renderer.unmount());
  });

  it("offers a fresh five-minute default only on open and requires explicit confirmation", async () => {
    vi.setSystemTime(new Date("2026-09-30T14:57:00.000Z"));
    const onConfirm = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PlannerScheduleDialog date="" time="" minimumDate="2026-09-30" minimumTime="23:57" onConfirm={onConfirm} />, { createNodeMock: () => ({ showModal: vi.fn(), close: vi.fn(), focus: vi.fn() }) }); });
    const trigger = () => renderer.root.findByProps({ className: "schedule-trigger" });
    expect(trigger().props["aria-label"]).toContain("날짜와 출발 시각 선택");
    await act(async () => trigger().props.onClick());
    expect(renderer.root.findByProps({ className: "calendar-heading" }).findByType("strong").children.join("")).toBe("2026년 10월");
    expect(renderer.root.findByProps({ className: "schedule-selection" }).children.join("")).toBe("10월 1일 · 00:00 출발");
    expect(onConfirm).not.toHaveBeenCalled();
    await act(async () => renderer.root.findByProps({ "aria-label": "일정 선택 닫기" }).props.onClick());
    expect(trigger().props["aria-label"]).toContain("날짜와 출발 시각 선택");
    vi.setSystemTime(new Date("2026-09-30T15:00:00.001Z"));
    await act(async () => trigger().props.onClick());
    expect(renderer.root.findByProps({ className: "schedule-selection" }).children.join("")).toBe("10월 1일 · 00:05 출발");
    await act(async () => renderer.root.findByProps({ className: "primary-button" }).props.onClick());
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("2026-10-01", "00:05");
    await act(async () => renderer.unmount());
  });

  it("offers minutes from 00 to 55 in five-minute steps", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PlannerScheduleDialog date="" time="" minimumDate="2026-09-17" minimumTime="10:30" onConfirm={vi.fn()} />, { createNodeMock: () => ({ showModal: vi.fn(), close: vi.fn(), focus: vi.fn(), querySelector: vi.fn(() => null) }) }); });
    await act(async () => renderer.root.findByProps({ className: "schedule-trigger" }).props.onClick());
    await act(async () => renderer.root.findByProps({ className: "schedule-time-rows" }).findAllByType("button")[1].props.onClick());
    const minutes = renderer.root.findByProps({ className: "clock-grid minute-grid" }).findAllByType("button");
    expect(minutes.map((button) => button.children.join(""))).toEqual(["00분", "05분", "10분", "15분", "20분", "25분", "30분", "35분", "40분", "45분", "50분", "55분"]);
    await act(async () => renderer.unmount());
  });

  it("preserves an explicit off-grid time on open and accepts it while still future", async () => {
    const onConfirm = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PlannerScheduleDialog date="2026-09-17" time="10:32" minimumDate="2026-09-17" minimumTime="10:30" onConfirm={onConfirm} />, { createNodeMock: () => ({ showModal: vi.fn(), close: vi.fn(), focus: vi.fn() }) }); });
    await act(async () => renderer.root.findByProps({ className: "schedule-trigger" }).props.onClick());
    expect(renderer.root.findByProps({ className: "schedule-selection" }).children.join("")).toBe("9월 17일 · 10:32 출발");
    await act(async () => renderer.root.findByProps({ className: "primary-button" }).props.onClick());
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("2026-09-17", "10:32");
    await act(async () => renderer.unmount());
  });

  it("rechecks the clock at confirmation without advancing the selected departure", async () => {
    const onConfirm = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PlannerScheduleDialog date="2026-09-17" time="10:35" minimumDate="2026-09-17" minimumTime="10:30" onConfirm={onConfirm} />, { createNodeMock: () => ({ showModal: vi.fn(), close: vi.fn(), focus: vi.fn() }) }); });
    await act(async () => renderer.root.findByProps({ className: "schedule-trigger" }).props.onClick());
    vi.setSystemTime(new Date("2026-09-17T01:35:00.001Z"));
    await act(async () => renderer.root.findByProps({ className: "primary-button" }).props.onClick());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain("현재 이후");
    expect(renderer.root.findByProps({ className: "schedule-selection" }).children.join("")).toBe("9월 17일 · 10:35 출발");
    await act(async () => renderer.unmount());
  });

  it("returns Escape from a clock panel to the date panel without closing the dialog", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PlannerScheduleDialog date="" time="" minimumDate="2026-09-17" minimumTime="10:31" onConfirm={vi.fn()} />, { createNodeMock: (element) => element.type === "dialog" ? { showModal: vi.fn(), close: vi.fn() } : { focus: vi.fn(), querySelector: vi.fn(() => null) } }); });
    await act(async () => renderer.root.findByProps({ className: "schedule-trigger" }).props.onClick());
    await act(async () => renderer.root.findByProps({ className: "schedule-time-rows" }).findAllByType("button")[0].props.onClick());
    const preventDefault = vi.fn();
    await act(async () => renderer.root.findByProps({ className: "clock-dialog" }).props.onCancel({ preventDefault }));
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ className: "schedule-time-rows" })).toBeDefined();
    await act(async () => renderer.unmount());
  });
});
