import { StrictMode, type ReactNode } from "react";
import { act, create, type ReactTestRenderer, type TestRendererOptions } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicSharedRide } from "./public-shared-ride";
import { rawSharedRideSnapshotWithOmissions } from "../tests/fixtures/shared-ride-snapshot";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string; className?: string; "aria-label"?: string }) => <a {...props}>{children}</a>,
}));

vi.mock("@/components/shared-ride-snapshot", () => ({
  SharedRideSnapshotView: ({ snapshot, actions }: { snapshot: { trip: { title: string } }; actions?: ReactNode }) => <><h2>{snapshot.trip.title}</h2>{actions}</>,
}));
vi.mock("@/components/planner-dashboard", () => ({
  PlannerDashboard: ({ initialTitle }: { initialTitle: string }) => <div data-embedded-planner>{initialTitle}</div>,
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
    createNodeMock: (element) => element.type === "dialog" ? { showModal: vi.fn(), close: vi.fn() } : {},
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

function snapshotTitle(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType("h2").find((heading) => heading.children.includes("두 번째 공유본") || heading.children.includes("첫 공유본"));
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
    expect(snapshotTitle(renderer)?.children).toEqual(["두 번째 공유본"]);

    await act(async () => finishFirstJson({ snapshot: firstSnapshot }));

    expect(snapshotTitle(renderer)?.children).toEqual(["두 번째 공유본"]);
    await act(async () => renderer.unmount());
  });

  it("reuses the same save operation after an unknown outcome and changes it with the title", async () => {
    const snapshot = rawSharedRideSnapshotWithOmissions(0);
    const saveBodies: Array<{ saveOperationId: string; title: string }> = [];
    let saveAttempt = 0;
    const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
      if (url === "/api/shares/resolve") return { ok: true, status: 200, json: async () => ({ snapshot }) } as Response;
      const body = JSON.parse(String(options.body)) as { saveOperationId: string; title: string };
      saveBodies.push(body);
      saveAttempt += 1;
      return saveAttempt === 1
        ? { ok: false, status: 503, json: async () => ({ error: "잠시 뒤 다시 시도해 주세요." }) } as Response
        : { ok: true, status: 200, json: async () => ({ collectionId: "c", versionId: "v", versionNumber: 1 }) } as Response;
    });
    stubWindow(validToken, vi.fn());
    vi.stubGlobal("fetch", fetchMock);
    const renderer = await renderSharedRide();
    const saveButton = renderer.root.findAllByType("button").find((button) => button.children.includes("저장"));
    await act(async () => saveButton?.props.onClick());
    await act(async () => saveButton?.props.onClick());
    expect(saveBodies[1].saveOperationId).toBe(saveBodies[0].saveOperationId);

    const titleInput = renderer.root.findByType("input");
    await act(async () => titleInput.props.onChange({ target: { value: "다른 이름" } }));
    const changedTitleSaveButton = renderer.root.findAllByType("button").find((button) => button.children.includes("저장"));
    await act(async () => changedTitleSaveButton?.props.onClick());
    expect(saveBodies[2].saveOperationId).not.toBe(saveBodies[1].saveOperationId);
    await act(async () => renderer.unmount());
  });

  it("keeps one request in flight and blocks rename, close, and Escape until it settles", async () => {
    const snapshot = rawSharedRideSnapshotWithOmissions(0);
    let finishSave!: (response: Response) => void;
    const pendingSave = new Promise<Response>((resolve) => { finishSave = resolve; });
    const fetchMock = vi.fn((url: string) => url === "/api/shares/resolve"
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ snapshot }) } as Response)
      : pendingSave);
    stubWindow(validToken, vi.fn());
    vi.stubGlobal("fetch", fetchMock);
    const renderer = await renderSharedRide();
    const saveButton = renderer.root.findAllByType("button").find((button) => button.children.includes("저장"));
    const startSave = saveButton?.props.onClick;
    await act(async () => {
      void startSave();
      void startSave();
    });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/shares/save")).toHaveLength(1);
    expect(renderer.root.findByType("input").props.disabled).toBe(true);
    expect(renderer.root.findByProps({ "aria-label": "저장 창 닫기" }).props.disabled).toBe(true);
    const preventDefault = vi.fn();
    renderer.root.findByType("dialog").props.onCancel({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);

    await act(async () => finishSave({ ok: false, status: 503, json: async () => ({}) } as Response));
    expect(renderer.root.findByType("input").props.disabled).toBe(false);
    await act(async () => renderer.unmount());
  });

  it("ignores an old save response after the fragment changes and saves the new share independently", async () => {
    const baseSnapshot = rawSharedRideSnapshotWithOmissions(0);
    const firstSnapshot = { ...baseSnapshot, trip: { ...baseSnapshot.trip, title: "첫 공유본" } };
    const secondSnapshot = { ...baseSnapshot, trip: { ...baseSnapshot.trip, title: "두 번째 공유본" } };
    const nextToken = "b".repeat(43);
    let finishFirstSave!: (response: Response) => void;
    const firstSave = new Promise<Response>((resolve) => { finishFirstSave = resolve; });
    const saveBodies: Array<{ token: string; saveOperationId: string; title: string }> = [];
    const fetchMock = vi.fn((url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body)) as { token: string; saveOperationId: string; title: string };
      if (url === "/api/shares/resolve") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ snapshot: body.token === validToken ? firstSnapshot : secondSnapshot }),
        } as Response);
      }
      saveBodies.push(body);
      return body.token === validToken
        ? firstSave
        : Promise.resolve({ ok: true, status: 200, json: async () => ({ collectionId: "c2", versionId: "v2", versionNumber: 1 }) } as Response);
    });
    const navigateHash = stubWindow(validToken, vi.fn());
    vi.stubGlobal("fetch", fetchMock);
    const renderer = await renderSharedRide();

    const firstSaveButton = renderer.root.findAllByType("button").find((button) => button.children.includes("저장"));
    await act(async () => { void firstSaveButton?.props.onClick(); });
    await act(async () => navigateHash(nextToken));
    expect(renderer.root.findByType("input").props.value).toBe("두 번째 공유본");

    await act(async () => finishFirstSave({ ok: true, status: 200, json: async () => ({ collectionId: "c1", versionId: "v1", versionNumber: 1 }) } as Response));
    expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(0);
    expect(renderer.root.findByType("input").props.value).toBe("두 번째 공유본");

    const secondSaveButton = renderer.root.findAllByType("button").find((button) => button.children.includes("저장"));
    await act(async () => secondSaveButton?.props.onClick());
    expect(saveBodies).toHaveLength(2);
    expect(saveBodies[0]).toMatchObject({ token: validToken, title: "첫 공유본" });
    expect(saveBodies[1]).toMatchObject({ token: nextToken, title: "두 번째 공유본" });
    expect(saveBodies[1].saveOperationId).not.toBe(saveBodies[0].saveOperationId);
    expect(renderer.root.findAllByProps({ role: "status" })[0].findByType("strong").children.join("")).toContain("두 번째 공유본");
    await act(async () => renderer.unmount());
  });

  it("ignores a late private-course response after the share fragment changes", async () => {
    const baseSnapshot = rawSharedRideSnapshotWithOmissions(0);
    const firstSnapshot = { ...baseSnapshot, trip: { ...baseSnapshot.trip, title: "첫 공유본" } };
    const secondSnapshot = { ...baseSnapshot, trip: { ...baseSnapshot.trip, title: "두 번째 공유본" } };
    const nextToken = "b".repeat(43);
    const oldCourse = new Promise<Response>((resolve) => { (globalThis as typeof globalThis & { finishOldCourse?: (value: Response) => void }).finishOldCourse = resolve; });
    const course = {
      origin: { kakaoPlaceId: "origin", verificationToken: "a".repeat(43), name: "출발", address: "주소", roadAddress: null, longitude: 127, latitude: 37 },
      destination: { kakaoPlaceId: "destination", verificationToken: "b".repeat(43), name: "도착", address: "주소", roadAddress: null, longitude: 127.2, latitude: 37.2 },
      points: [],
    };
    const fetchMock = vi.fn((url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body)) as { token: string };
      if (url === "/api/shares/resolve") return Promise.resolve({ ok: true, status: 200, json: async () => ({ snapshot: body.token === validToken ? firstSnapshot : secondSnapshot }) } as Response);
      if (url === "/api/shares/course" && body.token === validToken) return oldCourse;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ course }) } as Response);
    });
    const navigateHash = stubWindow(validToken, vi.fn());
    vi.stubGlobal("fetch", fetchMock);
    const renderer = await renderSharedRide();
    await act(async () => { void renderer.root.findAllByType("button").find((button) => button.children.includes("새 일정으로 출발"))!.props.onClick(); });
    await act(async () => navigateHash(nextToken));
    await act(async () => (globalThis as typeof globalThis & { finishOldCourse: (value: Response) => void }).finishOldCourse({ ok: true, status: 200, json: async () => ({ course }) } as Response));
    expect(renderer.root.findAllByProps({ "data-embedded-planner": true })).toHaveLength(0);
    await act(async () => renderer.root.findAllByType("button").find((button) => button.children.includes("새 일정으로 출발"))!.props.onClick());
    expect(renderer.root.findByProps({ "data-embedded-planner": true }).children).toEqual(["두 번째 공유본"]);
    await act(async () => renderer.unmount());
    delete (globalThis as typeof globalThis & { finishOldCourse?: unknown }).finishOldCourse;
  });
});
