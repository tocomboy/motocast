"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { LineIcon } from "@/components/line-icon";
import { ConfirmPopup, type ConfirmWrite, type Pending, type Recheck } from "./confirm-popup";
import { SavedDialog } from "./saved-dialog";
import { useSharedFolders, type SharedSnapshot, type SharedWrite } from "./shared-folders-provider";
import { useSharedPopup } from "./shared-place-actions";
import { FREQUENT_PLACE_LIMIT } from "@/lib/places/saved";
import {
  FOLDER_DISPLAY_NAME_LIMIT,
  FOLDER_NAME_LIMIT,
  nameProblem,
  parseCreatedInvite,
  parseFolderInvite,
  parseFolderMember,
  parsePlaceFolder,
  PLACE_FOLDER_INVITE_LIMIT,
  PLACE_FOLDER_MEMBER_LIMIT,
  type CreatedInvite,
  type FolderInvite,
  type FolderMember,
  type FolderRole,
} from "@/lib/places/shared-folders";
import { dateLabel, dateTimeLabel, expiryLabel, permissionLabel } from "@/lib/places/shared-folder-format";
import styles from "./saved-places-manager.module.css";

export type SettingsPage = "invites" | "members" | "display-name" | "rename" | "delete" | "leave";
type Shared = ReturnType<typeof useSharedFolders>;
const unreadable: SharedWrite = { ok: false, reason: "blocked", title: "목록을 확인하지 못했어요", message: "목록을 다시 불러온 뒤에 시도할 수 있어요." };

/** Builds the shareable invite URL; the token lives only in the fragment, never in a query. */
export const inviteUrl = (token: string) => `${window.location.origin}/folder-invite#t=${token}`;

export function FolderSettings({ folderId, page, onClose, onLeft }: {
  folderId: string;
  page: SettingsPage;
  onClose: () => void;
  /** The folder is gone for me (deleted or left); `message` is shown on the list. */
  onLeft: (message?: string) => void;
}) {
  const shared = useSharedFolders();
  const { open, popup } = useSharedPopup();
  const opened = useRef(false);
  const { snapshot } = shared;
  const folder = snapshot.folders.find((row) => row.id === folderId);
  const members = snapshot.members.filter((row) => row.folderId === folderId);
  const mine = members.find((row) => row.memberId === snapshot.userId);
  useEffect(() => {
    if (opened.current || !folder || !mine) return;
    if (page === "delete" || page === "leave") {
      opened.current = true;
      open(page === "delete" ? deletePopup(shared, folderId, () => onLeft("폴더를 삭제했어요.")) : leavePopup(shared, folderId, () => onLeft("폴더에서 나왔어요.")));
    }
  });
  if (!folder || !mine) return null;
  if (page === "delete" || page === "leave") return <>{popup}</>;
  if (page === "invites") return <InviteLinks folderId={folderId} onClose={onClose} />;
  if (page === "members") return <Members folderId={folderId} onClose={onClose} onLeave={() => open(leavePopup(shared, folderId, () => onLeft("폴더에서 나왔어요.")))} popup={popup} />;
  if (page === "display-name") return <DisplayNameEdit folderId={folderId} onClose={onClose} />;
  return <FolderRename folderId={folderId} onClose={onClose} />;
}

/** G38: the owner deletes the folder for every member. */
function deletePopup(shared: Shared, folderId: string, onDone: () => void): Omit<Pending<SharedSnapshot>, "key"> {
  const snapshot = shared.current().snapshot;
  const folder = snapshot.folders.find((row) => row.id === folderId)!;
  const places = snapshot.places.filter((row) => row.folderId === folderId).length;
  const members = snapshot.members.filter((row) => row.folderId === folderId).length;
  const gone = (s: SharedSnapshot) => !s.folders.some((row) => row.id === folderId);
  return {
    title: `"${folder.name}" 폴더를 삭제할까요?`,
    card: { eyebrow: "공유 폴더 · 주인", name: folder.name, line: `장소 ${places.toLocaleString()} · 회원 ${members}` },
    note: "폴더의 장소와 회원 참여가 모두 사라지고 초대 링크도 쓸 수 없게 돼요. 회원 모두의 이 폴더 별표도 빠져요. 이미 만든 일정·코스·공유 결과는 그대로예요. 되돌릴 수 없어요.",
    confirm: {
      label: "폴더 삭제",
      retryLabel: "확인하고 삭제",
      busyLabel: "삭제하는 중…",
      danger: true,
      checking: "삭제됐는지 확인하고 있어요",
      notApplied: { title: "삭제되지 않았어요", message: "폴더 목록을 다시 확인했지만 폴더가 그대로 있어요. 다시 삭제하려면 \"확인하고 삭제\"를 눌러 주세요." },
      run: async () => {
        if (shared.current().status !== "ready") return unreadable;
        const current = shared.current().snapshot.folders.find((row) => row.id === folderId);
        if (!current) { onDone(); return { ok: true }; }
        const write = await shared.write({
          rpc: "delete_place_folder",
          args: { folder_id: folderId, expected_revision: current.revision },
          success: "폴더를 삭제했어요.",
          receipt: () => gone,
          applied: gone,
          unknownMessage: "삭제됐는지 확인했는데 폴더가 그대로 있어요.",
          refusal: (code) => code === "PLACE_FOLDER_STALE"
            ? { reason: "rejected", stale: true, title: "폴더가 바뀌었어요", message: "다른 기기에서 폴더 이름이 바뀌었어요. 최신 내용을 불러왔어요. 다시 삭제할 수 있어요." }
            : null,
        });
        if (write.ok) onDone();
        return write;
      },
      onApplied: onDone,
    },
  };
}

