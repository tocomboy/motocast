import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSavedPlaceEntry } from "@/lib/places/saved";
import {
  parseAvoidedPlace,
  parseFolderMember,
  parseFolderPreference,
  parsePlaceFolder,
  parseSharedPlace,
  parseStarEntries,
} from "@/lib/places/shared-folders";
import { F1, F2, F3, ME, OTHER, sampleSaved, sampleTables, sharedRow } from "@/tests/fixtures/shared-folders";
import type { SharedSnapshot, SharedWrite } from "./shared-folders-provider";
import { SavedPlacesManager } from "./saved-places-manager";

const mocks = vi.hoisted(() => ({
  saved: {} as Record<string, unknown>,
  shared: {} as Record<string, unknown>,
  canvases: [] as Array<Record<string, unknown>>,
}));
vi.mock("./saved-places-provider", () => ({ useSavedPlaces: () => mocks.saved }));
vi.mock("./shared-folders-provider", async () => {
  const actual = await vi.importActual<typeof import("./shared-folders-provider")>("./shared-folders-provider");
  return { ...actual, useSharedFolders: () => mocks.shared };
});
vi.mock("@/lib/supabase/browser", () => ({ getBrowserSupabase: () => null }));
vi.mock("./kakao-map-canvas", () => ({ KakaoMapCanvas: (props: Record<string, unknown>) => { mocks.canvases.push(props); return null; } }));
vi.mock("./map-point-confirmation", () => ({ MapPointConfirmation: () => null }));

function snapshotFrom(tables = sampleTables()): SharedSnapshot {
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
function text(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  return ((node as { children?: unknown[] }).children ?? []).map(text).join("");
}
const buttons = (r: ReactTestRenderer | ReactTestInstance, label: string) => ("root" in r ? r.root : r).findAll((n) => n.type === "button" && text(n) === label);
const button = (r: ReactTestRenderer | ReactTestInstance, label: string) => buttons(r, label)[0];
// The innermost dialog: popups open inside full-screen dialogs.
const dialogWith = (r: ReactTestRenderer, title: string) => r.root.findAll((n) => n.type === "dialog" && text(n).includes(title)).at(-1)!;
const dialogs = (r: ReactTestRenderer, title: string) => r.root.findAll((n) => n.type === "dialog" && text(n).includes(title));
const cards = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === "li" && typeof n.props.className === "string" && n.props.className.includes("placeCard")).map(text);

