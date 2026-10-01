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

function installMaps({ throwOnLoad = false }: { throwOnLoad?: boolean } = {}) {
  const loadCallbacks: Listener[] = [];
  const extend = vi.fn();
  const setBounds = vi.fn();
  const coordinate = { getLat: () => 37.5, getLng: () => 127.1 };
  let center = coordinate;
  let level = 8;
  const setCenter = vi.fn((point: typeof coordinate) => { center = point; });
  const setLevel = vi.fn((value: number) => { level = value; });
  const relayout = vi.fn(() => {
    center = { getLat: () => 0, getLng: () => 0 };
    level = 1;
  });
  const projection = { coordsFromContainerPoint: vi.fn(() => coordinate) };
  const MapConstructor = vi.fn(function MapInstance(this: InstanceType<KakaoMapsNamespace["Map"]>) {
    this.setBounds = setBounds;
    this.getProjection = () => projection;
    this.getCenter = () => center;
    this.setCenter = setCenter;
    this.getLevel = () => level;
    this.setLevel = setLevel;
    this.relayout = relayout;
  });
  const Marker = vi.fn(function MarkerInstance() {});
  const MarkerImage = vi.fn(function MarkerImageInstance() {});
  const Polyline = vi.fn(function PolylineInstance() {});
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
      loadCallbacks.push(callback);
    }),
    LatLng,
    LatLngBounds,
    Map: MapConstructor,
    Marker,
    MarkerImage,
    Size,
    Point,
    Polyline,
  };
  (window as Window).kakao = { maps: maps as unknown as KakaoMapsNamespace };
  return { loadCallbacks, MapConstructor, Marker, MarkerImage, Polyline, Point, extend, setBounds, projection, setCenter, setLevel, relayout };
}

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
  await act(async () => renderer.root.findByType("dialog").props.onCancel({ preventDefault }));
  await resize();
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(surface.show).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByType("dialog").props.role).toBe("region");
  expect(expanded.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  expect(maps.MapConstructor).toHaveBeenCalledTimes(1);
  expect(maps.Polyline).toHaveBeenCalledTimes(1);
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
  await act(async () => { renderer = create(<KakaoMapCanvas points={points} onSelectCoordinate={select} />, {
    createNodeMock: node => node.type === "dialog" ? surface : node.type === "button" ? { focus: vi.fn() } : canvas,
  }); });
  await flush(maps.loadCallbacks);
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
    expect(maps.Polyline).toHaveBeenCalledTimes(1);
    const polylineCalls = maps.Polyline.mock.calls as unknown as Array<[
      { path: Array<{ getLat: () => number; getLng: () => number }> },
    ]>;
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
      "점심 · 점심지",
      "저녁 · 저녁지",
      "휴식 · 휴식지",
      "경유 · 경유지",
    ]);
    const legend = renderer.root.findByProps({ "aria-label": "지도 지점 표시 안내" });
    expect(legend.findAllByType("li").map((item) => item.children.at(-1))).toEqual([
      "출발", "복귀", "점심", "저녁", "휴식", "경유",
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
    expect(maps.Polyline).toHaveBeenCalledTimes(1);
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
    expect(markerCall[0].title).toBe("점심 · 점심 / 경유 · 점심 · 선택 경로 미통과");
    const markerImageCall = maps.MarkerImage.mock.calls[0] as unknown as [string];
    const compositeSvg = decodeURIComponent(markerImageCall[0].replace("data:image/svg+xml;charset=UTF-8,", ""));
    expect(compositeSvg).toContain(">점</text>");
    expect(compositeSvg).toContain(">경×</text>");
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
