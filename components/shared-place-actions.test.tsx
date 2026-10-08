import { describe, expect, it, vi } from "vitest";
import { parseAvoidedPlace, parseFolderMember, parseFolderPreference, parsePlaceFolder, parseSharedPlace, parseStarEntries } from "@/lib/places/shared-folders";
import { ME, sampleTables, sharedRow, F1 } from "@/tests/fixtures/shared-folders";
import type { SharedSnapshot, SharedWrite } from "./shared-folders-provider";
import { avoidPopup, deleteSharedPopup, editSharedPopup } from "./shared-place-actions";

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
});
