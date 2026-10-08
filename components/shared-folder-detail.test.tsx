import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSavedPlaceEntry } from "@/lib/places/saved";
import type { PlaceSearchResult } from "@/lib/places/search";
import { parseAvoidedPlace, parseFolderMember, parseFolderPreference, parsePlaceFolder, parseSharedPlace, parseStarEntries } from "@/lib/places/shared-folders";
import { F1, ME, place, sampleSaved, sampleTables, sharedRow } from "@/tests/fixtures/shared-folders";
import type { SharedSnapshot, SharedWrite } from "./shared-folders-provider";
import { SharedFolderDetail } from "./shared-folder-detail";

const mocks = vi.hoisted(() => ({
  saved: {} as Record<string, unknown>,
  shared: {} as Record<string, unknown>,
  registration: null as null | { onSave: (place: unknown, alias: string, kind: string, starred: boolean) => void },
}));
vi.mock("./saved-places-provider", () => ({ useSavedPlaces: () => mocks.saved }));
vi.mock("./shared-folders-provider", async () => {
  const actual = await vi.importActual<typeof import("./shared-folders-provider")>("./shared-folders-provider");
  return { ...actual, useSharedFolders: () => mocks.shared };
});
vi.mock("@/lib/supabase/browser", () => ({ getBrowserSupabase: () => null }));
vi.mock("./kakao-map-canvas", () => ({ KakaoMapCanvas: () => null }));
// The search screen is covered elsewhere; here it only hands over the chosen place.
vi.mock("./saved-place-registration", () => ({
  SavedPlaceRegistration: (props: typeof mocks.registration) => { mocks.registration = props; return null; },
}));

function snapshotFrom(): SharedSnapshot {
  const tables = sampleTables();
  return {
    userId: ME,
    folders: tables.place_folders.map(parsePlaceFolder),
    members: tables.place_folder_members.map(parseFolderMember),
    preferences: tables.place_folder_preferences.map(parseFolderPreference),
    places: tables.shared_place_entries.map(parseSharedPlace),
    stars: parseStarEntries(tables.my_star_entries),
    avoided: tables.avoided_places.map(parseAvoidedPlace),
  };
}
function text(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}
const buttons = (r: ReactTestRenderer | ReactTestInstance, label: string) => ("root" in r ? r.root : r).findAll((n) => n.type === "button" && text(n) === label);
const dialogs = (r: ReactTestRenderer, title: string) => r.root.findAll((n) => n.type === "dialog" && text(n).includes(title));

let snapshot: SharedSnapshot;
let write: ReturnType<typeof vi.fn>;
let refresh: ReturnType<typeof vi.fn>;
let recheck: ReturnType<typeof vi.fn>;
const searched: PlaceSearchResult = { ...place("k-new", "양서 손두부"), roadAddress: "경기 양평군 양서면 1", category: "음식점", phone: null, placeUrl: null } as PlaceSearchResult;
const newRow = () => parseSharedPlace(sharedRow(40, F1, "k-new", "양서 손두부", { kind: "restaurant" }));

async function mount() {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<SharedFolderDetail folderId={F1} wide={false} disabled={false} onBack={vi.fn()} onAddWaypoint={vi.fn()} />, {
      createNodeMock: () => ({ showModal: vi.fn(), close: vi.fn(), focus: vi.fn() }),
    });
  });
  return r;
}
async function addPlace(r: ReactTestRenderer, chosen: PlaceSearchResult, starred: boolean) {
  await act(async () => buttons(r, "＋ 이 폴더에 장소 추가")[0].props.onClick());
  await act(async () => buttons(r, "검색·지도로 새 장소 추가").concat(r.root.findAll((n) => n.type === "button" && text(n).startsWith("검색")))[0].props.onClick());
  await act(async () => mocks.registration!.onSave(chosen, "", "restaurant", starred));
}

beforeEach(() => {
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  const places = sampleSaved().map(parseSavedPlaceEntry);
  mocks.saved = { status: "ready", places, current: () => ({ status: "ready", places }) };
  snapshot = snapshotFrom();
  write = vi.fn(async (): Promise<SharedWrite> => ({ ok: true }));
  refresh = vi.fn(async () => snapshot);
  recheck = vi.fn(async () => "unreadable");
  mocks.registration = null;
  mocks.shared = {
    accountEpoch: 0, enabled: true, status: "ready", busy: false, verifying: false, message: "",
    get snapshot() { return snapshot; },
    current: () => ({ status: "ready", snapshot }),
    retry: vi.fn(), refresh, reloadStars: vi.fn(async () => undefined),
    captureSnapshot: () => () => true, recheck, write, call: vi.fn(async () => ({ data: [] })),
  };
});
afterEach(() => vi.unstubAllGlobals());

