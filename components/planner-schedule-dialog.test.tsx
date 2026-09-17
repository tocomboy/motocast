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

  it("requires an explicit hour and minute and rejects a past time chosen for today", async () => {
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
