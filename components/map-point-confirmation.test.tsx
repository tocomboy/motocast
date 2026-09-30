import { createRef } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MapPointConfirmation, type MapPlacePickerHandle } from "./map-point-confirmation";

const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ getBrowserSupabase: () => ({ functions: api }) }));
const point = { latitude: 37.5, longitude: 127.1 };
const place = { ...point, kakaoPlaceId: "map:37.5000000:127.1000000", verificationToken: "a".repeat(43), name: "지도 시험 주소", address: "지도 시험 주소", roadAddress: null, category: "지도에서 선택", phone: null, placeUrl: null };
const response = { data: { places: [place], isEnd: true }, error: null };
let renderer: ReactTestRenderer;
beforeEach(() => { vi.stubGlobal("document", { activeElement: null }); vi.stubGlobal("HTMLElement", class {}); api.invoke.mockReset(); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); vi.unstubAllGlobals(); });
async function mount() {
  const reference = createRef<MapPlacePickerHandle>(); const onSelect = vi.fn();
  await act(async () => { renderer = create(<MapPointConfirmation pickerRef={reference} onSelect={onSelect} />); });
  await act(async () => reference.current!.open(point));
  return { reference, onSelect };
}
function button(label: string) { return renderer.root.findAllByType("button").find(n => n.children.includes(label))!; }

it("shows a confirmation popup and commits one point only after explicit confirmation", async () => {
  api.invoke.mockResolvedValue(response);
  const { onSelect } = await mount();
  expect(renderer.root.findByType("dialog").props.className).toBe("map-confirmation-dialog");
  expect(renderer.root.findByType("h2").children.join("")).toBe("이 지점을 경유지로 추가할까요?");
  expect(onSelect).not.toHaveBeenCalled();
  const confirm = button("경유지로 추가").props.onClick;
  await act(async () => { confirm(); confirm(); });
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(place);
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith("search-places", { body: { mode: "coordinate", ...point } });
});

it.each(["cancel", "escape", "unmount"])("discards a delayed lookup after %s", async (mode) => {
  let resolve!: (value: unknown) => void;
  api.invoke.mockReturnValue(new Promise(done => { resolve = done; }));
  const { onSelect } = await mount();
  expect(button("주소 확인 중").props.disabled).toBe(true);
  await act(async () => {
    if (mode === "cancel") button("취소").props.onClick();
    else if (mode === "escape") renderer.root.findByType("dialog").props.onCancel({ preventDefault: vi.fn() });
    else renderer.unmount();
  });
  await act(async () => resolve(response));
  expect(onSelect).not.toHaveBeenCalled();
  if (mode !== "unmount") expect(button("경유지로 추가")).toBeUndefined();
});

it("retries the same selected point only after the user requests it", async () => {
  api.invoke.mockResolvedValueOnce({ error: new Error("offline") }).mockResolvedValueOnce(response);
  const { onSelect } = await mount();
  expect(api.invoke).toHaveBeenCalledTimes(1);
  await act(async () => button("다시 시도").props.onClick());
  expect(api.invoke.mock.calls.map(c => c[1].body)).toEqual([{ mode: "coordinate", ...point }, { mode: "coordinate", ...point }]);
  expect(onSelect).not.toHaveBeenCalled();
  await act(async () => button("취소").props.onClick());
  expect(onSelect).not.toHaveBeenCalled();
});

it.each([
  { ...place, latitude: 37.500001 },
  { ...place, kakaoPlaceId: "unrelated-place" },
])("never offers confirmation for a result from another point %#", async (wrong) => {
  api.invoke.mockResolvedValue({ data: { places: [wrong], isEnd: true }, error: null });
  const { onSelect } = await mount();
  expect(button("경유지로 추가")).toBeUndefined();
  expect(button("다시 시도")).toBeDefined();
  expect(onSelect).not.toHaveBeenCalled();
});

it("keeps an addressless point out of the course", async () => {
  api.invoke.mockResolvedValue({ data: { places: [], isEnd: true }, error: null });
  const { onSelect } = await mount();
  expect(button("경유지로 추가")).toBeUndefined();
  await act(async () => button("지도에서 다시 선택").props.onClick());
  expect(onSelect).not.toHaveBeenCalled();
});
