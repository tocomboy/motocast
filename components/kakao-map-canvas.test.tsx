import { StrictMode } from "react";
import { act, create, type ReactTestRenderer, type TestRendererOptions } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sharedRideSnapshotWithOmissions } from "../tests/fixtures/shared-ride-snapshot";
import { KakaoMapCanvas, MapOmissionList, type MapMarkerRole, type MapPoint } from "./kakao-map-canvas";
import { SharedRideSnapshotView } from "./shared-ride-snapshot";

type Listener = () => void;

class FakeScript {
  async = false;
  dataset: Record<string, string> = {};
  src = "";
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: "load" | "error") {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  listenerCount(type: "load" | "error") {
    return this.listeners.get(type)?.size ?? 0;
  }
}

const points = [
  { label: "출발", latitude: 37.5, longitude: 127.1, role: "origin" as const },
  { label: "복귀", latitude: 37.6, longitude: 127.2, role: "destination" as const },
];
const actualPath = [
  { latitude: 37.5, longitude: 127.1 },
  { latitude: 37.55, longitude: 127.18 },
  { latitude: 37.6, longitude: 127.2 },
];
const rendererOptions: TestRendererOptions & { unstable_strictMode: boolean } = {
  createNodeMock: () => ({}),
  unstable_strictMode: true,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubBrowser() {
  const scripts: FakeScript[] = [];
  vi.stubGlobal("ResizeObserver", class {
    observe = vi.fn();
    disconnect = vi.fn();
  });
  vi.stubGlobal("window", {
    clearTimeout: (...args: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...args),
    setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
  });
  vi.stubGlobal("document", {
    createElement: () => new FakeScript(),
    head: { appendChild: (script: FakeScript) => scripts.push(script) },
    querySelector: () => scripts[0] ?? null,
  });
  return scripts;
}

function installMaps({ throwOnLoad = false, synchronousLoad = false }: { throwOnLoad?: boolean; synchronousLoad?: boolean } = {}) {
  const loadCallbacks: Listener[] = [];
  const extend = vi.fn();
  const setBounds = vi.fn();
  const coordinate = { getLat: () => 37.5, getLng: () => 127.1 };
  let center = coordinate;
  let level = 8;
  const setCenter = vi.fn((point: typeof coordinate) => { center = point; });
  const setLevel = vi.fn((value: number) => { level = value; });
  const setDraggable = vi.fn();
  const relayout = vi.fn(() => {
    center = { getLat: () => 0, getLng: () => 0 };
    level = 1;
  });
  // 0.001° maps to 100px so the fixture spacing stays above every cluster radius.
  const projection = {
    coordsFromContainerPoint: vi.fn(() => coordinate),
    containerPointFromCoords: vi.fn((point: KakaoLatLng) => ({ x: (point.getLng() - 127) * 100_000, y: (37.6 - point.getLat()) * 100_000 })),
  };
  const mapLayers = new Map<HTMLElement, unknown[]>();
  const activeMarkers = new Set<InstanceType<KakaoMapsNamespace["Marker"]>>();
  const activePolylines = new Set<InstanceType<KakaoMapsNamespace["Polyline"]>>();
  const MapConstructor = vi.fn(function MapInstance(this: InstanceType<KakaoMapsNamespace["Map"]>, container: HTMLElement) {
    const layers = mapLayers.get(container) ?? [];
    layers.push(this); mapLayers.set(container, layers);
    this.setBounds = setBounds;
    this.getProjection = () => projection;
    this.getCenter = () => center;
    this.setCenter = setCenter;
    this.getLevel = () => level;
    this.setLevel = setLevel;
    this.relayout = relayout;
    this.setDraggable = setDraggable;
  });
  const Marker = vi.fn(function MarkerInstance(this: InstanceType<KakaoMapsNamespace["Marker"]>) {
    activeMarkers.add(this);
    this.setMap = vi.fn(() => { activeMarkers.delete(this); });
  });
  const MarkerImage = vi.fn(function MarkerImageInstance() {});
  const Polyline = vi.fn(function PolylineInstance(this: InstanceType<KakaoMapsNamespace["Polyline"]>) {
    activePolylines.add(this);
    this.setMap = vi.fn(() => { activePolylines.delete(this); });
  });
  const Size = vi.fn(function SizeInstance() {});
  const Point = vi.fn(function PointInstance() {});
  class LatLng {
    constructor(private latitude: number, private longitude: number) {}
    getLat() { return this.latitude; }
    getLng() { return this.longitude; }
  }
  class LatLngBounds {
    extend = extend;
  }
  const maps = {
    load: vi.fn((callback: Listener) => {
      if (throwOnLoad) throw new Error("partial SDK");
      if (synchronousLoad) callback();
      else loadCallbacks.push(callback);
    }),
    LatLng,
    LatLngBounds,
    Map: MapConstructor,
    Marker,
    MarkerImage,
    Size,
    Point,
    Polyline,
    event: { addListener: vi.fn(), removeListener: vi.fn() },
  };
  (window as Window).kakao = { maps: maps as unknown as KakaoMapsNamespace };
  return { setDraggable, loadCallbacks, MapConstructor, Marker, MarkerImage, Polyline, Point, extend, setBounds, projection, setCenter, setLevel, relayout, mapLayers, activeMarkers, activePolylines, event: maps.event };
}

it("updates 100 saved pins and twenty toggle cycles on one map without moving the camera or removing draft points",async()=>{
  vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY","fixture-key");stubBrowser();const maps=installMaps();const select=vi.fn();
  const pins=Array.from({length:100},(_,n)=>({id:String(n),label:`공개 장소 ${n}`,kind:n%2?"restaurant" as const:"riding_spot" as const,latitude:37.5+n/1000,longitude:127.1}));
  let renderer!:ReactTestRenderer;
  await act(async()=>{renderer=create(<KakaoMapCanvas points={points} path={actualPath} savedPins={pins} onSelectSavedPin={select} allowEmptyMap/>,rendererOptions);});await flush(maps.loadCallbacks);
  const bounds=maps.setBounds.mock.calls.length;const routes=maps.Polyline.mock.calls.length;
  await act(async()=>{maps.event.addListener.mock.calls[0][2]();});expect(select).toHaveBeenCalledWith("0");
  for(let n=0;n<20;n++)for(const visible of [pins.filter(p=>p.kind==="restaurant"),[],pins.filter(p=>p.kind==="riding_spot"),pins]){
    await act(async()=>renderer.update(<KakaoMapCanvas points={points} path={actualPath} savedPins={visible} onSelectSavedPin={select} allowEmptyMap/>));
    expect(maps.activeMarkers.size).toBe(visible.length+2);expect(maps.activePolylines.size).toBe(2);
  }
  expect(maps.MapConstructor).toHaveBeenCalledTimes(1);expect(maps.setBounds).toHaveBeenCalledTimes(bounds);expect(maps.Polyline).toHaveBeenCalledTimes(routes);
  await act(async()=>renderer.unmount());expect(maps.activeMarkers.size).toBe(0);expect(maps.event.removeListener.mock.calls.length).toBe(maps.event.addListener.mock.calls.length);
});

it("keeps an empty saved-place map available with no route points or pins",async()=>{
  vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY","fixture-key");stubBrowser();const maps=installMaps();let renderer!:ReactTestRenderer;
  await act(async()=>{renderer=create(<KakaoMapCanvas points={[]} savedPins={[]} allowEmptyMap/>,rendererOptions);});await flush(maps.loadCallbacks);
  expect(maps.MapConstructor).toHaveBeenCalledTimes(1);expect(maps.Marker).not.toHaveBeenCalled();expect(maps.setBounds).not.toHaveBeenCalled();await act(async()=>renderer.unmount());
});

it("hides saved-pin cleanup failures and disables stale click callbacks while still attempting every removal",async()=>{
  vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY","fixture-key");stubBrowser();const maps=installMaps();const select=vi.fn();
  const pins=[{id:"1",label:"공개 장소",kind:"riding_spot" as const,latitude:37.5,longitude:127.1}];let r!:ReactTestRenderer;
  await act(async()=>{r=create(<KakaoMapCanvas points={[]} savedPins={pins} onSelectSavedPin={select} allowEmptyMap/>,rendererOptions);});await flush(maps.loadCallbacks);
  const click=maps.event.addListener.mock.calls[0][2];const marker=maps.Marker.mock.instances[0] as unknown as {setMap:ReturnType<typeof vi.fn>};
  maps.event.removeListener.mockImplementationOnce(()=>{throw new Error("SDK cleanup error");});
  await act(async()=>r.update(<KakaoMapCanvas points={[]} savedPins={[]} onSelectSavedPin={select} allowEmptyMap/>));
  expect(marker.setMap).toHaveBeenCalledWith(null);expect(mapCanvas(r).props["aria-hidden"]).toBe(true);expect(mapCanvas(r).props.inert).toBe(true);
  click();expect(select).not.toHaveBeenCalled();await act(async()=>r.unmount());
});

function markerTitled(maps: ReturnType<typeof installMaps>, title: string) {
  const index = maps.Marker.mock.calls.map((call) => (call as unknown[] as [{ title: string }])[0].title).lastIndexOf(title);
  const marker = maps.Marker.mock.instances[index];
  const call = maps.event.addListener.mock.calls.filter((entry) => entry[0] === marker && entry[1] === "click").at(-1);
  return call?.[2] as () => void;
}
const savedPin = (id: string, latitude: number, extra: { starred?: boolean; longitude?: number } = {}) =>
  ({ id, label: `장소 ${id}`, kind: "riding_spot" as const, latitude, longitude: extra.longitude ?? 127.1, starred: extra.starred });

it("clusters nearby visible pins with a star badge, keeps the selected pin single, and zooms a cluster at least two levels", async () => {
  vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "fixture-key"); stubBrowser(); const maps = installMaps();
  // Level 8 → radius 56px; 0.0002° = 20px in the fixture projection.
  const pins = [savedPin("a", 37.5), savedPin("b", 37.5002), savedPin("c", 37.5004, { starred: true }), savedPin("d", 37.55)];
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<KakaoMapCanvas points={[]} savedPins={pins} allowEmptyMap />, rendererOptions); }); await flush(maps.loadCallbacks);
  expect(maps.activeMarkers.size).toBe(2);
  expect(maps.Marker.mock.calls.map((call) => (call as unknown[] as [{ title: string }])[0].title)).toEqual(["저장 장소 3곳 묶음 · 자주 찾는 장소 포함", "라이딩 스팟 · 장소 d"]);
  const fits = maps.setBounds.mock.calls.length;
  await act(async () => markerTitled(maps, "저장 장소 3곳 묶음 · 자주 찾는 장소 포함")());
  expect(maps.setBounds.mock.calls.length).toBe(fits + 1);
  expect(maps.setBounds.mock.calls.at(-1)?.slice(1)).toEqual([48, 48, 48, 48]);
  expect(maps.setLevel).toHaveBeenLastCalledWith(6, expect.objectContaining({ anchor: expect.anything() }));
  await act(async () => r.update(<KakaoMapCanvas points={[]} savedPins={pins} selectedSavedPinId="b" allowEmptyMap />));
  expect(maps.activeMarkers.size).toBe(3);
  expect(maps.Marker.mock.calls.slice(-3).map((call) => [(call as unknown[] as [{ title: string }])[0].title, (call as unknown[] as [{ zIndex: number }])[0].zIndex])).toEqual([
    ["저장 장소 2곳 묶음 · 자주 찾는 장소 포함", 2], ["라이딩 스팟 · 장소 b", 3], ["라이딩 스팟 · 장소 d", 1],
  ]);
  await act(async () => r.unmount());
  expect(maps.activeMarkers.size).toBe(0);
  expect(maps.event.removeListener.mock.calls.length).toBe(maps.event.addListener.mock.calls.length);
});

