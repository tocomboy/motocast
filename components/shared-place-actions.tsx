"use client";

import { useRef, useState } from "react";
import styles from "./saved-places-manager.module.css";
import { ConfirmPopup, type Pending, type PopupButton } from "./confirm-popup";
import { sharedPlacePayload, useSharedFolders, type Refusal, type SharedSnapshot, type SharedWrite } from "./shared-folders-provider";
import { FREQUENT_PLACE_LIMIT, isRegionOnlyPlace, type SavedPlaceKind } from "@/lib/places/saved";
import type { PlaceSearchResult } from "@/lib/places/search";
import { matchesAvoided } from "@/lib/places/place-merge";
import {
  AVOIDED_PLACE_LIMIT,
  PLACE_FOLDER_PLACE_LIMIT,
  parseAvoidedPlace,
  parseSharedPlace,
  type AvoidedPlace,
  type SharedPlace,
} from "@/lib/places/shared-folders";
import { dateTimeLabel } from "@/lib/places/shared-folder-format";

export type SharedPending = Omit<Pending<SharedSnapshot>, "key">;
export const kindLabel = (kind: SavedPlaceKind) => (kind === "restaurant" ? "식당" : "라이딩 스팟");
export const placeAddress = (place: PlaceSearchResult) =>
  isRegionOnlyPlace(place) ? `${place.name} · 상세 주소 없음` : place.roadAddress ?? place.address;
export const sharedName = (row: { alias: string | null; place: PlaceSearchResult }) => row.alias ?? row.place.name;
/** Address line of a list card; an alias shows the original name first (FP01). */
export const cardLine = (row: { alias: string | null; place: PlaceSearchResult }) =>
  isRegionOnlyPlace(row.place) ? `${row.place.name} · 상세 주소 없음` : row.alias ? `${row.place.name} · ${row.place.roadAddress ?? row.place.address}` : row.place.roadAddress ?? row.place.address;
export const folderNameOf = (snapshot: SharedSnapshot, folderId: string) => snapshot.folders.find((row) => row.id === folderId)?.name ?? "공유 폴더";
const avoidedInputs = (avoided: readonly AvoidedPlace[]) =>
  avoided.map((row) => ({ id: row.id, kakaoPlaceId: row.place.kakaoPlaceId, latitude: row.place.latitude, longitude: row.place.longitude }));
/** The avoided row that covers this place (contract §7.2), if any. */
export function avoidedFor(avoided: readonly AvoidedPlace[], place: PlaceSearchResult) {
  const match = matchesAvoided(place, avoidedInputs(avoided));
  return match ? avoided.find((row) => row.id === match.id) : undefined;
}

const single = (data: unknown) => {
  if (!Array.isArray(data) || data.length !== 1) throw new Error("NO_RECEIPT");
  return data[0];
};
const sharedCard = (row: SharedPlace, folder: string) => ({
  eyebrow: `${kindLabel(row.kind)} · ${row.province ?? "지역 미확인"}`,
  name: sharedName(row),
  line: placeAddress(row.place),
  source: { icon: "folder" as const, text: `공유 · ${folder}` },
});

/** One shared popup at a time, bound to the shared-folders provider's busy and verify state. */
export function useSharedPopup() {
  const shared = useSharedFolders();
  const [pending, setPending] = useState<Pending<SharedSnapshot> | null>(null);
  const key = useRef(0);
  const open = (next: SharedPending) => setPending({ ...next, key: ++key.current });
  const close = () => setPending(null);
  const popup = pending ? (
    <ConfirmPopup
      key={pending.key}
      pending={pending}
      busy={shared.busy}
      verifying={shared.verifying}
      recheck={shared.recheck}
      capture={shared.captureSnapshot}
      onClose={close}
    />
  ) : null;
  return { open, close, popup };
}

type Actions = ReturnType<typeof useSharedFolders>;
const unreadable: SharedWrite = { ok: false, reason: "blocked", title: "목록을 확인하지 못했어요", message: "목록을 다시 불러온 뒤에 시도할 수 있어요." };
const latestPlace = (shared: Actions, id: string) => shared.current().snapshot.places.find((row) => row.id === id);
const starCount = (shared: Actions) => shared.current().snapshot.stars.length;

