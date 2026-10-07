import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useEffect } from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { SavedPlacesProvider, useSavedPlaces, type SavedPlaceWrite } from "./saved-places-provider";
import { parseSavedPlace } from "@/lib/places/saved";

const mocks = vi.hoisted(() => ({
  reads: [] as Array<Promise<{ data: unknown; error: unknown }>>,
  tables: [] as string[],
  rpc: vi.fn(),
  listener: null as
    null | ((event: string, session: { user: { id: string } } | null) => void),
}));
vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({
    from: (table: string) => (mocks.tables.push(table), {
      select() {
        return this;
      },
      order() {
        return this;
      },
      limit: () =>
        mocks.reads.shift() ?? Promise.resolve({ data: [], error: null }),
    }),
    rpc: mocks.rpc,
    auth: {
      onAuthStateChange: (listener: typeof mocks.listener) => {
        mocks.listener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
}));
const row = {
  id: "00000000-0000-4000-8000-000000000001",
  place: {
    kakaoPlaceId: "1",
    verificationToken: "a".repeat(43),
    name: "팔당역",
    address: "경기 남양주시",
    roadAddress: null,
    latitude: 37.55,
    longitude: 127.24,
  },
  alias: "출발 거점",
  kind: "riding_spot",
  province: "경기",
  star_slot: 5,
  star_position: 5,
  revision: 1,
  created_at: "2026-10-02T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
};
let controls: ReturnType<typeof useSavedPlaces>;
function Harness() {
  const value = useSavedPlaces();
  useEffect(() => {
    controls = value;
  }, [value]);
  return <output>{value.status}</output>;
}
async function mount() {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <SavedPlacesProvider enabled>
        <Harness />
      </SavedPlacesProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return renderer;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
beforeEach(() => {
  mocks.reads = [];
  mocks.tables = [];
  mocks.rpc.mockReset();
  mocks.listener = null;
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});
afterEach(() => vi.unstubAllGlobals());

it("keeps the signed empty road address when registering a place", async () => {
  const original = { ...row.place, roadAddress: "" };
  const saved = { ...row, place: original };
  mocks.reads.push(
    Promise.resolve({ data: [], error: null }),
    Promise.resolve({ data: [saved], error: null }),
  );
  mocks.rpc.mockResolvedValue({ data: [saved], error: null });
  const renderer = await mount();
  await act(async () => {
    expect(
      await controls.save(
        parseSavedPlace(saved).place,
        "출발 거점",
        "riding_spot",
        true,
      ),
    ).toMatchObject({ ok: true, duplicate: false });
  });
  expect(mocks.tables.every((table) => table === "saved_place_entries")).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledWith("save_place_v2", {
    saved_place: original,
    place_alias: "출발 거점",
    place_kind: "riding_spot",
    starred: true,
  });
  await act(async () => renderer.unmount());
});

it("reads stars beyond the legacy five, preserves signed original data, and reconciles unstar without deleting the place", async () => {
  const ten = { ...row, id: "00000000-0000-4000-8000-00000000000a", place: { ...row.place, kakaoPlaceId: "10" }, alias: null, star_slot: null, star_position: 10 };
  mocks.reads.push(
    Promise.resolve({ data: [row, ten], error: null }),
    Promise.resolve({
      data: [{ ...row, star_slot: null, star_position: null, revision: 2 }, ten],
      error: null,
    }),
  );
  mocks.rpc.mockResolvedValue({
    data: [{ ...row, star_slot: null, star_position: null, revision: 2 }],
    error: null,
  });
  const renderer = await mount();
  expect(controls.favorites[0]).toMatchObject({
    slot: 5,
    displayName: "출발 거점",
    place: { name: "팔당역" },
  });
  expect(controls.favorites[1]).toMatchObject({ slot: 10, displayName: "팔당역" });
  await act(async () => {
    expect(await controls.star(controls.places[0], false)).toMatchObject({ ok: true });
  });
  expect(mocks.rpc).toHaveBeenCalledWith("set_place_star", {
    saved_place_id: row.id,
    expected_revision: 1,
    starred: false,
  });
  expect(controls.places).toHaveLength(2);
  expect(controls.favorites.map((favorite) => favorite.slot)).toEqual([10]);
  expect(controls.places[0].place.name).toBe("팔당역");
  expect(controls.message).toContain("자주 찾는 장소에서 뺐어요");
  await act(async () => renderer.unmount());
});
it("blocks parallel writes and treats a lost receipt as saved only when the fresh list shows it, without resending", async () => {
  const write = deferred<{ data: unknown; error: unknown }>();
  mocks.reads.push(
    Promise.resolve({ data: [], error: null }),
    Promise.resolve({ data: [row], error: null }),
  );
  mocks.rpc.mockReturnValue(write.promise);
  const renderer = await mount();
  const place = parseSavedPlace(row).place;
  let first!: Promise<SavedPlaceWrite>;
  await act(async () => {
    first = controls.save(place, "출발 거점", "riding_spot", true);
    expect(await controls.save(place, "", "restaurant", false)).toMatchObject({ ok: false, reason: "blocked" });
  });
  await act(async () => {
    write.resolve({ data: null, error: { message: "connection lost" } });
    // The re-read list already contains the place, so the save counts as done.
    expect(await first).toEqual({ ok: true });
  });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(controls.places).toHaveLength(1);
  expect(controls.busy).toBe(false);
  expect(controls.message).toBe("장소를 저장했어요.");
  await act(async () => renderer.unmount());
});
it("invalidates confirmation snapshots and ignores a former owner's late mutation", async () => {
  mocks.reads.push(
    Promise.resolve({ data: [row], error: null }),
    Promise.resolve({ data: [row], error: null }),
  );
  const renderer = await mount();
  await act(async () => {
    mocks.listener?.("INITIAL_SESSION", { user: { id: "owner-a" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const valid = controls.captureSnapshot();
  await act(async () =>
    mocks.listener?.("TOKEN_REFRESHED", { user: { id: "owner-a" } }),
  );
  expect(valid()).toBe(true);
  const write = deferred<{ data: unknown; error: unknown }>();
  mocks.rpc.mockReturnValue(write.promise);
  let result!: Promise<SavedPlaceWrite>;
  await act(async () => {
    result = controls.deletePlace(controls.places[0]);
  });
  expect(valid()).toBe(false);
  await act(async () => mocks.listener?.("SIGNED_OUT", null));
  await act(async () => {
    write.resolve({ data: null, error: null });
    expect(await result).toMatchObject({ ok: false, reason: "blocked" });
  });
  expect(controls.places).toEqual([]);
  expect(controls.status).toBe("error");
  expect(controls.message).toContain("로그인");
  await act(async () => renderer.unmount());
});
it("fails closed after a malformed list or failed write reconciliation", async () => {
  mocks.reads.push(
    Promise.resolve({
      data: [row, { ...row, id: "00000000-0000-4000-8000-000000000002" }],
      error: null,
    }),
  );
  const renderer = await mount();
  expect(controls.status).toBe("error");
  expect(controls.places).toEqual([]);
  mocks.reads.push(Promise.resolve({ data: [row], error: null }));
  await act(async () => controls.retry());
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { message: "SAVED_PLACE_STALE" },
  });
  mocks.reads.push(
    Promise.resolve({ data: null, error: { message: "offline" } }),
  );
  await act(async () => {
    expect(await controls.star(controls.places[0], false)).toMatchObject({ ok: false, reason: "rejected" });
  });
  expect(controls.status).toBe("error");
  expect(controls.places).toEqual([]);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});

it("explains an 11th star rejected by the server and shows the re-read list without a resend", async () => {
  mocks.reads.push(
    Promise.resolve({ data: [{ ...row, star_slot: null, star_position: null }], error: null }),
    Promise.resolve({ data: [{ ...row, star_slot: null, star_position: null }], error: null }),
  );
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "SAVED_PLACE_STAR_LIMIT" } });
  const renderer = await mount();
  await act(async () => {
    expect(await controls.star(controls.places[0], true)).toMatchObject({ ok: false, reason: "star_limit" });
  });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(controls.status).toBe("ready");
  expect(controls.failureTitle).toBe("자주 찾는 장소에 추가하지 못했어요");
  expect(controls.message).toBe("이미 10곳이 별표돼 있어요. 다른 기기에서 먼저 추가했을 수 있어요. 목록을 새로 불러왔어요.");
  expect(controls.favorites).toHaveLength(0);
  await act(async () => renderer.unmount());
});

it("explains the server alias requirement for a region-only map point", async () => {
  mocks.reads.push(Promise.resolve({ data: [], error: null }), Promise.resolve({ data: [], error: null }));
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "INVALID_SAVED_PLACE_METADATA" } });
  const renderer = await mount();
  let write!: SavedPlaceWrite;
  await act(async () => {
    write = await controls.save(parseSavedPlace(row).place, "", "riding_spot", false);
  });
  expect(write).toMatchObject({ ok: false, reason: "rejected" });
  expect(!write.ok && write.message).toContain("상세 주소가 없는 지점은 별명이 있어야 저장할 수 있어요.");
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});