it("lists same-coordinate pins instead of zooming and never zooms the camera for them", async () => {
  vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "fixture-key"); stubBrowser(); const maps = installMaps(); const list = vi.fn();
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<KakaoMapCanvas points={[]} savedPins={[savedPin("b", 37.5), savedPin("a", 37.5)]} onSelectSavedCluster={list} allowEmptyMap />, rendererOptions); }); await flush(maps.loadCallbacks);
  const fits = maps.setBounds.mock.calls.length; const zooms = maps.setLevel.mock.calls.length;
  await act(async () => markerTitled(maps, "저장 장소 2곳 묶음")());
  expect(list).toHaveBeenCalledExactlyOnceWith(["a", "b"]);
  expect(maps.setBounds.mock.calls.length).toBe(fits); expect(maps.setLevel.mock.calls.length).toBe(zooms);
  await act(async () => r.unmount());
});

it("recalculates clusters 150ms after the camera settles without new requests", async () => {
  vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "fixture-key"); stubBrowser(); const maps = installMaps();
  // 60px apart: single at level 8 (56px), one cluster at level 10 (72px).
  const pins = [savedPin("a", 37.5), savedPin("b", 37.5006)];
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<KakaoMapCanvas points={[]} savedPins={pins} allowEmptyMap />, rendererOptions); }); await flush(maps.loadCallbacks);
  expect(maps.activeMarkers.size).toBe(2);
  vi.useFakeTimers();
  maps.setLevel(10);
  const idle = maps.event.addListener.mock.calls.find((call) => call[1] === "idle")?.[2] as () => void;
  await act(async () => { idle(); vi.advanceTimersByTime(149); });
  expect(maps.activeMarkers.size).toBe(2);
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(maps.activeMarkers.size).toBe(1);
  expect(maps.MapConstructor).toHaveBeenCalledTimes(1);
  await act(async () => r.unmount());
  expect(maps.activeMarkers.size).toBe(0);
});

