"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LineIcon } from "@/components/line-icon";
import { ConfirmPopup, type Pending } from "./confirm-popup";
import { SavedDialog } from "./saved-dialog";
import { useSavedPlaces } from "./saved-places-provider";
import { useSharedFolders, type CreateToken, type SharedSnapshot, type SharedWrite } from "./shared-folders-provider";
import { kindLabel, useSharedPopup } from "./shared-place-actions";
import { isRegionOnlyPlace, savedPlaceName, type SavedPlaceEntry, type SavedPlaceKind } from "@/lib/places/saved";
import {
  FOLDER_DISPLAY_NAME_LIMIT,
  FOLDER_NAME_LIMIT,
  nameProblem,
  PLACE_FOLDER_LIMIT,
  PLACE_FOLDER_MEMBER_LIMIT,
  PLACE_FOLDER_PLACE_LIMIT,
  parsePlaceFolder,
  parseAbandonResult,
  type AbandonResult,
  type PendingCreate,
} from "@/lib/places/shared-folders";
import { folderLastEdit, roleLabel } from "@/lib/places/shared-folder-format";
import styles from "./saved-places-manager.module.css";

const savedAddress = (row: SavedPlaceEntry) => (isRegionOnlyPlace(row.place) ? `${row.place.name} · 상세 주소 없음` : row.place.roadAddress ?? row.place.address);