/** G14a / G14d and FP36 for a shared place: my own star, any member including viewers. */
export function sharedStarPopup(shared: Actions, row: SharedPlace, onManageStars?: () => void): SharedPending {
  const snapshot = shared.current().snapshot;
  const folder = folderNameOf(snapshot, row.folderId);
  const starred = !row.starred;
  const count = snapshot.stars.length;
  if (starred && count >= FREQUENT_PLACE_LIMIT)
    return {
      title: `자주 찾는 장소 ${FREQUENT_PLACE_LIMIT}곳이 모두 찼어요`,
      card: sharedCard(row, folder),
      note: "다른 장소의 별표를 빼면 이 장소를 추가할 수 있어요. 아무것도 바뀌지 않았어요.",
      // The popup closes itself before a button's action (ConfirmPopup).
      buttons: [{ label: "닫기", primary: true, onClick: () => undefined }, ...(onManageStars ? [{ label: "자주 찾는 장소 관리", onClick: onManageStars }] : [])],
    };
  return {
    title: starred ? "자주 찾는 장소에 추가할까요?" : "자주 찾는 장소에서 뺄까요?",
    card: sharedCard(row, folder),
    count: { label: "자주 찾는 장소", value: `${count} → ${count + (starred ? 1 : -1)} / ${FREQUENT_PLACE_LIMIT}` },
    note: starred ? undefined : "별표만 빼요. 공유 폴더에는 그대로 남아 있어요.",
    confirm: {
      label: starred ? "추가" : "별표 빼기",
      busyLabel: starred ? "추가하는 중…" : "빼는 중…",
      checking: starred ? "추가됐는지 확인하고 있어요" : "별표를 뺐는지 확인하고 있어요",
      notApplied: starred
        ? { title: "추가되지 않았어요", message: "목록을 다시 확인했지만 별표가 없어요. 다시 추가하려면 \"추가\"를 눌러 주세요." }
        : { title: "별표가 그대로예요", message: "목록을 다시 확인했지만 별표가 남아 있어요. 다시 빼려면 \"별표 빼기\"를 눌러 주세요." },
      run: async () => {
        if (shared.current().status !== "ready") return unreadable;
        const current = latestPlace(shared, row.id);
        if (!current) return { ok: false, reason: "rejected", title: "장소를 찾지 못했어요", message: "폴더에서 삭제됐거나 더 볼 수 없어요. 최신 목록을 확인해 주세요." };
        if (current.starred === starred) return { ok: true };
        const applied = (s: SharedSnapshot) => s.places.some((p) => p.id === row.id && p.starred === starred) || (!starred && !s.places.some((p) => p.id === row.id));
        return shared.write({
          rpc: "set_shared_place_star",
          args: { shared_place_id: row.id, starred },
          success: starred ? "자주 찾는 장소에 추가했어요." : "자주 찾는 장소에서 뺐어요. 공유 폴더에는 그대로 남아 있어요.",
          receipt: (data) => { const receipt = parseSharedPlace(single(data)); if (receipt.starred !== starred) throw new Error("NO_RECEIPT"); return (s) => s.stars.some((star) => star.source === "shared" && star.id === row.id) === starred && applied(s); },
          applied,
          unknownMessage: starred
            ? "추가됐는지 확인했는데 반영되지 않았어요. 다시 시도하면 최신 목록으로 한 번 요청해요."
            : "별표를 뺐는지 확인했는데 반영되지 않았어요. 다시 시도하면 최신 목록으로 한 번 요청해요.",
          refusal: (code) => code === "SHARED_PLACE_NOT_FOUND"
            ? { reason: "rejected", stale: true, title: "장소를 찾지 못했어요", message: "폴더에서 삭제됐거나 더 볼 수 없어요. 최신 목록을 불러왔어요." }
            : null,
        });
      },
    },
  };
}

