import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaceSearchResult } from "@/lib/places/search";

const mocks = vi.hoisted(() => ({
  reads: [] as Array<Promise<{ data: unknown; error: unknown }>>,
  rpc: vi.fn(),
  authListener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
}));

vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({
    from: () => ({ select: () => ({ order: () => mocks.reads.shift() ?? Promise.resolve({ data: [], error: null }) }) }),
    rpc: mocks.rpc,
    auth: { onAuthStateChange: (listener: typeof mocks.authListener) => {
      mocks.authListener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    } },
  }),
}));

import { PlaceFavoritesProvider, usePlaceFavorites } from "./place-favorites-provider";

const place: PlaceSearchResult = {
  kakaoPlaceId: "place-1", verificationToken: "a".repeat(43), name: "팔당역", address: "경기 남양주시", roadAddress: null,
  longitude: 127.24, latitude: 37.55, category: "", phone: null, placeUrl: null,
};
const row = { slot: 1, place: { kakaoPlaceId: place.kakaoPlaceId, verificationToken: place.verificationToken, name: place.name, address: place.address, roadAddress: null, longitude: place.longitude, latitude: place.latitude }, created_at: "2026-09-17T00:00:00Z" };
const secondPlace = { ...place, kakaoPlaceId: "place-2", verificationToken: "b".repeat(43), name: "양평역" };
const secondRow = { ...row, slot: 2, place: { ...row.place, kakaoPlaceId: secondPlace.kakaoPlaceId, verificationToken: secondPlace.verificationToken, name: secondPlace.name } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function Harness() {
  const favorites = usePlaceFavorites();
  return <div><output data-state>{favorites.status}|{favorites.busy ? "busy" : "idle"}|{favorites.favorites.length}|{favorites.message}</output><button onClick={() => void favorites.add(place)}>첫 장소 추가</button><button onClick={() => void favorites.add(secondPlace)}>둘째 장소 추가</button><button onClick={favorites.retry}>재시도</button></div>;
}

async function renderProvider() {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<PlaceFavoritesProvider enabled><Harness /></PlaceFavoritesProvider>); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return renderer;
}

async function flushAsync() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  mocks.reads.length = 0;
  mocks.rpc.mockReset();
  mocks.authListener = null;
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});

afterEach(() => vi.unstubAllGlobals());

describe("PlaceFavoritesProvider", () => {
  it("keeps a mutation failure visible after the reconciliation read succeeds", async () => {
    mocks.reads.push(Promise.resolve({ data: [], error: null }), Promise.resolve({ data: [], error: null }));
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "WRITE_FAILED" } });
    const renderer = await renderProvider();
    await act(async () => renderer.root.findAllByType("button")[0].props.onClick());
    await flushAsync();
    expect(renderer.root.findByProps({ "data-state": true }).children.join("")).toContain("즐겨찾기를 저장하지 못했습니다");
    expect(renderer.root.findByProps({ "data-state": true }).children.join("")).toContain("idle");
    await act(async () => renderer.unmount());
  });

  it("does not let an older read erase a favorite saved by a later mutation", async () => {
    const oldRead = deferred<{ data: unknown; error: unknown }>();
    mocks.reads.push(oldRead.promise);
    mocks.rpc.mockResolvedValue({ data: [row], error: null });
    const renderer = await renderProvider();
    await act(async () => renderer.root.findAllByType("button")[0].props.onClick());
    await flushAsync();
    expect(renderer.root.findByProps({ "data-state": true }).children.join("")).toContain("|1|팔당역");
    await act(async () => oldRead.resolve({ data: [], error: null }));
    expect(renderer.root.findByProps({ "data-state": true }).children.join("")).toContain("|1|팔당역");
    await act(async () => renderer.unmount());
  });

  it("keeps a write on same-user token refresh and ignores it after an account change", async () => {
    mocks.reads.push(Promise.resolve({ data: [], error: null }));
    const write = deferred<{ data: unknown; error: unknown }>();
    mocks.rpc.mockReturnValue(write.promise);
    const renderer = await renderProvider();
    await act(async () => mocks.authListener?.("INITIAL_SESSION", { user: { id: "user-a" } }));
    await act(async () => { void renderer.root.findAllByType("button")[0].props.onClick(); });
    await act(async () => mocks.authListener?.("TOKEN_REFRESHED", { user: { id: "user-a" } }));
    await act(async () => write.resolve({ data: [row], error: null }));
    await flushAsync();
    expect(renderer.root.findByProps({ "data-state": true }).children.join("")).toContain("|1|팔당역");

    const secondWrite = deferred<{ data: unknown; error: unknown }>();
    mocks.rpc.mockReturnValue(secondWrite.promise);
    await act(async () => { void renderer.root.findAllByType("button")[1].props.onClick(); });
    await act(async () => mocks.authListener?.("SIGNED_IN", { user: { id: "user-b" } }));
    await act(async () => secondWrite.resolve({ data: [secondRow], error: null }));
    await flushAsync();
    expect(renderer.root.findByProps({ "data-state": true }).children.join("")).toContain("|0|");
    await act(async () => renderer.unmount());
  });
});