let snapshot: SharedSnapshot;
let write: ReturnType<typeof vi.fn>;
async function mount() {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<SavedPlacesManager onBack={vi.fn()} onAddWaypoint={vi.fn(() => null)} routePoints={[]} />, {
      createNodeMock: () => ({ showModal: vi.fn(), close: vi.fn(), focus: vi.fn() }),
    });
  });
  return r;
}
beforeEach(() => {
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("window", { setTimeout, clearTimeout, sessionStorage: { getItem: () => null, removeItem: () => undefined } });
  const places = sampleSaved().map(parseSavedPlaceEntry);
  mocks.saved = {
    accountEpoch: 1, places, favorites: [], status: "ready", busy: false, verifying: false, message: "", failureTitle: "",
    current: () => ({ status: "ready", places }), captureSnapshot: () => () => true, recheck: vi.fn(), retry: vi.fn(),
    star: vi.fn(async () => ({ ok: true })), deletePlace: vi.fn(), save: vi.fn(), edit: vi.fn(),
  };
  snapshot = snapshotFrom();
  write = vi.fn(async (): Promise<SharedWrite> => ({ ok: true }));
  mocks.shared = {
    accountEpoch: 0, enabled: true, status: "ready", busy: false, verifying: false, message: "",
    get snapshot() { return snapshot; },
    current: () => ({ status: "ready", snapshot }),
    retry: vi.fn(), refresh: vi.fn(), reloadStars: vi.fn(async () => undefined),
    captureSnapshot: () => () => true, recheck: vi.fn(async () => "unreadable"), write, call: vi.fn(async () => ({ data: [] })),
    // Like the provider: account-wide, outside the favorites screen.
    pendingCreate: null,
    setPendingCreate: vi.fn((next: unknown) => { mocks.shared.pendingCreate = next; }),
  };
  mocks.canvases = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("favorites places view with shared folders (G00, G00a, G00b)", () => {
  it("merges my places and enabled folders with one row per place and its source", async () => {
    const r = await mount();
    expect(buttons(r, "장소").length + buttons(r, "공유 폴더").length + buttons(r, "기피 장소").length).toBeGreaterThanOrEqual(3);
    const spots = cards(r);
    expect(spots.filter((card) => card.includes("팔당 라이딩 카페"))).toHaveLength(1);
    expect(spots.find((card) => card.includes("팔당 라이딩 카페"))).toContain("내 장소");
    expect(spots.filter((card) => card.includes("남한강 강변 쉼터"))).toEqual([expect.stringContaining("공유 · 남한강 맛집 외 1")]);
    expect(spots.find((card) => card.includes("문호리 강변 쉼터"))).toContain("공유 · 주말 라이더");
    // G00a count line: shared rows are counted apart from my 1,000 limit.
    const count = r.root.findAll((n) => n.type === "p" && typeof n.props.className === "string" && n.props.className.includes("listCount"))[0];
    expect(text(count)).toBe("라이딩 스팟4곳 (공유 2) · 내 저장 장소2 / 1,000");
    expect(text(r.root.findByProps({ "aria-label": "공유 폴더 2 / 3 켬, 고르기" }))).toContain("공유 폴더 2 / 3");
    await act(async () => button(r, "식당").props.onClick());
    // The disabled folder's restaurant is left out; the avoided restaurant keeps a 기피 chip.
    const restaurants = cards(r);
    expect(restaurants.some((card) => card.includes("양수리 닭갈비"))).toBe(false);
    expect(restaurants.find((card) => card.includes("가평 휴게소"))).toContain("기피");
    await act(async () => r.unmount());
  });

  it("draws avoided places as their own pins and never clusters them", async () => {
    const r = await mount();
    const pins = (mocks.canvases.at(-1)!.savedPins as Array<{ id: string; avoided?: boolean }>);
    expect(pins.filter((pin) => pin.avoided).map((pin) => pin.id).sort()).toEqual([`avoid:00000000-0000-4000-8000-0000000000b2`, `shared:${sharedRow(6, F1, "", "").id}`].sort());
    await act(async () => r.unmount());
  });

  it("shows every star in the frequent tab, including a disabled folder's, in starred order", async () => {
    const r = await mount();
    await act(async () => button(r, "자주 찾는 장소").props.onClick());
    const starred = cards(r);
    expect(starred.map((card) => card.includes("팔당 라이딩 카페") ? "saved" : card.includes("양수리 닭갈비") ? "shared" : "?")).toEqual(["saved", "shared"]);
    expect(starred[1]).toContain("공유 · 동호회 정모 코스");
    expect(text(r.root)).toContain("2 / 10");
    await act(async () => r.unmount());
  });

  it("sends only the folders the rider changed and nothing on cancel (G00b, G00c)", async () => {
    const r = await mount();
    await act(async () => r.root.findByProps({ "aria-label": "공유 폴더 2 / 3 켬, 고르기" }).props.onClick());
    let popup = dialogWith(r, "지도와 목록에 보일 공유 폴더");
    expect(text(popup)).toContain("켜 둔 폴더2 / 3");
    await act(async () => button(popup, "모두 끄기").props.onClick());
    expect(text(dialogWith(r, "지도와 목록에 보일 공유 폴더"))).toContain("켜 둔 폴더0 / 3");
    await act(async () => button(dialogWith(r, "지도와 목록에 보일 공유 폴더"), "취소").props.onClick());
    expect(write).not.toHaveBeenCalled();
    await act(async () => r.root.findByProps({ "aria-label": "공유 폴더 2 / 3 켬, 고르기" }).props.onClick());
    popup = dialogWith(r, "지도와 목록에 보일 공유 폴더");
    const f1 = popup.findAll((n) => n.type === "input" && n.props.type === "checkbox")[0];
    await act(async () => f1.props.onChange({ target: { checked: false } }));
    await act(async () => button(dialogWith(r, "지도와 목록에 보일 공유 폴더"), "적용").props.onClick());
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toMatchObject({ rpc: "set_place_folders_enabled", args: { changes: [{ folderId: F1, enabled: false }] } });
    await act(async () => r.unmount());
  });

  it("applies with no request when nothing changed", async () => {
    const r = await mount();
    await act(async () => r.root.findByProps({ "aria-label": "공유 폴더 2 / 3 켬, 고르기" }).props.onClick());
    await act(async () => button(dialogWith(r, "지도와 목록에 보일 공유 폴더"), "적용").props.onClick());
    expect(write).not.toHaveBeenCalled();
    await act(async () => r.unmount());
  });

  it("hides the folder toggle without folders and says so when all folders are off", async () => {
    snapshot = { ...snapshot, preferences: snapshot.preferences.map((row) => ({ ...row, enabled: false })) };
    let r = await mount();
    expect(text(r.root)).toContain("공유 폴더 끔");
    expect(text(r.root)).toContain("공유 폴더를 모두 꺼서 내 장소만 보여요");
    expect(cards(r).every((card) => card.includes("내 장소"))).toBe(true);
    await act(async () => r.unmount());
    snapshot = { ...snapshot, folders: [], members: [], preferences: [], places: [] };
    r = await mount();
    expect(r.root.findAll((n) => n.props["aria-label"]?.toString().startsWith("공유 폴더") && n.type === "button")).toHaveLength(0);
    // Without any shared folder there is nothing to tell apart: no "내 장소" source line.
    expect(cards(r).some((card) => card.includes("내 장소"))).toBe(false);
    await act(async () => r.unmount());
  });

  it("lists a place starred both as mine and from a folder twice and counts both stars", async () => {
    const tables = sampleTables();
    const mineStar = tables.my_star_entries.find((row) => row.source === "saved")!;
    tables.shared_place_entries[0].starred = true;
    tables.my_star_entries.push({ ...mineStar, source: "shared", id: tables.shared_place_entries[0].id, folder_id: F1, star_slot: null, starred_at: "2026-10-05T00:00:00Z" });
    snapshot = snapshotFrom(tables);
    const r = await mount();
    await act(async () => button(r, "자주 찾는 장소").props.onClick());
    const rows = cards(r).filter((card) => card.includes("팔당 라이딩 카페"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("내 장소");
    expect(rows[1]).toContain("공유 · 주말 라이더");
    expect(text(r.root)).toContain("3 / 10");
    await act(async () => r.unmount());
  });

  it("stars a shared place for me only through the G14a confirmation", async () => {
    const r = await mount();
    const card = r.root.findAll((n) => n.type === "li" && text(n).includes("문호리 강변 쉼터"))[0];
    await act(async () => card.findByProps({ "aria-label": "자주 찾는 장소에 추가" }).props.onClick());
    const popup = dialogWith(r, "자주 찾는 장소에 추가할까요?");
    expect(text(popup)).toContain("공유 · 주말 라이더");
    expect(text(popup)).toContain("2 → 3 / 10");
    expect(write).not.toHaveBeenCalled();
    await act(async () => button(popup, "추가").props.onClick());
    expect(write.mock.calls[0][0]).toMatchObject({ rpc: "set_shared_place_star", args: { shared_place_id: sharedRow(4, F1, "", "").id, starred: true } });
    await act(async () => r.unmount());
  });
});

describe("states added with the 456 frames", () => {
  it("keeps my places and offers a reload when the shared folders fail to load (G00g)", async () => {
    mocks.shared = { ...mocks.shared, status: "error" };
    const r = await mount();
    const body = text(r.root);
    expect(body).toContain("공유 폴더 장소를 불러오지 못했어요");
    expect(body).toContain("내 장소는 그대로 볼 수 있어요. 공유 폴더 장소는 지도와 목록에서 잠시 빠져 있어요.");
    expect(body).toContain("다시 불러오면 공유 폴더 장소가 지도와 목록에 함께 보여요.");
    expect(r.root.findByProps({ "aria-label": "공유 폴더, 불러오지 못해 고를 수 없음" }).props.disabled).toBe(true);
    expect(cards(r).every((card) => card.includes("내 장소"))).toBe(true);
    expect(cards(r).some((card) => card.includes("공유 ·"))).toBe(false);
    await act(async () => button(r, "공유 폴더 다시 불러오기").props.onClick());
    expect(mocks.shared.retry).toHaveBeenCalledTimes(1);
    await act(async () => r.unmount());
  });

  it("asks before dropping a started folder and names what is lost (G04x)", async () => {
    const r = await mount();
    await act(async () => button(r, "공유 폴더").props.onClick());
    await act(async () => button(r, "＋ 공유 폴더 만들기").props.onClick());
    const back = () => r.root.findByProps({ "aria-label": "공유 폴더 만들기 뒤로" });
    await act(async () => r.root.findByProps({ placeholder: "예: 주말 라이더" }).props.onChange({ target: { value: "주말 라이더" } }));
    await act(async () => r.root.findByProps({ placeholder: "예: 주말라이더" }).props.onChange({ target: { value: "바람개비" } }));
    await act(async () => back().props.onClick());
    const popup = () => dialogWith(r, "폴더 만들기를 그만둘까요?");
    expect(text(popup())).toContain("입력한 폴더 이름·내 폴더용 이름이 저장되지 않아요.");
    expect(button(popup(), "그만두기").props.className).toContain("destructiveButton");
    // X keeps making the folder, like "계속 만들기".
    await act(async () => popup().findByProps({ "aria-label": "닫기" }).props.onClick());
    expect(r.root.find((n) => n.type === "input" && n.props.placeholder === "예: 주말 라이더").props.value).toBe("주말 라이더");
    await act(async () => back().props.onClick());
    await act(async () => button(popup(), "그만두기").props.onClick());
    expect(r.root.findAll((n) => n.type === "input" && n.props.placeholder === "예: 주말 라이더")).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
    await act(async () => r.unmount());
  });

  async function openInvites(rows: unknown[]) {
    (mocks.shared as { call: ReturnType<typeof vi.fn> }).call = vi.fn(async () => ({ data: rows }));
    const r = await mount();
    await act(async () => button(r, "공유 폴더").props.onClick());
    await act(async () => r.root.findByProps({ "aria-label": "주말 라이더 폴더 열기, 주인" }).props.onClick());
    await act(async () => r.root.findByProps({ "aria-label": "폴더 메뉴" }).props.onClick());
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    const row = dialogWith(r, "폴더 삭제").findAll((n) => n.type === "button" && text(n).startsWith("초대 링크"))[0];
    await act(async () => row.props.onClick());
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    return r;
  }
  const invite = (index: number) => ({
    id: `00000000-0000-4000-8000-0000000009${String(index).padStart(2, "0")}`,
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    expires_at: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    revoked_at: null,
  });

  it("shows the empty invite state with the link count (G20a)", async () => {
    const r = await openInvites([]);
    const body = text(r.root);
    expect(body).toContain("사용 중인 링크0 / 10");
    expect(body).toContain("새 링크를 만들어 보내면, 받은 사람이 로그인한 뒤 이 폴더에 들어올 수 있어요.");
    expect(button(r, "새 초대 링크 만들기").props.disabled).toBe(false);
    await act(async () => r.unmount());
  });

  it("disables a new link at 10 and says why (G20b)", async () => {
    const r = await openInvites(Array.from({ length: 10 }, (_, index) => invite(index)));
    const body = text(r.root);
    expect(body).toContain("사용 중인 링크10 / 10");
    expect(body).toContain("사용 중인 초대 링크 10개가 모두 찼어요");
    expect(body).toContain("쓰지 않는 링크를 회수하면 새 링크를 만들 수 있어요.");
    expect(body).toContain("사용 중인 링크가 10개라 더 만들 수 없어요.");
    expect(button(r, "새 초대 링크 만들기").props.disabled).toBe(true);
    await act(async () => r.unmount());
  });

  it("starts the avoided registration with its own title, example and note (AV10)", async () => {
    const r = await mount();
    await act(async () => button(r, "기피 장소").props.onClick());
    await act(async () => button(r, "＋ 기피 장소 등록").props.onClick());
    const body = text(r.root);
    expect(body).toContain("기피 장소 등록");
    expect(r.root.findAll((n) => n.type === "input" && n.props.placeholder === "예: 양평 해장국, 양평군 양평읍")).toHaveLength(1);
    expect(body).toContain("기피 장소는 나에게만 적용돼요. 같은 장소로 판단되는 식당은 식당 추천에서 빠져요.");
    expect(body).not.toContain("길게 눌러도");
    await act(async () => button(r, "지도에서 지점 고르기").props.onClick());
    expect(r.root.findAll((n) => n.type === "h2" && text(n) === "기피 장소 등록").length).toBeGreaterThan(0);
    await act(async () => r.unmount());
  });
});

describe("V3 part 1: newer data is never overwritten by a retry", () => {
  // Like the provider: every reload starts a new generation, and a popup's approval belongs to one.
  let generation = 0;
  function reload(next: SharedSnapshot) { snapshot = next; generation += 1; }
  beforeEach(() => {
    generation = 0;
    // Assigned in place: spreading would freeze the `snapshot` getter to the first snapshot.
    mocks.shared.captureSnapshot = () => { const at = generation; return () => at === generation; };
  });
  async function openMenuRow(r: ReactTestRenderer, label: string) {
    await act(async () => button(r, "공유 폴더").props.onClick());
    await act(async () => r.root.findByProps({ "aria-label": "주말 라이더 폴더 열기, 주인" }).props.onClick());
    await act(async () => r.root.findByProps({ "aria-label": "폴더 메뉴" }).props.onClick());
    const row = dialogWith(r, "폴더 삭제").findAll((n) => n.type === "button" && text(n).startsWith(label))[0];
    await act(async () => row.props.onClick());
  }
  const inputOf = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === "input" && n.props.maxLength !== undefined).at(-1)!;

  it("V3-2: a folder rename refused as stale ends with the newest name instead of retrying over it", async () => {
    const r = await mount();
    await openMenuRow(r, "폴더 이름 바꾸기");
    await act(async () => inputOf(r).props.onChange({ target: { value: "주말 라이더 C" } }));
    await act(async () => button(r, "이름 저장").props.onClick());
    write.mockImplementationOnce(async () => {
      reload({ ...snapshot, folders: snapshot.folders.map((row) => (row.id === F1 ? { ...row, name: "주말 라이더 B", revision: 2 } : row)) });
      return { ok: false, reason: "rejected", stale: true, title: "다른 기기에서 먼저 바뀌었어요", message: "최신 이름을 불러왔어요." };
    });
    const popup = () => dialogWith(r, "폴더 이름을 바꿀까요?");
    await act(async () => button(popup(), "확인하고 바꾸기").props.onClick());
    expect(write.mock.calls[0][0]).toMatchObject({ rpc: "rename_place_folder", args: { expected_revision: 1, folder_name: "주말 라이더 C" } });
    expect(buttons(popup(), "다시 시도")).toHaveLength(0);
    expect(buttons(popup(), "확인하고 바꾸기")).toHaveLength(0);
    expect(write).toHaveBeenCalledTimes(1);
    // G37c: the newest name is the "전" value, with one button that shows it in the input.
    expect(text(popup())).toContain("다른 기기에서 먼저 바뀌었어요");
    expect(text(popup())).toContain("지금 폴더 이름은 \"주말 라이더 B\"이에요. 바꿀 이름을 확인한 뒤 다시 저장해 주세요.");
    expect(popup().findAll((n) => n.type === "del").map(text)).toEqual(["주말 라이더 B"]);
    expect(text(popup())).toContain("회원 모두에게 새 이름으로 보여요.");
    await act(async () => button(popup(), "최신 이름 확인").props.onClick());
    expect(dialogs(r, "폴더 이름을 바꿀까요?")).toHaveLength(0);
    expect(inputOf(r).props.value).toBe("주말 라이더 B");
    await act(async () => r.unmount());
  });

  it("delta 2-1: a stale rename whose newest name could not be read only re-reads, then opens G37c with the newest name", async () => {
    let status = "ready";
    mocks.shared.current = () => ({ status, snapshot });
    const r = await mount();
    await openMenuRow(r, "폴더 이름 바꾸기");
    await act(async () => inputOf(r).props.onChange({ target: { value: "주말 라이더 C" } }));
    await act(async () => button(r, "이름 저장").props.onClick());
    // STALE, and the provider's re-read failed: the list is in error and still shows the old row.
    write.mockImplementationOnce(async () => { status = "error"; generation += 1; return { ok: false, reason: "rejected", stale: true, title: "다른 기기에서 먼저 바뀌었어요", message: "최신 이름을 불러왔어요. 최신 목록도 확인하지 못했어요." }; });
    const popup = () => dialogs(r, "폴더 이름을 바꿀까요?").at(-1)!;
    await act(async () => button(popup(), "확인하고 바꾸기").props.onClick());
    expect(buttons(popup(), "다시 시도")).toHaveLength(0);
    expect(text(popup())).toContain("최신 이름을 확인하지 못했어요");
    // The connection is back: reading again shows the newest name as a new approval (G37c).
    (mocks.shared as { recheck: ReturnType<typeof vi.fn> }).recheck = vi.fn(async (applied: (s: SharedSnapshot) => boolean) => {
      reload({ ...snapshot, folders: snapshot.folders.map((row) => (row.id === F1 ? { ...row, name: "주말 라이더 모임", revision: 2 } : row)) });
      status = "ready";
      return applied(snapshot) ? "applied" : "missing";
    });
    await act(async () => r.update(<SavedPlacesManager onBack={vi.fn()} onAddWaypoint={vi.fn(() => null)} routePoints={[]} />));
    await act(async () => { button(popup(), "최신 이름 다시 확인").props.onClick(); await Promise.resolve(); });
    expect(text(popup())).toContain("지금 폴더 이름은 \"주말 라이더 모임\"이에요.");
    expect(buttons(popup(), "최신 이름 확인")).toHaveLength(1);
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => r.unmount());
  });

  for (const [label, kind] of [["폴더 이름 바꾸기", "folder"], ["이 폴더에서 쓰는 내 이름", "member"]] as const) {
    it(`delta 3-1: an unread stale ${kind} name stays read-only while the re-read shows the same or an older revision`, async () => {
      let status = "ready";
      mocks.shared.current = () => ({ status, snapshot });
      // Shown at revision 2, so an older revision (1) can be read back.
      const setRevision = (revision: number, name: string) => {
        reload(kind === "folder"
          ? { ...snapshot, folders: snapshot.folders.map((row) => (row.id === F1 ? { ...row, name, revision } : row)) }
          : { ...snapshot, members: snapshot.members.map((row) => (row.folderId === F1 && row.memberId === ME ? { ...row, displayName: name, revision } : row)) });
      };
      setRevision(2, kind === "folder" ? "주말 라이더" : "바람개비");
      const r = await mount();
      await openMenuRow(r, label);
      await act(async () => inputOf(r).props.onChange({ target: { value: kind === "folder" ? "주말 라이더 C" : "바람개비C" } }));
      await act(async () => button(r, "이름 저장").props.onClick());
      const title = kind === "folder" ? "폴더 이름을 바꿀까요?" : "폴더용 이름을 바꿀까요?";
      const popup = () => dialogs(r, title).at(-1)!;
      write.mockImplementationOnce(async () => { status = "error"; generation += 1; return { ok: false, reason: "rejected", stale: true, title: "다른 기기에서 먼저 바뀌었어요", message: "" }; });
      await act(async () => button(popup(), "확인하고 바꾸기").props.onClick());
      for (const revision of [2, 1]) {
        (mocks.shared as { recheck: ReturnType<typeof vi.fn> }).recheck = vi.fn(async (applied: (s: SharedSnapshot) => boolean) => {
          setRevision(revision, kind === "folder" ? "옛 이름" : "옛이름");
          status = "ready";
          return applied(snapshot) ? "applied" : "missing";
        });
        await act(async () => r.update(<SavedPlacesManager onBack={vi.fn()} onAddWaypoint={vi.fn(() => null)} routePoints={[]} />));
        await act(async () => { button(popup(), "최신 이름 다시 확인").props.onClick(); await Promise.resolve(); });
        expect(text(popup())).toContain("아직 최신 이름이 보이지 않아요. 이름 변경은 다시 보내지 않아요.");
        expect(buttons(popup(), "최신 이름 다시 확인")).toHaveLength(1);
        expect(buttons(popup(), "확인하고 바꾸기")).toHaveLength(0);
        expect(buttons(popup(), "다시 시도")).toHaveLength(0);
        expect(buttons(popup(), "최신 이름 확인")).toHaveLength(0);
      }
      expect(inputOf(r).props.value).toBe(kind === "folder" ? "주말 라이더 C" : "바람개비C");
      expect(write).toHaveBeenCalledTimes(1);
      await act(async () => r.unmount());
    });
  }

  it("parity 1: closing an unknown create keeps its request id, blocks new creates, and a re-read resumes it", async () => {
    const r = await mount();
    await startCreate(r);
    write.mockImplementationOnce(async () => ({ ok: false, reason: "unknown", checked: false, title: "목록을 확인하지 못했어요", message: "", recheck: () => false }));
    await act(async () => button(dialogWith(r, "이 공유 폴더를 만들까요?"), "폴더 만들기").props.onClick());
    await act(async () => button(dialogWith(r, "이 공유 폴더를 만들까요?"), "취소").props.onClick());
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    // Back on the list, with the notice and no new create.
    expect(r.root.findAll((n) => n.type === "input" && n.props.placeholder === "예: 주말 라이더")).toHaveLength(0);
    expect(text(r.root)).toContain("폴더를 만들었는지 확인하고 있어요");
    expect(text(r.root)).toContain("응답을 받지 못한 만들기 요청이 있어요. 확인이 끝날 때까지 새 폴더 만들기를 잠시 막아 둘게요.");
    expect(button(r, "＋ 공유 폴더 만들기").props.disabled).toBe(true);
    // Re-read: no folder with that id, so the same confirmation opens again with the same id.
    (mocks.shared as { refresh: ReturnType<typeof vi.fn> }).refresh = vi.fn(async () => snapshot);
    await act(async () => r.update(<SavedPlacesManager onBack={vi.fn()} onAddWaypoint={vi.fn(() => null)} routePoints={[]} />));
    await act(async () => { button(r, "다시 확인").props.onClick(); await Promise.resolve(); });
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    await act(async () => button(dialogWith(r, "이 공유 폴더를 만들까요?"), "폴더 만들기").props.onClick());
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0].args).toEqual(write.mock.calls[0][0].args);
    await act(async () => r.unmount());
  });

  async function keepUnknownCreate(r: ReactTestRenderer) {
    await startCreate(r);
    write.mockImplementationOnce(async () => ({ ok: false, reason: "unknown", checked: false, title: "목록을 확인하지 못했어요", message: "", recheck: () => false }));
    await act(async () => button(dialogWith(r, "이 공유 폴더를 만들까요?"), "폴더 만들기").props.onClick());
    await act(async () => button(dialogWith(r, "이 공유 폴더를 만들까요?"), "취소").props.onClick());
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
  }
  const rerenderManager = (r: ReactTestRenderer) => act(async () => r.update(<SavedPlacesManager onBack={vi.fn()} onAddWaypoint={vi.fn(() => null)} routePoints={[]} />));
  async function resume(r: ReactTestRenderer) {
    (mocks.shared as { refresh: ReturnType<typeof vi.fn> }).refresh = vi.fn(async () => snapshot);
    await rerenderManager(r);
    await act(async () => { button(r, "다시 확인").props.onClick(); await Promise.resolve(); });
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
  }

  it("delta 5-1: cancelling the reopened confirmation returns to the kept request, never to a new id or edited input", async () => {
    const r = await mount();
    await keepUnknownCreate(r);
    await resume(r);
    // The reopened screen is locked to the kept input.
    expect(r.root.find((n) => n.type === "input" && n.props.placeholder === "예: 주말 라이더").props.disabled).toBe(true);
    await act(async () => button(dialogWith(r, "이 공유 폴더를 만들까요?"), "취소").props.onClick());
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    expect(r.root.findAll((n) => n.type === "input" && n.props.placeholder === "예: 주말 라이더")).toHaveLength(0);
    expect(text(r.root)).toContain("폴더를 만들었는지 확인하고 있어요");
    expect(button(r, "＋ 공유 폴더 만들기").props.disabled).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => r.unmount());
  });

  it("delta 5-2: closing the deleted-since notice settles the kept request and allows a new create", async () => {
    const r = await mount();
    await keepUnknownCreate(r);
    await resume(r);
    write.mockImplementationOnce(async (spec: { args: { request_id: string }; receipt: (data: unknown) => unknown }) => {
      spec.receipt({ folder: { id: "00000000-0000-4000-8000-0000000000f9", owner_id: ME, name: "새 폴더", revision: 1, create_request_id: spec.args.request_id, created_at: "2026-10-09T00:00:00Z", updated_at: "2026-10-09T00:00:00Z" } });
      return { ok: false, reason: "mismatch", checked: true, title: "", message: "", recheck: () => false };
    });
    const popup = () => dialogWith(r, "이 공유 폴더를 만들까요?");
    await act(async () => button(popup(), "폴더 만들기").props.onClick());
    expect(text(popup())).toContain("이 요청으로 만든 폴더는 이미 삭제됐어요");
    await act(async () => button(popup(), "닫기").props.onClick());
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    expect(mocks.shared.pendingCreate).toBeNull();
    await act(async () => r.root.findByProps({ "aria-label": "공유 폴더 만들기 뒤로" }).props.onClick());
    await act(async () => { const leave = r.root.findAll((n) => n.type === "button" && text(n) === "그만두기")[0]; if (leave) leave.props.onClick(); });
    expect(text(r.root)).not.toContain("폴더를 만들었는지 확인하고 있어요");
    expect(button(r, "＋ 공유 폴더 만들기").props.disabled).toBe(false);
    await act(async () => r.unmount());
  });

  it("delta 5-3: the kept request survives leaving the favorites screen in the same account", async () => {
    let r = await mount();
    await keepUnknownCreate(r);
    const first = write.mock.calls[0][0].args;
    await act(async () => r.unmount());
    // Home and back: a new favorites screen over the same account state.
    r = await mount();
    await act(async () => button(r, "공유 폴더").props.onClick());
    expect(text(r.root)).toContain("폴더를 만들었는지 확인하고 있어요");
    expect(button(r, "＋ 공유 폴더 만들기").props.disabled).toBe(true);
    await resume(r);
    await act(async () => button(dialogWith(r, "이 공유 폴더를 만들까요?"), "폴더 만들기").props.onClick());
    expect(write.mock.calls[1][0].args).toEqual(first);
    await act(async () => r.unmount());
  });

  // The first send times out (its result unknown, the list without it), then the retry is refused,
  // so the request is abandoned on the server with `abandon` as the answer.
  async function refusedAfterUnknown(r: ReactTestRenderer, abandon: { data: unknown; code: string | null; lost: boolean }) {
    await startCreate(r);
    write
      .mockImplementationOnce(async () => ({ ok: false, reason: "unknown", checked: true, title: "변경을 확인하지 못했어요", message: "" }))
      .mockImplementationOnce(async () => ({ ok: false, reason: "rejected", title: "폴더를 만들지 못했어요", message: "공유 폴더 20개가 모두 찼어요." }));
    const call = vi.fn<(rpc: string, args: Record<string, unknown>) => Promise<typeof abandon>>(async () => abandon);
    (mocks.shared as { call: typeof call }).call = call;
    await rerenderManager(r);
    const popup = () => dialogWith(r, "이 공유 폴더를 만들까요?");
    await act(async () => button(popup(), "폴더 만들기").props.onClick());
    await act(async () => { button(popup(), "확인하고 만들기").props.onClick(); await Promise.resolve(); });
    expect(call).toHaveBeenCalledWith("abandon_place_folder_request", { request_id: write.mock.calls[0][0].args.request_id });
    return { call, popup, requestId: write.mock.calls[0][0].args.request_id as string };
  }

  it("delta 7: a refused retry after an unknown try abandons the request; 'abandoned' releases it with the refusal", async () => {
    const r = await mount();
    const { popup } = await refusedAfterUnknown(r, { data: { status: "abandoned" }, code: null, lost: false });
    expect(text(popup())).toContain("공유 폴더 20개가 모두 찼어요.");
    expect(buttons(popup(), "다시 시도")).toHaveLength(0);
    expect(mocks.shared.pendingCreate).toBeNull();
    await act(async () => button(popup(), "닫기").props.onClick());
    expect(write).toHaveBeenCalledTimes(2);
    await act(async () => r.unmount());
  });

  it("delta 7: an abandon answering 'created' opens the folder the late first send made", async () => {
    const r = await mount();
    const id = "00000000-0000-4000-8000-0000000000f9";
    (mocks.shared as { refresh: ReturnType<typeof vi.fn> }).refresh = vi.fn(async () => {
      reload({
        ...snapshot,
        folders: [...snapshot.folders, { ...snapshot.folders[0], id, name: "새 폴더" }],
        members: [...snapshot.members, { ...snapshot.members[0], folderId: id, memberId: ME, role: "owner", displayName: "바람개비" }],
        preferences: [...snapshot.preferences, { ...snapshot.preferences[0], folderId: id, enabled: true }],
      });
      return snapshot;
    });
    await refusedAfterUnknown(r, { data: { status: "created", result: { folder: { id, owner_id: ME, name: "새 폴더", revision: 1, create_request_id: null, created_at: "2026-10-09T00:00:00Z", updated_at: "2026-10-09T00:00:00Z" } } }, code: null, lost: false });
    expect(text(r.root)).toContain("공유 폴더를 만들었어요.");
    expect(mocks.shared.pendingCreate).toBeNull();
    await act(async () => r.unmount());
  });

  it("delta 7: an abandon answering 'created_gone' ends with the deleted notice", async () => {
    const r = await mount();
    const { popup } = await refusedAfterUnknown(r, { data: { status: "created_gone" }, code: null, lost: false });
    expect(text(popup())).toContain("이 요청으로 만든 폴더는 이미 삭제됐어요");
    expect(mocks.shared.pendingCreate).toBeNull();
    await act(async () => r.unmount());
  });

  it("delta 7: an unknown abandon keeps the request blocked, and 다시 확인 sends the same abandon again", async () => {
    const r = await mount();
    const { call, popup, requestId } = await refusedAfterUnknown(r, { data: null, code: null, lost: true });
    expect(mocks.shared.pendingCreate).toMatchObject({ requestId, abandoning: { title: "폴더를 만들지 못했어요" } });
    await act(async () => button(popup(), "닫기").props.onClick());
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    expect(text(r.root)).toContain("이전 만들기 요청을 정리하고 있어요");
    expect(text(r.root)).toContain("다시 확인을 누르면 같은 정리 요청을 한 번 더 보내요. 여러 번 보내도 결과는 같아요.");
    expect(button(r, "＋ 공유 폴더 만들기").props.disabled).toBe(true);
    call.mockResolvedValueOnce({ data: null, code: null, lost: true });
    await act(async () => { button(r, "다시 확인").props.onClick(); await Promise.resolve(); });
    expect(text(r.root)).toContain("정리됐는지 확인하지 못했어요.");
    call.mockResolvedValueOnce({ data: { status: "abandoned" }, code: null, lost: false });
    await act(async () => { button(r, "다시 확인").props.onClick(); await Promise.resolve(); });
    expect(text(r.root)).not.toContain("이전 만들기 요청을 정리하고 있어요");
    expect(text(r.root)).toContain("폴더를 만들지 못했어요. 공유 폴더 20개가 모두 찼어요.");
    expect(button(r, "＋ 공유 폴더 만들기").props.disabled).toBe(false);
    expect(call.mock.calls.every((args) => args[0] === "abandon_place_folder_request" && (args[1] as { request_id?: string }).request_id === requestId)).toBe(true);
    expect(call).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenCalledTimes(2);
    await act(async () => r.unmount());
  });

  it("delta 6-2: a receipt, a failed read, then a read without the folder settles it without resending", async () => {
    const r = await mount();
    await startCreate(r);
    write.mockImplementationOnce(async (spec: { args: { request_id: string }; receipt: (data: unknown) => (s: SharedSnapshot) => boolean }) => {
      const shows = spec.receipt({ folder: { id: "00000000-0000-4000-8000-0000000000f9", owner_id: ME, name: "새 폴더", revision: 1, create_request_id: spec.args.request_id, created_at: "2026-10-09T00:00:00Z", updated_at: "2026-10-09T00:00:00Z" } });
      return { ok: false, reason: "mismatch", checked: false, title: "변경이 목록에 아직 보이지 않아요", message: "", recheck: shows };
    });
    const popup = () => dialogWith(r, "이 공유 폴더를 만들까요?");
    await act(async () => button(popup(), "폴더 만들기").props.onClick());
    expect(mocks.shared.pendingCreate).not.toBeNull();
    (mocks.shared as { recheck: ReturnType<typeof vi.fn> }).recheck = vi.fn(async (applied: (s: SharedSnapshot) => boolean) => (applied(snapshot) ? "applied" : "missing"));
    await rerenderManager(r);
    await act(async () => { button(popup(), "목록 다시 확인").props.onClick(); await Promise.resolve(); });
    expect(text(popup())).toContain("이 요청으로 만든 폴더는 이미 삭제됐어요");
    expect(buttons(popup(), "목록 다시 확인")).toHaveLength(0);
    expect(mocks.shared.pendingCreate).toBeNull();
    await act(async () => button(popup(), "닫기").props.onClick());
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => r.unmount());
  });

  it("parity 1: a re-read that finds the folder made by the kept request id opens it", async () => {
    const r = await mount();
    await startCreate(r);
    write.mockImplementationOnce(async () => ({ ok: false, reason: "unknown", checked: false, title: "목록을 확인하지 못했어요", message: "", recheck: () => false }));
    await act(async () => button(dialogWith(r, "이 공유 폴더를 만들까요?"), "폴더 만들기").props.onClick());
    await act(async () => button(dialogWith(r, "이 공유 폴더를 만들까요?"), "취소").props.onClick());
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    const requestId = write.mock.calls[0][0].args.request_id as string;
    const id = "00000000-0000-4000-8000-0000000000f9";
    (mocks.shared as { refresh: ReturnType<typeof vi.fn> }).refresh = vi.fn(async () => {
      reload({
        ...snapshot,
        folders: [...snapshot.folders, { ...snapshot.folders[0], id, name: "새 폴더", createRequestId: requestId }],
        members: [...snapshot.members, { ...snapshot.members[0], folderId: id, memberId: ME, role: "owner", displayName: "바람개비" }],
        preferences: [...snapshot.preferences, { ...snapshot.preferences[0], folderId: id, enabled: true }],
      });
      return snapshot;
    });
    await act(async () => r.update(<SavedPlacesManager onBack={vi.fn()} onAddWaypoint={vi.fn(() => null)} routePoints={[]} />));
    await act(async () => { button(r, "다시 확인").props.onClick(); await Promise.resolve(); });
    expect(text(r.root)).toContain("공유 폴더를 만들었어요.");
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => r.unmount());
  });

  it("delta 3-3: a replayed receipt for a folder deleted since ends with its own notice and resends nothing", async () => {
    const r = await mount();
    await startCreate(r);
    write.mockImplementationOnce(async (spec: { args: { request_id: string }; receipt: (data: unknown) => unknown }) => {
      spec.receipt({ folder: { id: "00000000-0000-4000-8000-0000000000f9", owner_id: ME, name: "새 폴더", revision: 1, create_request_id: spec.args.request_id, created_at: "2026-10-09T00:00:00Z", updated_at: "2026-10-09T00:00:00Z" } });
      return { ok: false, reason: "mismatch", checked: true, title: "목록에서 변경을 확인하지 못했어요", message: "", recheck: () => false };
    });
    const popup = () => dialogWith(r, "이 공유 폴더를 만들까요?");
    await act(async () => button(popup(), "폴더 만들기").props.onClick());
    expect(text(popup())).toContain("이 요청으로 만든 폴더는 이미 삭제됐어요");
    expect(buttons(popup(), "목록 다시 확인")).toHaveLength(0);
    expect(buttons(popup(), "다시 시도")).toHaveLength(0);
    await act(async () => button(popup(), "닫기").props.onClick());
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => r.unmount());
  });

  it("delta 3-4: changing the input after closing the confirmation sends a new request id", async () => {
    const r = await mount();
    await startCreate(r);
    write.mockResolvedValueOnce({ ok: false, reason: "rejected", title: "폴더를 만들지 못했어요", message: "" });
    await act(async () => button(dialogWith(r, "이 공유 폴더를 만들까요?"), "폴더 만들기").props.onClick());
    await act(async () => button(dialogWith(r, "이 공유 폴더를 만들까요?"), "취소").props.onClick());
    await act(async () => r.root.findByProps({ placeholder: "예: 주말 라이더" }).props.onChange({ target: { value: "새 폴더 2" } }));
    await act(async () => button(r, "빈 폴더로 만들기").props.onClick());
    await act(async () => button(dialogWith(r, "이 공유 폴더를 만들까요?"), "폴더 만들기").props.onClick());
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0].args.folder_name).toBe("새 폴더 2");
    expect(write.mock.calls[1][0].args.request_id).not.toBe(write.mock.calls[0][0].args.request_id);
    await act(async () => r.unmount());
  });

  it("V3-2: a display name confirm whose row changed underneath sends nothing and shows the newest name", async () => {
    const r = await mount();
    await openMenuRow(r, "이 폴더에서 쓰는 내 이름");
    await act(async () => inputOf(r).props.onChange({ target: { value: "바람개비C" } }));
    await act(async () => button(r, "이름 저장").props.onClick());
    // Another device renamed me without a reload of this screen's generation.
    snapshot = { ...snapshot, members: snapshot.members.map((row) => (row.folderId === F1 && row.memberId === ME ? { ...row, displayName: "바람개비B", revision: 2 } : row)) };
    const popup = () => dialogWith(r, "폴더용 이름을 바꿀까요?");
    await act(async () => button(popup(), "확인하고 바꾸기").props.onClick());
    expect(write).not.toHaveBeenCalled();
    expect(text(popup())).toContain("지금 폴더용 이름은 \"바람개비B\"이에요.");
    expect(buttons(popup(), "다시 시도")).toHaveLength(0);
    // G36c
    expect(popup().findAll((n) => n.type === "del").map(text)).toEqual(["바람개비B"]);
    await act(async () => button(popup(), "최신 이름 확인").props.onClick());
    expect(inputOf(r).props.value).toBe("바람개비B");
    await act(async () => r.unmount());
  });

  async function startCreate(r: ReactTestRenderer) {
    await act(async () => button(r, "공유 폴더").props.onClick());
    await act(async () => button(r, "＋ 공유 폴더 만들기").props.onClick());
    await act(async () => r.root.findByProps({ placeholder: "예: 주말 라이더" }).props.onChange({ target: { value: "새 폴더" } }));
    await act(async () => r.root.findByProps({ placeholder: "예: 주말라이더" }).props.onChange({ target: { value: "바람개비" } }));
    await act(async () => button(r, "빈 폴더로 만들기").props.onClick());
  }
  type CreateSpec = { args: { request_id: string }; applied: (s: SharedSnapshot) => boolean };
  const lost = (spec: CreateSpec) => (spec.applied(snapshot) ? { ok: true } : { ok: false, reason: "unknown", checked: true, title: "변경을 확인하지 못했어요", message: "" });

  it("V3-3 / idempotent create: a lost reply is confirmed by the folder carrying this request id", async () => {
    const r = await mount();
    await startCreate(r);
    write.mockImplementationOnce(async (spec: CreateSpec) => {
      const id = "00000000-0000-4000-8000-0000000000f9";
      reload({
        ...snapshot,
        folders: [...snapshot.folders, { ...snapshot.folders[0], id, name: "새 폴더", createRequestId: spec.args.request_id }],
        members: [...snapshot.members, { ...snapshot.members[0], folderId: id, memberId: ME, role: "owner", displayName: "바람개비" }],
        preferences: [...snapshot.preferences, { ...snapshot.preferences[0], folderId: id, enabled: true }],
      });
      return lost(spec);
    });
    await act(async () => button(dialogWith(r, "이 공유 폴더를 만들까요?"), "폴더 만들기").props.onClick());
    expect(write.mock.calls[0][0]).toMatchObject({ rpc: "create_place_folder", args: { folder_name: "새 폴더", display_name: "바람개비", saved_place_ids: [] } });
    expect(write.mock.calls[0][0].args.request_id).toMatch(/^[0-9a-f-]{36}$/);
    // The created folder opens (G10 entry notice), not the list.
    expect(text(r.root)).toContain("공유 폴더를 만들었어요.");
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => r.unmount());
  });

  it("V3-3 / idempotent create: a same-name folder from another request is not taken, and a retry resends the same request id", async () => {
    const r = await mount();
    await startCreate(r);
    write.mockImplementationOnce(async (spec: CreateSpec) => {
      reload({ ...snapshot, folders: [...snapshot.folders, { ...snapshot.folders[0], id: "00000000-0000-4000-8000-0000000000f9", name: "새 폴더", createRequestId: "00000000-0000-4000-8000-00000000ffff" }] });
      return lost(spec);
    });
    const popup = () => dialogWith(r, "이 공유 폴더를 만들까요?");
    await act(async () => button(popup(), "폴더 만들기").props.onClick());
    expect(r.root.findAllByProps({ "aria-label": "폴더 메뉴" })).toHaveLength(0);
    expect(text(popup())).toContain("폴더가 만들어지지 않았어요");
    await act(async () => button(popup(), "확인하고 만들기").props.onClick());
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0].args.request_id).toBe(write.mock.calls[0][0].args.request_id);
    await act(async () => r.unmount());
  });

  it("V3-7: after a stale role refusal the reloaded choices open as a new approval that can be confirmed", async () => {
    const r = await mount();
    await openMenuRow(r, "회원·권한 관리");
    await act(async () => r.root.findByProps({ "aria-label": "새벽바이크님 권한 편집 가능, 바꾸기" }).props.onClick());
    const popup = () => dialogWith(r, "새벽바이크님의 권한");
    await act(async () => popup().findAll((n) => n.type === "input" && n.props.type === "radio")[1].props.onChange());
    write.mockImplementationOnce(async () => {
      reload({ ...snapshot, members: snapshot.members.map((row) => (row.folderId === F1 && row.memberId === OTHER ? { ...row, role: "viewer", revision: 2 } : row)) });
      return { ok: false, reason: "rejected", stale: true, title: "회원 정보가 바뀌었어요", message: "최신 회원 목록을 불러왔어요." };
    });
    await act(async () => button(popup(), "보기만으로 바꾸기").props.onClick());
    expect(text(popup())).toContain("다른 기기에서 먼저 \"보기만\"으로 바뀌었어요");
    await act(async () => popup().findAll((n) => n.type === "input" && n.props.type === "radio")[0].props.onChange());
    expect(button(popup(), "편집 가능으로 바꾸기").props.disabled).toBe(false);
    await act(async () => button(popup(), "편집 가능으로 바꾸기").props.onClick());
    expect(write.mock.calls[1][0]).toMatchObject({ rpc: "set_place_folder_member_role", args: { expected_revision: 2, role: "editor" } });
    await act(async () => r.unmount());
  });
});

