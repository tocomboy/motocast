"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { LineIcon } from "@/components/line-icon";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { withClientTimeout } from "@/lib/planner/client-timeout";
import {
  captureInviteFragment,
  consumePendingInvite,
  INVITE_PATH,
  OPEN_FOLDER_STORAGE_KEY,
  savePendingInvite,
  type InviteCapture,
} from "@/lib/places/folder-invite-token";
import {
  FOLDER_DISPLAY_NAME_LIMIT,
  nameProblem,
  parseFolderMember,
  parseInvitePreview,
  PLACE_FOLDER_MEMBER_LIMIT,
  serverCode,
  type InvitePreview,
} from "@/lib/places/shared-folders";
import styles from "./folder-invite.module.css";

/*
 * The fragment is moved into memory when this module is first evaluated in the browser, before
 * React renders, before the Supabase client exists and before any request (contract §8).
 * A later `#t=` on the same page (hashchange) is captured the same way.
 */
let captured: InviteCapture | null =
  typeof window !== "undefined" && window.location.pathname === INVITE_PATH ? captureInviteFragment(window) : null;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  const onHash = () => {
    if (window.location.pathname !== INVITE_PATH || !window.location.hash) return;
    captured = captureInviteFragment(window);
    listeners.forEach((notify) => notify());
  };
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("hashchange", onHash);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("hashchange", onHash);
  };
}

type View =
  | { step: "checking" }
  | { step: "cleanup-failed" }
  | { step: "missing" }
  | { step: "login"; storageFailed?: boolean }
  | { step: "membership" }
  | { step: "invalid" }
  | { step: "unavailable" }
  | { step: "join"; preview: InvitePreview; error?: string; busy?: boolean; lost?: boolean }
  | { step: "member"; preview: InvitePreview }
  | { step: "full"; preview: InvitePreview; reason: "mine" | "folder" };

const sessionStore = () => window.sessionStorage;
const RPC_TIMEOUT_MS = 15_000;

async function rpc(name: string, args: Record<string, unknown>) {
  const client = getBrowserSupabase();
  if (!client) return { data: null, code: "UNAVAILABLE", lost: false };
  try {
    const { data, error } = await withClientTimeout<{ data: unknown; error: { message: string } | null }>(client.rpc(name, args), RPC_TIMEOUT_MS);
    if (error) { const code = serverCode(error.message); return { data: null, code, lost: !code }; }
    return { data, code: null, lost: false };
  } catch {
    return { data: null, code: null, lost: true };
  }
}

/**
 * Folder invite (Figma G23–G28 381:12085–381:12210, GW02 385:12473, GS01 385:12509).
 * Before login the folder name and owner are never requested or shown.
 */
