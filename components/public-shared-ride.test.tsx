import { StrictMode, type ReactNode } from "react";
import { act, create, type ReactTestRenderer, type TestRendererOptions } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicSharedRide } from "./public-shared-ride";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string; className?: string; "aria-label"?: string }) => <a {...props}>{children}</a>,
}));

const validToken = "a".repeat(43);

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWindow(token: string, replaceState: () => void) {
  vi.stubGlobal("window", {
    location: { hash: `#${token}`, pathname: "/share", search: "" },
    history: { replaceState },
  });
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
});