it("fits numbered search pins once, recenters on a new selection, and never clusters them", async () => {
  vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "fixture-key"); stubBrowser(); const maps = installMaps(); const choose = vi.fn();
  const results = [1, 2, 3].map((number) => ({ id: `r${number}`, number, label: `결과 ${number}`, latitude: 37.5, longitude: 127.1 + number / 1_000_000 }));
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<KakaoMapCanvas points={[]} numberedPins={results} selectedNumberedPinId="r1" onSelectNumberedPin={choose} allowEmptyMap />, rendererOptions); }); await flush(maps.loadCallbacks);
  expect(maps.activeMarkers.size).toBe(3);
  expect(maps.setBounds).toHaveBeenCalledTimes(1);
  await act(async () => markerTitled(maps, "3번 · 결과 3")());
  expect(choose).toHaveBeenCalledExactlyOnceWith("r3");
  await act(async () => r.update(<KakaoMapCanvas points={[]} numberedPins={results} selectedNumberedPinId="r3" onSelectNumberedPin={choose} allowEmptyMap />));
  expect(maps.setBounds).toHaveBeenCalledTimes(1);
  expect(maps.setCenter.mock.calls.at(-1)?.[0].getLng()).toBeCloseTo(127.100003, 9);
  expect(maps.Marker.mock.calls.slice(-3).map((call) => (call as unknown[] as [{ zIndex: number }])[0].zIndex)).toEqual([1, 1, 3]);
  await act(async () => r.unmount());
  expect(maps.activeMarkers.size).toBe(0);
});

it("reads the fixed center through the picker handle and zooms with buttons", async () => {
  vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "fixture-key"); stubBrowser(); const maps = installMaps();
  const handle = { current: null as null | { getCenter(): { latitude: number; longitude: number } | null } };
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<KakaoMapCanvas points={[]} allowEmptyMap centerPicker centerHandle={handle} initialView={{ latitude: 37.4, longitude: 127.3, level: 5 }} />, rendererOptions); }); await flush(maps.loadCallbacks);
  expect(handle.current?.getCenter()).toEqual({ latitude: 37.5, longitude: 127.1 });
  await act(async () => r.root.findByProps({ "aria-label": "지도 확대" }).props.onClick());
  expect(maps.setLevel).toHaveBeenLastCalledWith(7);
  expect(r.root.findAllByProps({ className: "map-center-marker" })).toHaveLength(1);
  await act(async () => r.unmount());
});

it("opens the saved-place fullscreen with a titled header, layer controls and the register sheet (FP40)", async () => {
  vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "fixture-key"); stubBrowser(); const maps = installMaps(); const pick = vi.fn(); const status = vi.fn();
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<KakaoMapCanvas points={[]} allowEmptyMap onSelectCoordinate={pick} coordinateActionLabel="이 지점 등록" coordinateActionInFullscreenOnly fullscreenTitle="저장 장소 지도" fullscreenControls={<span>핀 토글</span>} onStatusChange={status} />, { createNodeMock: () => ({ close: vi.fn(), show: vi.fn(), showModal: vi.fn(), focus: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }) }); });
  await flush(maps.loadCallbacks);
  expect(status).toHaveBeenLastCalledWith("ready");
  expect(r.root.findAllByProps({ className: "map-register-sheet" })).toHaveLength(0);
  await act(async () => r.root.findByProps({ className: "map-fullscreen-trigger" }).props.onClick());
  expect(r.root.findByType("h2").children).toEqual(["저장 장소 지도"]);
  expect(r.root.findAllByProps({ className: "map-fullscreen-controls" })).toHaveLength(1);
  expect(r.root.findAllByProps({ className: "map-center-marker" })).toHaveLength(1);
  const sheet = r.root.findByProps({ className: "map-register-sheet" });
  await act(async () => sheet.findByType("button").props.onClick());
  expect(pick).toHaveBeenCalledExactlyOnceWith({ latitude: 37.5, longitude: 127.1 });
  await act(async () => r.unmount());
});

