import { afterEach, describe, expect, it, vi } from "vitest";
import { bindMapLongPress } from "./map-long-press";

function surface() {
  const element = new EventTarget();
  Object.assign(element, { getBoundingClientRect: () => ({ left: 10, top: 20 }) });
  const select = vi.fn();
  const remove = bindMapLongPress(element as HTMLElement, select);
  const emit = (type: string, fields = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 1, button: 0, clientX: 50, clientY: 70 }, fields);
    element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  };
  return { emit, select, remove };
}
afterEach(() => vi.useRealTimers());
describe("map long press without taking over SDK gestures", () => {
  it("selects one relative coordinate only after a stationary long press", () => {
    vi.useFakeTimers(); const map = surface();
    map.emit("pointerdown"); vi.advanceTimersByTime(599); expect(map.select).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(map.select).toHaveBeenCalledExactlyOnceWith(40, 50);
    vi.advanceTimersByTime(1000); expect(map.select).toHaveBeenCalledTimes(1); map.remove();
  });
  it.each(["pointerup", "pointercancel", "pointerleave", "wheel"])("cancels on %s without preventing pan or zoom", (type) => {
    vi.useFakeTimers(); const map = surface(); map.emit("pointerdown"); map.emit(type);
    vi.advanceTimersByTime(1000); expect(map.select).not.toHaveBeenCalled(); map.remove();
  });
  it("does not turn a drag or pinch into a waypoint", () => {
    vi.useFakeTimers(); const map = surface(); map.emit("pointerdown"); map.emit("pointermove", {clientX: 59});
    vi.advanceTimersByTime(1000); expect(map.select).not.toHaveBeenCalled(); map.emit("pointerup");
    map.emit("pointerdown"); map.emit("pointerdown", {pointerId: 2}); map.emit("pointerup", {pointerId: 2});
    vi.advanceTimersByTime(1000); expect(map.select).not.toHaveBeenCalled(); map.remove();
  });
  it("cancels pending work and removes handlers when the map detaches", () => {
    vi.useFakeTimers(); const map = surface(); map.emit("pointerdown"); map.remove();
    vi.advanceTimersByTime(1000); map.emit("pointerdown"); vi.advanceTimersByTime(1000);
    expect(map.select).not.toHaveBeenCalled();
  });
});
