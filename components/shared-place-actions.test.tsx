import { describe, expect, it, vi } from "vitest";
import { parseAvoidedPlace, parseFolderMember, parseFolderPreference, parsePlaceFolder, parseSharedPlace, parseStarEntries } from "@/lib/places/shared-folders";
import { ME, sampleTables, sharedRow, F1 } from "@/tests/fixtures/shared-folders";
import type { SharedSnapshot, SharedWrite } from "./shared-folders-provider";
import { avoidPopup, cardLine, deleteSharedPopup, editSharedPopup, placeAddress } from "./shared-place-actions";

vi.mock("@/lib/supabase/browser", () => ({ getBrowserSupabase: () => null }));

function controls(snapshot: SharedSnapshot, write = vi.fn<(spec: { rpc: string; args: Record<string, unknown> }) => Promise<SharedWrite>>(async () => ({ ok: true }))) {
  return { write, current: () => ({ status: "ready" as const, snapshot }) } as never as Parameters<typeof editSharedPopup>[0] & { write: typeof write };
}
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
const target = () => parseSharedPlace(sharedRow(4, F1, "k-f1", "문호리 강변 쉼터"));

describe("shared place confirmations", () => {
  it("shows another member's newer edit as the new 'before' and sends nothing (G15)", async () => {
    const snapshot = snapshotFrom();
    const newer = { ...snapshot.places.find((row) => row.id === target().id)!, revision: 2, alias: "문호리 쉼터", updatedByDisplayName: "새벽바이크", updatedByLeft: false };
    snapshot.places = snapshot.places.map((row) => (row.id === newer.id ? newer : row));
    const shared = controls(snapshot);
    const reopen = vi.fn();
    const pending = editSharedPopup(shared, target(), { alias: "강변 쉼터" }, { onSaved: vi.fn(), onBackToFolder: vi.fn(), reopen });
    await pending.confirm!.run();
    expect(shared.write).not.toHaveBeenCalled();
    const conflict = reopen.mock.calls[0][0];
    expect(conflict.error.title).toBe("다른 회원이 먼저 수정했어요");
    expect(conflict.changes).toEqual([{ label: "별명", before: "문호리 쉼터", after: "강변 쉼터" }]);
    expect(conflict.confirm).toMatchObject({ label: "이 내용으로 다시 저장", cancelLabel: "지금 저장된 내용 유지" });
  });

  it("ends an edit refused after a downgrade to viewer without a retry (GP08)", async () => {
    const shared = controls(snapshotFrom(), vi.fn<(spec: { rpc: string; args: Record<string, unknown> }) => Promise<SharedWrite>>(async () => ({ ok: false, reason: "rejected", title: "장소를 고치지 못했어요", message: "방금 주인이 내 권한을 \"보기만\"으로 바꿨어요." })));
    const done = { onSaved: vi.fn(), onBackToFolder: vi.fn(), reopen: vi.fn() };
    const pending = editSharedPopup(shared, target(), { kind: "restaurant" }, done);
    const write = await pending.confirm!.run();
    expect(shared.write.mock.calls[0][0]).toMatchObject({ rpc: "update_shared_place", args: { expected_revision: 1, place_kind: "restaurant", place_alias: null } });
    const buttons = pending.confirm!.finalOnRefusal!(write as never)!;
    expect(buttons.map((button) => button.label)).toEqual(["폴더로 돌아가기", "닫기"]);
    buttons[0].onClick();
    expect(done.onBackToFolder).toHaveBeenCalled();
  });

  it("treats a place already gone from the folder as deleted without a request", async () => {
    const snapshot = snapshotFrom();
    const row = target();
    snapshot.places = snapshot.places.filter((place) => place.id !== row.id);
    const shared = controls(snapshot);
    const onDone = vi.fn();
    expect(await deleteSharedPopup(shared, row, onDone).confirm!.run()).toEqual({ ok: true });
    expect(shared.write).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it("keeps the avoid confirmation disabled at 200 and sends the shared source for a folder place", async () => {
    const snapshot = snapshotFrom();
    const full = { ...snapshot, avoided: Array.from({ length: 200 }, (_, index) => ({ ...snapshot.avoided[0], id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, place: { ...snapshot.avoided[0].place, kakaoPlaceId: `a${index}` } })) };
    expect(avoidPopup(controls(full), target().place, { sharedPlaceId: target().id }).confirm!.disabled).toBe(true);
    const shared = controls(snapshot);
    const pending = avoidPopup(shared, target().place, { kind: "riding_spot", sharedPlaceId: target().id });
    expect(pending.count).toEqual({ label: "기피 장소", value: "2 → 3 / 200" });
    await pending.confirm!.run();
    expect(shared.write.mock.calls[0][0]).toMatchObject({ rpc: "add_avoided_place", args: { source_shared_place_id: target().id, place: { kakaoPlaceId: "k-f1" } } });
  });

  it("names only where a newly registered avoided place came from, never a kind (AV03)", () => {
    const shared = controls(snapshotFrom());
    const searched = { ...target().place, category: "음식점 > 한식" };
    expect(avoidPopup(shared, searched, { registration: true }).card!.eyebrow).toBe("검색 결과");
    const point = { ...target().place, kakaoPlaceId: "map:37.5000000:127.1000000", category: "지도에서 선택" };
    expect(avoidPopup(shared, point, { registration: true }).card!.eyebrow).toBe("지도 지점");
    const region = { ...point, kakaoPlaceId: "map:37.5000000:127.1000000:region", category: "지도에서 선택 · 상세 주소 없음" };
    const regionCard = avoidPopup(shared, region, { registration: true }).card!;
    expect(regionCard.eyebrow).toBe("지도 지점");
    expect(regionCard.region).toBe(true);
  });
});

describe("map point address lines (Issue #137 A03)", () => {
  const mapPoint = { kakaoPlaceId: "map:37.5000000:127.0000000", verificationToken: "a".repeat(43), name: "경기 남양주시 와부읍 덕소로 150", address: "경기 남양주시 와부읍 덕소리 123-4", roadAddress: "경기 남양주시 와부읍 덕소로 150", category: "", phone: null, placeUrl: null, latitude: 37.5, longitude: 127 };
  const noParcel = { ...mapPoint, roadAddress: null, name: "경기 남양주시 와부읍 덕소리 123-4" };

  it("never repeats the place name as its address line", () => {
    expect(placeAddress(mapPoint)).toBe("경기 남양주시 와부읍 덕소리 123-4");
    expect(placeAddress(noParcel)).toBeUndefined();
    expect(placeAddress(mapPoint, "집")).toBe("경기 남양주시 와부읍 덕소로 150");
    expect(cardLine({ alias: null, place: mapPoint })).toBe("경기 남양주시 와부읍 덕소리 123-4");
    expect(cardLine({ alias: "집", place: mapPoint })).toBe("경기 남양주시 와부읍 덕소로 150 · 경기 남양주시 와부읍 덕소리 123-4");
    expect(cardLine({ alias: "집", place: noParcel })).toBe("경기 남양주시 와부읍 덕소리 123-4");
    expect(cardLine({ alias: null, place: noParcel })).toBeUndefined();
  });
});