it("shows the exact temporary selected point and disposes it without a route or edit controls", async () => {
  vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "fixture-key"); stubBrowser();
  const maps = installMaps();
  const resized: Array<() => void> = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized.push(callback); }
    observe = vi.fn(); disconnect = vi.fn();
  });
  const selected = { latitude: 38.03, longitude: 128.38, label: "선택한 위치" };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<KakaoMapCanvas points={[selected]} selectionPreview />, rendererOptions); });
  await flush(maps.loadCallbacks);
  expect(maps.MapConstructor).toHaveBeenCalledTimes(1);
  const marker = (maps.Marker.mock.calls[0] as unknown as [{ position: { getLat(): number; getLng(): number }; title: string }])[0];
  expect([marker.position.getLat(), marker.position.getLng(), marker.title]).toEqual([selected.latitude, selected.longitude, "선택한 위치"]);
  expect(maps.setCenter).toHaveBeenCalledWith(marker.position);
  expect(maps.setLevel).toHaveBeenCalledWith(4);
  // Reproduce the real SDK changing its center before our resize observer runs.
  maps.setCenter({ getLat: () => 37, getLng: () => 127 });
  await act(async () => resized.at(-1)!());
  const resizedMap = maps.MapConstructor.mock.instances[0] as unknown as InstanceType<KakaoMapsNamespace["Map"]>;
  expect([resizedMap.getCenter().getLat(), resizedMap.getCenter().getLng()]).toEqual([selected.latitude, selected.longitude]);

  expect(maps.Polyline).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType("button")).toHaveLength(0);
  expect(renderer.root.findAllByProps({ className: "route-sketch" })).toHaveLength(0);
  await act(async () => renderer.unmount());
  expect(maps.activeMarkers.size).toBe(0);
});

it("keeps one SDK map and its camera across fullscreen, return, and viewport resize", async () => {
  vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "fixture-key"); stubBrowser();
  const maps = installMaps();
  const resized: Array<() => void> = [];
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized.push(callback); }
    observe = vi.fn();
    disconnect = disconnect;
  });
  const surface = { close: vi.fn(), show: vi.fn(), showModal: vi.fn() };
  const expanded = { focus: vi.fn() }; const closed = { focus: vi.fn() };
  const canvas = {};
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<KakaoMapCanvas points={points} path={actualPath} showLegend={false} />, {
      createNodeMock: (node) => node.type === "dialog" ? surface : (node.props as { className?: string }).className === "map-fullscreen-trigger" ? expanded : node.type === "button" ? closed : canvas,
    });
  });
  await flush(maps.loadCallbacks);
  const camera = { getLat: () => 38.1, getLng: () => 128.3 };
  maps.setCenter(camera); maps.setLevel(4);
  const resize = async () => act(async () => resized.at(-1)!());
  await act(async () => renderer.root.findByProps({ className: "map-fullscreen-trigger" }).props.onClick());
  await resize();
  expect(surface.showModal).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByType("dialog").props.role).toBe("dialog");
  expect(closed.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  await resize();
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  await act(async () => renderer.root.findByType("dialog").props.onCancel({ preventDefault, stopPropagation }));
  expect(stopPropagation).toHaveBeenCalledOnce();
  await resize();
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(surface.show).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByType("dialog").props.role).toBe("region");
  expect(expanded.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  expect(maps.MapConstructor).toHaveBeenCalledTimes(1);
  expect(maps.Polyline).toHaveBeenCalledTimes(2);
  expect(maps.setBounds).toHaveBeenCalledTimes(1);
  const map = maps.MapConstructor.mock.instances[0] as unknown as InstanceType<KakaoMapsNamespace["Map"]>;
  expect(map.getCenter()).toBe(camera); expect(map.getLevel()).toBe(4);
  expect(maps.relayout).toHaveBeenCalledTimes(3);
  await act(async () => renderer.unmount());
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it("retains a closable truthful fullscreen error without enabling coordinate selection", async () => {
  vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "fixture-key"); const scripts = stubBrowser();
  const surface = { close: vi.fn(), show: vi.fn(), showModal: vi.fn() };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<KakaoMapCanvas points={points} path={actualPath} onSelectCoordinate={vi.fn()} />, {
    createNodeMock: node => node.type === "dialog" ? surface : { focus: vi.fn() },
  }); });
  await act(async () => renderer.root.findByProps({ className: "map-fullscreen-trigger" }).props.onClick());
  await act(async () => scripts[0].emit("error"));
  expect(statusText(renderer)).toContain("카카오 지도 로드 실패 · 실제 경로 선을 표시할 수 없습니다");
  expect(mapCanvas(renderer).props.inert).toBe(true);
  expect(renderer.root.findAllByProps({ className: "map-waypoint-actions" })).toHaveLength(0);
  expect(renderer.root.findAllByProps({ className: "route-sketch" })).toHaveLength(0);
  await act(async () => renderer.root.findAllByType("button").find(node => node.children.includes("닫기"))!.props.onClick());
  expect(surface.show).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});

