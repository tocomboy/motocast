import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getBrowserSupabase = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/browser", () => ({ getBrowserSupabase }));
vi.mock("next/link", () => ({ default: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
vi.mock("@/components/kakao-map-canvas", () => ({
  KakaoMapCanvas: () => <div data-testid="map" />,
}));
vi.mock("@/components/place-search-field", () => ({
  PlaceSearchField: ({ label }: { label: string }) => <label>{label}<input /></label>,
}));
vi.mock("@/components/share-manager", () => ({
  ShareManager: () => <section aria-label="공유 관리" />,
}));

import { PlannerDashboard } from "./planner-dashboard";

function installWindow() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
    matchMedia: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  vi.stubGlobal("document", { activeElement: null });
}

describe("rollback planner wiring", () => {
  beforeEach(() => {
    getBrowserSupabase.mockReset();
    installWindow();
  });

  it("mounts the connected planner with visible collection closure and no collection request", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<PlannerDashboard connected />);
    });

    const collection = renderer.root.findByProps({ "aria-labelledby": "rollback-collection-heading" });
    expect(collection.findAllByType("button")).toHaveLength(0);
    expect(collection.findByProps({ role: "status" }).children.join(" ")).toContain("저장·새 버전·적용을 일시 중지");
    expect(renderer.root.findAll((node) => (
      typeof node.props["aria-label"] === "string" && /컬렉션.*(저장|적용|삭제|공유 준비)/.test(node.props["aria-label"])
    ))).toHaveLength(0);
    expect(getBrowserSupabase).not.toHaveBeenCalled();

    await act(async () => renderer.unmount());
  });
});