describe("shared place detail and folder screens", () => {
  async function openDetail(r: ReactTestRenderer, name: string) {
    await act(async () => r.root.findByProps({ "aria-label": `${name} 상세 보기` }).props.onClick());
  }

  it("lets an editor edit and delete but a viewer only star, avoid and add as a waypoint (G14, GP07)", async () => {
    snapshot = { ...snapshot, preferences: snapshot.preferences.map((row) => ({ ...row, enabled: true })) };
    const r = await mount();
    await act(async () => button(r, "식당").props.onClick());
    await openDetail(r, "양수리 닭갈비");
    expect(buttons(r, "별명·분류 수정")).toHaveLength(0);
    expect(buttons(r, "폴더에서 삭제")).toHaveLength(0);
    expect(text(r.root)).toContain("보기만 권한이라 별명·분류 수정과 폴더에서 삭제는 할 수 없어요.");
    expect(buttons(r, "경유지에 추가")).toHaveLength(1);
    await act(async () => r.unmount());
    const editor = await mount();
    await openDetail(editor, "문호리 강변 쉼터");
    expect(buttons(editor, "별명·분류 수정")).toHaveLength(1);
    expect(buttons(editor, "폴더에서 삭제")).toHaveLength(1);
    // A former member is shown as "나간 회원", never by a Kakao nickname.
    expect(text(editor.root)).toContain("마지막 수정 · 나간 회원");
    await act(async () => editor.unmount());
  });

  it("locks the delete popup while it runs and offers one new confirm after a missing change (G16a–c)", async () => {
    let release!: (value: SharedWrite) => void;
    write.mockImplementationOnce(() => new Promise<SharedWrite>((resolve) => { release = resolve; }));
    const r = await mount();
    await openDetail(r, "문호리 강변 쉼터");
    await act(async () => button(r, "폴더에서 삭제").props.onClick());
    const popup = () => dialogWith(r, "폴더에서 이 장소를 삭제할까요?");
    expect(text(popup())).toContain("회원 3명 모두의 폴더에서 사라지고");
    let running!: Promise<void>;
    await act(async () => { running = button(popup(), "폴더에서 삭제").props.onClick(); });
    expect(popup().findByProps({ "aria-label": "닫기" }).props.disabled).toBe(true);
    expect(button(popup(), "취소").props.disabled).toBe(true);
    await act(async () => { release({ ok: false, reason: "unknown", checked: true, title: "", message: "" }); await running; });
    expect(text(popup())).toContain("삭제되지 않았어요");
    expect(button(popup(), "확인하고 삭제").props.disabled).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => r.unmount());
  });

  it("shows the folder list with roles, counts and the last change (G01)", async () => {
    const r = await mount();
    await act(async () => button(r, "공유 폴더").props.onClick());
    const body = text(r.root);
    expect(body).toContain("내 공유 폴더3 / 20");
    const folders = r.root.findAll((n) => n.type === "li" && typeof n.props.className === "string" && n.props.className.includes("folderCard")).map(text);
    expect(folders[0]).toContain("주말 라이더주인");
    expect(folders[1]).toContain("남한강 맛집회원");
    expect(folders[0]).toContain("장소 4");
    expect(folders[0]).toContain("회원 3");
    await act(async () => r.unmount());
  });

  it("opens a folder with the owner's menu and the viewer's disabled add button (G10, G11, GP06)", async () => {
    const r = await mount();
    await act(async () => button(r, "공유 폴더").props.onClick());
    await act(async () => r.root.findByProps({ "aria-label": "동호회 정모 코스 폴더 열기, 회원" }).props.onClick());
    expect(text(r.root)).toContain("보기만 권한이라 추가할 수 없어요.");
    expect(r.root.findAllByProps({ "aria-label": "＋ 이 폴더에 장소 추가" }).every((node) => node.props.disabled)).toBe(true);
    await act(async () => r.root.findByProps({ "aria-label": "공유 폴더 목록으로" }).props.onClick());
    await act(async () => r.root.findByProps({ "aria-label": "주말 라이더 폴더 열기, 주인" }).props.onClick());
    expect(text(r.root)).toContain("곳 · 폴더 장소4 / 1,000");
    await act(async () => r.root.findByProps({ "aria-label": "폴더 메뉴" }).props.onClick());
    const menu = text(dialogWith(r, "초대 링크"));
    expect(menu).toContain("회원·권한 관리");
    expect(menu).toContain("폴더 이름 바꾸기");
    expect(menu).toContain("폴더 삭제");
    expect(menu).not.toContain("폴더 나가기");
    await act(async () => r.unmount());
  });

  it("asks before changing a member's role and keeps confirm off until a different role is chosen (GP01)", async () => {
    const r = await mount();
    await act(async () => button(r, "공유 폴더").props.onClick());
    await act(async () => r.root.findByProps({ "aria-label": "주말 라이더 폴더 열기, 주인" }).props.onClick());
    await act(async () => r.root.findByProps({ "aria-label": "폴더 메뉴" }).props.onClick());
    await act(async () => button(dialogWith(r, "초대 링크"), "회원·권한 관리5 / 30명".replace("5", "3")).props.onClick());
    await act(async () => r.root.findByProps({ "aria-label": "새벽바이크님 권한 편집 가능, 바꾸기" }).props.onClick());
    const popup = () => dialogWith(r, "새벽바이크님의 권한");
    expect(button(popup(), "바꿀 권한을 고르세요").props.disabled).toBe(true);
    const viewer = popup().findAll((n) => n.type === "input" && n.props.type === "radio")[1];
    await act(async () => viewer.props.onChange());
    await act(async () => button(popup(), "보기만으로 바꾸기").props.onClick());
    expect(write.mock.calls[0][0]).toMatchObject({ rpc: "set_place_folder_member_role", args: { folder_id: F1, member_id: OTHER, expected_revision: 1, role: "viewer" } });
    await act(async () => r.unmount());
  });

  it("lists avoided places with their origin and removes one only after AV09", async () => {
    const r = await mount();
    await act(async () => button(r, "기피 장소").props.onClick());
    const body = text(r.root);
    expect(body).toContain("기피 장소2 / 200");
    expect(body).toContain("공유 폴더 \"주말 라이더\"에서 표시");
    expect(body).toContain("지도에서 등록");
    await act(async () => r.root.findByProps({ "aria-label": "서종 공사 구간 기피 해제" }).props.onClick());
    expect(write).not.toHaveBeenCalled();
    await act(async () => button(dialogWith(r, "기피를 해제할까요?"), "기피 해제").props.onClick());
    expect(write.mock.calls[0][0]).toMatchObject({ rpc: "remove_avoided_place", args: { avoided_place_id: "00000000-0000-4000-8000-0000000000b2" } });
    await act(async () => r.unmount());
  });
});

void F2; void F3;
