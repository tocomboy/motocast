import { StrictMode, type ReactNode } from "react";
import { act, create, type ReactTestRenderer, type TestRendererOptions } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReleaseAnnouncement } from "./release-announcement";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string; onClick?: () => void }) => (
    <a {...props}>{children}</a>
  ),
}));

const presentationId = "82000000-0000-4000-8000-000000000001";

function dialogNode() {
  return {
    close: vi.fn(),
    open: false,
    showModal: vi.fn(),
  };
}

async function renderAnnouncement(node = dialogNode()) {
  let renderer!: ReactTestRenderer;
  const options: TestRendererOptions = {
    createNodeMock: (element) => element.type === "dialog" ? node : {},
  };
  await act(async () => {
    renderer = create(<StrictMode><ReleaseAnnouncement /></StrictMode>, options);
  });
  return { node, renderer };
}

function text(renderer: ReactTestRenderer) {
  return renderer.root.findAll((item) => item.children.some((child) => typeof child === "string"))
    .flatMap((item) => item.children.filter((child) => typeof child === "string"))
    .join(" ");
}

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => presentationId) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("release announcement", () => {
  it("uses one presentation request across Strict Mode replay and opens the current note", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ show: true, version: "0.2.0" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { node, renderer } = await renderAnnouncement();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/releases/claim", expect.objectContaining({
      body: JSON.stringify({ expectedVersion: "0.2.0", presentationId }),
      cache: "no-store",
      method: "POST",
    }));
    expect(node.showModal).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByType("p")
      .some((paragraph) => paragraph.children.join("") === "현재 v0.2.0")).toBe(true);
    expect(renderer.root.findByProps({ id: "release-announcement-title" }).children.join(""))
      .toBe("새로운 소식을 확인해 보세요");
    await act(async () => renderer.unmount());
  });

  it("does not show a late successful response after the component detaches", async () => {
    let resolveResponse!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => pending));

    const { node, renderer } = await renderAnnouncement();
    await act(async () => renderer.unmount());
    await act(async () => resolveResponse(new Response(JSON.stringify({ show: true, version: "0.2.0" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));

    expect(node.showModal).not.toHaveBeenCalled();
  });

  it("retries a failed request with the same presentation UUID", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ show: true, version: "0.2.0" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const { node, renderer } = await renderAnnouncement();
    const retry = renderer.root.findAllByType("button")
      .find((button) => button.children.includes("다시 시도"));
    expect(retry).toBeDefined();
    expect(retry!.children).toEqual(["다시 시도"]);
    await act(async () => retry!.props.onClick());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(([, options]) => JSON.parse(String(options?.body)));
    expect(bodies).toEqual([
      { expectedVersion: "0.2.0", presentationId },
      { expectedVersion: "0.2.0", presentationId },
    ]);
    expect(node.showModal).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  it("ignores a retry result after the component detaches", async () => {
    let resolveRetry!: (response: Response) => void;
    const retryPending = new Promise<Response>((resolve) => {
      resolveRetry = resolve;
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(retryPending));

    const { node, renderer } = await renderAnnouncement();
    const retry = renderer.root.findAllByType("button")
      .find((button) => button.children.includes("다시 시도"));
    await act(async () => retry!.props.onClick());
    await act(async () => renderer.unmount());
    await act(async () => resolveRetry(new Response(JSON.stringify({ show: true, version: "0.2.0" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));

    expect(node.showModal).not.toHaveBeenCalled();
  });

  it("shows a reload notice without retrying when the server version is newer", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "stale" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);

    const { node, renderer } = await renderAnnouncement();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(node.showModal).not.toHaveBeenCalled();
    expect(text(renderer)).toContain("새 버전이 준비됐어요. 새로고침 후 확인해 주세요.");
    expect(renderer.root.findAllByType("button").some((button) => button.children.includes("다시 시도"))).toBe(false);
    await act(async () => renderer.unmount());
  });
});