/** G33: leave a folder; my stars on its places go with me. */
function leavePopup(shared: Shared, folderId: string, onDone: () => void): Omit<Pending<SharedSnapshot>, "key"> {
  const snapshot = shared.current().snapshot;
  const folder = snapshot.folders.find((row) => row.id === folderId)!;
  const places = snapshot.places.filter((row) => row.folderId === folderId).length;
  const members = snapshot.members.filter((row) => row.folderId === folderId).length;
  const stars = snapshot.stars.length;
  const mineHere = snapshot.stars.filter((star) => star.source === "shared" && star.folderId === folderId).length;
  const gone = (s: SharedSnapshot) => !s.folders.some((row) => row.id === folderId);
  return {
    title: `${folder.name} 폴더에서 나갈까요?`,
    card: { eyebrow: "공유 폴더 · 회원", name: folder.name, line: `장소 ${places.toLocaleString()} · 회원 ${members} / ${PLACE_FOLDER_MEMBER_LIMIT}` },
    count: mineHere ? { label: "자주 찾는 장소", value: `${stars} → ${stars - mineHere} / ${FREQUENT_PLACE_LIMIT}` } : undefined,
    note: `폴더 장소를 더 볼 수 없${mineHere ? `고, 이 폴더 장소에 표시한 내 별표 ${mineHere}개가 빠져요` : "어요"}. 내가 추가·수정한 장소는 남고 "나간 회원"으로 표시돼요. 다시 들어오려면 새 초대 링크가 필요해요.`,
    confirm: {
      label: "폴더 나가기",
      retryLabel: "확인하고 나가기",
      busyLabel: "나가는 중…",
      danger: true,
      checking: "나갔는지 확인하고 있어요",
      notApplied: { title: "폴더에서 나가지 않았어요", message: "폴더 목록을 다시 확인했지만 아직 회원이에요. 다시 나가려면 \"확인하고 나가기\"를 눌러 주세요." },
      run: async () => {
        if (shared.current().status !== "ready") return unreadable;
        if (gone(shared.current().snapshot)) { onDone(); return { ok: true }; }
        const write = await shared.write({
          rpc: "leave_place_folder",
          args: { folder_id: folderId },
          success: "폴더에서 나왔어요.",
          receipt: () => gone,
          applied: gone,
          unknownMessage: "나갔는지 확인했는데 아직 회원이에요.",
          refusal: (code) => code === "PLACE_FOLDER_NOT_FOUND" ? { reason: "rejected", stale: true, title: "이미 폴더에서 나갔어요", message: "폴더가 삭제됐거나 내보내졌어요." } : null,
        });
        if (write.ok || (!write.ok && write.reason === "rejected" && gone(shared.current().snapshot))) { onDone(); return { ok: true }; }
        return write;
      },
      onApplied: onDone,
    },
  };
}

function useInvites(shared: Shared, folderId: string) {
  const [invites, setInvites] = useState<FolderInvite[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const generation = useRef(0);
  const load = useCallback(async (): Promise<FolderInvite[] | null> => {
    const read = ++generation.current;
    setState("loading");
    const { data, code, lost } = await shared.call("list_place_folder_invites", { folder_id: folderId });
    if (read !== generation.current) return null;
    try {
      if (code || lost || !Array.isArray(data) || data.length > PLACE_FOLDER_INVITE_LIMIT * 10) throw new Error("READ_FAILED");
      const rows = data.map(parseFolderInvite);
      setInvites(rows);
      setState("ready");
      return rows;
    } catch {
      setState("error");
      return null;
    }
  }, [shared, folderId]);
  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);
  return { invites, state, load };
}

