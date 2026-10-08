import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const TOKEN = "T".repeat(43);
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
  client: true,
  push: vi.fn(),
  authListener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
}));
vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => (mocks.client ? {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: (listener: typeof mocks.authListener) => { mocks.authListener = listener; return { data: { subscription: { unsubscribe: () => { mocks.authListener = null; } } } }; },
    },
    rpc: mocks.rpc,
  } : null),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => <a href={href} {...props}>{children}</a>,
}));

type FakeWindow = ReturnType<typeof fakeWindow>;
function fakeWindow(hash: string, options: { replaceThrows?: boolean; storageThrows?: boolean; stored?: string } = {}) {
  const values = new Map<string, string>();
  if (options.stored) values.set("motocast.folder-invite.pending", options.stored);
  const storage = {
    getItem: (key: string) => { if (options.storageThrows) throw new Error("SecurityError"); return values.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (options.storageThrows) throw new Error("SecurityError"); values.set(key, value); },
    removeItem: (key: string) => { if (options.storageThrows) throw new Error("SecurityError"); values.delete(key); },
  };
  const location = { hash, pathname: "/folder-invite", search: "", assign: vi.fn() };
  return {
    values,
    location,
    sessionStorage: storage,
    history: {
      replaceState: vi.fn((_state: unknown, _title: string, url: string) => {
        if (options.replaceThrows) throw new Error("SecurityError");
        location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
      }),
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout,
    clearTimeout,
  };
}
let win: FakeWindow;
async function mount() {
  vi.stubGlobal("window", win);
  vi.resetModules();
  const { FolderInvite } = await import("./folder-invite");
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<FolderInvite />); });
  await act(async () => { await Promise.resolve(); });
  return r;
}
const text = (node: ReactTestRenderer) => JSON.stringify(node.toJSON());
const button = (r: ReactTestRenderer, label: string) => r.root.findAll((n) => n.type === "button" && JSON.stringify(n.props.children ?? "").includes(label))[0];
const preview = (status: "joinable" | "already_member", extra: Record<string, unknown> = {}) => ({
  data: { status, folder_name: "주말 라이더", owner_display_name: "바람개비", member_count: 5, place_count: 34, ...(status === "already_member" ? { folder_id: "00000000-0000-4000-8000-0000000000f1" } : {}), ...extra },
  error: null,
});
const member = { folder_id: "00000000-0000-4000-8000-0000000000f1", member_id: "00000000-0000-4000-8000-0000000000a2", role: "editor", display_name: "초록헬멧", joined_at: "2026-10-09T00:00:00Z", revision: 1 };

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.getSession.mockReset();
  mocks.client = true;
  mocks.push.mockReset();
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "u" } } } });
});
afterEach(() => vi.unstubAllGlobals());

