import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useEffect } from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { SavedPlacesProvider, useSavedPlaces } from "./saved-places-provider";
import { parseSavedPlace } from "@/lib/places/saved";

const mocks = vi.hoisted(() => ({
  reads: [] as Array<Promise<{ data: unknown; error: unknown }>>,
  rpc: vi.fn(),
  listener: null as
    null | ((event: string, session: { user: { id: string } } | null) => void),
}));
vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({
    from: () => ({
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
    ).toBe(true);
  });
  expect(mocks.rpc).toHaveBeenCalledWith("save_place", {
    saved_place: original,
    place_alias: "출발 거점",
    place_kind: "riding_spot",
    starred: true,
  });
  await act(async () => renderer.unmount());
});

it("reads all five slots, preserves signed original data, and reconciles unstar without deleting the place", async () => {
  mocks.reads.push(
    Promise.resolve({ data: [row], error: null }),
    Promise.resolve({
      data: [{ ...row, star_slot: null, revision: 2 }],
      error: null,
    }),
  );
  mocks.rpc.mockResolvedValue({
    data: [{ ...row, star_slot: null, revision: 2 }],
    error: null,
  });
  const renderer = await mount();
  expect(controls.favorites[0]).toMatchObject({
    slot: 5,
    displayName: "출발 거점",
    place: { name: "팔당역" },
  });
  await act(async () => {
    expect(await controls.star(controls.places[0], false)).toBe(true);
  });
  expect(mocks.rpc).toHaveBeenCalledWith("set_saved_place_star", {
    saved_place_id: row.id,
    expected_revision: 1,
    starred: false,
  });
  expect(controls.places).toHaveLength(1);
  expect(controls.favorites).toHaveLength(0);
  expect(controls.places[0].place.name).toBe("팔당역");
  await act(async () => renderer.unmount());
});
it("blocks parallel writes and never retries an ambiguous receipt; fresh readback preserves committed data", async () => {
  const write = deferred<{ data: unknown; error: unknown }>();
  mocks.reads.push(
    Promise.resolve({ data: [], error: null }),
    Promise.resolve({ data: [row], error: null }),
  );
  mocks.rpc.mockReturnValue(write.promise);
  const renderer = await mount();
  const place = parseSavedPlace(row).place;
  let first!: Promise<boolean>;
  await act(async () => {
    first = controls.save(place, "출발 거점", "riding_spot", true);
    expect(await controls.save(place, "", "restaurant", false)).toBe(false);
  });
  await act(async () => {
    write.resolve({ data: null, error: { message: "connection lost" } });
    expect(await first).toBe(false);
  });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(controls.places).toHaveLength(1);
  expect(controls.busy).toBe(false);
  expect(controls.message).toContain("확인하지 못했어요");
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
  let result!: Promise<boolean>;
  await act(async () => {
    result = controls.deletePlace(controls.places[0]);
  });
  expect(valid()).toBe(false);
  await act(async () => mocks.listener?.("SIGNED_OUT", null));
  await act(async () => {
    write.resolve({ data: null, error: null });
    expect(await result).toBe(false);
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
    expect(await controls.star(controls.places[0], false)).toBe(false);
  });
  expect(controls.status).toBe("error");
  expect(controls.places).toEqual([]);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});