it("uses the same owner selection callback in fullscreen and never enables it for readonly maps", async () => {
  vi.useFakeTimers(); vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "fixture-key"); stubBrowser();
  const maps = installMaps(); const select = vi.fn();
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 20, top: 72 }) });
  const surface = { close: vi.fn(), show: vi.fn(), showModal: vi.fn() };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<KakaoMapCanvas points={points} onSelectCoordinate={select} coordinateActionInFullscreenOnly />, {
    createNodeMock: node => node.type === "dialog" ? surface : node.type === "button" ? { focus: vi.fn() } : canvas,
  }); });
  await flush(maps.loadCallbacks);
  expect(renderer.root.findAllByType("button").some(node => node.children.includes("지도 중심에서 경유지 선택"))).toBe(false);
  await act(async () => renderer.root.findByProps({ className: "map-fullscreen-trigger" }).props.onClick());
  const chooseCenter = () => renderer.root.findAllByType("button").find(node => node.children.includes("지도 중심에서 경유지 선택"));
  await act(async () => chooseCenter()!.props.onClick());
  const down = () => {
    const event = new Event("pointerdown");
    Object.assign(event, { pointerId: 1, button: 0, clientX: 50, clientY: 100 });
    canvas.dispatchEvent(event);
  };
  await act(async () => { down(); vi.advanceTimersByTime(600); });
  expect(select.mock.calls).toEqual([[{ latitude: 37.5, longitude: 127.1 }], [{ latitude: 37.5, longitude: 127.1 }]]);
  expect(maps.Point).toHaveBeenCalledWith(30, 28);
  await act(async () => renderer.update(<KakaoMapCanvas points={points} />));
  expect(chooseCenter()).toBeUndefined();
  await act(async () => { down(); vi.advanceTimersByTime(600); });
  expect(select).toHaveBeenCalledTimes(2);
  expect(maps.MapConstructor).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByProps({ className: "map-viewing-hint" }).children).toHaveLength(1);
  await act(async () => renderer.unmount());
});

it("enables point selection after load, removes it when disabled, and leaves the existing camera intact", async () => {
  vi.useFakeTimers(); vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "fixture-key"); stubBrowser();
  const maps = installMaps(); const select = vi.fn();
  const element = Object.assign(new EventTarget(), {getBoundingClientRect: () => ({left:0,top:0})});
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<KakaoMapCanvas points={points} />, { createNodeMock: () => element }); });
  await flush(maps.loadCallbacks);
  await act(async () => renderer.update(<KakaoMapCanvas points={points} onSelectCoordinate={select} />));
  const down = () => { const event = new Event("pointerdown"); Object.assign(event, {pointerId:1,button:0,clientX:50,clientY:60}); element.dispatchEvent(event); };
  await act(async () => { down(); vi.advanceTimersByTime(600); });
  expect(select).toHaveBeenCalledExactlyOnceWith({latitude:37.5,longitude:127.1});
  expect(maps.projection.coordsFromContainerPoint).toHaveBeenCalledTimes(1);
  await act(async () => renderer.update(<KakaoMapCanvas points={points} />));
  down(); vi.advanceTimersByTime(600); expect(select).toHaveBeenCalledTimes(1);
  expect(maps.MapConstructor).toHaveBeenCalledTimes(1);
  expect(renderer.root.findAllByProps({className:"map-waypoint-actions"})).toHaveLength(0);
  await act(async () => renderer.unmount());
});

async function mountMap(
  path?: typeof actualPath,
  mapPoints: Array<{ label: string; latitude: number; longitude: number; role?: MapMarkerRole; nonTraversed?: boolean }> = points,
  showLegend = true,
) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <StrictMode><KakaoMapCanvas points={mapPoints} path={path} showLegend={showLegend} /></StrictMode>,
      rendererOptions,
    );
  });
  return renderer;
}

async function flush(callbacks: Listener[]) {
  await act(async () => {
    callbacks.splice(0).forEach((callback) => callback());
  });
}

function statusText(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ role: "status" }).children.filter((child) => typeof child === "string").join("");
}

function mapCanvas(renderer: ReactTestRenderer) {
  return renderer.root.find((node) => typeof node.props.className === "string" && node.props.className.startsWith("map-canvas"));
}

