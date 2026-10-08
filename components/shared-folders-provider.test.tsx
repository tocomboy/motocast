import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedFoldersProvider, useSharedFolders, type SharedWrite } from "./shared-folders-provider";
import { abandonCreate } from "./shared-folder-list";
import { F1, F2, ME, sampleTables, sharedRow } from "@/tests/fixtures/shared-folders";

type Tables = ReturnType<typeof sampleTables>;
const mocks = vi.hoisted(() => ({
  tables: null as null | Record<string, unknown[]>,
  failures: new Set<string>(),
  ranges: [] as Array<[number, number]>,
  rpc: vi.fn(),
  listener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
}));
vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({
    from: (table: string) => {
      let range: [number, number] | null = null;
      const builder = {
        select: () => builder,
        order: () => builder,
        range: (from: number, to: number) => { range = [from, to]; mocks.ranges.push(range); return builder; },
        then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => {
          if (mocks.failures.has(table)) return Promise.resolve(resolve({ data: null, error: { message: "boom" } }));
          const rows = mocks.tables![table] ?? [];
          return Promise.resolve(resolve({ data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null }));
        },
      };
      return builder;
    },
    rpc: mocks.rpc,
    auth: {
      getSession: async () => ({ data: { session: { user: { id: ME } } } }),
      onAuthStateChange: (listener: typeof mocks.listener) => {
        mocks.listener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
}));

let controls: ReturnType<typeof useSharedFolders>;
function Harness() {
  const value = useSharedFolders();
  useEffect(() => { controls = value; }, [value]);
  return null;
}
async function mount() {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<SharedFoldersProvider enabled><Harness /></SharedFoldersProvider>); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return r;
}
let tables: Tables;
beforeEach(() => {
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  tables = sampleTables();
  mocks.tables = tables as unknown as Record<string, unknown[]>;
  mocks.failures.clear();
  mocks.ranges = [];
  mocks.rpc.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("SharedFoldersProvider", () => {
  it("keeps refresh stable so a screen that re-reads on entry reads once, not in a loop", async () => {
    let reads = 0;
    const counting = new Proxy(mocks.tables!, { get: (target, key: string) => { if (key === "place_folders") reads++; return target[key]; } });
    mocks.tables = counting;
    // Mirrors the favorites screen and the folder detail: refresh once per refresh identity.
    function Entry() {
      const { refresh } = useSharedFolders();
      useEffect(() => { const task = setTimeout(() => void refresh(), 0); return () => clearTimeout(task); }, [refresh]);
      return null;
    }
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<SharedFoldersProvider enabled><Harness /><Entry /></SharedFoldersProvider>); });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(controls.status).toBe("ready");
    expect(reads).toBe(2);
    await act(async () => r.unmount());
  });

  it("reads every page of shared places instead of stopping at 1,000 rows", async () => {
    tables.shared_place_entries = Array.from({ length: 1500 }, (_, index) => sharedRow(index + 10, index < 1000 ? F1 : F2, `bulk-${index}`, `장소 ${index}`));
    await mount();
    expect(controls.status).toBe("ready");
    expect(controls.snapshot.places).toHaveLength(1500);
    expect(mocks.ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(controls.snapshot.userId).toBe(ME);
    expect(controls.snapshot.stars.map((star) => star.source)).toEqual(["saved", "shared"]);
  });

  it("fails the whole read instead of showing a partial list", async () => {
    mocks.failures.add("avoided_places");
    await mount();
    expect(controls.status).toBe("error");
    expect(controls.snapshot.folders).toEqual([]);
  });

  it("treats a lost write reply as unknown and decides by reading again without resending", async () => {
    await mount();
    mocks.rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    // The write landed on the server: the re-read shows it.
    tables.place_folder_preferences = tables.place_folder_preferences.map((row) => (row.folder_id === F2 ? { ...row, enabled: false } : row));
    let result!: SharedWrite;
    await act(async () => {
      result = await controls.write({
        rpc: "set_place_folders_enabled",
        args: { changes: [{ folderId: F2, enabled: false }] },
        success: "적용했어요.",
        receipt: () => () => true,
        applied: (s) => s.preferences.some((row) => row.folderId === F2 && !row.enabled),
        unknownMessage: "확인하지 못했어요.",
      });
    });
    expect(result).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("reports an unknown result that the fresh list does not show, so only one new confirm may follow", async () => {
    await mount();
    mocks.rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    let result!: SharedWrite;
    await act(async () => {
      result = await controls.write({
        rpc: "delete_shared_place",
        args: {},
        success: "",
        receipt: () => () => true,
        applied: () => false,
        unknownMessage: "삭제되지 않았어요.",
      });
    });
    expect(result).toMatchObject({ ok: false, reason: "unknown", checked: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("maps a clear refusal to the screen's own wording and re-reads", async () => {
    await mount();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "PLACE_FOLDER_FORBIDDEN" } });
    let result!: SharedWrite;
    await act(async () => {
      result = await controls.write({
        rpc: "update_shared_place",
        args: {},
        success: "",
        receipt: () => () => true,
        applied: () => false,
        unknownMessage: "",
        refusal: (code) => (code === "PLACE_FOLDER_FORBIDDEN" ? { reason: "rejected", title: "장소를 고치지 못했어요", message: "보기만" } : null),
      });
    });
    expect(result).toMatchObject({ ok: false, reason: "rejected", title: "장소를 고치지 못했어요" });
  });

  it("keeps a receipt the list never shows as a read-only mismatch", async () => {
    await mount();
    mocks.rpc.mockResolvedValueOnce({ data: [{}], error: null });
    let result!: SharedWrite;
    await act(async () => {
      result = await controls.write({ rpc: "x", args: {}, success: "", receipt: () => () => false, applied: () => false, unknownMessage: "" });
    });
    expect(result).toMatchObject({ ok: false, reason: "mismatch", checked: true, title: "변경이 목록에 아직 보이지 않아요", message: "변경은 저장됐지만 목록에 아직 반영되지 않았어요. 변경은 다시 보내지 않아요. 잠시 뒤 목록을 다시 확인해 주세요.", stillMissing: { title: "변경이 목록에 아직 보이지 않아요", message: "변경은 저장됐지만 목록에 아직 반영되지 않았어요. 변경은 다시 보내지 않아요. 잠시 뒤 목록을 다시 확인해 주세요." } });
  });

  it("refuses a second write while one runs and blocks writes before the first read", async () => {
    let release!: (value: unknown) => void;
    await mount();
    mocks.rpc.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    let first!: Promise<SharedWrite>;
    let second!: SharedWrite;
    await act(async () => {
      first = controls.write({ rpc: "a", args: {}, success: "", receipt: () => () => true, applied: () => true, unknownMessage: "" });
      second = await controls.write({ rpc: "b", args: {}, success: "", receipt: () => () => true, applied: () => true, unknownMessage: "" });
    });
    expect(second).toMatchObject({ ok: false, reason: "blocked" });
    await act(async () => { release({ data: [], error: null }); await first; });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("delta 5-3: keeps a pending create for the same account and drops it for another or none", async () => {
    await mount();
    const pending = { requestId: "95000000-0000-0000-0000-000000000001", folderName: "새 폴더", displayName: "바람개비", ids: [], abandoning: null };
    await act(async () => { controls.captureCreate(pending.requestId).keep(pending); });
    await act(async () => { mocks.listener?.("INITIAL_SESSION", { user: { id: ME } }); });
    await act(async () => { mocks.listener?.("TOKEN_REFRESHED", { user: { id: ME } }); });
    expect(controls.pendingCreate).toEqual(pending);
    await act(async () => { mocks.listener?.("SIGNED_IN", { user: { id: "00000000-0000-4000-8000-0000000000b9" } }); });
    expect(controls.pendingCreate).toBeNull();
    await act(async () => { controls.captureCreate(pending.requestId).keep(pending); });
    await act(async () => { mocks.listener?.("SIGNED_OUT", null); });
    expect(controls.pendingCreate).toBeNull();
  });

  for (const reply of ["abandoned", "lost"] as const) {
    it(`delta 8: an abandon reply (${reply}) after an account change leaves the new account's kept request alone`, async () => {
      await mount();
      await act(async () => { mocks.listener?.("INITIAL_SESSION", { user: { id: ME } }); });
      const pendingA = { requestId: "95000000-0000-0000-0000-00000000000a", folderName: "A 폴더", displayName: "에이", ids: [], abandoning: { title: "폴더를 만들지 못했어요", message: "" } };
      const tokenA = controls.captureCreate(pendingA.requestId);
      await act(async () => { tokenA.keep(pendingA); });
      let release!: (value: unknown) => void;
      mocks.rpc.mockImplementationOnce(() => new Promise((resolve, reject) => { release = (value) => (reply === "lost" ? reject(value) : resolve(value)); }));
      let outcome!: Promise<{ kind: string }>;
      await act(async () => { outcome = abandonCreate(controls, tokenA, pendingA); });
      // Account B signs in and keeps its own request while A's abandon is still in flight.
      await act(async () => { mocks.listener?.("SIGNED_IN", { user: { id: "00000000-0000-4000-8000-0000000000b9" } }); });
      const pendingB = { requestId: "95000000-0000-0000-0000-00000000000b", folderName: "B 폴더", displayName: "비", ids: [], abandoning: null };
      await act(async () => { controls.captureCreate(pendingB.requestId).keep(pendingB); });
      expect(controls.pendingCreate).toEqual(pendingB);
      let result!: { kind: string };
      await act(async () => { release(reply === "lost" ? new TypeError("Failed to fetch") : { data: { status: "abandoned" }, error: null }); result = await outcome; });
      expect(result.kind).toBe("stale");
      expect(controls.pendingCreate).toEqual(pendingB);
      expect(tokenA.keep(pendingA)).toBe(false);
      expect(tokenA.clear()).toBe(false);
      expect(controls.pendingCreate).toEqual(pendingB);
    });
  }

  it("drops the former account's folders when another account signs in", async () => {
    await mount();
    expect(controls.snapshot.folders).toHaveLength(3);
    await act(async () => { mocks.listener?.("SIGNED_IN", { user: { id: ME } }); });
    tables.place_folders = [];
    tables.place_folder_members = [];
    tables.place_folder_preferences = [];
    tables.shared_place_entries = [];
    tables.my_star_entries = [];
    await act(async () => { mocks.listener?.("SIGNED_IN", { user: { id: "00000000-0000-4000-8000-00000000ffff" } }); });
    expect(controls.snapshot.folders).toEqual([]);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(controls.status).toBe("ready");
  });
});