/** G14c / AV03: mark a place avoided, for me only. */
export function avoidPopup(
  shared: Actions,
  place: PlaceSearchResult,
  context: { kind?: SavedPlaceKind; province?: string | null; name?: string; source?: { icon: "pin" | "folder"; text: string }; sharedPlaceId?: string; registration?: boolean },
  onApplied?: () => void,
): SharedPending {
  const count = shared.current().snapshot.avoided.length;
  const full = count >= AVOIDED_PLACE_LIMIT;
  return {
    title: context.registration ? "기피 장소로 등록할까요?" : "기피 장소로 표시할까요?",
    card: {
      // AV03: an avoided place has no kind, so the top line names only where it came from.
      eyebrow: context.registration ? (isRegionOnlyPlace(place) || place.kakaoPlaceId.startsWith("map:") ? "지도 지점" : "검색 결과") : `${kindLabel(context.kind ?? "riding_spot")} · ${context.province ?? "지역 미확인"}`,
      region: isRegionOnlyPlace(place),
      name: context.name ?? place.name,
      line: placeAddress(place),
      source: context.source,
    },
    count: { label: "기피 장소", value: full ? `${count} / ${AVOIDED_PLACE_LIMIT} 가득 참` : `${count} → ${count + 1} / ${AVOIDED_PLACE_LIMIT}` },
    note: full
      ? "기피 장소 200곳이 모두 찼어요. 더 등록하려면 쓰지 않는 기피 장소를 해제해 주세요."
      : context.registration
        ? "같은 장소로 판단되는 식당은 추천에서 빠져요. 내 장소·공유 폴더에 있어도 지우지 않고 \"기피\" 표시만 해요. 기피 장소는 나에게만 보여요."
        : context.sharedPlaceId
          ? "나에게만 적용돼요. 식당 추천에서 이 장소가 빠지고 지도에 기피 표시가 보여요. 공유 폴더에서는 지워지지 않고 다른 회원에게는 보이지 않아요."
          : "나에게만 적용돼요. 식당 추천에서 이 장소가 빠지고 지도에 기피 표시가 보여요. 내 장소에서는 지워지지 않아요.",
    confirm: {
      label: context.registration ? "기피 장소로 등록" : "기피로 표시",
      busyLabel: "등록하는 중…",
      disabled: full,
      checking: "기피로 등록됐는지 확인하고 있어요",
      notApplied: { title: "등록되지 않았어요", message: "기피 목록을 다시 확인했지만 이 장소가 없어요. 다시 등록하려면 확인 버튼을 눌러 주세요." },
      run: async () => {
        if (shared.current().status !== "ready") return unreadable;
        if (shared.current().snapshot.avoided.some((row) => row.place.kakaoPlaceId === place.kakaoPlaceId)) return { ok: true };
        const applied = (s: SharedSnapshot) => s.avoided.some((row) => row.place.kakaoPlaceId === place.kakaoPlaceId);
        const write = await shared.write({
          rpc: "add_avoided_place",
          args: { place: sharedPlacePayload(place), source_shared_place_id: context.sharedPlaceId ?? null },
          success: "기피 장소로 등록했어요.",
          receipt: (data) => { const row = parseAvoidedPlace(single(data)); return (s) => s.avoided.some((a) => a.id === row.id); },
          applied,
          unknownMessage: "등록됐는지 확인했는데 반영되지 않았어요. 다시 시도하면 한 번만 요청해요.",
          refusal: (code) => code === "AVOIDED_PLACE_LIMIT"
            ? { reason: "rejected", title: "기피 장소를 등록하지 못했어요", message: "기피 장소 200곳이 모두 찼어요. 쓰지 않는 기피 장소를 해제해 주세요." }
            : code === "SHARED_PLACE_NOT_FOUND"
              ? { reason: "rejected", stale: true, title: "장소를 찾지 못했어요", message: "폴더에서 삭제됐거나 더 볼 수 없어요. 최신 목록을 불러왔어요." }
              : null,
        });
        if (write.ok) onApplied?.();
        return write;
      },
      onApplied,
    },
  };
}

