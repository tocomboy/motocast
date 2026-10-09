import { StrictMode, type ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OPEN_FOLDER_STORAGE_KEY } from "@/lib/places/folder-invite-token";

// The real planner with its providers, as the app mounts it on /#favorites. The browser session
// (`mocks.user`) is what reads see; auth reports arrive separately, before or after those reads.
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const mocks = vi.hoisted(() => ({
  session: new Map<string, string>(),
  authListeners: [] as Array<(event: string, session: { user: { id: string } } | null) => void>,
  user: null as string | null,
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
      const owner = mocks.user ?? A;
      const rows = (): unknown[] => {
        if (!mocks.user) return [];
        if (table === "saved_place_entries") return [{
          id: "20000000-0000-4000-8000-000000000001",
          place: { kakaoPlaceId: "kakao-1", verificationToken: "a".repeat(43), name: "팔당 라이딩 카페", address: "경기 남양주시", roadAddress: null, longitude: 127.1, latitude: 37.5 },
          alias: null, kind: "riding_spot", province: "경기", star_slot: null, star_position: null, revision: 1, created_at: at, updated_at: at,
        }];
        if (table === "place_folders") return [{ id: FOLDER, owner_id: owner, name: "주말 라이더", revision: 1, create_request_id: null, created_at: at, updated_at: at }];
        if (table === "place_folder_members") return [{ folder_id: FOLDER, member_id: owner, role: "owner", display_name: "바람개비", joined_at: at, revision: 1 }];
        if (table === "place_folder_preferences") return [{ member_id: owner, folder_id: FOLDER, enabled: true, updated_at: at }];
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
      getSession: async () => ({ data: { session: mocks.user ? { user: { id: mocks.user } } : null } }),
      onAuthStateChange: (listener: (event: string, session: { user: { id: string } } | null) => void) => {
        mocks.authListeners.push(listener);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
}));

import { PlannerDashboard } from "./planner-dashboard";
import { SavedPlaceRegistration } from "./saved-place-registration";

const createNodeMock = () => ({ focus: vi.fn(), scrollTo: vi.fn(), querySelector: vi.fn(() => null), querySelectorAll: vi.fn(() => []), showModal: vi.fn(), close: vi.fn() });

function text(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(text).join("");
}
async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
/** An auth report, as the browser client sends it (INITIAL_SESSION first, then changes). */
async function report(event: string, user: string | null) {
  mocks.user = user;
  await act(async () => { for (const listener of [...mocks.authListeners]) listener(event, user ? { user: { id: user } } : null); });
  await settle();
}
async function open(options: { strict?: boolean; reportFirst?: boolean } = {}) {
  let renderer!: ReactTestRenderer;
  const app = <PlannerDashboard connected />;
  await act(async () => { renderer = create(options.strict ? <StrictMode>{app}</StrictMode> : app, { createNodeMock }); });
  if (options.reportFirst) await report("INITIAL_SESSION", mocks.user);
  await settle();
  return renderer;
}
const folderTitle = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => node.type === "h1" && node.props.id === "shared-folder-title").map(text);
const pressed = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => node.type === "button" && node.props["aria-pressed"] === true).map(text);
const GONE = "이 폴더를 더 볼 수 없어요";

