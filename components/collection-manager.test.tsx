import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CollectionCourse } from "@/lib/collections/contracts";

const browserMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({
    from: () => ({
      select() { return this; },
      order: async () => ({ data: [], error: null }),
    }),
    functions: { invoke: browserMocks.invoke },
    rpc: vi.fn(),
  }),
}));

import { CollectionManager } from "./collection-manager";

const directCourse: CollectionCourse = {
  origin: {
    kakaoPlaceId: "origin-place",
    verificationToken: "origin-proof",
    name: "테스트 출발지",
    address: "서울특별시 테스트 출발로",
    roadAddress: null,
    longitude: 127,
    latitude: 37.5,
  },
  destination: {
    kakaoPlaceId: "destination-place",
    verificationToken: "destination-proof",
    name: "테스트 복귀지",
    address: "서울특별시 테스트 복귀로",
    roadAddress: null,
    longitude: 127.1,
    latitude: 37.6,
  },
  points: [],
};

function buttonWithText(root: ReactTestInstance, text: string) {
  return root.findAllByType("button").find((button) => (
    button.children.some((child) => typeof child === "string" && child.includes(text))
  ));
}

beforeEach(() => {
  browserMocks.invoke.mockReset();
  browserMocks.invoke.mockResolvedValue({ data: { versionNumber: 1 }, error: null });
  vi.stubGlobal("window", { clearTimeout, confirm: vi.fn(), setTimeout });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CollectionManager direct course", () => {
  it("saves an origin-to-destination course with no waypoint placeholder", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <CollectionManager currentCourse={directCourse} onApply={vi.fn()} onShare={vi.fn()} />,
      );
    });

    const input = renderer.root.findByType("input");
    await act(async () => input.props.onChange({ target: { value: "직접 코스" } }));
    const saveButton = buttonWithText(renderer.root, "현재 전체 코스로 새 컬렉션 저장");
    expect(saveButton).toBeDefined();
    expect(saveButton?.props.disabled).toBe(false);

    await act(async () => saveButton?.props.onClick());
    expect(browserMocks.invoke).toHaveBeenCalledWith("save-collection", {
      body: {
        saveOperationId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        collectionId: null,
        title: "직접 코스",
        description: "",
        origin: directCourse.origin,
        destination: directCourse.destination,
        points: [],
      },
    });
    await act(async () => renderer.unmount());
  });

  it("reuses one operation id after an unknown response outcome", async () => {
    browserMocks.invoke
      .mockResolvedValueOnce({ data: null, error: { message: "response lost" } })
      .mockResolvedValueOnce({ data: { versionNumber: 1 }, error: null });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<CollectionManager currentCourse={directCourse} onApply={vi.fn()} onShare={vi.fn()} />);
    });
    await act(async () => renderer.root.findByType("input").props.onChange({ target: { value: "재시도 코스" } }));
    const saveButton = buttonWithText(renderer.root, "현재 전체 코스로 새 컬렉션 저장");
    await act(async () => saveButton?.props.onClick());
    await act(async () => saveButton?.props.onClick());
    const firstId = browserMocks.invoke.mock.calls[0][1].body.saveOperationId;
    expect(browserMocks.invoke.mock.calls[1][1].body.saveOperationId).toBe(firstId);
    await act(async () => renderer.unmount());
  });
});