/** G20 / G21 / G22: invite links. The raw link exists only in this screen right after creation. */
function InviteLinks({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const shared = useSharedFolders();
  const { invites, state, load } = useInvites(shared, folderId);
  const [created, setCreated] = useState<(CreatedInvite & { copied: boolean }) | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [pending, setPending] = useState<Pending<FolderInvite[]> | null>(null);
  const popupKey = useRef(0);
  const { snapshot } = shared;
  const members = snapshot.members.filter((row) => row.folderId === folderId);
  const owner = members.find((row) => row.role === "owner");
  const full = (invites?.length ?? 0) >= PLACE_FOLDER_INVITE_LIMIT;
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); return true; } catch { return false; }
  }
  async function create() {
    if (creating || state !== "ready") return;
    setCreating(true);
    setError(null);
    const before = new Set((invites ?? []).map((row) => row.id));
    const { data, code, lost } = await shared.call("create_place_folder_invite", { folder_id: folderId });
    try {
      if (!code && !lost) {
        const invite = parseCreatedInvite(data);
        const copied = await copy(inviteUrl(invite.token));
        setCreated({ ...invite, copied });
        void load();
        return;
      }
      if (code === "PLACE_FOLDER_INVITE_LIMIT") setError({ title: "초대 링크를 만들지 못했어요", message: `사용 중인 링크가 ${PLACE_FOLDER_INVITE_LIMIT}개예요. 쓰지 않는 링크를 회수한 뒤 만들어 주세요.` });
      else if (code === "PLACE_FOLDER_FORBIDDEN" || code === "PLACE_FOLDER_NOT_FOUND") setError({ title: "초대 링크를 만들지 못했어요", message: "이 폴더의 주인만 초대 링크를 만들 수 있어요." });
      else {
        // The reply is lost: the token cannot be recovered, so only the list tells what happened.
        const rows = await load();
        const appeared = rows?.some((row) => !before.has(row.id));
        setError(appeared
          ? { title: "링크는 만들어졌지만 주소를 받지 못했어요", message: "보안을 위해 주소는 다시 볼 수 없어요. 새로 생긴 링크를 회수하고 새 링크를 만들어 주세요." }
          : rows ? { title: "초대 링크를 만들지 못했어요", message: "목록을 다시 확인했지만 새 링크가 없어요. 다시 만들 수 있어요." }
            : { title: "결과를 확인하지 못했어요", message: "목록을 다시 불러온 뒤 확인해 주세요." });
      }
    } catch {
      setError({ title: "결과를 확인하지 못했어요", message: "목록을 다시 불러온 뒤 확인해 주세요." });
      void load();
    } finally {
      setCreating(false);
    }
  }
  function revoke(invite: FolderInvite) {
    const expiry = expiryLabel(invite.expiresAt);
    const gone = (rows: FolderInvite[]) => !rows.some((row) => row.id === invite.id);
    setPending({
      key: ++popupKey.current,
      title: "이 초대 링크를 회수할까요?",
      card: { eyebrow: "초대 링크 · 사용 중", line: `만료 ${expiry.at} · ${expiry.left} 남음`, line2: `만든 사람 ${owner?.displayName ?? "주인"} · ${dateTimeLabel(invite.createdAt)}` },
      note: `회수하면 이 링크로는 더 이상 들어올 수 없어요. 이미 들어온 회원 ${members.length}명은 그대로예요. 되돌릴 수 없어요.`,
      confirm: {
        label: "링크 회수",
        retryLabel: "확인하고 회수",
        busyLabel: "회수하는 중…",
        danger: true,
        checking: "회수됐는지 확인하고 있어요",
        notApplied: { title: "회수되지 않았어요", message: "링크 목록을 다시 확인했지만 아직 사용 중이에요. 다시 회수하려면 \"확인하고 회수\"를 눌러 주세요." },
        run: async (): Promise<ConfirmWrite<FolderInvite[]>> => {
          const { code, lost } = await shared.call("revoke_place_folder_invite", { invite_id: invite.id });
          if (code && !lost) {
            await load();
            return { ok: false, reason: "rejected", title: "링크를 회수하지 못했어요", message: code === "PLACE_FOLDER_INVITE_NOT_FOUND" ? "링크를 찾지 못했어요. 최신 목록을 불러왔어요." : "다시 시도해 주세요." };
          }
          const rows = await load();
          if (rows && gone(rows)) return { ok: true };
          return rows
            ? lost ? { ok: false, reason: "unknown", checked: true, title: "회수되지 않았어요", message: "", recheck: gone } : { ok: false, reason: "mismatch", checked: true, title: "목록에서 변경을 확인하지 못했어요", message: "회수 요청은 접수됐지만 목록에 아직 보여요.", recheck: gone }
            : { ok: false, reason: "unknown", checked: false, title: "목록을 확인하지 못했어요", message: "회수됐는지 아직 몰라요. 목록을 다시 확인해 주세요.", recheck: gone };
        },
      },
    });
  }
  const recheck = async (applied: (rows: FolderInvite[]) => boolean): Promise<Recheck> => {
    const rows = await load();
    return rows ? (applied(rows) ? "applied" : "missing") : "unreadable";
  };
  if (created) {
    const expiry = expiryLabel(created.expiresAt);
    return (
      <SavedDialog title="초대 링크" onBack={() => setCreated(null)} onClose={onClose} fullScreen>
        <div className={`${styles.waypointBody} ${styles.formBody}`}>
          <p className={styles.noticeCard} role="status">{created.copied ? "초대 링크를 복사했어요. 메신저에 붙여 넣어 보내세요." : "아래 버튼으로 링크를 복사해 메신저로 보내세요."}</p>
          <div className={styles.inviteCreated}>
            <p className={styles.inviteTitle}><LineIcon name="link" /><strong>방금 만든 초대 링크</strong></p>
            <p className={styles.helper}>만료 <b className={styles.countNumber}>{expiry.at}</b> · {expiry.left} 뒤</p>
            <button type="button" className={styles.secondaryButton} onClick={async () => setCreated({ ...created, copied: await copy(inviteUrl(created.token)) })}><LineIcon name="copy" /> 링크 다시 복사</button>
            {typeof navigator !== "undefined" && "share" in navigator ? (
              <button type="button" className={styles.secondaryButton} onClick={() => { void navigator.share({ title: "MOTOCAST 공유 폴더 초대", url: inviteUrl(created.token) }).catch(() => undefined); }}>공유하기</button>
            ) : null}
          </div>
          <p className={styles.helper}>이 화면을 닫으면 이 링크 주소는 다시 볼 수 없어요. 잃어버리면 회수하고 새로 만드세요.</p>
        </div>
        <div className={styles.waypointFooter}><button type="button" className="primary-button" onClick={() => setCreated(null)}>완료</button></div>
      </SavedDialog>
    );
  }
  return (
    <SavedDialog title="초대 링크" onBack={onClose} onClose={onClose} fullScreen>
      <div className={`${styles.waypointBody} ${styles.formBody}`}>
        <p className={styles.helper}>링크를 받은 사람은 로그인한 뒤 이 폴더에 들어올 수 있어요. 링크는 만든 뒤 7일 동안 쓸 수 있어요.</p>
        <p className={styles.sectionCount}><strong>회원</strong><b className={styles.countNumber}>{members.length} / {PLACE_FOLDER_MEMBER_LIMIT}</b></p>
        {error ? <div className={styles.errorCard} role="alert"><strong>{error.title}</strong><p>{error.message}</p></div> : null}
        {state === "loading" && !invites ? (
          <div className={styles.stateCard} role="status"><strong>초대 링크를 불러오고 있어요</strong></div>
        ) : state === "error" ? (
          <div className={`${styles.stateCard} ${styles.errorState}`} role="alert"><strong>초대 링크를 불러오지 못했어요</strong><p>연결을 확인하고 다시 시도해 주세요.</p><button type="button" onClick={() => void load()}>다시 시도</button></div>
        ) : !invites?.length ? (
          <div className={styles.stateCard}><strong>사용 중인 초대 링크가 없어요</strong><p>새 초대 링크를 만들어 메신저로 보내 보세요.</p></div>
        ) : (
          <ul className={styles.list}>
            {invites.map((invite) => {
              const expiry = expiryLabel(invite.expiresAt);
              return (
                <li key={invite.id} className={styles.inviteCard}>
                  <p className={styles.inviteTitle}><LineIcon name="link" /><strong>초대 링크</strong><span className={styles.ownerChip}>사용 중</span></p>
                  <p className={styles.helper}>만료 <b className={styles.countNumber}>{expiry.at}</b> · {expiry.left} 남음</p>
                  <p className={styles.helper}>만든 시각 {dateTimeLabel(invite.createdAt)} · {owner?.displayName ?? "주인"}</p>
                  <button type="button" className={styles.dangerButton} onClick={() => revoke(invite)}>이 링크 회수</button>
                </li>
              );
            })}
          </ul>
        )}
        <p className={styles.noticeCard}>보안을 위해 링크 주소는 만들 때 한 번만 복사할 수 있어요. 다시 보내야 하면 새 링크를 만드세요.</p>
      </div>
      <div className={styles.waypointFooter}>
        <button type="button" className="primary-button" disabled={creating || state !== "ready" || full} onClick={() => void create()}>{creating ? "만드는 중…" : "새 초대 링크 만들기"}</button>
        {full ? <p className={styles.footerHint}>사용 중인 링크가 {PLACE_FOLDER_INVITE_LIMIT}개예요. 회수한 뒤 만들 수 있어요.</p> : null}
      </div>
      {pending ? <ConfirmPopup<FolderInvite[]> key={pending.key} pending={pending} busy={false} verifying={false} recheck={recheck} capture={() => () => true} onClose={() => setPending(null)} /> : null}
    </SavedDialog>
  );
}