/** AV08 (detail) / AV09 (list): remove an avoided place. */
export function unavoidPopup(shared: Actions, row: AvoidedPlace, context: { eyebrow: string; note: string; source?: { icon: "pin" | "folder"; text: string }; name?: string }): SharedPending {
  const count = shared.current().snapshot.avoided.length;
  return {
    title: "기피를 해제할까요?",
    card: { eyebrow: context.eyebrow, region: isRegionOnlyPlace(row.place), name: context.name ?? row.place.name, line: placeAddress(row.place), source: context.source },
    count: { label: "기피 장소", value: `${count} → ${Math.max(0, count - 1)} / ${AVOIDED_PLACE_LIMIT}` },
    note: context.note,
    confirm: {
      label: "기피 해제",
      busyLabel: "해제하는 중…",
      checking: "해제됐는지 확인하고 있어요",
      notApplied: { title: "해제되지 않았어요", message: "기피 목록을 다시 확인했지만 그대로 있어요. 다시 해제하려면 \"기피 해제\"를 눌러 주세요." },
      run: async () => {
        if (shared.current().status !== "ready") return unreadable;
        if (!shared.current().snapshot.avoided.some((a) => a.id === row.id)) return { ok: true };
        const applied = (s: SharedSnapshot) => !s.avoided.some((a) => a.id === row.id);
        return shared.write({
          rpc: "remove_avoided_place",
          args: { avoided_place_id: row.id },
          success: "기피를 해제했어요.",
          receipt: () => applied,
          applied,
          unknownMessage: "해제됐는지 확인했는데 반영되지 않았어요. 다시 시도하면 한 번만 요청해요.",
          refusal: (code) => code === "AVOIDED_PLACE_NOT_FOUND" ? { reason: "rejected", stale: true, title: "이미 해제된 기피 장소예요", message: "최신 기피 목록을 불러왔어요." } : null,
        });
      },
    },
  };
}

/** G16 (UI-001, FP39 a–d): delete a place from the folder for every member. */
export function deleteSharedPopup(shared: Actions, row: SharedPlace, onDone: () => void): SharedPending {
  const snapshot = shared.current().snapshot;
  const members = snapshot.members.filter((m) => m.folderId === row.folderId).length;
  return {
    title: "폴더에서 이 장소를 삭제할까요?",
    card: sharedCard(row, folderNameOf(snapshot, row.folderId)),
    note: `회원 ${members}명 모두의 폴더에서 사라지고, 각자 표시한 별표도 함께 빠져요. 이미 만든 일정·코스·공유 결과는 그대로예요. 되돌릴 수 없어요.`,
    confirm: {
      label: "폴더에서 삭제",
      retryLabel: "확인하고 삭제",
      busyLabel: "삭제하는 중…",
      danger: true,
      checking: "삭제됐는지 확인하고 있어요",
      checkingMessage: "응답을 받지 못해 폴더 목록을 다시 읽는 중이에요. 같은 요청을 다시 보내지 않아요.",
      notApplied: { title: "삭제되지 않았어요", message: "폴더를 다시 확인했지만 이 장소가 아직 있어요. 다시 삭제하려면 \"확인하고 삭제\"를 눌러 주세요." },
      run: async () => {
        if (shared.current().status !== "ready") return unreadable;
        const current = latestPlace(shared, row.id);
        // Absent from a folder list that did load: already deleted.
        if (!current) { onDone(); return { ok: true }; }
        const applied = (s: SharedSnapshot) => !s.places.some((p) => p.id === row.id);
        const write = await shared.write({
          rpc: "delete_shared_place",
          args: { shared_place_id: row.id, expected_revision: current.revision },
          success: "폴더에서 장소를 삭제했어요.",
          receipt: () => applied,
          applied,
          unknownMessage: "삭제됐는지 확인했는데 반영되지 않았어요. 다시 시도하면 최신 목록으로 한 번 요청해요.",
          refusal: (code) => sharedPlaceRefusal(code, "삭제"),
        });
        if (write.ok) onDone();
        else if (!write.ok && write.reason === "rejected" && write.stale && !latestPlace(shared, row.id)) { onDone(); return { ok: true }; }
        return write;
      },
      onApplied: onDone,
      finalOnRefusal: (write) => (write.title === FORBIDDEN_TITLE ? [{ label: "닫기", primary: true, onClick: onDone }] : null),
    },
  };
}