describe("KakaoMapCanvas", () => {
  it("keeps one SDK root while replacing overlays across repeated additions, empty geometry, and delayed redraws", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "fixture-key"); stubBrowser();
    const maps = installMaps();
    const renderer = await mountMap(actualPath);
    await flush(maps.loadCallbacks);
    const firstMarkers = [...maps.activeMarkers]; const firstLine = [...maps.activePolylines][0];
    for (let count = 1; count <= 2; count += 1) {
      const changedPoints = [...points, ...Array.from({ length: count }, (_, index) => ({
        label: `추가 경유지 ${index + 1}`, latitude: 37.51 + index / 100, longitude: 127.12 + index / 100, role: "waypoint" as const,
      }))];
      await act(async () => renderer.update(<StrictMode><KakaoMapCanvas points={changedPoints} path={actualPath} /></StrictMode>));
      expect(maps.activeMarkers.size).toBe(0); expect(maps.activePolylines.size).toBe(0);
      expect(mapCanvas(renderer).props.inert).toBe(true);
      await flush(maps.loadCallbacks);
      expect(maps.activeMarkers.size).toBe(changedPoints.length); expect(maps.activePolylines.size).toBe(2);
      expect(maps.mapLayers.size).toBe(1); expect([...maps.mapLayers.values()][0]).toHaveLength(1);
    }
    firstMarkers.forEach(marker => expect(marker.setMap).toHaveBeenCalledExactlyOnceWith(null));
    expect(firstLine.setMap).toHaveBeenCalledExactlyOnceWith(null);
    expect(maps.setBounds).toHaveBeenCalledTimes(3);

    // Cancel a geometry redraw before the SDK callback settles, then show empty.
    await act(async () => renderer.update(<StrictMode><KakaoMapCanvas points={points} /></StrictMode>));
    await act(async () => renderer.update(<StrictMode><KakaoMapCanvas points={[]} /></StrictMode>));
    await flush(maps.loadCallbacks);
    expect(statusText(renderer)).toContain("장소를 선택하면 지도에 표시해요");
    expect(maps.activeMarkers.size).toBe(0); expect(maps.activePolylines.size).toBe(0);
    expect(maps.setBounds).toHaveBeenCalledTimes(3);

    await act(async () => renderer.update(<StrictMode><KakaoMapCanvas points={points} /></StrictMode>));
    await flush(maps.loadCallbacks);
    expect(maps.MapConstructor).toHaveBeenCalledTimes(1);
    expect(maps.setBounds).toHaveBeenCalledTimes(4);
    expect(maps.activeMarkers.size).toBe(2); expect(maps.activePolylines.size).toBe(0);
    expect(mapCanvas(renderer).props.inert).toBe(false);
    await act(async () => renderer.unmount());
    expect(maps.activeMarkers.size).toBe(0); expect(maps.activePolylines.size).toBe(0);
  });

  it("removes replayed overlays and reuses the map when a ready SDK calls back synchronously under Strict Mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "fixture-key"); stubBrowser();
    const maps = installMaps({ synchronousLoad: true });
    const renderer = await mountMap(actualPath);
    expect(maps.MapConstructor).toHaveBeenCalledTimes(1);
    expect(maps.Marker).toHaveBeenCalledTimes(points.length * 2);
    expect(maps.setBounds).toHaveBeenCalledTimes(2);
    expect([...maps.mapLayers.values()][0]).toHaveLength(1);
    expect(maps.activeMarkers.size).toBe(2); expect(maps.activePolylines.size).toBe(2);
    expect(statusText(renderer)).toContain("실제 경로 지도 준비 완료");
    await act(async () => renderer.unmount());
    expect(maps.activeMarkers.size).toBe(0); expect(maps.activePolylines.size).toBe(0);
    for (const marker of maps.Marker.mock.instances as unknown as Array<InstanceType<KakaoMapsNamespace["Marker"]>>) expect(marker.setMap).toHaveBeenCalledExactlyOnceWith(null);
    for (const line of maps.Polyline.mock.instances as unknown as Array<InstanceType<KakaoMapsNamespace["Polyline"]>>) expect(line.setMap).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("hides a partial redraw and detaches its already created overlays before reusing the map", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "fixture-key"); stubBrowser();
    const maps = installMaps();
    maps.Marker.mockImplementationOnce(maps.Marker.getMockImplementation()!)
      .mockImplementationOnce(function () { throw new Error("partial marker failure"); });
    const renderer = await mountMap(actualPath);
    await flush(maps.loadCallbacks);
    expect(statusText(renderer)).toContain("카카오 지도 로드 실패");
    expect(mapCanvas(renderer).props.inert).toBe(true);
    expect(maps.activeMarkers.size).toBe(0); expect(maps.activePolylines.size).toBe(0);
    await act(async () => renderer.update(<StrictMode><KakaoMapCanvas points={points} /></StrictMode>));
    await flush(maps.loadCallbacks);
    expect(maps.MapConstructor).toHaveBeenCalledTimes(1);
    expect(maps.activeMarkers.size).toBe(2);
    expect(mapCanvas(renderer).props.inert).toBe(false);
    await act(async () => renderer.unmount());
    expect(maps.activeMarkers.size).toBe(0);
  });

  it("keeps the canvas inert if an old overlay cannot detach instead of exposing mixed geometry", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "fixture-key"); stubBrowser();
    const maps = installMaps();
    const renderer = await mountMap(actualPath);
    await flush(maps.loadCallbacks);
    const diagnostics = vi.spyOn(console, "error").mockImplementation(() => {});
    const stuckMarker = [...maps.activeMarkers][0];
    vi.mocked(stuckMarker.setMap).mockImplementation(() => { throw new Error("SDK cleanup failure"); });
    await act(async () => renderer.update(<StrictMode><KakaoMapCanvas points={[points[0]]} /></StrictMode>));
    expect(diagnostics).toHaveBeenCalledWith("지도 표시 요소를 정리하지 못했습니다.");
    expect(statusText(renderer)).toContain("카카오 지도 로드 실패");
    expect(mapCanvas(renderer).props.inert).toBe(true);
    expect(maps.MapConstructor).toHaveBeenCalledTimes(1);
    expect(maps.Marker).toHaveBeenCalledTimes(2);
    expect(maps.activeMarkers.size).toBe(1); expect(maps.activePolylines.size).toBe(0);
    await act(async () => renderer.unmount());
    diagnostics.mockRestore();
  });

  it("shows an explicit empty state and loads the map after the first place is selected", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "test-public-key");
    stubBrowser();
    const maps = installMaps();
    const renderer = await mountMap(undefined, []);

    expect(statusText(renderer)).toContain("장소를 선택하면 지도에 표시해요");
    expect(renderer.root.findAllByProps({ className: "schematic-map" })).toHaveLength(0);
    expect(maps.MapConstructor).not.toHaveBeenCalled();
    expect(maps.loadCallbacks).toHaveLength(0);

    await act(async () => {
      renderer.update(<StrictMode><KakaoMapCanvas points={[points[0]]} /></StrictMode>);
    });
    expect(statusText(renderer)).toContain("카카오 지도를 불러오는 중");
    await flush(maps.loadCallbacks);

    expect(maps.MapConstructor).toHaveBeenCalledTimes(1);
    expect(maps.Marker).toHaveBeenCalledTimes(1);
    expect(statusText(renderer)).toContain("카카오 지도 준비 완료");
    expect(mapCanvas(renderer).props.className).toContain("is-ready");
    await act(async () => renderer.unmount());
  });

  it("turns an SDK response without kakao.maps into a visible error without demo geometry", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "test-public-key");
    const scripts = stubBrowser();
    const renderer = await mountMap();
    await act(async () => scripts[0].emit("load"));

    expect(statusText(renderer)).toContain("카카오 지도 로드 실패");
    expect(renderer.root.findAllByProps({ className: "route-sketch" })).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

  it("does not leave the map in loading state when the SDK never settles", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "test-public-key");
    stubBrowser();
    const renderer = await mountMap();
    await act(async () => { vi.advanceTimersByTime(10_000); });

    expect(statusText(renderer)).toContain("카카오 지도 로드 실패");
    expect(renderer.root.findAllByProps({ className: "route-sketch" })).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

  it("renders the live Kakao map only after the SDK callback succeeds", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "test-public-key");
    stubBrowser();
    const maps = installMaps();
    const renderer = await mountMap(actualPath);
    await flush(maps.loadCallbacks);

    expect(maps.MapConstructor).toHaveBeenCalledTimes(1);
    expect(maps.Marker).toHaveBeenCalledTimes(points.length);
    expect(maps.MarkerImage).toHaveBeenCalledTimes(points.length);
    const markerCalls = maps.Marker.mock.calls as unknown as Array<[{ title: string; image: unknown }]>;
    expect(markerCalls.map(([options]) => options.title)).toEqual(["출발 · 출발", "복귀 · 복귀"]);
    expect(markerCalls[0][0].image).not.toBe(markerCalls[1][0].image);
    expect(maps.Polyline).toHaveBeenCalledTimes(2);
    const polylineCalls = maps.Polyline.mock.calls as unknown as Array<[
      { path: Array<{ getLat: () => number; getLng: () => number }> },
    ]>;
    expect(polylineCalls.map(([options]) => options)).toEqual([
      expect.objectContaining({ strokeWeight: 9, strokeColor: "#20252A" }),
      expect.objectContaining({ strokeWeight: 4.5, strokeColor: "#FFB800" }),
    ]);
    expect(polylineCalls[1][0].path).toEqual(polylineCalls[0][0].path);
    const renderedPath = polylineCalls[0][0].path;
    expect(renderedPath.map((point) => ({ latitude: point.getLat(), longitude: point.getLng() }))).toEqual(actualPath);
    expect(maps.extend).toHaveBeenCalledTimes(actualPath.length + points.length);
    expect(maps.setBounds).toHaveBeenCalledTimes(1);
    expect(mapCanvas(renderer).props.className).toContain("is-ready");
    expect(mapCanvas(renderer).props["aria-hidden"]).toBe(false);
    expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(1);
    expect(renderer.root.findByProps({ "aria-label": "지도 지점 표시 안내" }).findAllByType("li")).toHaveLength(2);
    expect(statusText(renderer)).toContain("실제 경로 지도 준비 완료");
    expect(renderer.root.findByProps({ role: "status" }).props.className).toContain("is-visually-hidden");
    await act(async () => renderer.unmount());
  });

  it("does not connect marker points with a synthetic straight line before an actual route exists", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "test-public-key");
    stubBrowser();
    const maps = installMaps();
    const renderer = await mountMap();
    await flush(maps.loadCallbacks);

    expect(maps.MapConstructor).toHaveBeenCalledTimes(1);
    expect(maps.Marker).toHaveBeenCalledTimes(points.length);
    expect(maps.Polyline).not.toHaveBeenCalled();
    expect(maps.extend).toHaveBeenCalledTimes(points.length);
    expect(statusText(renderer)).toContain("카카오 지도 준비 완료");
    await act(async () => renderer.unmount());
  });

  it("distinguishes every planned place role with text as well as color", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "test-public-key");
    stubBrowser();
    const maps = installMaps();
    const rolePoints = [
      { label: "출발지", latitude: 37.50, longitude: 127.10, role: "origin" as const },
      { label: "복귀지", latitude: 37.51, longitude: 127.11, role: "destination" as const },
      { label: "점심지", latitude: 37.52, longitude: 127.12, role: "lunch" as const },
      { label: "저녁지", latitude: 37.53, longitude: 127.13, role: "dinner" as const },
      { label: "휴식지", latitude: 37.54, longitude: 127.14, role: "rest" as const },
      { label: "경유지", latitude: 37.56, longitude: 127.16, role: "waypoint" as const },
    ];
    const renderer = await mountMap(undefined, rolePoints);
    await flush(maps.loadCallbacks);

    const markerCalls = maps.Marker.mock.calls as unknown as Array<[{ title: string }]>;
    expect(markerCalls.map(([options]) => options.title)).toEqual([
      "출발 · 출발지",
      "복귀 · 복귀지",
      "식사 · 점심지",
      "식사 · 저녁지",
      "휴식 · 휴식지",
      "경유 · 경유지",
    ]);
    const legend = renderer.root.findByProps({ "aria-label": "지도 지점 표시 안내" });
    expect(legend.findAllByType("li").map((item) => item.children.at(-1))).toEqual([
      "출발", "복귀", "식사", "식사", "휴식", "경유",
    ]);
    await act(async () => renderer.unmount());
  });

  it("lets the planner render the marker legend outside the map surface", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "test-public-key");
    stubBrowser();
    const maps = installMaps();
    const renderer = await mountMap(actualPath, points, false);
    await flush(maps.loadCallbacks);

    expect(renderer.root.findAllByProps({ "aria-label": "지도 지점 표시 안내" })).toHaveLength(0);
    expect(maps.Marker).toHaveBeenCalledTimes(points.length);
    expect(maps.Polyline).toHaveBeenCalledTimes(2);
    await act(async () => renderer.unmount());
  });

  it("renders same-coordinate roles as one composite marker", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "test-public-key");
    stubBrowser();
    const maps = installMaps();
    const renderer = await mountMap(undefined, [
      { label: "점심", latitude: 37.52, longitude: 127.12, role: "lunch" },
      { label: "점심 · 선택 경로 미통과", latitude: 37.52, longitude: 127.12, role: "waypoint", nonTraversed: true },
    ]);
    await flush(maps.loadCallbacks);

    expect(maps.Marker).toHaveBeenCalledTimes(1);
    expect(maps.MarkerImage).toHaveBeenCalledTimes(1);
    const markerCall = maps.Marker.mock.calls[0] as unknown as [{ title: string }];
    expect(markerCall[0].title).toBe("식사 · 점심 / 경유 · 점심 · 선택 경로 미통과");
    const markerImageCall = maps.MarkerImage.mock.calls[0] as unknown as [string];
    const compositeSvg = decodeURIComponent(markerImageCall[0].replace("data:image/svg+xml;charset=UTF-8,", ""));
    expect(compositeSvg).toContain(">식</text>");
    expect(compositeSvg).toContain(">경</text>");
    expect(compositeSvg).toContain('d="M50 8l6 6m0-6l-6 6"');
    expect(maps.extend).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  it("keeps all omitted points wired outside the real shared map during an SDK error", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "test-public-key");
    const scripts = stubBrowser();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <StrictMode><SharedRideSnapshotView
          snapshot={sharedRideSnapshotWithOmissions(20)}
          referenceTime="2030-01-01T00:00:00.000Z"
        /></StrictMode>,
        rendererOptions,
      );
    });
    await act(async () => scripts[0].emit("error"));

    expect(statusText(renderer)).toContain("카카오 지도 로드 실패");
    const notice = renderer.root.findByProps({ "aria-labelledby": "map-omissions-heading" });
    const sharedMap = renderer.root.findByProps({ "aria-label": "공유된 라이딩 경로" });
    expect(notice.findAllByType("li")).toHaveLength(20);
    expect(notice.findAllByType("li").at(-1)?.findAllByType("span")[1].children.join(""))
      .toContain("와인딩 경유지 20 · 선택 경로 미통과");
    expect(sharedMap.findAllByProps({ "aria-labelledby": "map-omissions-heading" })).toHaveLength(0);
    const notices = renderer.root.findByProps({ className: "riding-summary-notices" });
    expect(notices.findAllByProps({ "aria-labelledby": "map-omissions-heading" })).toHaveLength(1);
    expect(notices).not.toBe(sharedMap);
    await act(async () => renderer.unmount());
  });

  it("renders every omitted point when the supported maximum of twenty is present", async () => {
    const omittedPoints: MapPoint[] = Array.from({ length: 20 }, (_, index) => ({
      label: `와인딩 경유지 ${index + 1} · 선택 경로 미통과`,
      latitude: 37.5 + index / 1000,
      longitude: 127.1 + index / 1000,
      role: "waypoint" as const,
      nonTraversed: true,
    }));
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<MapOmissionList points={omittedPoints} />, rendererOptions);
    });

    const items = renderer.root.findByProps({ "aria-labelledby": "map-omissions-heading" }).findAllByType("li");
    expect(items).toHaveLength(20);
    expect(items.at(-1)?.findAllByType("span")[1].children.join("")).toContain("와인딩 경유지 20 · 선택 경로 미통과");
    await act(async () => renderer.unmount());
  });

  it("hides the previous canvas immediately when geometry changes", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "test-public-key");
    stubBrowser();
    const maps = installMaps();
    const renderer = await mountMap();
    await flush(maps.loadCallbacks);
    expect(mapCanvas(renderer).props.className).toContain("is-ready");

    await act(async () => {
      renderer.update(<StrictMode><KakaoMapCanvas points={points} path={actualPath} /></StrictMode>);
    });

    expect(mapCanvas(renderer).props.className).not.toContain("is-ready");
    expect(mapCanvas(renderer).props["aria-hidden"]).toBe(true);
    expect(statusText(renderer)).toContain("실제 경로 지도를 불러오는 중");
    expect(renderer.root.findAllByProps({ className: "route-sketch" })).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

  it("converts a partial SDK load exception into the safe error state", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "test-public-key");
    stubBrowser();
    installMaps({ throwOnLoad: true });
    const renderer = await mountMap(actualPath);

    expect(statusText(renderer)).toContain("카카오 지도 로드 실패");
    expect(mapCanvas(renderer).props.className).not.toContain("is-ready");
    await act(async () => renderer.unmount());
  });

  it("removes pending script listeners and timers when unmounted", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "test-public-key");
    const scripts = stubBrowser();
    const renderer = await mountMap();
    expect(scripts[0].listenerCount("load")).toBe(1);
    expect(scripts[0].listenerCount("error")).toBe(1);

    await act(async () => renderer.unmount());
    expect(scripts[0].listenerCount("load")).toBe(0);
    expect(scripts[0].listenerCount("error")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    scripts[0].emit("load");
    scripts[0].emit("error");
  });

  it("ignores a queued maps.load callback after unmount", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "test-public-key");
    stubBrowser();
    const maps = installMaps();
    const renderer = await mountMap(actualPath);
    await act(async () => renderer.unmount());
    await flush(maps.loadCallbacks);

    expect(maps.MapConstructor).not.toHaveBeenCalled();
    expect(maps.Marker).not.toHaveBeenCalled();
    expect(maps.Polyline).not.toHaveBeenCalled();
  });

  it("shows synthetic geometry only in explicit keyless demo mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "");
    stubBrowser();
    const renderer = await mountMap();

    expect(statusText(renderer)).toContain("예시 경로 개요 표시 중");
    expect(renderer.root.findAllByProps({ className: "route-sketch" })).toHaveLength(1);
    await act(async () => renderer.unmount());
  });
});
