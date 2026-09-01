import { StrictMode } from "react";
import { act, create, type ReactTestRenderer, type TestRendererOptions } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browserMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({
    from: () => ({
      select() { return this; },
      order: async () => ({ data: [], error: null }),
    }),
    rpc: browserMocks.rpc,
  }),
}));

import { ShareManager } from "./share-manager";

const tripId = "123e4567-e89b-42d3-a456-426614174000";

beforeEach(() => {
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

async function renderShareManager(disabled = false, currentTripId: string | null = tripId) {
  let renderer!: ReactTestRenderer;
  const options: TestRendererOptions & { unstable_strictMode: boolean } = {
    createNodeMock: () => ({}),
    unstable_strictMode: true,
  };
  await act(async () => {
    renderer = create(
      <StrictMode><ShareManager tripId={currentTripId} previewRequest={1} disabled={disabled} /></StrictMode>,
      options,
    );
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
});