it("re-reads once when the list lags the write receipt and then accepts the matching list", async () => {
  const starred = { ...row, star_slot: null, star_position: 7, revision: 2 };
  mocks.reads.push(
    Promise.resolve({ data: [{ ...row, star_slot: null, star_position: null }], error: null }),
    Promise.resolve({ data: [{ ...row, star_slot: null, star_position: null }], error: null }),
    Promise.resolve({ data: [starred], error: null }),
  );
  mocks.rpc.mockResolvedValue({ data: [starred], error: null });
  const renderer = await mount();
  await act(async () => {
    expect(await controls.star(controls.places[0], true)).toMatchObject({ ok: true });
  });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.tables).toHaveLength(3);
  expect(controls.favorites.map((favorite) => favorite.slot)).toEqual([7]);
  await act(async () => renderer.unmount());
});

it("keeps comparing revisions when a receipt never shows up and offers only a read-only recheck", async () => {
  const stale = { ...row, star_slot: null, star_position: null };
  mocks.reads.push(
    Promise.resolve({ data: [stale], error: null }),
    Promise.resolve({ data: [stale], error: null }),
    Promise.resolve({ data: [stale], error: null }),
  );
  mocks.rpc.mockResolvedValue({ data: [{ ...stale, star_position: 7, revision: 2 }], error: null });
  const renderer = await mount();
  let write!: SavedPlaceWrite;
  await act(async () => {
    write = await controls.star(controls.places[0], true);
  });
  // Two reads that still show revision 1 are a mismatch, not a field-only success.
  expect(write).toMatchObject({ ok: false, reason: "mismatch", checked: true });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.tables).toHaveLength(3);
  expect(controls.status).toBe("ready");
  expect(controls.places).toHaveLength(1);
  // A lower-revision list with the right fields is still not the receipt.
  mocks.reads.push(Promise.resolve({ data: [{ ...stale, star_slot: 5, star_position: 5, revision: 1 }], error: null }));
  const recheck = !write.ok ? write.recheck! : () => false;
  await act(async () => { expect(await controls.recheck(recheck)).toBe("missing"); });
  mocks.reads.push(Promise.resolve({ data: [{ ...stale, star_position: 7, revision: 2 }], error: null }));
  await act(async () => { expect(await controls.recheck(recheck)).toBe("applied"); });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});