const FORBIDDEN_TITLE = "장소를 고치지 못했어요";
function sharedPlaceRefusal(code: string, action: string): Refusal | null {
  if (code === "PLACE_FOLDER_FORBIDDEN")
    return { reason: "rejected", title: FORBIDDEN_TITLE, message: `방금 주인이 내 권한을 "보기만"으로 바꿨어요. 입력한 내용은 저장되지 않았어요. 이제 장소 추가·수정·삭제는 할 수 없어요.` };
  if (code === "SHARED_PLACE_NOT_FOUND" || code === "PLACE_FOLDER_NOT_FOUND")
    return { reason: "rejected", stale: true, title: "장소를 찾지 못했어요", message: `이미 삭제됐거나 폴더를 더 볼 수 없어요. ${action}할 것이 없어요.` };
  if (code === "SHARED_PLACE_STALE")
    return { reason: "rejected", stale: true, title: "다른 회원이 먼저 수정했어요", message: "최신 내용을 불러왔어요. 확인한 뒤 다시 시도해 주세요." };
  if (code === "PLACE_FOLDER_PLACE_LIMIT")
    return { reason: "rejected", title: "폴더에 추가하지 못했어요", message: `이 폴더의 장소 ${PLACE_FOLDER_PLACE_LIMIT.toLocaleString()}곳이 모두 찼어요. 쓰지 않는 장소를 삭제하면 다시 추가할 수 있어요.` };
  if (code === "INVALID_SAVED_PLACE_METADATA")
    return { reason: "rejected", title: "저장하지 못했어요", message: "별명을 입력해 주세요. 상세 주소가 없는 지점은 별명이 있어야 저장할 수 있어요." };
  return null;
}