/** G30 (owner) / G32 (member) with GP01–GP05 role changes and G31 removal. */
function Members({ folderId, onClose, onLeave, popup }: { folderId: string; onClose: () => void; onLeave: () => void; popup: React.ReactNode }) {
  const shared = useSharedFolders();
  const { open, close, popup: memberPopup, update } = useEditablePopup();
  const [done, setDone] = useState<{ memberId: string; text: string } | null>(null);
  const [rowMenu, setRowMenu] = useState<FolderMember | null>(null);
  const { snapshot } = shared;
  const me = snapshot.userId;
  const members = snapshot.members.filter((row) => row.folderId === folderId).sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : Date.parse(a.joinedAt) - Date.parse(b.joinedAt)));
  const mine = members.find((row) => row.memberId === me);
  const isOwner = mine?.role === "owner";
  const blocked = shared.busy || shared.status !== "ready";

  function rolePopup(target: FolderMember, choice: FolderRole | null, reloaded?: string) {
    const current = target.role;
    const selected = choice ?? current;
    const changed = selected !== current;
    const choose = (role: FolderRole) => update(rolePopup(target, role, reloaded));
    const label = (role: FolderRole) => (role === "editor" ? "편집 가능" : "보기만");
    return {
      title: `${target.displayName}님의 권한`,
      body: (
        <div className={styles.roleChoices} role="radiogroup" aria-label={`${target.displayName}님의 권한`}>
          {(["editor", "viewer"] as const).map((role) => (
            <label key={role} className={`${styles.roleChoice}${selected === role ? ` ${styles.roleChoiceOn}` : ""}`}>
              <input type="radio" name={`role-${target.memberId}`} checked={selected === role} onChange={() => choose(role)} />
              <span>
                <strong>{label(role)}{current === role ? <span className={styles.helperInline}> · 지금 권한</span> : null}</strong>
                <span>{role === "editor" ? "장소를 추가·수정·삭제할 수 있어요." : "장소를 보고 경로·식당 추천에 쓰고, 별표·기피 표시만 할 수 있어요. 폴더 장소는 바꿀 수 없어요."}</span>
              </span>
            </label>
          ))}
        </div>
      ),
      note: "바꾸면 바로 적용돼요. 언제든 다시 바꿀 수 있어요.",
      error: reloaded ? { title: "회원 정보가 바뀌어 다시 불러왔어요", message: reloaded } : undefined,
      confirm: {
        label: changed ? `${label(selected)}으로 바꾸기` : "바꿀 권한을 고르세요",
        retryLabel: "확인하고 바꾸기",
        busyLabel: "바꾸는 중…",
        disabled: !changed,
        checking: "권한이 바뀌었는지 확인하고 있어요",
        checkingMessage: "응답을 받지 못해 회원 목록을 다시 읽는 중이에요. 같은 요청을 다시 보내지 않아요.",
        notApplied: { title: "권한이 바뀌지 않았어요", message: `응답을 받지 못해 회원 목록을 다시 확인했지만 ${target.displayName}님은 아직 "${label(current as "editor" | "viewer")}"이에요. 다시 바꾸려면 "확인하고 바꾸기"를 눌러 주세요.` },
        run: async (): Promise<SharedWrite> => {
          const latest = shared.current().snapshot.members.find((row) => row.folderId === folderId && row.memberId === target.memberId);
          if (!latest) { close(); setDone({ memberId: target.memberId, text: `${target.displayName}님은 이미 폴더에서 나갔어요. 회원 목록을 새로 불러왔어요.` }); return { ok: false, reason: "blocked", title: "", message: "" }; }
          if (latest.revision !== target.revision) {
            update(rolePopup(latest, null, `${target.displayName}님의 권한이 다른 기기에서 먼저 "${permissionLabel(latest.role)}"으로 바뀌었어요. 지금 권한을 확인하고 필요하면 다시 골라 주세요.`));
            return { ok: false, reason: "blocked", title: "", message: "" };
          }
          const applied = (s: SharedSnapshot) => s.members.some((row) => row.folderId === folderId && row.memberId === target.memberId && row.role === selected);
          const write = await shared.write({
            rpc: "set_place_folder_member_role",
            args: { folder_id: folderId, member_id: target.memberId, expected_revision: latest.revision, role: selected },
            success: `${target.displayName}님을 "${label(selected)}"으로 바꿨어요.`,
            receipt: (data) => { const row = parseFolderMember(data); return (s) => s.members.some((m) => m.folderId === folderId && m.memberId === row.memberId && m.revision >= row.revision); },
            applied,
            unknownMessage: "권한이 바뀌었는지 확인하지 못했어요.",
            refusal: (code) => code === "PLACE_FOLDER_MEMBER_STALE" || code === "PLACE_FOLDER_MEMBER_NOT_FOUND"
              ? { reason: "rejected", stale: true, title: "회원 정보가 바뀌었어요", message: "최신 회원 목록을 불러왔어요." }
              : null,
          });
          if (write.ok) { setDone({ memberId: target.memberId, text: `${target.displayName}님을 "${label(selected)}"으로 바꿨어요.` }); return write; }
          if (write.reason === "rejected" && write.stale) {
            const fresh = shared.current().snapshot.members.find((row) => row.folderId === folderId && row.memberId === target.memberId);
            if (!fresh) { close(); setDone({ memberId: target.memberId, text: `${target.displayName}님은 이미 폴더에서 나갔어요. 회원 목록을 새로 불러왔어요.` }); return { ok: false, reason: "blocked", title: "", message: "" }; }
            update(rolePopup(fresh, null, `${target.displayName}님의 권한이 다른 기기에서 먼저 "${permissionLabel(fresh.role)}"으로 바뀌었어요. 지금 권한을 확인하고 필요하면 다시 골라 주세요.`));
            return { ok: false, reason: "blocked", title: "", message: "" };
          }
          return write;
        },
      },
    } satisfies Omit<Pending<SharedSnapshot>, "key">;
  }

  function removePopup(target: FolderMember): Omit<Pending<SharedSnapshot>, "key"> {
    const gone = (s: SharedSnapshot) => !s.members.some((row) => row.folderId === folderId && row.memberId === target.memberId);
    return {
      title: `${target.displayName}님을 내보낼까요?`,
      card: { eyebrow: `회원 · ${permissionLabel(target.role)}`, name: target.displayName, line: `${dateLabel(target.joinedAt)} 참여` },
      count: { label: "폴더 회원", value: `${members.length} → ${members.length - 1} / ${PLACE_FOLDER_MEMBER_LIMIT}` },
      note: "이 폴더를 더 볼 수 없게 되고, 이 폴더 장소에 표시한 별표도 빠져요. 이 회원이 추가·수정한 장소는 남고 \"나간 회원\"으로 표시돼요. 다시 들어오려면 새 초대 링크가 필요해요. 되돌릴 수 없어요.",
      confirm: {
        label: "내보내기",
        retryLabel: "확인하고 내보내기",
        busyLabel: "내보내는 중…",
        danger: true,
        checking: "내보냈는지 확인하고 있어요",
        notApplied: { title: "내보내지 않았어요", message: "회원 목록을 다시 확인했지만 아직 회원이에요. 다시 내보내려면 \"확인하고 내보내기\"를 눌러 주세요." },
        run: async () => {
          const latest = shared.current().snapshot.members.find((row) => row.folderId === folderId && row.memberId === target.memberId);
          if (!latest) return { ok: true };
          return shared.write({
            rpc: "remove_place_folder_member",
            args: { folder_id: folderId, member_id: target.memberId, expected_revision: latest.revision },
            success: `${target.displayName}님을 내보냈어요.`,
            receipt: () => gone,
            applied: gone,
            unknownMessage: "내보냈는지 확인했는데 아직 회원이에요.",
            refusal: (code) => code === "PLACE_FOLDER_MEMBER_STALE"
              ? { reason: "rejected", stale: true, title: "회원 정보가 바뀌었어요", message: "최신 회원 목록을 불러왔어요. 다시 내보낼 수 있어요." }
              : code === "PLACE_FOLDER_MEMBER_NOT_FOUND" ? { reason: "rejected", stale: true, title: "이미 나간 회원이에요", message: "회원 목록을 새로 불러왔어요." } : null,
          });
        },
      },
    };
  }

  return (
    <SavedDialog title={isOwner ? "회원·권한 관리" : "회원 보기"} onBack={onClose} onClose={onClose} fullScreen>
      <div className={`${styles.waypointBody} ${styles.formBody}`}>
        <p className={styles.sectionCount}><strong>회원</strong><b className={styles.countNumber}>{members.length} / {PLACE_FOLDER_MEMBER_LIMIT}</b></p>
        {done ? <p className={styles.noticeCard} role="status">{done.text}</p> : isOwner ? <p className={styles.noticeCard}>새로 들어온 회원은 &quot;편집 가능&quot;으로 시작해요. 회원마다 여기서 &quot;보기만&quot;으로 바꿀 수 있어요.</p> : null}
        <p className={styles.helper}>편집 가능: 장소 추가·수정·삭제<br />보기만: 보기·경로·식당 추천·별표·기피 표시만, 폴더 장소 변경 불가</p>
        <ul className={styles.memberList}>
          {members.map((member) => {
            const self = member.memberId === me;
            return (
              <li key={member.memberId} className={`${styles.memberRow}${done?.memberId === member.memberId ? ` ${styles.memberRowDone}` : ""}`}>
                <LineIcon name="person" />
                <span className={styles.memberText}>
                  <span><strong>{member.displayName}</strong>{member.role === "owner" ? <span className={styles.ownerChip}>주인</span> : null}</span>
                  <span>{member.role === "owner" ? `주인${self ? " · 나" : ""}` : `${dateLabel(member.joinedAt)} 참여${self ? " · 나" : ""}`}</span>
                </span>
                {isOwner && member.role !== "owner" ? (
                  <span className={styles.memberActions}>
                    <button type="button" className={styles.roleButton} aria-label={`${member.displayName}님 권한 ${permissionLabel(member.role)}, 바꾸기`} disabled={blocked} onClick={() => { setDone(null); open(rolePopup(member, null)); }}>{permissionLabel(member.role)}<LineIcon name="chevron-down" /></button>
                    <button type="button" className={styles.iconButton} aria-label={`${member.displayName}님 메뉴`} disabled={blocked} onClick={() => setRowMenu(member)}><LineIcon name="more-vertical" /></button>
                  </span>
                ) : (
                  <span className={member.role === "owner" ? styles.permissionPillStrong : styles.permissionPill}>{permissionLabel(member.role)}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {!isOwner ? <div className={styles.waypointFooter}><button type="button" className={styles.dangerButton} disabled={blocked} onClick={onLeave}>폴더 나가기</button></div> : null}
      {rowMenu ? (
        <SavedDialog title={rowMenu.displayName} onClose={() => setRowMenu(null)} sheet>
          <ul className={styles.menuList}>
            <li><button type="button" className={`${styles.menuRow} ${styles.menuDanger}`} onClick={() => { const target = rowMenu; setRowMenu(null); open(removePopup(target)); }}><LineIcon name="close" /><span><strong>내보내기</strong></span></button></li>
          </ul>
        </SavedDialog>
      ) : null}
      {memberPopup}
      {popup}
    </SavedDialog>
  );
}

/** A shared popup whose content can change while it stays open (GP01 choices, GP05 reload). */
function useEditablePopup() {
  const shared = useSharedFolders();
  const [pending, setPending] = useState<Pending<SharedSnapshot> | null>(null);
  const key = useRef(0);
  return {
    open: (next: Omit<Pending<SharedSnapshot>, "key">) => setPending({ ...next, key: ++key.current }),
    update: (next: Omit<Pending<SharedSnapshot>, "key">) => setPending((current) => (current ? { ...next, key: current.key } : current)),
    close: () => setPending(null),
    popup: pending ? <ConfirmPopup key={pending.key} pending={pending} busy={shared.busy} verifying={shared.verifying} recheck={shared.recheck} capture={shared.captureSnapshot} onClose={() => setPending(null)} /> : null,
  };
}

/** G34 / G35 / G36: my folder-only display name. */
function DisplayNameEdit({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const shared = useSharedFolders();
  const { open, close, popup } = useSharedPopup();
  const { snapshot } = shared;
  const folder = snapshot.folders.find((row) => row.id === folderId)!;
  const members = snapshot.members.filter((row) => row.folderId === folderId);
  const mine = members.find((row) => row.memberId === snapshot.userId)!;
  const [value, setValue] = useState(mine.displayName);
  const [taken, setTaken] = useState(false);
  const id = useId();
  const next = value.trim();
  const issue = nameProblem(value, FOLDER_DISPLAY_NAME_LIMIT);
  const duplicate = taken || members.some((row) => row.memberId !== mine.memberId && row.displayName.toLocaleLowerCase() === next.toLocaleLowerCase());
  const same = next === mine.displayName;
  function submit() {
    if (issue || duplicate || same) return;
    open({
      title: "폴더용 이름을 바꿀까요?",
      card: { eyebrow: `${folder.name} · 내 폴더용 이름`, name: next, line: "1~20자 · 이 폴더 안에서 겹치지 않음" },
      changes: [{ label: "폴더용 이름", before: mine.displayName, after: next }],
      note: `${folder.name} 폴더 회원 ${members.length - 1}명에게 새 이름으로 보여요. 다른 폴더의 내 이름은 그대로예요.`,
      confirm: {
        label: "확인하고 바꾸기",
        busyLabel: "바꾸는 중…",
        checking: "이름이 바뀌었는지 확인하고 있어요",
        notApplied: { title: "이름이 바뀌지 않았어요", message: "회원 목록을 다시 확인했지만 이름이 그대로예요. 다시 바꾸려면 \"확인하고 바꾸기\"를 눌러 주세요." },
        run: async () => {
          const latest = shared.current().snapshot.members.find((row) => row.folderId === folderId && row.memberId === mine.memberId);
          if (!latest) return { ok: false, reason: "rejected", title: "폴더를 찾지 못했어요", message: "폴더가 삭제됐거나 더 볼 수 없어요." };
          const applied = (s: SharedSnapshot) => s.members.some((row) => row.folderId === folderId && row.memberId === mine.memberId && row.displayName === next);
          const write = await shared.write({
            rpc: "set_place_folder_display_name",
            args: { folder_id: folderId, expected_revision: latest.revision, display_name: next },
            success: "폴더용 이름을 바꿨어요.",
            receipt: (data) => { const row = parseFolderMember(data); return (s) => s.members.some((m) => m.folderId === folderId && m.memberId === row.memberId && m.revision >= row.revision); },
            applied,
            unknownMessage: "이름이 바뀌었는지 확인하지 못했어요.",
            refusal: (code) => code === "FOLDER_DISPLAY_NAME_TAKEN"
              ? { reason: "rejected", title: "같은 이름이 있어요", message: "이 폴더에 이미 같은 이름이 있어요. 다른 이름을 입력해 주세요." }
              : code === "PLACE_FOLDER_MEMBER_STALE" ? { reason: "rejected", stale: true, title: "다른 기기에서 먼저 바뀌었어요", message: "최신 이름을 불러왔어요. 다시 시도해 주세요." } : null,
          });
          if (write.ok) onClose();
          return write;
        },
        onApplied: onClose,
        finalOnRefusal: (write) => (write.title === "같은 이름이 있어요" ? [{ label: "이름 고치기", primary: true, onClick: () => { close(); setTaken(true); } }] : null),
      },
    });
  }
  return (
    <SavedDialog title="내 폴더용 이름" onBack={onClose} onClose={onClose} fullScreen>
      <div className={`${styles.waypointBody} ${styles.formBody}`}>
        <p className={styles.helper}>{folder.name} 폴더</p>
        <div className={styles.textFieldGroup}>
          <label className={styles.fieldLabel} htmlFor={id}>내 이름</label>
          <input id={id} className={`${styles.textField}${issue === "long" || duplicate || (issue && value !== mine.displayName) ? ` ${styles.invalidInput}` : ""}`} value={value} maxLength={40} onChange={(e) => { setValue(e.target.value); setTaken(false); }} aria-invalid={Boolean(duplicate || issue) || undefined} aria-describedby={`${id}-hint`} />
          <p id={`${id}-hint`} className={duplicate || issue ? styles.fieldError : styles.helper} role={duplicate || issue ? "alert" : undefined}>
            {duplicate ? "이 폴더에 이미 같은 이름이 있어요. 다른 이름을 입력해 주세요." : issue === "empty" ? "이름을 입력해 주세요. 1~20자" : issue === "long" ? `${FOLDER_DISPLAY_NAME_LIMIT}자 이하로 줄여 주세요. 지금 ${[...next].length}자` : issue ? "쓸 수 없는 문자가 있어요." : `${[...next].length} / ${FOLDER_DISPLAY_NAME_LIMIT}`}
          </p>
        </div>
        <p className={styles.helper}>이 폴더의 회원 목록과 장소의 &quot;마지막 수정&quot; 표시가 새 이름으로 바뀌어요. 다른 폴더의 이름은 그대로예요. 카카오 닉네임은 쓰이지 않아요.</p>
      </div>
      <div className={styles.waypointFooter}><button type="button" className="primary-button" disabled={Boolean(issue) || duplicate || same || shared.busy} onClick={submit}>이름 저장</button></div>
      {popup}
    </SavedDialog>
  );
}

/** G37 / G37b: the owner renames the folder. */
function FolderRename({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const shared = useSharedFolders();
  const { open, popup } = useSharedPopup();
  const { snapshot } = shared;
  const folder = snapshot.folders.find((row) => row.id === folderId)!;
  const [value, setValue] = useState(folder.name);
  const id = useId();
  const next = value.trim();
  const issue = nameProblem(value, FOLDER_NAME_LIMIT);
  const same = next === folder.name;
  const places = snapshot.places.filter((row) => row.folderId === folderId).length;
  const members = snapshot.members.filter((row) => row.folderId === folderId).length;
  function submit() {
    if (issue || same) return;
    open({
      title: "폴더 이름을 바꿀까요?",
      card: { eyebrow: "공유 폴더 · 주인", line: `회원 ${members}명 · 장소 ${places.toLocaleString()}` },
      changes: [{ label: "폴더 이름", before: folder.name, after: next }],
      note: "회원 모두에게 새 이름으로 보여요. 초대 링크와 장소는 그대로예요.",
      confirm: {
        label: "확인하고 바꾸기",
        busyLabel: "바꾸는 중…",
        checking: "이름이 바뀌었는지 확인하고 있어요",
        notApplied: { title: "이름이 바뀌지 않았어요", message: "폴더를 다시 확인했지만 이름이 그대로예요. 다시 바꾸려면 \"확인하고 바꾸기\"를 눌러 주세요." },
        run: async () => {
          const latest = shared.current().snapshot.folders.find((row) => row.id === folderId);
          if (!latest) return { ok: false, reason: "rejected", title: "폴더를 찾지 못했어요", message: "폴더가 삭제됐어요." };
          const write = await shared.write({
            rpc: "rename_place_folder",
            args: { folder_id: folderId, expected_revision: latest.revision, folder_name: next },
            success: "폴더 이름을 바꿨어요.",
            receipt: (data) => { if (!Array.isArray(data) || data.length !== 1) throw new Error("NO_RECEIPT"); const row = parsePlaceFolder(data[0]); return (s) => s.folders.some((f) => f.id === row.id && f.revision >= row.revision); },
            applied: (s) => s.folders.some((f) => f.id === folderId && f.name === next),
            unknownMessage: "이름이 바뀌었는지 확인하지 못했어요.",
          });
          if (write.ok) onClose();
          return write;
        },
        onApplied: onClose,
      },
    });
  }
  return (
    <SavedDialog title="폴더 이름 바꾸기" onBack={onClose} onClose={onClose} fullScreen>
      <div className={`${styles.waypointBody} ${styles.formBody}`}>
        <div className={styles.textFieldGroup}>
          <label className={styles.fieldLabel} htmlFor={id}>폴더 이름</label>
          <input id={id} className={`${styles.textField}${issue ? ` ${styles.invalidInput}` : ""}`} value={value} maxLength={80} onChange={(e) => setValue(e.target.value)} aria-invalid={Boolean(issue) || undefined} aria-describedby={`${id}-hint`} />
          <p id={`${id}-hint`} className={issue ? styles.fieldError : styles.helper} role={issue ? "alert" : undefined}>
            {issue === "empty" ? "폴더 이름을 입력해 주세요. 1~40자" : issue === "long" ? `${FOLDER_NAME_LIMIT}자 이하로 줄여 주세요. 지금 ${[...next].length}자` : issue ? "쓸 수 없는 문자가 있어요." : `${[...next].length} / ${FOLDER_NAME_LIMIT} · 회원 모두에게 바뀐 이름으로 보여요.`}
          </p>
        </div>
      </div>
      <div className={styles.waypointFooter}><button type="button" className="primary-button" disabled={Boolean(issue) || same || shared.busy} onClick={submit}>이름 저장</button></div>
      {popup}
    </SavedDialog>
  );
}