beforeEach(() => {
  mocks.session.clear();
  mocks.authListeners.length = 0;
  mocks.user = A;
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
  it.each([false, true])("opens the folder when the session report comes after the reads (StrictMode %s)", async (strict) => {
    mocks.session.set(OPEN_FOLDER_STORAGE_KEY, FOLDER);
    const renderer = await open({ strict });
    // Read once and removed, before the session is known.
    expect(mocks.session.has(OPEN_FOLDER_STORAGE_KEY)).toBe(false);
    await report("INITIAL_SESSION", A);
    expect(folderTitle(renderer)).toEqual(["주말 라이더"]);
    act(() => renderer.unmount());
  });

  it("opens the folder when the session report comes before the reads", async () => {
    mocks.session.set(OPEN_FOLDER_STORAGE_KEY, FOLDER);
    const renderer = await open({ reportFirst: true });
    expect(folderTitle(renderer)).toEqual(["주말 라이더"]);
    act(() => renderer.unmount());
  });

  it("shows the folder list with a notice when the folder is gone (deleted, left or removed)", async () => {
    mocks.session.set(OPEN_FOLDER_STORAGE_KEY, "00000000-0000-4000-8000-0000000000ff");
    const renderer = await open();
    await report("INITIAL_SESSION", A);
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
    await report("INITIAL_SESSION", A);
    expect(text(renderer.root)).toContain("공유 폴더를 불러오지 못했어요");
    expect(folderTitle(renderer)).toEqual([]);
    mocks.failFolders = false;
    const retry = renderer.root.findAll((node) => node.type === "button" && text(node) === "다시 시도")[0];
    await act(async () => retry.props.onClick());
    await settle();
    expect(folderTitle(renderer)).toEqual(["주말 라이더"]);
    act(() => renderer.unmount());
  });

  it("does not carry an unfinished request to the next account (A asks, read fails, B signs in)", async () => {
    mocks.failFolders = true;
    mocks.session.set(OPEN_FOLDER_STORAGE_KEY, FOLDER);
    const renderer = await open();
    await report("INITIAL_SESSION", A);
    expect(folderTitle(renderer)).toEqual([]);
    // B's list holds a folder with the same id; it must neither open nor explain A's request.
    mocks.failFolders = false;
    await report("SIGNED_IN", B);
    expect(folderTitle(renderer)).toEqual([]);
    expect(text(renderer.root)).not.toContain(GONE);
    expect(pressed(renderer).join()).toContain("장소");
    act(() => renderer.unmount());
  });

  it("drops the request on sign-out, even when the same account signs in again", async () => {
    mocks.failFolders = true;
    mocks.session.set(OPEN_FOLDER_STORAGE_KEY, FOLDER);
    const renderer = await open();
    await report("INITIAL_SESSION", A);
    await report("SIGNED_OUT", null);
    mocks.failFolders = false;
    await report("SIGNED_IN", A);
    expect(folderTitle(renderer)).toEqual([]);
    expect(text(renderer.root)).not.toContain(GONE);
    act(() => renderer.unmount());
  });

  it("drops a request the first confirmed session does not own (signed out)", async () => {
    mocks.session.set(OPEN_FOLDER_STORAGE_KEY, FOLDER);
    const renderer = await open();
    await report("INITIAL_SESSION", null);
    mocks.user = A;
    await report("SIGNED_IN", A);
    expect(folderTitle(renderer)).toEqual([]);
    expect(text(renderer.root)).not.toContain(GONE);
    act(() => renderer.unmount());
  });

  it("opens nothing without a stored request", async () => {
    const renderer = await open();
    await report("INITIAL_SESSION", A);
    expect(folderTitle(renderer)).toEqual([]);
    expect(pressed(renderer).join()).toContain("장소");
    act(() => renderer.unmount());
  });
});

describe("the first session report and a form opened before it", () => {
  async function openEditForm() {
    const renderer = await open();
    await act(async () => renderer.root.findByProps({ "aria-label": "팔당 라이딩 카페 상세 보기" }).props.onClick());
    await act(async () => renderer.root.findAll((node) => node.type === "button" && text(node) === "별명·분류 수정")[0].props.onClick());
    expect(renderer.root.findAllByType(SavedPlaceRegistration)).toHaveLength(1);
    return renderer;
  }

  it.each([["another account", B], ["no account", null]] as const)("discards A's edit form when the first report names %s", async (_name, next) => {
    const renderer = await openEditForm();
    await report("INITIAL_SESSION", next);
    expect(renderer.root.findAllByType(SavedPlaceRegistration)).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it("keeps A's edit form when the first report names A", async () => {
    const renderer = await openEditForm();
    await report("INITIAL_SESSION", A);
    expect(renderer.root.findAllByType(SavedPlaceRegistration)).toHaveLength(1);
    act(() => renderer.unmount());
  });
});