/** G15 / FP38 / GP08: alias and kind of a shared place; only the changed values are shown. */
export function editSharedPopup(
  shared: Actions,
  base: SharedPlace,
  edits: { alias?: string; kind?: SavedPlaceKind },
  done: { onSaved: () => void; onBackToFolder: () => void; reopen: (next: SharedPending) => void },
  conflict?: SharedPlace,
): SharedPending {
  const alias = edits.alias ?? base.alias ?? "";
  const kind = edits.kind ?? base.kind;
  const place = base.place;
  const changes = [
    ...((base.alias ?? "") !== alias ? [{ label: "별명", before: base.alias ?? `${place.name} (없음)`, after: alias || `${place.name} (없음)` }] : []),
    ...(base.kind !== kind ? [{ label: "분류", before: kindLabel(base.kind), after: kindLabel(kind) }] : []),
  ];
  const card = { line: `원래 이름 · ${place.name}`, line2: isRegionOnlyPlace(place) ? `상세 주소 없음 · ${place.address}` : place.roadAddress ?? place.address };
  if (!changes.length)
    return { title: "이미 같은 값이에요", card, note: "다른 곳에서 같은 내용으로 바뀌었어요. 바뀐 것은 없어요.", buttons: [{ label: "닫기", primary: true, onClick: done.onSaved }] };
  const conflictName = conflict ? (conflict.updatedByLeft || !conflict.updatedByDisplayName ? "나간 회원" : conflict.updatedByDisplayName) : "";
  return {
    title: "별명과 분류를 수정할까요?",
    card,
    changes,
    note: conflict ? "전 값은 다른 회원이 먼저 바꾼 최신 값이에요. 바뀐 값만 보여요." : "바뀐 값만 보여요. 원래 이름·위치와 내 별표는 그대로예요.",
    error: conflict ? { title: "다른 회원이 먼저 수정했어요", message: `${conflictName}님이 ${dateTimeLabel(conflict.updatedAt)}에 바꾼 내용을 불러왔어요. 내 입력은 그대로예요. 이대로 저장할지 골라 주세요.` } : undefined,
    confirm: {
      label: conflict ? "이 내용으로 다시 저장" : "확인하고 수정",
      cancelLabel: conflict ? "지금 저장된 내용 유지" : undefined,
      busyLabel: "수정하는 중…",
      checking: "수정됐는지 확인하고 있어요",
      notApplied: { title: "수정되지 않았어요", message: "폴더를 다시 확인했지만 바뀐 내용이 없어요. 입력 내용은 그대로예요. 다시 수정하려면 \"확인하고 수정\"을 눌러 주세요." },
      run: async () => {
        if (shared.current().status !== "ready") return unreadable;
        const current = latestPlace(shared, base.id);
        if (!current) return { ok: false, reason: "rejected", title: "장소를 찾지 못했어요", message: "폴더에서 삭제됐거나 더 볼 수 없어요." };
        // A newer row changes what "before" means: show the recalculated change first (G15).
        if (current.revision !== base.revision) { done.reopen(editSharedPopup(shared, current, edits, done, current)); return { ok: false, reason: "blocked", title: "", message: "" }; }
        const nextAlias = alias.trim() || null;
        const applied = (s: SharedSnapshot) => s.places.some((p) => p.id === base.id && p.alias === nextAlias && p.kind === kind);
        const write = await shared.write({
          rpc: "update_shared_place",
          args: { shared_place_id: base.id, expected_revision: current.revision, place_alias: nextAlias, place_kind: kind },
          success: "장소 정보를 수정했어요.",
          receipt: (data) => { const row = parseSharedPlace(single(data)); return (s) => s.places.some((p) => p.id === row.id && p.revision >= row.revision); },
          applied,
          unknownMessage: "수정됐는지 확인했는데 반영되지 않았어요. 입력 내용은 그대로예요.",
          refusal: (code) => sharedPlaceRefusal(code, "수정"),
        });
        if (write.ok) done.onSaved();
        else if (write.reason === "rejected" && write.stale) {
          const fresh = latestPlace(shared, base.id);
          if (fresh && fresh.revision !== base.revision) { done.reopen(editSharedPopup(shared, fresh, edits, done, fresh)); return { ok: false, reason: "blocked", title: "", message: "" }; }
        }
        return write;
      },
      onApplied: done.onSaved,
      finalOnRefusal: (write): PopupButton[] | null => (write.title === FORBIDDEN_TITLE ? [
        { label: "폴더로 돌아가기", primary: true, onClick: done.onBackToFolder },
        { label: "닫기", onClick: done.onSaved },
      ] : null),
    },
  };
}

