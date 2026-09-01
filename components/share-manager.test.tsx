import { StrictMode } from "react";
import { act, create, type ReactTestRenderer, type TestRendererOptions } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browserMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({
    from: browserMocks.from,
    rpc: browserMocks.rpc,
  }),
}));

import { ShareManager } from "./share-manager";

const tripId = "123e4567-e89b-42d3-a456-426614174000";

beforeEach(() => {
  browserMocks.from.mockReset();
  browserMocks.from.mockReturnValue({
    select() { return this; },
    order: async () => ({ data: [], error: null }),
  });
  browserMocks.rpc.mockReset();
  browserMocks.rpc.mockResolvedValue({ data: null, error: { message: "expected test refusal" } });
  vi.stubGlobal("window", {
    clearTimeout,
    location: { origin: "https://preview.example.test" },
    setTimeout,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderShareManager(disabled = false, currentTripId: string | null = tripId, sessionEpoch = 0, previewRequest = 1) {
  let renderer!: ReactTestRenderer;
  const options: TestRendererOptions & { unstable_strictMode: boolean } = {
    createNodeMock: () => ({}),
    unstable_strictMode: true,
  };
  await act(async () => {
    renderer = create(
      <StrictMode><ShareManager tripId={currentTripId} sessionEpoch={sessionEpoch} previewRequest={previewRequest} disabled={disabled} /></StrictMode>,
      options,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return renderer;
}

describe("ShareManager collection preview request", () => {
  it("starts exactly one preview RPC across Strict Mode effect replay", async () => {
    const renderer = await renderShareManager();
    expect(browserMocks.rpc).toHaveBeenCalledTimes(1);
    expect(browserMocks.rpc).toHaveBeenCalledWith("preview_trip_share", { target_trip_id: tripId });
    await act(async () => renderer.unmount());
  });

  it("defers the request while disabled and consumes it once after planning unlocks", async () => {
    const renderer = await renderShareManager(true);
    expect(browserMocks.rpc).not.toHaveBeenCalled();
    await act(async () => {
      renderer.update(<StrictMode><ShareManager tripId={tripId} previewRequest={1} disabled={false} /></StrictMode>);
    });
    expect(browserMocks.rpc).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  it("does not preview when the parent withholds a trip lacking fresh weather", async () => {
    const renderer = await renderShareManager(false, null);
    expect(browserMocks.rpc).not.toHaveBeenCalled();
    const previewButton = renderer.root.findAllByType("button")[0];
    expect(previewButton.props.disabled).toBe(true);
    await act(async () => renderer.unmount());
  });

  it("does not replay a consumed automatic preview after the same trip is blocked and becomes ready again", async () => {
    const renderer = await renderShareManager();
    expect(browserMocks.rpc).toHaveBeenCalledTimes(1);
    await act(async () => {
      renderer.update(<StrictMode><ShareManager tripId={null} previewRequest={0} /></StrictMode>);
    });
    await act(async () => {
      renderer.update(<StrictMode><ShareManager tripId={tripId} previewRequest={1} /></StrictMode>);
    });
    expect(browserMocks.rpc).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  it("announces the blocked state when fresh weather expires without reloading link history", async () => {
    const renderer = await renderShareManager();
    const initialLinkReads = browserMocks.from.mock.calls.length;
    expect(renderer.root.findByProps({ className: "manager-status" }).children.join(""))
      .toContain("공유 미리보기를 만들지 못했습니다");
    await act(async () => {
      renderer.update(<StrictMode><ShareManager tripId={null} sessionEpoch={0} previewRequest={0} /></StrictMode>);
    });
    expect(renderer.root.findByProps({ className: "manager-status" }).children.join(""))
      .toContain("유효한 최신 날씨를 준비한 뒤 공유할 수 있습니다");
    expect(browserMocks.from).toHaveBeenCalledTimes(initialLinkReads);
    await act(async () => renderer.unmount());
  });

  it("starts a new session request without remounting or reloading link history", async () => {
    const renderer = await renderShareManager();
    const initialLinkReads = browserMocks.from.mock.calls.length;
    await act(async () => {
      renderer.update(<StrictMode><ShareManager tripId={null} sessionEpoch={1} previewRequest={0} /></StrictMode>);
    });
    await act(async () => {
      renderer.update(<StrictMode><ShareManager tripId={tripId} sessionEpoch={1} previewRequest={2} /></StrictMode>);
    });
    expect(browserMocks.rpc).toHaveBeenCalledTimes(2);
    expect(browserMocks.from).toHaveBeenCalledTimes(initialLinkReads);
    await act(async () => renderer.unmount());
  });

  it("ignores a late preview response from an invalidated session", async () => {
    let resolveOldPreview!: (value: { data: null; error: { message: string } }) => void;
    browserMocks.rpc.mockReturnValueOnce(new Promise((resolve) => { resolveOldPreview = resolve; }));
    const renderer = await renderShareManager();
    expect(browserMocks.rpc).toHaveBeenCalledTimes(1);
    await act(async () => {
      renderer.update(<StrictMode><ShareManager tripId={null} sessionEpoch={1} previewRequest={0} /></StrictMode>);
    });
    await act(async () => {
      resolveOldPreview({ data: null, error: { message: "late old-session failure" } });
      await Promise.resolve();
    });
    expect(renderer.root.findByProps({ className: "manager-status" }).children.join(""))
      .toContain("유효한 최신 날씨를 준비한 뒤 공유할 수 있습니다");
    await act(async () => {
      renderer.update(<StrictMode><ShareManager tripId={tripId} sessionEpoch={1} previewRequest={2} /></StrictMode>);
    });
    expect(browserMocks.rpc).toHaveBeenCalledTimes(2);
    await act(async () => renderer.unmount());
  });
});
