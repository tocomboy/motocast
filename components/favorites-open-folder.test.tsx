import { StrictMode, type ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OPEN_FOLDER_STORAGE_KEY } from "@/lib/places/folder-invite-token";

// "폴더 열기" on the invite page stores the folder id and goes to /#favorites. This mounts the real
// planner with its providers, as the app does, and lets the signed-in session arrive after mount.
const ME = "00000000-0000-4000-8000-0000000000a1";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const mocks = vi.hoisted(() => ({
  session: new Map<string, string>(),
  authListeners: [] as Array<(event: string, session: { user: { id: string } } | null) => void>,
  failFolders: false,
}));

vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));
vi.mock("next/image", () => ({ default: ({ src }: { src: string }) => <span data-image-src={src} /> }));
vi.mock("@/components/kakao-map-canvas", () => ({ KakaoMapCanvas: () => <div />, MapMarkerLegend: () => <div /> }));
vi.mock("@/components/map-point-confirmation", () => ({ MapPointConfirmation: () => <div /> }));
vi.mock("@/components/place-search-field", () => ({ PlaceSearchField: () => <div /> }));
vi.mock("@/components/ordered-waypoint-editor", () => ({ OrderedWaypointEditor: () => <div /> }));
vi.mock("@/components/collection-manager", () => ({ CollectionManager: () => <div /> }));
vi.mock("@/components/share-manager", () => ({ ShareManager: () => <div /> }));
vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: [], error: null }),
    from: (table: string) => {
      const at = "2026-10-01T00:00:00.000Z";
      const rows = (): unknown[] => {
        if (table === "place_folders") return [{ id: FOLDER, owner_id: ME, name: "주말 라이더", revision: 1, create_request_id: null, created_at: at, updated_at: at }];
        if (table === "place_folder_members") return [{ folder_id: FOLDER, member_id: ME, role: "owner", display_name: "바람개비", joined_at: at, revision: 1 }];
        if (table === "place_folder_preferences") return [{ member_id: ME, folder_id: FOLDER, enabled: true, updated_at: at }];
        return [];
      };
      const result = () => (table === "place_folders" && mocks.failFolders ? { data: null, error: { message: "offline" } } : { data: rows(), error: null });
      const builder = {
        select() { return builder; },
        order() { return builder; },
        in() { return builder; },
        eq() { return builder; },
        range() { return builder; },
        limit: async () => result(),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
      };
      return builder;
    },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: ME } } } }),
      onAuthStateChange: (listener: (event: string, session: { user: { id: string } } | null) => void) => {
        mocks.authListeners.push(listener);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
}));

import { PlannerDashboard } from "./planner-dashboard";

const createNodeMock = () => ({ focus: vi.fn(), scrollTo: vi.fn(), querySelector: vi.fn(() => null), querySelectorAll: vi.fn(() => []), showModal: vi.fn(), close: vi.fn() });

function text(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(text).join("");
}
async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
/** The session arrives after the first render, as the browser client reports it. */
async function signIn() {
  await act(async () => { for (const listener of [...mocks.authListeners]) listener("INITIAL_SESSION", { user: { id: ME } }); });
  await settle();
}
async function open(strict = false) {
  let renderer!: ReactTestRenderer;
  const app = <PlannerDashboard connected />;
  await act(async () => { renderer = create(strict ? <StrictMode>{app}</StrictMode> : app, { createNodeMock }); });
  await settle();
  return renderer;
}
const folderTitle = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => node.type === "h1" && node.props.id === "shared-folder-title").map(text);
const pressed = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => node.type === "button" && node.props["aria-pressed"] === true).map(text);

beforeEach(() => {
  mocks.session.clear();
  mocks.authListeners.length = 0;
  mocks.failFolders = false;
  vi.stubGlobal("document", { activeElement: null, querySelector: vi.fn(() => null), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("window", {
    localStorage: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
    sessionStorage: {
      getItem: (key: string) => mocks.session.get(key) ?? null,
      setItem: (key: string, value: string) => { mocks.session.set(key, value); },
      removeItem: (key: string) => { mocks.session.delete(key); },
    },
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    setTimeout, clearTimeout, setInterval, clearInterval,
    scrollTo: vi.fn(),
    history: { pushState: vi.fn(), replaceState: vi.fn() },
    location: { pathname: "/", search: "", hash: "#favorites" },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("폴더 열기 from the invite page", () => {
  it.each([false, true])("opens the folder after the session arrives and the list is read (StrictMode %s)", async (strict) => {
    mocks.session.set(OPEN_FOLDER_STORAGE_KEY, FOLDER);
    const renderer = await open(strict);
    // Read once and removed, before the session is known.
    expect(mocks.session.has(OPEN_FOLDER_STORAGE_KEY)).toBe(false);
    await signIn();
    expect(folderTitle(renderer)).toEqual(["주말 라이더"]);
    act(() => renderer.unmount());
  });

  it("shows the folder list with a notice when the folder is gone (deleted, left or removed)", async () => {
    mocks.session.set(OPEN_FOLDER_STORAGE_KEY, "00000000-0000-4000-8000-0000000000ff");
    const renderer = await open();
    await signIn();
    expect(folderTitle(renderer)).toEqual([]);
    expect(pressed(renderer).join()).toContain("공유 폴더");
    expect(text(renderer.root)).toContain("이 폴더를 더 볼 수 없어요. 폴더가 삭제됐거나 이 폴더에서 나갔어요.");
    expect(text(renderer.root)).toContain("주말 라이더");
    act(() => renderer.unmount());
  });

  it("keeps the request through a failed read and opens the folder after the retry", async () => {
    mocks.failFolders = true;
    mocks.session.set(OPEN_FOLDER_STORAGE_KEY, FOLDER);
    const renderer = await open();
    await signIn();
    expect(text(renderer.root)).toContain("공유 폴더를 불러오지 못했어요");
    expect(folderTitle(renderer)).toEqual([]);
    mocks.failFolders = false;
    const retry = renderer.root.findAll((node) => node.type === "button" && text(node) === "다시 시도")[0];
    await act(async () => retry.props.onClick());
    await settle();
    expect(folderTitle(renderer)).toEqual(["주말 라이더"]);
    act(() => renderer.unmount());
  });

  it("opens nothing without a stored request", async () => {
    const renderer = await open();
    await signIn();
    expect(folderTitle(renderer)).toEqual([]);
    expect(pressed(renderer).join()).toContain("장소");
    act(() => renderer.unmount());
  });
});