/** G13b (FP29): save a searched place into the folder, optionally starring it for me. */
export function addSharedPopup(
  shared: Actions,
  folderId: string,
  draft: { place: PlaceSearchResult; alias: string; kind: SavedPlaceKind; starred: boolean },
  done: { onSaved: (row: SharedPlace | null) => void; onBackToFolder: () => void; onExisting: (row: SharedPlace) => void },
): SharedPending {
  const snapshot = shared.current().snapshot;
  const folder = folderNameOf(snapshot, folderId);
  const members = snapshot.members.filter((m) => m.folderId === folderId).length;
  const me = snapshot.members.find((m) => m.folderId === folderId && m.memberId === snapshot.userId);
  const name = draft.alias.trim();
  const count = starCount(shared);
  const region = isRegionOnlyPlace(draft.place);
  return {
    title: `${folder} 폴더에 저장할까요?`,
    card: { eyebrow: `${kindLabel(draft.kind)} · ${region ? "지도에서 선택" : "검색 결과"}`, region, name: draft.place.name, line: placeAddress(draft.place) },
    rows: [
      ...(name ? [{ label: "별명", value: name }] : []),
      { label: "분류", value: kindLabel(draft.kind) },
      { label: "주소", value: region ? `상세 주소 없음 · ${draft.place.address}` : draft.place.roadAddress ?? draft.place.address },
      draft.starred
        ? { label: "자주 찾는 장소", value: "추가", count: `${count} → ${count + 1} / ${FREQUENT_PLACE_LIMIT}` }
        : { label: "자주 찾는 장소", value: "추가 안 함" },
    ],
    note: `폴더 회원 ${members}명 모두에게 보여요. 마지막 수정자에는 내 폴더용 이름 "${me?.displayName ?? ""}"가 표시돼요.`,
    confirm: {
      label: "확인하고 저장",
      busyLabel: "저장하는 중…",
      checking: "저장됐는지 확인하고 있어요",
      notApplied: { title: "저장되지 않았어요", message: "폴더를 다시 확인했지만 이 장소가 없어요. 입력 내용은 그대로예요. 다시 저장하려면 \"확인하고 저장\"을 눌러 주세요." },
      run: async () => {
        if (shared.current().status !== "ready") return unreadable;
        const existing = shared.current().snapshot.places.find((p) => p.folderId === folderId && p.place.kakaoPlaceId === draft.place.kakaoPlaceId);
        if (existing) { done.onExisting(existing); return { ok: false, reason: "blocked", title: "", message: "" }; }
        let receiptRow: SharedPlace | null = null;
        let duplicate = false;
        const applied = (s: SharedSnapshot) => s.places.some((p) => p.folderId === folderId && p.place.kakaoPlaceId === draft.place.kakaoPlaceId);
        const write = await shared.write({
          rpc: "add_shared_place",
          args: { folder_id: folderId, place: sharedPlacePayload(draft.place), place_alias: name || null, place_kind: draft.kind },
          success: "폴더에 장소를 저장했어요.",
          receipt: (data) => {
            const body = data as { status?: unknown; shared_place?: unknown };
            if (!body || (body.status !== "added" && body.status !== "already_exists")) throw new Error("NO_RECEIPT");
            receiptRow = parseSharedPlace(body.shared_place);
            duplicate = body.status === "already_exists";
            const id = receiptRow.id;
            return (s) => s.places.some((p) => p.id === id);
          },
          applied,
          unknownMessage: "저장됐는지 확인했는데 반영되지 않았어요. 입력 내용은 그대로예요.",
          refusal: (code) => sharedPlaceRefusal(code, "저장"),
        });
        if (!write.ok) return write;
        const saved = (receiptRow as SharedPlace | null) ?? shared.current().snapshot.places.find((p) => p.folderId === folderId && p.place.kakaoPlaceId === draft.place.kakaoPlaceId) ?? null;
        if (duplicate && saved) { done.onExisting(saved); return { ok: false, reason: "blocked", title: "", message: "" }; }
        done.onSaved(saved);
        return write;
      },
      // An unknown reply later shown by a read-only re-check: the place is saved, so the star follows.
      onApplied: () => done.onSaved(shared.current().snapshot.places.find((p) => p.folderId === folderId && p.place.kakaoPlaceId === draft.place.kakaoPlaceId) ?? null),
      finalOnRefusal: (write): PopupButton[] | null => (write.title === FORBIDDEN_TITLE ? [
        { label: "폴더로 돌아가기", primary: true, onClick: done.onBackToFolder },
        { label: "닫기", onClick: done.onBackToFolder },
      ] : null),
    },
  };
}

/** Star a just-added shared place without a popup: the rider already confirmed it in G13b. */
export async function starAfterAdd(shared: Actions, row: SharedPlace) {
  return shared.write({
    rpc: "set_shared_place_star",
    args: { shared_place_id: row.id, starred: true },
    success: "폴더에 저장하고 자주 찾는 장소에도 추가했어요.",
    receipt: () => (s) => s.places.some((p) => p.id === row.id && p.starred),
    applied: (s) => s.places.some((p) => p.id === row.id && p.starred),
    unknownMessage: "별표가 반영됐는지 확인하지 못했어요. 장소 상세에서 다시 확인해 주세요.",
  });
}

