/** Gesture recognition only: leave the SDK's pan/pinch handling untouched. */
export function bindMapLongPress(element: HTMLElement, select: (x: number, y: number) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number; id: number } | null = null;
  const pointers = new Set<number>();
  const listenerOptions = { capture: true };
  const cancel = () => { clearTimeout(timer); timer = undefined; start = null; };
  const down = (event: PointerEvent) => {
    pointers.add(event.pointerId);
    cancel();
    if (pointers.size !== 1 || event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    timer = setTimeout(() => {
      if (!start || pointers.size !== 1) return;
      const bounds = element.getBoundingClientRect();
      const { x, y } = start;
      cancel();
      select(x - bounds.left, y - bounds.top);
    }, 600);
  };
  const move = (event: PointerEvent) => {
    if (start && (event.pointerId !== start.id || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8)) cancel();
  };
  const up = (event: PointerEvent) => { pointers.delete(event.pointerId); cancel(); };
  const leave = () => { pointers.clear(); cancel(); };
  element.addEventListener("pointerdown", down, listenerOptions);
  element.addEventListener("pointermove", move, listenerOptions);
  element.addEventListener("pointerup", up, listenerOptions);
  element.addEventListener("pointercancel", up, listenerOptions);
  element.addEventListener("pointerleave", leave, listenerOptions);
  element.addEventListener("wheel", cancel, listenerOptions);
  return () => {
    leave();
    element.removeEventListener("pointerdown", down, listenerOptions);
    element.removeEventListener("pointermove", move, listenerOptions);
    element.removeEventListener("pointerup", up, listenerOptions);
    element.removeEventListener("pointercancel", up, listenerOptions);
    element.removeEventListener("pointerleave", leave, listenerOptions);
    element.removeEventListener("wheel", cancel, listenerOptions);
  };
}
