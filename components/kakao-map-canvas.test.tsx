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
}

const points = [
  { label: "출발", latitude: 37.5, longitude: 127.1 },
  { label: "복귀", latitude: 37.6, longitude: 127.2 },
];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function renderMap() {
  vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "test-public-key");
  const scripts: FakeScript[] = [];
  vi.stubGlobal("window", {
    clearTimeout,
    setTimeout,
  });
  vi.stubGlobal("document", {
    createElement: () => new FakeScript(),
    head: { appendChild: (script: FakeScript) => scripts.push(script) },
    querySelector: () => scripts[0] ?? null,
  });

  let renderer!: ReactTestRenderer;
  const options: TestRendererOptions & { unstable_strictMode: boolean } = {
    createNodeMock: () => ({}),
    unstable_strictMode: true,
  };
  await act(async () => {
    renderer = create(<StrictMode><KakaoMapCanvas points={points} /></StrictMode>, options);
  });
  return { renderer, script: scripts[0] };
}

function statusText(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ role: "status" }).children.filter((child) => typeof child === "string").join("");
}

describe("KakaoMapCanvas", () => {
  it("turns an SDK response without kakao.maps into a visible error", async () => {
    const { renderer, script } = await renderMap();
    await act(async () => script.emit("load"));

    expect(statusText(renderer)).toContain("카카오 지도 로드 실패");
    await act(async () => renderer.unmount());
  });

  it("does not leave the map in loading state when the SDK never settles", async () => {
    vi.useFakeTimers();
    const { renderer } = await renderMap();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(statusText(renderer)).toContain("카카오 지도 로드 실패");
    await act(async () => renderer.unmount());
  });
});