it("does not let a former account's late read end the current account's checking state", async () => {
  const first = deferred<{ data: unknown; error: unknown }>();
  const second = deferred<{ data: unknown; error: unknown }>();
  mocks.reads.push(Promise.resolve({ data: [row], error: null }));
  const renderer = await mount();
  mocks.reads.push(Promise.resolve({ data: [row], error: null }));
  await act(async () => { mocks.listener?.("INITIAL_SESSION", { user: { id: "owner-a" } }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });
  mocks.reads.push(first.promise);
  let a!: Promise<SavedPlaceWrite>;
  await act(async () => { a = controls.star(controls.places[0], false); });
  expect(controls.verifying).toBe(true);
  mocks.reads.push(Promise.resolve({ data: [row], error: null }));
  await act(async () => { mocks.listener?.("SIGNED_IN", { user: { id: "owner-b" } }); });
  expect(controls.verifying).toBe(false);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });
  mocks.reads.push(second.promise);
  let b!: Promise<SavedPlaceWrite>;
  await act(async () => { b = controls.star(controls.places[0], false); });
  expect(controls.verifying).toBe(true);
  await act(async () => { first.resolve({ data: [row], error: null }); await a; });
  expect(controls.verifying).toBe(true);
  await act(async () => { second.resolve({ data: [{ ...row, star_slot: null, star_position: null, revision: 2 }], error: null }); await b; });
  expect(controls.verifying).toBe(false);
  await act(async () => renderer.unmount());
});

it("reports a duplicate save when the server returns a place that was already saved", async () => {
  mocks.reads.push(Promise.resolve({ data: [row], error: null }), Promise.resolve({ data: [row], error: null }));
  mocks.rpc.mockResolvedValue({ data: [row], error: null });
  const renderer = await mount();
  await act(async () => {
    expect(await controls.save(parseSavedPlace(row).place, "", "riding_spot", false)).toEqual({ ok: true, id: row.id, duplicate: true });
  });
  await act(async () => renderer.unmount());
});

it("rejects a list with more than ten stars or a broken legacy mirror", async () => {
  const stars = Array.from({ length: 11 }, (_, index) => ({
    ...row,
    id: `00000000-0000-4000-8000-0000000000${String(index + 10)}`,
    place: { ...row.place, kakaoPlaceId: `p${index}` },
    star_slot: index < 5 ? index + 1 : null,
    star_position: index + 1,
  }));
  mocks.reads.push(Promise.resolve({ data: stars, error: null }));
  const renderer = await mount();
  expect(controls.status).toBe("error");
  mocks.reads.push(Promise.resolve({ data: [{ ...row, star_slot: null, star_position: 5 }], error: null }));
  await act(async () => controls.retry());
  expect(controls.status).toBe("error");
  await act(async () => renderer.unmount());
});