describe("adding a place to a shared folder (G13b)", () => {
  it("V3-6: shows a saved place whose star hit the limit as a partial result", async () => {
    write
      .mockImplementationOnce(async () => { snapshot = { ...snapshot, places: [...snapshot.places, newRow()] }; return { ok: true }; })
      .mockResolvedValueOnce({ ok: false, reason: "star_limit", title: "자주 찾는 장소에 추가하지 못했어요", message: "이미 10곳이 별표돼 있어요." });
    const r = await mount();
    await addPlace(r, searched, true);
    await act(async () => { buttons(dialogs(r, "폴더에 저장할까요?").at(-1)!, "확인하고 저장")[0].props.onClick(); await Promise.resolve(); });
    expect(write.mock.calls.map((call) => call[0].rpc)).toEqual(["add_shared_place", "set_shared_place_star"]);
    expect(text(r.root)).toContain("자주 찾는 장소에는 추가하지 못했어요");
    expect(text(r.root)).toContain("장소는 폴더에 저장했어요. 자주 찾는 장소 10곳이 모두 차서 별표하지 못했어요. 다른 별표를 뺀 뒤 장소 상세에서 추가해 주세요.");
    // G18a: the saved card names the place and the folder above the partial result.
    expect(text(r.root)).toContain("장소를 폴더에 저장했어요");
    expect(text(r.root)).toContain("양서 손두부 · 주말 라이더");
  });

  it("V3-6: an unknown star is shown as unknown and resolved by a re-read, never by sending it again", async () => {
    write
      .mockImplementationOnce(async () => { snapshot = { ...snapshot, places: [...snapshot.places, newRow()] }; return { ok: true }; })
      .mockResolvedValueOnce({ ok: false, reason: "unknown", checked: false, title: "", message: "" });
    const r = await mount();
    await addPlace(r, searched, true);
    await act(async () => { buttons(dialogs(r, "폴더에 저장할까요?").at(-1)!, "확인하고 저장")[0].props.onClick(); await Promise.resolve(); });
    expect(text(r.root)).toContain("별표가 반영됐는지 확인하지 못했어요");
    refresh.mockImplementationOnce(async () => { snapshot = { ...snapshot, places: snapshot.places.map((p) => (p.id === newRow().id ? { ...p, starred: true } : p)) }; return snapshot; });
    await act(async () => buttons(r, "목록 다시 확인")[0].props.onClick());
    expect(text(r.root)).not.toContain("별표가 반영됐는지 확인하지 못했어요");
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("V3-6: a save confirmed only by the read-only re-check still sends the star", async () => {
    write.mockImplementationOnce(async () => ({ ok: false, reason: "unknown", checked: false, title: "목록을 확인하지 못했어요", message: "", recheck: () => true }));
    recheck.mockImplementationOnce(async () => { snapshot = { ...snapshot, places: [...snapshot.places, newRow()] }; return "applied"; });
    const r = await mount();
    await addPlace(r, searched, true);
    const popup = () => dialogs(r, "폴더에 저장할까요?").at(-1)!;
    await act(async () => { buttons(popup(), "확인하고 저장")[0].props.onClick(); await Promise.resolve(); });
    await act(async () => { buttons(popup(), "목록 다시 확인")[0].props.onClick(); await Promise.resolve(); });
    expect(write.mock.calls.map((call) => call[0].rpc)).toEqual(["add_shared_place", "set_shared_place_star"]);
  });

  it("V3-10: the duplicate-place popup closes with 닫기 and with 기존 장소 열기", async () => {
    const existing = { ...searched, kakaoPlaceId: "k-f1", name: "문호리 강변 쉼터" };
    const r = await mount();
    const confirmSave = () => act(async () => { buttons(dialogs(r, "폴더에 저장할까요?").at(-1)!, "확인하고 저장")[0].props.onClick(); await Promise.resolve(); });
    await addPlace(r, existing, false);
    await confirmSave();
    expect(dialogs(r, "이미 폴더에 있는 장소예요")).toHaveLength(1);
    await act(async () => buttons(dialogs(r, "이미 폴더에 있는 장소예요")[0], "닫기")[0].props.onClick());
    expect(dialogs(r, "이미 폴더에 있는 장소예요")).toHaveLength(0);
    await addPlace(r, existing, false);
    await confirmSave();
    await act(async () => buttons(dialogs(r, "이미 폴더에 있는 장소예요")[0], "기존 장소 열기")[0].props.onClick());
    expect(dialogs(r, "이미 폴더에 있는 장소예요")).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
  });
});
