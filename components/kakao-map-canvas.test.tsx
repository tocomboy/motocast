import { StrictMode } from "react";
import { act, create, type ReactTestRenderer, type TestRendererOptions } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KakaoMapCanvas, type MapMarkerRole } from "./kakao-map-canvas";

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
  const MapConstructor = vi.fn(function MapInstance(this: { setBounds: typeof setBounds }) {
    this.setBounds = setBounds;
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
  return { loadCallbacks, MapConstructor, Marker, MarkerImage, Polyline, extend, setBounds };
}

async function mountMap(
  path?: typeof actualPath,
  mapPoints: Array<{ label: string; latitude: number; longitude: number; role?: MapMarkerRole }> = points,
) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<StrictMode><KakaoMapCanvas points={mapPoints} path={path} /></StrictMode>, rendererOptions);
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
      { label: "굽이길", latitude: 37.55, longitude: 127.15, role: "winding" as const },
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
      "와인딩 · 굽이길",
      "경유 · 경유지",
    ]);
    const legend = renderer.root.findByProps({ "aria-label": "지도 지점 표시 안내" });
    expect(legend.findAllByType("li").map((item) => item.children.at(-1))).toEqual([
      "출발", "복귀", "점심", "저녁", "휴식", "와인딩", "경유",
    ]);
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