describe("folder invite page", () => {
  it("removes the fragment before anything else and sends nothing when removal fails", async () => {
    win = fakeWindow(`#t=${TOKEN}`, { replaceThrows: true });
    const r = await mount();
    expect(text(r)).toContain("초대 링크를 열지 못했어요");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("before login hides the folder, sends no request, and keeps the token out of the address", async () => {
    win = fakeWindow(`#t=${TOKEN}`);
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    const r = await mount();
    expect(win.location.hash).toBe("");
    expect(win.history.replaceState).toHaveBeenCalledWith(null, "", "/folder-invite");
    expect(text(r)).toContain("공유 폴더에 초대받았어요");
    expect(text(r)).not.toContain("주말 라이더");
    expect(mocks.rpc).not.toHaveBeenCalled();
    await act(async () => button(r, "로그인하고 계속").props.onClick());
    const stored = JSON.parse(win.values.get("motocast.folder-invite.pending")!);
    expect(stored).toEqual({ token: TOKEN, savedAt: expect.any(Number) });
    // Same-tab login on the fixed path: the token is never in the URL or return_to.
    expect(mocks.push).toHaveBeenCalledWith("/login");
    expect(JSON.stringify(mocks.push.mock.calls)).not.toContain(TOKEN);
  });

  it("shows the reopen screen (G29) without navigating when the token cannot be stored", async () => {
    win = fakeWindow(`#t=${TOKEN}`, { storageThrows: true });
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    const r = await mount();
    await act(async () => button(r, "로그인하고 계속").props.onClick());
    expect(text(r)).toContain("초대 링크를 다시 열어 주세요");
    expect(text(r)).toContain("받은 초대 링크를 다시 눌러 주세요");
    expect(text(r)).not.toContain(TOKEN);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("after the login return reads the stored token once and shows the folder to the member", async () => {
    win = fakeWindow("", { stored: JSON.stringify({ token: TOKEN, savedAt: Date.now() - 60_000 }) });
    mocks.rpc.mockResolvedValueOnce(preview("joinable"));
    const r = await mount();
    expect(win.values.has("motocast.folder-invite.pending")).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith("preview_place_folder_invite", { token: TOKEN });
    expect(text(r)).toContain("주말 라이더");
    expect(text(r)).toContain("바람개비");
    expect(text(r)).toContain("34");
    expect(button(r, "참여하기").props.disabled).toBe(true);
  });

  it("ignores a stored token older than 30 minutes", async () => {
    win = fakeWindow("", { stored: JSON.stringify({ token: TOKEN, savedAt: Date.now() - 31 * 60_000 }) });
    const r = await mount();
    expect(win.values.has("motocast.folder-invite.pending")).toBe(false);
    expect(text(r)).toContain("초대 링크를 다시 열어 주세요");
    expect(text(r)).toContain("앱이 다시 시작되거나 시간이 지나면 지워져요.");
    expect(text(r)).toContain("즐겨찾기로 가기");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("joins with the folder name and opens the folder", async () => {
    win = fakeWindow(`#t=${TOKEN}`);
    mocks.rpc.mockResolvedValueOnce(preview("joinable")).mockResolvedValueOnce({ data: { status: "joined", folder: {}, member, preference: {} }, error: null });
    const r = await mount();
    const input = r.root.findByType("input");
    await act(async () => input.props.onChange({ target: { value: " 초록헬멧 " } }));
    await act(async () => button(r, "참여하기").props.onClick());
    expect(mocks.rpc).toHaveBeenLastCalledWith("accept_place_folder_invite", { token: TOKEN, display_name: "초록헬멧" });
    expect(win.values.get("motocast.favorites.open-folder")).toBe(member.folder_id);
    expect(mocks.push).toHaveBeenCalledWith("/#favorites");
  });

  it("shows a taken name inline and the limits and invalid links as their own screens", async () => {
    for (const [code, expected] of [
      ["FOLDER_DISPLAY_NAME_TAKEN", "이 폴더에 이미 같은 이름이 있어요"],
      ["PLACE_FOLDER_LIMIT", "내 공유 폴더 20개가 모두 찼어요"],
      ["PLACE_FOLDER_MEMBER_LIMIT", "이 폴더의 회원 30명이 모두 찼어요"],
      ["PLACE_FOLDER_INVITE_INVALID", "이 초대 링크는 쓸 수 없어요"],
    ] as const) {
      mocks.rpc.mockReset();
      win = fakeWindow(`#t=${TOKEN}`);
      mocks.rpc.mockResolvedValueOnce(preview("joinable")).mockResolvedValueOnce({ data: null, error: { message: code } });
      const r = await mount();
      await act(async () => r.root.findByType("input").props.onChange({ target: { value: "바람개비" } }));
      await act(async () => button(r, "참여하기").props.onClick());
      expect(text(r)).toContain(expected);
      expect(mocks.rpc).toHaveBeenCalledTimes(2);
      await act(async () => r.unmount());
    }
  });

  it("checks a lost join reply by reading again and never sends the join twice", async () => {
    win = fakeWindow(`#t=${TOKEN}`);
    mocks.rpc
      .mockResolvedValueOnce(preview("joinable"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(preview("already_member"));
    const r = await mount();
    await act(async () => r.root.findByType("input").props.onChange({ target: { value: "초록헬멧" } }));
    await act(async () => button(r, "참여하기").props.onClick());
    expect(mocks.rpc.mock.calls.map((call) => call[0])).toEqual(["preview_place_folder_invite", "accept_place_folder_invite", "preview_place_folder_invite"]);
    expect(mocks.push).toHaveBeenCalledWith("/#favorites");
  });

  it("V3-1: after a lost join and a failed re-read it only re-reads, and allows joining again once a read proves it did not join", async () => {
    win = fakeWindow(`#t=${TOKEN}`);
    mocks.rpc
      .mockResolvedValueOnce(preview("joinable"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const r = await mount();
    await act(async () => r.root.findByType("input").props.onChange({ target: { value: "초록헬멧" } }));
    await act(async () => button(r, "참여하기").props.onClick());
    expect(text(r)).toContain("참여됐는지 확인하지 못했어요");
    expect(button(r, "참여하기")).toBeUndefined();
    expect(r.root.findByType("input").props.disabled).toBe(true);
    mocks.rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await act(async () => button(r, "참여됐는지 다시 확인").props.onClick());
    expect(button(r, "참여하기")).toBeUndefined();
    mocks.rpc.mockResolvedValueOnce(preview("joinable"));
    await act(async () => button(r, "참여됐는지 다시 확인").props.onClick());
    expect(text(r)).toContain("참여되지 않았어요");
    expect(button(r, "참여하기").props.disabled).toBe(false);
    // Only one join was ever sent; every other call was a read.
    expect(mocks.rpc.mock.calls.map((call) => call[0]).filter((name) => name === "accept_place_folder_invite")).toHaveLength(1);
  });

  it("V3-8: locks leaving while joining and drops a late reply after the page is left or the account changes", async () => {
    win = fakeWindow(`#t=${TOKEN}`);
    let release!: (value: unknown) => void;
    mocks.rpc.mockResolvedValueOnce(preview("joinable")).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    let r = await mount();
    await act(async () => r.root.findByType("input").props.onChange({ target: { value: "초록헬멧" } }));
    await act(async () => { void button(r, "참여하기").props.onClick(); });
    const closeLink = r.root.findByProps({ "aria-label": "초대 화면 닫기" });
    expect(closeLink.props["aria-disabled"]).toBe(true);
    const prevent = vi.fn();
    closeLink.props.onClick({ preventDefault: prevent });
    expect(prevent).toHaveBeenCalled();
    await act(async () => r.unmount());
    await act(async () => { release({ data: { status: "joined", folder: {}, member, preference: {} }, error: null }); await Promise.resolve(); });
    expect(mocks.push).not.toHaveBeenCalled();

    mocks.rpc.mockReset();
    win = fakeWindow(`#t=${TOKEN}`);
    mocks.rpc.mockResolvedValueOnce(preview("joinable")).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; })).mockResolvedValue(preview("joinable"));
    r = await mount();
    await act(async () => r.root.findByType("input").props.onChange({ target: { value: "초록헬멧" } }));
    await act(async () => { void button(r, "참여하기").props.onClick(); });
    await act(async () => { mocks.authListener?.("SIGNED_IN", { user: { id: "other" } }); await Promise.resolve(); });
    await act(async () => { release({ data: { status: "joined", folder: {}, member, preference: {} }, error: null }); await Promise.resolve(); });
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => r.unmount());
  });

  it("opens an already joined folder instead of joining again (G27)", async () => {
    win = fakeWindow(`#t=${TOKEN}`);
    mocks.rpc.mockResolvedValueOnce(preview("already_member"));
    const r = await mount();
    expect(text(r)).toContain("이미 참여한 폴더예요");
    await act(async () => button(r, "폴더 열기").props.onClick());
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("/#favorites");
  });

  it("treats an expired or revoked link and a malformed fragment the same way (G26)", async () => {
    win = fakeWindow(`#t=${TOKEN}`);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "PLACE_FOLDER_INVITE_INVALID" } });
    let r = await mount();
    expect(text(r)).toContain("이 초대 링크는 쓸 수 없어요");
    await act(async () => r.unmount());
    mocks.rpc.mockReset();
    win = fakeWindow("#t=not-a-token");
    r = await mount();
    expect(text(r)).toContain("이 초대 링크는 쓸 수 없어요");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