/** G01 / G02 / G03 / GW04: the folders I own or joined, at most 20. */
export function SharedFolderList({ onOpen, onCreate, createBlocked = false }: { onOpen: (folderId: string) => void; onCreate: () => void; createBlocked?: boolean }) {
  const shared = useSharedFolders();
  const { snapshot } = shared;
  const me = snapshot.userId;
  const full = snapshot.folders.length >= PLACE_FOLDER_LIMIT;
  const ready = shared.status === "ready";
  return (
    <>
      {ready && snapshot.folders.length ? (
        <>
          <p className={styles.sectionCount}><strong>내 공유 폴더</strong><b className={styles.countNumber}>{snapshot.folders.length} / {PLACE_FOLDER_LIMIT}</b></p>
          <p className={styles.helper}>내가 만든 폴더와 초대받아 들어간 폴더를 합쳐 최대 {PLACE_FOLDER_LIMIT}개예요.</p>
        </>
      ) : null}
      {shared.status === "loading" ? (
        <ul className={styles.list} aria-busy="true" aria-label="공유 폴더를 불러오는 중">
          {[0, 1, 2].map((index) => <li key={index} className={styles.skeletonCard} aria-hidden="true" />)}
        </ul>
      ) : shared.status === "error" ? (
        <div className={`${styles.stateCard} ${styles.errorState}`} role="alert">
          <strong>공유 폴더를 불러오지 못했어요</strong>
          <p>연결을 확인하고 다시 시도해 주세요. 내 장소와 기피 장소는 그대로 쓸 수 있어요.</p>
          <button type="button" disabled={shared.busy} onClick={shared.retry}>다시 시도</button>
        </div>
      ) : !snapshot.folders.length ? (
        <div className={styles.stateCard}>
          <span className={styles.stateIcon}><LineIcon name="folder" /></span>
          <strong>아직 공유 폴더가 없어요</strong>
          <p>함께 라이딩하는 사람들과 스팟·식당을 한 폴더에 모아 보세요. 폴더를 만들고 초대 링크를 보내면 돼요.</p>
          <p className={styles.helper}>초대 링크를 받았다면 그 링크를 열면 바로 참여할 수 있어요.</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {snapshot.folders.map((folder) => {
            const members = snapshot.members.filter((m) => m.folderId === folder.id);
            const role = members.find((m) => m.memberId === me)?.role ?? "viewer";
            const places = snapshot.places.filter((p) => p.folderId === folder.id);
            return (
              <li key={folder.id} className={styles.folderCard}>
                <button type="button" aria-label={`${folder.name} 폴더 열기, ${roleLabel(role)}`} onClick={() => onOpen(folder.id)}>
                  <span className={styles.folderIcon}><LineIcon name="folder" /></span>
                  <span className={styles.folderText}>
                    <span className={styles.folderTitle}><strong>{folder.name}</strong><RoleChip owner={role === "owner"} /></span>
                    <span className={styles.folderCounts}>장소 <b className={styles.countNumber}>{places.length.toLocaleString()}</b> · 회원 <b className={styles.countNumber}>{members.length}</b></span>
                    <span>{folderLastEdit(folder, places, members, me)}</span>
                  </span>
                  <LineIcon name="chevron-right" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <footer className={styles.registerFooter}>
        <button type="button" className="primary-button" disabled={!ready || shared.busy || full || createBlocked} onClick={onCreate}>＋ 공유 폴더 만들기</button>
        {!ready ? <p className={styles.footerHint}>목록을 확인한 뒤 만들 수 있어요.</p> : full ? <p className={styles.footerHint}>폴더 한도가 차서 만들 수 없어요.</p> : null}
      </footer>
    </>
  );
}

export function RoleChip({ owner }: { owner: boolean }) {
  return <span className={owner ? styles.ownerChip : styles.memberChip}>{owner ? "주인" : "회원"}</span>;
}

/**
 * Two-tab selection of my places (G04–G05d, GI02–GI04): selection survives tab changes, and
 * "모두 선택" respects the remaining room. `taken` places are already in the folder.
 */
export function SavedPlacePicker({
  places,
  selected,
  onChange,
  taken,
  room,
  emptyRestaurants,
}: {
  places: readonly SavedPlaceEntry[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  taken?: ReadonlySet<string>;
  room?: number;
  emptyRestaurants?: string;
}) {
  const [tab, setTab] = useState<SavedPlaceKind>("riding_spot");
  const [moved, setMoved] = useState(false);
  const id = useId();
  const isTaken = (row: SavedPlaceEntry) => Boolean(taken?.has(row.place.kakaoPlaceId));
  const selectable = (kind: SavedPlaceKind) => places.filter((row) => row.kind === kind && !isTaken(row));
  const chosen = (kind: SavedPlaceKind) => selectable(kind).filter((row) => selected.has(row.id)).length;
  const rows = places.filter((row) => row.kind === tab);
  const available = selectable(tab);
  const atRoom = room !== undefined && selected.size >= room;
  const selectAllBlocked = room !== undefined && selected.size + available.filter((row) => !selected.has(row.id)).length > room;
  return (
    <div className={styles.picker}>
      <div className={styles.tabs} role="group" aria-label="장소 분류">
        {(["riding_spot", "restaurant"] as const).map((kind) => {
          const total = selectable(kind).length;
          return (
            <button key={kind} type="button" aria-pressed={tab === kind} onClick={() => { if (kind !== tab && selected.size) setMoved(true); setTab(kind); }}>
              {kindLabel(kind)} <b className={styles.countNumber}>{total || places.some((row) => row.kind === kind) ? `${chosen(kind)}/${total}` : "없음"}</b>
            </button>
          );
        })}
      </div>
      {room !== undefined && atRoom ? (
        <div className={styles.noticeCard} role="status"><strong>폴더에 남은 자리 {room}곳을 모두 골랐어요</strong><p>더 고르려면 다른 장소를 해제하거나 폴더의 장소를 정리해 주세요. 폴더는 {PLACE_FOLDER_PLACE_LIMIT.toLocaleString()}곳까지예요.</p></div>
      ) : null}
      {!rows.length ? (
        <div className={styles.stateCard}>
          <strong>저장한 {kindLabel(tab)}{tab === "restaurant" ? "이" : "이"} 없어요</strong>
          <p>{tab === "restaurant" && emptyRestaurants ? emptyRestaurants : "폴더 화면에서 검색·지도로 장소를 바로 추가할 수 있어요."}</p>
        </div>
      ) : (
        <>
          <div className={styles.pickerTools}>
            <span id={`${id}-count`}>{taken ? `고를 수 있는 ${available.length}곳 중` : `${available.length}곳 중`} <b className={styles.countNumber}>{chosen(tab)}</b>{taken ? "" : " 곳 선택"}</span>
            <button type="button" disabled={!available.length || selectAllBlocked || available.every((row) => selected.has(row.id))} onClick={() => onChange(new Set([...selected, ...available.map((row) => row.id)]))}>모두 선택</button>
            <button type="button" disabled={!available.some((row) => selected.has(row.id))} onClick={() => { const next = new Set(selected); available.forEach((row) => next.delete(row.id)); onChange(next); }}>모두 해제</button>
          </div>
          {selectAllBlocked && available.some((row) => !selected.has(row.id)) ? <p className={styles.helper}>남은 자리({room}곳)보다 많아서 &quot;모두 선택&quot;을 쓸 수 없어요.</p> : null}
          <ul className={styles.checkList} aria-describedby={`${id}-count`}>
            {rows.map((row) => {
              const already = isTaken(row);
              const checked = selected.has(row.id);
              return (
                <li key={row.id}>
                  <label className={`${styles.checkRow}${checked ? ` ${styles.checkRowOn}` : ""}${already ? ` ${styles.checkRowTaken}` : ""}`}>
                    <input type="checkbox" checked={checked} disabled={already || (!checked && atRoom)} onChange={(e) => { const next = new Set(selected); if (e.target.checked) next.add(row.id); else next.delete(row.id); onChange(next); }} />
                    <span><strong>{savedPlaceName(row)}</strong><span>{savedAddress(row)}</span></span>
                    {already ? <span className={styles.chip}>이미 폴더에 있음</span> : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {moved ? <p className={`${styles.helper} ${styles.pickerMoved}`}>탭을 바꿔도 고른 장소는 그대로예요.</p> : null}
    </div>
  );
}

export const selectionCounts = (places: readonly SavedPlaceEntry[], selected: ReadonlySet<string>) => ({
  spots: places.filter((row) => row.kind === "riding_spot" && selected.has(row.id)).length,
  restaurants: places.filter((row) => row.kind === "restaurant" && selected.has(row.id)).length,
});

/** G04x (456:12971): what is lost, e.g. "입력한 폴더 이름·내 폴더용 이름과 고른 장소 14곳". */
export function leavingWhat(name: string, displayName: string, places: number) {
  const typed = [name ? "폴더 이름" : "", displayName ? "내 폴더용 이름" : ""].filter(Boolean).join("·");
  const picked = places ? `고른 장소 ${places}곳` : "";
  return typed && picked ? `입력한 ${typed}과 ${picked}` : typed ? `입력한 ${typed}` : picked;
}

/** G04–G08: name, my folder name, optional copies of my places, then the final confirmation. */
export type { PendingCreate };

/**
 * `stale`: the account changed (or another request is kept) meanwhile; nothing was applied.
 * `unread`: the server says it was made, but the folder list could not be read to confirm it; kept.
 */
export type AbandonOutcome = { kind: "created"; folderId: string } | { kind: "created_gone" } | { kind: "abandoned" } | { kind: "unknown" } | { kind: "unread" } | { kind: "stale" };
/**
 * Ends a kept create on the server (contract §6): its stored result or a tombstone that stops a late
 * copy of it. A write, but the same id may be sent again with the same answer. The kept request is
 * updated only through `token`, so an answer arriving after an account change changes nothing.
 */
export async function abandonCreate(shared: ReturnType<typeof useSharedFolders>, token: CreateToken, pending: PendingCreate): Promise<AbandonOutcome> {
  const { data, code, lost } = await shared.call("abandon_place_folder_request", { request_id: pending.requestId });
  if (!token.live()) return { kind: "stale" };
  let result: AbandonResult | null = null;
  if (!code && !lost) { try { result = parseAbandonResult(data); } catch { result = null; } }
  if (!result) return token.keep(pending) ? { kind: "unknown" } : { kind: "stale" };
  if (result.status !== "created") return token.clear() ? { kind: result.status } : { kind: "stale" };
  // Only a result made by this very request counts, like a create receipt.
  if (result.folder.createRequestId === null || result.folder.createRequestId !== pending.requestId) return token.keep(pending) ? { kind: "unknown" } : { kind: "stale" };
  // The same follow-up as a create receipt, decided only by a read this step itself completed: a
  // read skipped for another write, or failed, leaves it kept (V3 delta 9).
  const folderId = result.folder.id;
  const seen = await shared.recheck((list) => list.folders.some((row) => row.id === folderId));
  if (!token.live()) return { kind: "stale" };
  if (seen === "unreadable") return token.keep(pending) ? { kind: "unread" } : { kind: "stale" };
  if (!token.clear()) return { kind: "stale" };
  return seen === "applied" ? { kind: "created", folderId } : { kind: "created_gone" };
}

/** A keep or clear was refused: another step changed this request's state; nothing more is sent. */
export const CREATE_STATE_CHANGED = { title: "목록을 다시 확인해 주세요", message: "다른 화면에서 이 만들기 요청의 상태가 바뀌었어요. 폴더 목록에서 다시 확인해 주세요." };

/**
 * G04–G08 folder create. While the account has a kept create with an unknown result
 * (`shared.pendingCreate`), this screen only reopens that request: same id, same input, inputs
 * locked, and closing its confirmation without an answer returns to the list (V3 delta 5).
 */
export function FolderCreate({ onClose, onCreated }: { onClose: () => void; onCreated: (folderId: string) => void }) {
  const shared = useSharedFolders();
  const saved = useSavedPlaces();
  const { open, close, popup } = useSharedPopup();
  const kept = shared.pendingCreate;
  const [leaving, setLeaving] = useState<Pending<SharedSnapshot> | null>(null);
  const [name, setName] = useState(kept?.folderName ?? "");
  const [displayName, setDisplayName] = useState(kept?.displayName ?? "");
  const [touched, setTouched] = useState({ name: false, displayName: false });
  const [selected, setSelected] = useState<Set<string>>(() => new Set(kept?.ids ?? []));
  const nameId = useId();
  const created = useRef<string | null>(null);
  const popupOpen = popup !== null;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (popupOpen) { wasOpen.current = true; return; }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    // Closed without an answer for the kept request: back to the list, which keeps it.
    if (shared.pendingCreate) onClose();
  }, [popupOpen, shared.pendingCreate, onClose]);
  useEffect(() => {
    const atOpen = shared.pendingCreate;
    if (!atOpen) return;
    const task = window.setTimeout(() => submit(atOpen), 0);
    return () => window.clearTimeout(task);
    // Opens the kept request's confirmation once, when this screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { snapshot } = shared;
  const full = snapshot.folders.length >= PLACE_FOLDER_LIMIT;
  const blocked = shared.busy || shared.status !== "ready" || saved.status !== "ready";
  const nameIssue = nameProblem(name, FOLDER_NAME_LIMIT);
  const displayIssue = nameProblem(displayName, FOLDER_DISPLAY_NAME_LIMIT);
  const { spots, restaurants } = selectionCounts(saved.places, selected);
  const total = spots + restaurants;
  const dirty = Boolean(name || displayName || total);
  const length = (value: string) => [...value.trim()].length;
  function back() {
    // A kept request loses nothing by leaving: the list still holds it.
    if (!dirty || kept) { onClose(); return; }
    setLeaving({
      key: 1,
      title: "폴더 만들기를 그만둘까요?",
      note: `${leavingWhat(name, displayName, total)}이 저장되지 않아요.`,
      buttons: [
        { label: "그만두기", danger: true, onClick: () => { setLeaving(null); onClose(); } },
        { label: "계속 만들기", onClick: () => setLeaving(null) },
      ],
    });
  }
  function submit(resume: PendingCreate | null = null) {
    setTouched({ name: true, displayName: true });
    if (!resume && (nameIssue || displayIssue || full)) return;
    const folderName = resume?.folderName ?? name.trim();
    const mine = resume?.displayName ?? displayName.trim();
    const ids = resume?.ids ?? saved.places.filter((row) => selected.has(row.id)).map((row) => row.id);
    const me = snapshot.userId;
    const count = snapshot.folders.length;
    // One request id per confirmation: every try in it (FP39 re-check, "확인하고 만들기") reuses it,
    // so a resent or browser-retried request makes one folder (contract §6, idempotent create).
    const requestId = resume?.requestId ?? crypto.randomUUID();
    // Every keep/clear of this request below is bound to this account and this id.
    const token = shared.captureCreate(requestId);
    const request: PendingCreate = { requestId, folderName, displayName: mine, ids, abandoning: null };
    // An earlier try of this request had an unknown result (a reopened kept request always did).
    let uncertain = Boolean(resume);
    // The confirmation ends with a single close button (deleted since, abandoned, abandon unknown).
    let ended = false;
    const createdBy = (s: SharedSnapshot) => s.folders.find((f) => f.ownerId === me && f.createRequestId === requestId);
    const deletedSince = { ok: false as const, reason: "rejected" as const, title: "이 요청으로 만든 폴더는 이미 삭제됐어요", message: "같은 요청으로 만든 폴더가 그사이 삭제돼 다시 만들지 않았어요. 새로 만들려면 \"폴더 만들기\"를 다시 눌러 주세요." };
    // A refused keep or clear: another step changed this request; end here without any write.
    const changed: SharedWrite = { ok: false, reason: "rejected", ...CREATE_STATE_CHANGED };
    async function tryOnce(): Promise<SharedWrite> {
      created.current = null;
      const write = await shared.write({
        rpc: "create_place_folder",
        args: { folder_name: folderName, display_name: mine, saved_place_ids: ids, request_id: requestId },
        success: "공유 폴더를 만들었어요. 초대 링크를 만들어 회원을 불러 보세요.",
        receipt: (data) => {
          const folder = parsePlaceFolder((data as { folder?: unknown })?.folder);
          created.current = folder.id;
          return (s) => s.folders.some((f) => f.id === folder.id);
        },
        // A lost reply is confirmed only by the folder carrying this request id, never by its name.
        applied: (s) => Boolean(createdBy(s)),
        unknownMessage: "만들어졌는지 확인했는데 새 폴더가 없어요. 입력 내용은 그대로예요.",
        refusal: (code) => code === "PLACE_FOLDER_LIMIT"
          ? { reason: "rejected", title: "폴더를 만들지 못했어요", message: `공유 폴더 ${PLACE_FOLDER_LIMIT}개가 모두 찼어요. 쓰지 않는 폴더를 삭제하거나 나간 뒤 만들 수 있어요.` }
          : code === "SAVED_PLACE_NOT_FOUND"
            ? { reason: "rejected", stale: true, title: "고른 장소가 바뀌었어요", message: "고른 내 장소 중 삭제된 것이 있어요. 선택을 확인한 뒤 다시 만들어 주세요." }
            : code === "PLACE_FOLDER_REQUEST_ABANDONED"
              ? { reason: "rejected", title: "이 요청은 이미 정리됐어요", message: "응답을 받지 못한 이 만들기 요청은 정리돼 다시 만들지 않았어요. 새로 만들려면 \"폴더 만들기\"를 다시 눌러 주세요." }
            : code === "PLACE_FOLDER_REQUEST_MISMATCH"
              ? { reason: "rejected", title: "폴더를 만들지 못했어요", message: "같은 요청으로 다른 내용을 보낼 수 없어요. 닫고 다시 만들어 주세요." }
            : code === "INVALID_FOLDER_DISPLAY_NAME" || code === "INVALID_PLACE_FOLDER"
              ? { reason: "rejected", title: "이름을 확인해 주세요", message: "폴더 이름은 1~40자, 내 이름은 1~20자로 입력해 주세요." }
              : null,
      });
      if (!token.live()) return changed;
      if (write.ok) {
        if (!token.clear()) return changed;
        const id = created.current ?? createdBy(shared.current().snapshot)?.id;
        if (id) onCreated(id);
        return write;
      }
      // The server replayed this request's receipt, but the readable list has no such folder:
      // it was deleted since. This id is settled: nothing is kept or resent under it.
      if (write.reason === "mismatch" && write.checked && created.current) return token.clear() ? deletedSince : changed;
      // Unknown, or a receipt the list does not show yet: kept for this account until a read settles it.
      if (write.reason === "unknown" || write.reason === "mismatch") {
        uncertain = true;
        if (!token.keep({ ...request })) return changed;
        // A receipt whose folder a later successful read still does not show was deleted since.
        return write.reason === "mismatch" && created.current
          ? { ...write, stillMissing: { title: deletedSince.title, message: deletedSince.message, settle: () => { token.clear(); } } }
          : write;
      }
      if (write.reason === "rejected" || write.reason === "star_limit") {
        // A clear refusal of this try. Without an unknown try before it, nothing was made: release.
        if (!uncertain) return token.clear() ? write : changed;
        // After an unknown try, that send may still arrive (a timeout cancels nothing): the server
        // ends this id instead, returning its folder if it was made, or blocking a late copy.
        ended = true;
        const outcome = await abandonCreate(shared, token, { ...request, abandoning: { title: write.title, message: write.message } });
        if (outcome.kind === "stale") return changed;
        if (outcome.kind === "created") { onCreated(outcome.folderId); return { ok: true }; }
        if (outcome.kind === "created_gone") return deletedSince;
        if (outcome.kind === "abandoned") return { ...write, stale: false };
        if (outcome.kind === "unread") return { ok: false, reason: "rejected", title: write.title, message: `${write.message} 이전 요청으로 폴더가 만들어졌지만 목록을 확인하지 못했어요. 목록에서 다시 확인해 주세요.` };
        // The abandon's own result is unknown: still kept and blocked; the list retries it.
        return { ok: false, reason: "rejected", title: write.title, message: `${write.message} 응답을 받지 못한 이전 요청을 정리했는지 확인하지 못했어요. 목록에서 다시 확인해 주세요.` };
      }
      return write;
    }
    open({
      title: "이 공유 폴더를 만들까요?",
      card: { eyebrow: "새 공유 폴더", name: folderName, line: `이 폴더에서 쓸 내 이름 · ${mine}` },
      rows: [
        { label: "라이딩 스팟 · 식당", value: "", count: `${spots} · ${restaurants}` },
        { label: "폴더 장소", value: "", count: `${total} / ${PLACE_FOLDER_PLACE_LIMIT.toLocaleString()}` },
        { label: "내 공유 폴더", value: "", count: `${count} → ${count + 1} / ${PLACE_FOLDER_LIMIT}` },
      ],
      note: total
        ? "고른 내 장소를 복사해 폴더를 만들어요. 복사본은 내 장소와 따로 관리돼요. 만든 뒤 초대 링크로 회원을 부를 수 있어요."
        : "빈 폴더로 만들어요. 만든 뒤 장소를 추가하고 초대 링크로 회원을 부를 수 있어요.",
      confirm: {
        label: "폴더 만들기",
        busyLabel: "만드는 중…",
        retryLabel: "확인하고 만들기",
        checking: "만들어졌는지 확인하고 있어요",
        checkingMessage: "응답을 받지 못해 폴더 목록을 다시 읽는 중이에요. 같은 요청을 다시 보내지 않아요.",
        notApplied: { title: "폴더가 만들어지지 않았어요", message: "폴더 목록을 다시 확인했지만 새 폴더가 없어요. 입력 내용은 그대로예요. 다시 만들려면 \"확인하고 만들기\"를 눌러 주세요." },
        run: async () => {
          // One create-work step per account at a time (V3 delta 9): the list cannot re-check or
          // abandon this request while this try runs.
          if (!token.begin()) return { ok: false, reason: "blocked", title: "잠시 뒤 다시 시도해 주세요", message: "이 만들기 요청을 확인하고 있어요." };
          try {
            return await tryOnce();
          } finally {
            token.end();
          }
        },
        finalOnRefusal: (write) => (write.title === deletedSince.title || write.title === CREATE_STATE_CHANGED.title || ended
          ? [{ label: "닫기", primary: true, onClick: () => undefined }]
          : null),
        onApplied: () => {
          if (!token.clear()) return;
          const id = created.current ?? createdBy(shared.current().snapshot)?.id;
          if (id) onCreated(id);
        },
      },
    });
  }
  return (
    <SavedDialog title="공유 폴더 만들기" onBack={back} onClose={back} fullScreen>
      <div className={`${styles.waypointBody} ${styles.formBody}`}>
        {full ? <div className={styles.errorCard} role="alert"><strong>공유 폴더 {PLACE_FOLDER_LIMIT}개가 모두 찼어요</strong><p>내가 만든 폴더와 참여한 폴더를 합쳐 {PLACE_FOLDER_LIMIT}개까지예요. 쓰지 않는 폴더를 삭제하거나 나간 뒤 만들 수 있어요.</p></div> : null}
        <div className={styles.textFieldGroup}>
          <label className={styles.fieldLabel} htmlFor={`${nameId}-name`}>폴더 이름</label>
          <input id={`${nameId}-name`} className={`${styles.textField}${touched.name && nameIssue ? ` ${styles.invalidInput}` : ""}`} value={name} maxLength={80} placeholder="예: 주말 라이더" disabled={Boolean(kept)} aria-invalid={(touched.name && Boolean(nameIssue)) || undefined} aria-describedby={`${nameId}-name-hint`} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, name: true }))} />
          <p id={`${nameId}-name-hint`} className={touched.name && nameIssue ? styles.fieldError : styles.helper} role={touched.name && nameIssue ? "alert" : undefined}>
            {touched.name && nameIssue === "empty" ? "폴더 이름을 입력해 주세요. 1~40자" : nameIssue === "long" ? `${FOLDER_NAME_LIMIT}자 이하로 줄여 주세요. 지금 ${length(name)}자` : nameIssue === "invalid" && touched.name ? "쓸 수 없는 문자가 있어요." : `${length(name)} / ${FOLDER_NAME_LIMIT}`}
          </p>
        </div>
        <div className={styles.textFieldGroup}>
          <label className={styles.fieldLabel} htmlFor={`${nameId}-display`}>이 폴더에서 쓸 내 이름 (필수)</label>
          <input id={`${nameId}-display`} className={`${styles.textField}${touched.displayName && displayIssue ? ` ${styles.invalidInput}` : displayIssue === "long" ? ` ${styles.invalidInput}` : ""}`} value={displayName} maxLength={40} placeholder="예: 주말라이더" disabled={Boolean(kept)} aria-invalid={displayIssue === "long" || (touched.displayName && Boolean(displayIssue)) || undefined} aria-describedby={`${nameId}-display-hint`} onChange={(e) => setDisplayName(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, displayName: true }))} />
          <p id={`${nameId}-display-hint`} className={displayIssue === "long" || (touched.displayName && displayIssue) ? styles.fieldError : styles.helper} role={displayIssue === "long" ? "alert" : undefined}>
            {displayIssue === "long" ? `${FOLDER_DISPLAY_NAME_LIMIT}자 이하로 줄여 주세요. 지금 ${length(displayName)}자` : touched.displayName && displayIssue === "empty" ? "이 폴더에서 쓸 내 이름을 입력해 주세요. 1~20자" : displayName ? `${length(displayName)} / ${FOLDER_DISPLAY_NAME_LIMIT} · 이 폴더 회원에게만 보여요.` : "이 폴더 회원에게만 보여요. 1~20자, 카카오 닉네임은 보이지 않아요."}
          </p>
        </div>
        <h3 className={styles.sectionTitle}>처음에 넣을 내 장소 (선택)</h3>
        <p className={styles.helper}>고른 장소는 폴더에 복사돼요. 하나도 고르지 않고 빈 폴더로 만들어도 돼요. 폴더에서 고쳐도 내 장소는 바뀌지 않아요.</p>
        {saved.status === "error" ? (
          <div className={`${styles.stateCard} ${styles.errorState}`} role="alert"><strong>내 장소를 불러오지 못했어요</strong><p>{saved.message}</p><button type="button" onClick={saved.retry}>다시 시도</button></div>
        ) : (
          <SavedPlacePicker places={saved.places} selected={selected} onChange={(next) => { if (!kept) setSelected(next); }} emptyRestaurants="폴더를 만든 뒤 폴더 화면에서 검색·지도로 식당을 바로 추가할 수 있어요." />
        )}
      </div>
      <div className={styles.waypointFooter}>
        <p className={styles.selectionSummary}>라이딩 스팟 <b className={styles.countNumber}>{spots}</b> · 식당 <b className={styles.countNumber}>{restaurants}</b> 선택</p>
        <button type="button" className="primary-button" disabled={kept ? blocked : blocked || full || Boolean(nameIssue) || Boolean(displayIssue)} onClick={() => submit(kept)}>
          {total ? `폴더 만들기 · 장소 ${total}곳` : "빈 폴더로 만들기"}
        </button>
        {full ? <p className={styles.footerHint}>폴더 한도가 차서 만들 수 없어요.</p> : nameIssue || displayIssue ? <p className={styles.footerHint}>폴더 이름과 내 이름을 입력하면 만들 수 있어요. 장소는 고르지 않아도 돼요.</p> : null}
      </div>
      {popup}
      {leaving ? <ConfirmPopup<SharedSnapshot> pending={leaving} busy={false} verifying={false} recheck={async () => "unreadable"} capture={() => () => true} onClose={() => { setLeaving(null); close(); }} /> : null}
    </SavedDialog>
  );
}

export { PLACE_FOLDER_MEMBER_LIMIT };
