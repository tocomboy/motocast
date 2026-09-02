import { StrictMode, type ReactNode } from "react";
import { act, create, type ReactTestRenderer, type TestRendererOptions } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicSharedRide } from "./public-shared-ride";
import { rawSharedRideSnapshotWithOmissions } from "../tests/fixtures/shared-ride-snapshot";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string; className?: string; "aria-label"?: string }) => <a {...props}>{children}</a>,
}));

vi.mock("@/components/shared-ride-snapshot", () => ({
  SharedRideSnapshotView: ({ snapshot }: { snapshot: { trip: { title: string } } }) => <h2>{snapshot.trip.title}</h2>,
}));

const validToken = "a".repeat(43);

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWindow(token: string, replaceState: (...args: [unknown, string, string]) => void) {
  const location = { hash: `#${token}`, pathname: "/share", search: "" };
  const hashChangeListeners = new Set<() => void>();
  vi.stubGlobal("window", {
    location,
    history: {
      replaceState: (...args: [unknown, string, string]) => {
        replaceState(...args);
        location.hash = "";
      },
    },
    addEventListener: (type: string, listener: () => void) => {
      if (type === "hashchange") hashChangeListeners.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === "hashchange") hashChangeListeners.delete(listener);
    },
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
  });
  return (nextToken: string) => {
    location.hash = `#${nextToken}`;
    for (const listener of hashChangeListeners) listener();
  };
}

async function renderSharedRide() {
  let renderer!: ReactTestRenderer;
  const options: TestRendererOptions & { unstable_strictMode: boolean } = {
    createNodeMock: () => ({}),
    unstable_strictMode: true,
  };
  await act(async () => {
    renderer = create(<StrictMode><PublicSharedRide /></StrictMode>, options);
  });
  return renderer;
}

function pageText(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType("h1").flatMap((heading) => heading.children).join("");
}

describe("PublicSharedRide fragment handling", () => {
  it("removes the bearer fragment before one Strict Mode resolver request", async () => {
    const events: string[] = [];
    const replaceState = vi.fn(() => { events.push("replaceState"); });
    const fetchMock = vi.fn(async () => {
      events.push("fetch");
      return { ok: false, status: 404 } as Response;
    });
    stubWindow(validToken, replaceState);
    vi.stubGlobal("fetch", fetchMock);

    const renderer = await renderSharedRide();

    expect(events).toEqual(["replaceState", "fetch"]);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/share");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/shares/resolve", expect.objectContaining({
      body: JSON.stringify({ token: validToken }),
      cache: "no-store",
      method: "POST",
    }));
    expect(pageText(renderer)).toContain("공유 링크가 없거나 회수되었습니다");
    await act(async () => renderer.unmount());
  });

  it("removes a malformed fragment without calling the resolver", async () => {
    const replaceState = vi.fn();
    const fetchMock = vi.fn();
    stubWindow("invalid", replaceState);
    vi.stubGlobal("fetch", fetchMock);

    const renderer = await renderSharedRide();

    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pageText(renderer)).toContain("공유 링크 형식을 확인해 주세요");
    await act(async () => renderer.unmount());
  });

  it("fails closed before resolver access when fragment removal fails", async () => {
    const fetchMock = vi.fn();
    stubWindow(validToken, () => { throw new Error("history blocked"); });
    vi.stubGlobal("fetch", fetchMock);

    const renderer = await renderSharedRide();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(pageText(renderer)).toContain("공유 정보를 지금 불러올 수 없습니다");
    await act(async () => renderer.unmount());
  });

  it("keeps the newest snapshot when an earlier bearer finishes JSON parsing late", async () => {
    const replaceState = vi.fn();
    let finishFirstJson!: (value: unknown) => void;
    const firstJson = new Promise((resolve) => { finishFirstJson = resolve; });
    const baseSnapshot = rawSharedRideSnapshotWithOmissions(0);
    const firstSnapshot = { ...baseSnapshot, trip: { ...baseSnapshot.trip, title: "첫 공유본" } };
    const secondSnapshot = { ...baseSnapshot, trip: { ...baseSnapshot.trip, title: "두 번째 공유본" } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => firstJson } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ snapshot: secondSnapshot }) } as Response);
    const navigateHash = stubWindow(validToken, replaceState);
    vi.stubGlobal("fetch", fetchMock);
    const renderer = await renderSharedRide();

    const nextToken = "b".repeat(43);
    await act(async () => navigateHash(nextToken));

    expect(replaceState).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/shares/resolve", expect.objectContaining({
      body: JSON.stringify({ token: nextToken }),
    }));
    expect(window.location.hash).toBe("");
    expect(renderer.root.findByType("h2").children).toEqual(["두 번째 공유본"]);

    await act(async () => finishFirstJson({ snapshot: firstSnapshot }));

    expect(renderer.root.findByType("h2").children).toEqual(["두 번째 공유본"]);
    await act(async () => renderer.unmount());
  });
});
