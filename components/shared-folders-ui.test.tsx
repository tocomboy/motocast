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
    captureSnapshot: () => () => true, recheck: vi.fn(async () => "unreadable"), write, call: vi.fn(),
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
