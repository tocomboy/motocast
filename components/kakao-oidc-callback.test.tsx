import { StrictMode, type ReactNode } from "react";
import { act, create, type ReactTestRenderer, type TestRendererOptions } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, onNavigate, ...props }: {
    children: ReactNode;
    href: string;
    className?: string;
    onNavigate?: () => void;
  }) => <a {...props} onClick={() => onNavigate?.()}>{children}</a>,
}));

import { KakaoOidcCallback } from "./kakao-oidc-callback";

const handoff = "a".repeat(43);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderDelayedCallback() {
  vi.useFakeTimers();
  let resolveCompletion!: (response: Response) => void;
  const completion = new Promise<Response>((resolve) => { resolveCompletion = resolve; });
  const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
    if (String(input) === "/api/auth/kakao/complete") return completion;
    return Promise.resolve(new Response(JSON.stringify({ cleared: true }), { status: 200 }));
  });
  const replace = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("window", {
    history: { replaceState: vi.fn() },
    location: {
      hash: `#${handoff}`,
      pathname: "/auth/kakao/callback",
      search: "",
      replace,
    },
  });

  let renderer!: ReactTestRenderer;
  const strictOptions: TestRendererOptions & { unstable_strictMode: boolean } = {
    createNodeMock: () => null,
    unstable_strictMode: true,
  };
  await act(async () => {
    renderer = create(<StrictMode><KakaoOidcCallback /></StrictMode>, strictOptions);
  });
  const completionCalls = fetcher.mock.calls.filter(([input]) => String(input) === "/api/auth/kakao/complete");
  expect(completionCalls).toHaveLength(1);
  expect((completionCalls[0][1] as RequestInit | undefined)?.signal).toBeUndefined();

  await act(async () => { vi.advanceTimersByTime(10_000); });
  await act(async () => { renderer.root.findByType("a").props.onClick(); });
  return { completion, fetcher, renderer, replace, resolveCompletion };
}

describe("KakaoOidcCallback", () => {
  it("keeps one completion request through Strict Mode and blocks a late redirect after navigation", async () => {
    const result = await renderDelayedCallback();
    await act(async () => {
      result.resolveCompletion(new Response(JSON.stringify({ redirect: "/" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
      await result.completion;
    });

    expect(result.replace).not.toHaveBeenCalled();
    expect(result.fetcher.mock.calls.filter(([input]) => String(input) === "/api/auth/kakao/cancel")).toHaveLength(1);
    await act(async () => { result.renderer.unmount(); });
  });

  it("blocks a late error state update after navigation", async () => {
    const result = await renderDelayedCallback();
    await act(async () => {
      result.resolveCompletion(new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
      await result.completion;
    });

    expect(result.renderer.root.findByType("h1").children).toEqual(["로그인 처리가 지연되고 있습니다"]);
    expect(result.replace).not.toHaveBeenCalled();
    await act(async () => { result.renderer.unmount(); });
  });
});