export function FolderInvite() {
  const capture = useSyncExternalStore(subscribe, () => captured, () => null);
  const token = useRef<string | null>(null);
  const [view, setView] = useState<View>({ step: "checking" });
  const [name, setName] = useState("");
  const nameId = useId();
  const sequence = useRef(0);
  const router = useRouter();

  useEffect(() => {
    const attempt = ++sequence.current;
    let cancelled = false;
    const set = (next: View) => { if (!cancelled && attempt === sequence.current) setView(next); };
    void (async () => {
      if (!capture) return;
      if (capture.status === "cleanup-failed") { token.current = null; set({ step: "cleanup-failed" }); return; }
      if (capture.status === "invalid") { token.current = null; set({ step: "invalid" }); return; }
      if (capture.status === "token") token.current = capture.token;
      else {
        // No fragment: the login return, if any. Read once and removed at the same time.
        token.current = token.current ?? consumePendingInvite(sessionStore);
      }
      if (!token.current) { set({ step: "missing" }); return; }
      const client = getBrowserSupabase();
      if (!client) { set({ step: "login" }); return; }
      const { data } = await client.auth.getSession();
      if (!data.session) { set({ step: "login" }); return; }
      const result = await rpc("preview_place_folder_invite", { token: token.current });
      if (result.code === "PLACE_FOLDER_INVITE_INVALID") { set({ step: "invalid" }); return; }
      if (result.code === "MEMBERSHIP_REQUIRED") { set({ step: "membership" }); return; }
      if (result.code || result.lost) { set({ step: "unavailable" }); return; }
      try {
        const preview = parseInvitePreview(result.data);
        set(preview.status === "already_member" ? { step: "member", preview } : { step: "join", preview });
      } catch {
        set({ step: "unavailable" });
      }
    })();
    return () => { cancelled = true; };
  }, [capture]);

  function loginAndContinue() {
    const value = token.current;
    if (!value) { setView({ step: "missing" }); return; }
    // Same-tab navigation only; no new window copies the session storage.
    if (!savePendingInvite(sessionStore, value)) { setView({ step: "login", storageFailed: true }); return; }
    router.push("/login");
  }

  function openFolder(folderId: string | null) {
    try { if (folderId) window.sessionStorage.setItem(OPEN_FOLDER_STORAGE_KEY, folderId); } catch { /* the list opens instead */ }
    router.push("/#favorites");
  }

  async function join(preview: InvitePreview) {
    const value = token.current;
    const problem = nameProblem(name, FOLDER_DISPLAY_NAME_LIMIT);
    if (!value || problem) return;
    setView({ step: "join", preview, busy: true });
    const result = await rpc("accept_place_folder_invite", { token: value, display_name: name.trim() });
    if (!result.code && !result.lost) {
      try {
        const body = result.data as { status?: unknown; member?: unknown };
        const member = parseFolderMember(body.member);
        token.current = null;
        openFolder(member.folderId);
        return;
      } catch {
        // A reply that is not a receipt: check below like a lost reply.
      }
    }
    if (result.code === "FOLDER_DISPLAY_NAME_TAKEN") { setView({ step: "join", preview, error: "이 폴더에 이미 같은 이름이 있어요. 다른 이름을 입력해 주세요." }); return; }
    if (result.code === "INVALID_FOLDER_DISPLAY_NAME") { setView({ step: "join", preview, error: "1~20자로 입력해 주세요. 앞뒤 공백과 특수 제어 문자는 쓸 수 없어요." }); return; }
    if (result.code === "PLACE_FOLDER_LIMIT") { setView({ step: "full", preview, reason: "mine" }); return; }
    if (result.code === "PLACE_FOLDER_MEMBER_LIMIT") { setView({ step: "full", preview, reason: "folder" }); return; }
    if (result.code === "PLACE_FOLDER_INVITE_INVALID") { setView({ step: "invalid" }); return; }
    // Unknown result: read again instead of sending the join twice (FP39).
    const check = await rpc("preview_place_folder_invite", { token: value });
    try {
      const fresh = check.code || check.lost ? null : parseInvitePreview(check.data);
      if (fresh?.status === "already_member") { token.current = null; openFolder(fresh.folderId); return; }
      setView({ step: "join", preview: fresh ?? preview, lost: true, error: fresh ? "참여되지 않았어요. 다시 참여하려면 \"참여하기\"를 눌러 주세요." : "참여됐는지 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요." });
    } catch {
      setView({ step: "join", preview, lost: true, error: "참여됐는지 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요." });
    }
  }

  const close = <Link className={styles.close} href="/" aria-label="초대 화면 닫기"><LineIcon name="close" /></Link>;
  const summary = (preview: InvitePreview) => (
    <div className={styles.folderCard}>
      <p className={styles.folderName}><LineIcon name="folder" /><strong>{preview.folderName}</strong></p>
      <p className={styles.meta}>회원 <b className={styles.number}>{preview.memberCount} / {PLACE_FOLDER_MEMBER_LIMIT}</b></p>
      <p className={styles.meta}>주인 · {preview.ownerDisplayName}</p>
    </div>
  );
  const problem = nameProblem(name, FOLDER_DISPLAY_NAME_LIMIT);
  const length = [...name.trim()].length;
  let body: React.ReactNode;
  let actions: React.ReactNode = null;
  switch (view.step) {
    case "checking":
      body = <div className={styles.card} role="status" aria-busy="true"><p className={styles.meta}>초대 링크를 확인하고 있어요.</p></div>;
      break;
    case "cleanup-failed":
      body = <div className={styles.errorCard} role="alert"><strong>초대 링크를 열지 못했어요</strong><p>주소에서 초대 정보를 지우지 못해 안전을 위해 아무것도 보내지 않았어요. 받은 링크를 다시 열어 주세요.</p></div>;
      actions = <Link className={styles.secondary} href="/">홈으로</Link>;
      break;
    case "missing":
      body = <div className={styles.card}><LineIcon name="folder" /><strong>초대 링크를 다시 열어 주세요</strong><p>로그인한 뒤 받은 초대 링크를 다시 열면 참여할 수 있어요. 초대 정보는 이 화면을 떠나면 남지 않아요.</p></div>;
      actions = <Link className={styles.secondary} href="/#favorites">즐겨찾기로 가기</Link>;
      break;
    case "login":
      body = view.storageFailed
        ? <div className={styles.errorCard} role="alert"><strong>로그인한 뒤 링크를 다시 열어 주세요</strong><p>이 브라우저에서 초대 정보를 잠시 보관하지 못했어요. 먼저 로그인한 다음 받은 초대 링크를 다시 열어 주세요.</p></div>
        : <div className={styles.card}><LineIcon name="folder" /><strong>공유 폴더에 초대받았어요</strong><p>로그인하면 어떤 폴더인지 확인하고 참여할 수 있어요. 로그인 전에는 폴더 내용을 보여 주지 않아요.</p></div>;
      actions = view.storageFailed
        ? <Link className={styles.primary} href="/login">로그인하기</Link>
        : <><button type="button" className={styles.primary} onClick={loginAndContinue}>로그인하고 계속</button><p className={styles.hint}>로그인한 뒤 이 초대 화면으로 돌아와요.</p></>;
      break;
    case "membership":
      body = <div className={styles.errorCard} role="alert"><strong>앱에서 먼저 가입해 주세요</strong><p>MOTOCAST 회원만 공유 폴더에 참여할 수 있어요. Google Play의 MOTOCAST 앱에서 카카오 로그인으로 가입한 뒤 링크를 다시 열어 주세요.</p></div>;
      actions = <Link className={styles.secondary} href="/login">로그인 화면으로</Link>;
      break;
    case "invalid":
      body = <div className={styles.card}><LineIcon name="folder" /><strong>이 초대 링크는 쓸 수 없어요</strong><p>만든 지 7일이 지났거나 주인이 회수한 링크예요. 폴더 주인에게 새 링크를 요청해 주세요.</p></div>;
      actions = <Link className={styles.secondary} href="/#favorites">즐겨찾기로 가기</Link>;
      break;
    case "unavailable":
      body = <div className={styles.errorCard} role="alert"><strong>초대 정보를 확인하지 못했어요</strong><p>연결을 확인한 뒤 받은 링크를 다시 열어 주세요.</p></div>;
      actions = <Link className={styles.secondary} href="/#favorites">즐겨찾기로 가기</Link>;
      break;
    case "member":
      body = <>{summary(view.preview)}<p className={styles.text}>이미 참여한 폴더예요.</p></>;
      actions = <button type="button" className={styles.primary} onClick={() => openFolder(view.preview.folderId)}>폴더 열기</button>;
      break;
    case "full":
      body = <>{summary(view.preview)}<div className={styles.errorCard} role="alert">{view.reason === "mine"
        ? <><strong>내 공유 폴더 20개가 모두 찼어요</strong><p>쓰지 않는 폴더에서 나가거나 내가 만든 폴더를 삭제한 뒤 다시 링크를 열어 주세요.</p></>
        : <><strong>이 폴더의 회원 30명이 모두 찼어요</strong><p>폴더 주인에게 알려 주세요. 자리가 나면 같은 링크로 다시 참여할 수 있어요(링크가 만료되기 전까지).</p></>}</div></>;
      actions = <Link className={styles.secondary} href="/#favorites">즐겨찾기로 가기</Link>;
      break;
    case "join": {
      const shownError = view.error ?? (problem === "long" ? `${FOLDER_DISPLAY_NAME_LIMIT}자 이하로 줄여 주세요. 지금 ${length}자` : problem === "invalid" ? "쓸 수 없는 문자가 있어요." : "");
      body = (
        <>
          {summary(view.preview)}
          <p className={styles.text}>참여하면 &quot;편집 가능&quot; 권한으로 시작해 장소를 함께 추가·수정·삭제할 수 있어요. 주인이 회원 관리에서 &quot;보기만&quot;으로 바꿀 수 있어요. 별표와 기피 표시는 나에게만 적용돼요.</p>
          <label className={styles.label} htmlFor={nameId}>이 폴더에서 쓸 내 이름 (필수)</label>
          <input
            id={nameId}
            className={`${styles.input}${shownError ? ` ${styles.invalid}` : ""}`}
            value={name}
            maxLength={40}
            placeholder="예: 주말라이더"
            disabled={view.busy}
            aria-invalid={Boolean(shownError) || undefined}
            aria-describedby={`${nameId}-hint`}
            onChange={(e) => { setName(e.target.value); if (view.error && !view.lost) setView({ step: "join", preview: view.preview }); }}
          />
          <p id={`${nameId}-hint`} className={shownError ? styles.error : styles.hint} role={shownError ? "alert" : undefined}>
            {shownError || (name ? `${length} / ${FOLDER_DISPLAY_NAME_LIMIT} · 이 폴더 회원에게만 보여요. 카카오 닉네임은 보이지 않아요.` : "이 폴더 회원에게만 보여요. 1~20자, 카카오 닉네임은 보이지 않아요.")}
          </p>
        </>
      );
      actions = (
        <>
          <button type="button" className={styles.primary} disabled={view.busy || Boolean(problem)} onClick={() => void join(view.preview)}>{view.busy ? "참여하는 중…" : "참여하기"}</button>
          <Link className={styles.secondary} href="/" aria-disabled={view.busy || undefined} onClick={(e) => { if (view.busy) e.preventDefault(); }}>참여하지 않기</Link>
        </>
      );
      break;
    }
  }
  return (
    <div className={styles.page}>
      <header className={styles.siteHeader}>
        <Link className={styles.brand} href="/" aria-label="MOTOCAST 홈">MOTOCAST</Link>
        <nav className={styles.siteNav} aria-label="주요 화면"><Link href="/">홈</Link><Link href="/#editor">새 경로 만들기</Link><Link href="/#collections">저장한 경로</Link></nav>
      </header>
      <main className={styles.main}>
        <section className={styles.panel} aria-labelledby={`${nameId}-title`}>
          <div className={styles.heading}>
            <h1 id={`${nameId}-title`}>공유 폴더 초대</h1>
            {close}
          </div>
          <div className={styles.body}>{body}</div>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </section>
      </main>
    </div>
  );
}
