import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CollectionCourse } from "@/lib/collections/contracts";

const browserMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  rows: [] as unknown[],
  loadError: null as unknown,
}));

vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({
    from: () => ({
      select() { return this; },
      order: async () => ({ data: browserMocks.rows, error: browserMocks.loadError }),
    }),
    functions: { invoke: browserMocks.invoke },
    rpc: browserMocks.rpc,
  }),
}));

import { CollectionManager } from "./collection-manager";

const directCourse: CollectionCourse = {
  origin: {
    kakaoPlaceId: "origin-place",
    verificationToken: "a".repeat(43),
    name: "테스트 출발지",
    address: "서울특별시 테스트 출발로",
    roadAddress: null,
    longitude: 127,
    latitude: 37.5,
  },
  destination: {
    kakaoPlaceId: "destination-place",
    verificationToken: "b".repeat(43),
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
  browserMocks.rpc.mockReset();
  browserMocks.rows = [];
  browserMocks.loadError = null;
  vi.stubGlobal("window", { clearTimeout, confirm: vi.fn(), setTimeout });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CollectionManager direct course", () => {
  it("saves an origin-to-destination course with no waypoint placeholder", async () => {
    let resolveSave!: (value: { data: { versionNumber: number }; error: null }) => void;
    browserMocks.invoke.mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve; }));
    const onSaved = vi.fn();
    const onBusyChange = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <CollectionManager mode="save-panel" currentCourse={directCourse} onApply={vi.fn()} onShare={vi.fn()} onSaved={onSaved} onBusyChange={onBusyChange} />,
      );
    });

    const input = renderer.root.findByType("input");
    await act(async () => input.props.onChange({ target: { value: "직접 코스" } }));
    const saveButton = buttonWithText(renderer.root, "내 경로에 저장");
    expect(saveButton).toBeDefined();
    expect(saveButton?.props.disabled).toBe(false);

    await act(async () => { void saveButton?.props.onClick(); });
    expect(onBusyChange).toHaveBeenCalledWith(true);
    await act(async () => resolveSave({ data: { versionNumber: 1 }, error: null }));
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
    expect(onSaved).toHaveBeenCalledWith("직접 코스");
    await act(async () => renderer.unmount());
  });

  it("reuses one operation id after an unknown response outcome", async () => {
    browserMocks.invoke
      .mockResolvedValueOnce({ data: null, error: { message: "response lost" } })
      .mockResolvedValueOnce({ data: { versionNumber: 1 }, error: null });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<CollectionManager mode="save-panel" currentCourse={directCourse} onApply={vi.fn()} onShare={vi.fn()} />);
    });
    await act(async () => renderer.root.findByType("input").props.onChange({ target: { value: "재시도 코스" } }));
    const saveButton = buttonWithText(renderer.root, "내 경로에 저장");
    await act(async () => saveButton?.props.onClick());
    await act(async () => saveButton?.props.onClick());
    const firstId = browserMocks.invoke.mock.calls[0][1].body.saveOperationId;
    expect(browserMocks.invoke.mock.calls[1][1].body.saveOperationId).toBe(firstId);
    await act(async () => renderer.unmount());
  });

  it("shows a stable saved result and opens the saved routes view", async () => {
    const onShowCollections = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<CollectionManager mode="save" currentCourse={directCourse} onApply={vi.fn()} onShare={vi.fn()} onShowCollections={onShowCollections} />, {
        createNodeMock: (element) => element.type === "dialog" ? { showModal: vi.fn(), close: vi.fn() } : {},
      });
    });
    await act(async () => buttonWithText(renderer.root, "경로 저장")?.props.onClick());
    await act(async () => renderer.root.findByType("input").props.onChange({ target: { value: "남한강 코스" } }));
    const confirmSave = renderer.root.findAllByType("button").find((button) => button.children.join("") === "저장");
    await act(async () => confirmSave?.props.onClick());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(renderer.root.findByProps({ role: "status" }).findByType("strong").children).toEqual(["남한강 코스"]);
    expect(renderer.root.findAllByType("input")).toHaveLength(0);
    await act(async () => buttonWithText(renderer.root, "저장한 경로 보기")?.props.onClick());
    expect(onShowCollections).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  it("does not navigate after a save-panel request settles after unmount", async () => {
    let resolveSave!: (value: { data: { versionNumber: number }; error: null }) => void;
    browserMocks.invoke.mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve; }));
    const onSaved = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<CollectionManager mode="save-panel" currentCourse={directCourse} onApply={vi.fn()} onShare={vi.fn()} onSaved={onSaved} />);
    });
    await act(async () => renderer.root.findByType("input").props.onChange({ target: { value: "늦은 코스" } }));
    await act(async () => { void buttonWithText(renderer.root, "내 경로에 저장")?.props.onClick(); });
    await act(async () => renderer.unmount());
    await act(async () => resolveSave({ data: { versionNumber: 1 }, error: null }));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("keeps a collection mutation failure visible after the list loaded", async () => {
    browserMocks.rows = [{
      id: "collection-1",
      title: "삭제 실패 코스",
      description: "",
      updated_at: "2026-09-17T00:00:00.000Z",
      collection_versions: [{
        id: "version-1",
        version_number: 1,
        created_at: "2026-09-17T00:00:00.000Z",
        origin: directCourse.origin,
        destination: directCourse.destination,
        points: [],
      }],
    }];
    browserMocks.rpc.mockResolvedValue({ error: { message: "denied" } });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<CollectionManager currentCourse={directCourse} onApply={vi.fn()} onShare={vi.fn()} />);
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    const deleteButton = renderer.root.findAllByType("button").find((button) => button.props["aria-label"] === "삭제 실패 코스 삭제");
    expect(deleteButton).toBeDefined();
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => deleteButton?.props.onClick());
    const feedback = renderer.root.findByProps({ className: "manager-operation-feedback" });
    expect(feedback.props.role).toBe("alert");
    expect(feedback.children.join("")).toContain("삭제하지 못했습니다");
    await act(async () => renderer.unmount());
  });
});
