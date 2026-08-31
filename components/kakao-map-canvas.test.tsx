import { StrictMode } from "react";
import { act, create, type ReactTestRenderer, type TestRendererOptions } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KakaoMapCanvas } from "./kakao-map-canvas";

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
  { label: "출발", latitude: 37.5, longitude: 127.1 },
  { label: "복귀", latitude: 37.6, longitude: 127.2 },
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
  const Polyline = vi.fn(function PolylineInstance() {});
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
    Polyline,
  };
  (window as Window).kakao = { maps: maps as unknown as KakaoMapsNamespace };
  return { loadCallbacks, MapConstructor, Marker, Polyline, extend, setBounds };
}

async function mountMap(path?: typeof actualPath) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<StrictMode><KakaoMapCanvas points={points} path={path} /></StrictMode>, rendererOptions);
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
    expect(maps.Polyline).toHaveBeenCalledTimes(1);
    expect(maps.extend).toHaveBeenCalledTimes(actualPath.length + points.length);
    expect(maps.setBounds).toHaveBeenCalledTimes(1);
    expect(mapCanvas(renderer).props.className).toContain("is-ready");
    expect(mapCanvas(renderer).props["aria-hidden"]).toBe(false);
    expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(1);
    expect(statusText(renderer)).toContain("실제 경로 지도 준비 완료");
    expect(renderer.root.findByProps({ role: "status" }).props.className).toContain("is-visually-hidden");
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