/** G00b / G00c / GW03b: choose which folders show; only the changed folders are sent (desired state). */
export function folderPickerPopup(shared: Actions, enabledNow: readonly string[]): SharedPending {
  const snapshot = shared.current().snapshot;
  let draft = new Set(enabledNow);
  const changes = () => snapshot.folders
    .filter((folder) => enabledNow.includes(folder.id) !== draft.has(folder.id))
    .map((folder) => ({ folderId: folder.id, enabled: draft.has(folder.id) }));
  return {
    title: "지도와 목록에 보일 공유 폴더",
    body: <FolderChoices snapshot={snapshot} initial={enabledNow} onChange={(next) => { draft = next; }} />,
    note: "끈 폴더의 장소는 지도·목록과 식당 추천에서 빠져요. 별표한 장소는 자주 찾는 장소에 그대로 보여요. 설정은 내 계정에 저장돼 웹·앱 어디서나 같아요.",
    confirm: {
      label: "적용",
      busyLabel: "적용하는 중…",
      retryLabel: "확인하고 적용",
      checking: "적용됐는지 확인하고 있어요",
      notApplied: { title: "적용되지 않았어요", message: "설정을 다시 확인했지만 바뀌지 않았어요. 다시 적용하려면 \"확인하고 적용\"을 눌러 주세요." },
      run: async () => {
        const changed = changes();
        if (!changed.length) return { ok: true };
        const applied = (s: SharedSnapshot) => changed.every((change) => s.preferences.some((row) => row.folderId === change.folderId && row.enabled === change.enabled) || !s.folders.some((f) => f.id === change.folderId));
        return shared.write({
          rpc: "set_place_folders_enabled",
          args: { changes: changed },
          success: "공유 폴더 설정을 적용했어요.",
          receipt: (data) => { if (!Array.isArray(data)) throw new Error("NO_RECEIPT"); return applied; },
          applied,
          unknownMessage: "설정이 적용됐는지 확인하지 못했어요.",
          refusal: (code) => code === "PLACE_FOLDER_NOT_FOUND"
            ? { reason: "rejected", stale: true, title: "폴더 목록이 바뀌었어요", message: "나간 폴더가 있어요. 최신 목록을 불러왔어요. 닫고 다시 골라 주세요." }
            : null,
        });
      },
    },
  };
}

/** Nothing changes until "적용"; X, 취소, the backdrop and back close without a request (G00c). */
function FolderChoices({ snapshot, initial, onChange }: { snapshot: SharedSnapshot; initial: readonly string[]; onChange: (next: Set<string>) => void }) {
  const [draft, setDraft] = useState(() => new Set(initial));
  const set = (next: Set<string>) => { setDraft(next); onChange(next); };
  const me = snapshot.userId;
  return (
    <div className={styles.folderChoices}>
      <div className={styles.folderChoiceTools}>
        <button type="button" onClick={() => set(new Set(snapshot.folders.map((f) => f.id)))}>모두 켜기</button>
        <button type="button" onClick={() => set(new Set())}>모두 끄기</button>
      </div>
      <p className={styles.popupCount}><span>켜 둔 폴더</span><b className={styles.countNumber}>{draft.size} / {snapshot.folders.length}</b></p>
      <ul className={styles.checkList}>
        {snapshot.folders.map((folder) => {
          const owner = folder.ownerId === me;
          const on = draft.has(folder.id);
          return (
            <li key={folder.id}>
              <label className={`${styles.checkRow}${on ? ` ${styles.checkRowOn}` : ""}`}>
                <input type="checkbox" checked={on} onChange={(e) => { const next = new Set(draft); if (e.target.checked) next.add(folder.id); else next.delete(folder.id); set(next); }} />
                <span>
                  <strong>{folder.name} <span className={owner ? styles.ownerChip : styles.memberChip}>{owner ? "주인" : "회원"}</span></strong>
                  <span>장소 {snapshot.places.filter((p) => p.folderId === folder.id).length.toLocaleString()}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

