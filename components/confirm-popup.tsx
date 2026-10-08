"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LineIcon } from "@/components/line-icon";
import styles from "./saved-places-manager.module.css";

/**
 * Outcome of one confirmed write (Figma memo 392:10916, decision "option A"):
 * - ok: committed (or the re-read list already shows it).
 * - rejected: the server refused with a known code; the input stays and the rider may confirm again.
 * - star_limit: an 11th star; the list was re-read (FP03).
 * - unknown: no readable result. `checked` says whether a fresh list was read; only then may the
 *   rider confirm one new request. Without it, `recheck` (read only) must succeed first.
 * - mismatch: the server returned a receipt but the list still disagrees after the fixed re-reads.
 *   The write is committed, so only `recheck` is allowed, never a resend.
 */
export type ConfirmWrite<T> =
  | { ok: true; id?: string; duplicate?: boolean }
  | {
      ok: false;
      reason: "rejected" | "star_limit" | "unknown" | "mismatch" | "blocked";
      title: string;
      message: string;
      checked?: boolean;
      stale?: boolean;
      recheck?: (list: T) => boolean;
    };
/** Outcome of a read-only recheck of an earlier write. */
export type Recheck = "applied" | "missing" | "unreadable";
/**
 * Buttons of information-only and final popups: the popup closes first, then `onClick` runs (it
 * may open the next popup). `danger` is the red destructive button (G04x "그만두기").
 */
export type PopupButton = { label: string; primary?: boolean; danger?: boolean; onClick: () => void };

/** Centered confirmation popup content (Figma FP29, FP29b, FP34–FP37, memo 392:10916; #124 UI-001). */
export type Pending<T> = {
  key: number;
  title: string;
  card?: {
    eyebrow?: string;
    region?: boolean;
    name?: string;
    line?: string;
    line2?: string;
    /** Source line with an icon: "내 장소" or "공유 · <folder>". */
    source?: { icon: "pin" | "folder"; text: string };
  };
  rows?: Array<{ label: string; value: string; count?: string }>;
  /** FP38: only the changed values, as before → after. */
  changes?: Array<{ label: string; before: string; after: string }>;
  count?: { label: string; value: string };
  /** Extra content such as choices (GP01) or a folder list (G00b). */
  body?: ReactNode;
  note?: string;
  /** Confirm action that sends one request; absent for information-only popups. */
  confirm?: {
    label: string;
    busyLabel: string;
    /** Label once a re-read proved the change missing (FP39b), e.g. "확인하고 삭제". */
    retryLabel?: string;
    danger?: boolean;
    disabled?: boolean;
    /** Second button; it only closes (G15 "지금 저장된 내용 유지"). */
    cancelLabel?: string;
    /** FP39a title while an unknown result is checked, e.g. "저장됐는지 확인하고 있어요". */
    checking: string;
    /** FP39a body; names the list that is re-read. */
    checkingMessage?: string;
    /** FP39b text when the re-read list does not show the change. */
    notApplied: { title: string; message: string };
    run: () => Promise<ConfirmWrite<T>>;
    /** Effects of a confirmed change, also used when a read-only recheck finds it applied. */
    onApplied?: () => void;
    /** A refusal that ends the flow (GP08, GI08): its own buttons replace confirm and cancel. */
    finalOnRefusal?: (write: ConfirmWrite<T> & { ok: false }) => PopupButton[] | null;
  };
  /** Information-only popups (FP36, duplicate save) replace confirm/cancel with these buttons. */
  buttons?: PopupButton[];
  error?: { title: string; message: string };
};

export function ConfirmPopup<T>({
  pending,
  busy,
  verifying,
  recheck,
  capture,
  onClose,
}: {
  pending: Pending<T>;
  busy: boolean;
  verifying: boolean;
  recheck: (applied: (list: T) => boolean) => Promise<Recheck>;
  capture: () => () => boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const started = useRef(false);
  const mounted = useRef(false);
  const [snapshot, setSnapshot] = useState(() => capture());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ title: string; message: string; retry?: boolean; again?: boolean } | null>(pending.error ?? null);
  const [final, setFinal] = useState<PopupButton[] | null>(null);
  // Unknown without a readable list, or a receipt the list does not show yet: only reading is allowed.
  const [readOnly, setReadOnly] = useState<{ check: (list: T) => boolean; mismatch: boolean } | null>(null);
  const [rechecking, setRechecking] = useState(false);
  useEffect(() => {
    mounted.current = true;
    const focus = document.activeElement;
    ref.current?.showModal();
    return () => {
      mounted.current = false;
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    };
  }, []);
  const valid = snapshot();
  function close() { if (!running) onClose(); }
  async function confirm() {
    const action = pending.confirm;
    if (!action || started.current || busy || !snapshot()) return;
    started.current = true;
    setRunning(true);
    setError(null);
    try {
      const write = await action.run();
      if (!mounted.current) return;
      if (write.ok) onClose();
      else if ((write.reason === "unknown" && !write.checked) || write.reason === "mismatch") {
        setError({ title: write.title, message: write.message });
        setReadOnly(write.recheck ? { check: write.recheck, mismatch: write.reason === "mismatch" } : null);
      } else if (write.reason !== "blocked" || write.message) {
        const ending = write.reason === "rejected" || write.reason === "star_limit" ? action.finalOnRefusal?.(write) : null;
        if (ending) {
          setError({ title: write.title, message: write.message });
          setFinal(ending);
          return;
        }
        // FP39b: the list was re-read without the change, so the same confirm sends one new
        // request with the newest revision. FP39c: a clear refusal can be retried right away.
        setError(write.reason === "unknown" ? { ...action.notApplied, again: true } : { title: write.title, message: write.message, retry: true });
        setSnapshot(() => capture());
      }
    } catch {
      if (mounted.current) setError({ title: "변경을 확인하지 못했어요", message: "목록을 확인한 뒤 다시 시도해 주세요." });
    } finally {
      started.current = false;
      if (mounted.current) setRunning(false);
    }
  }
  async function readAgain() {
    const action = pending.confirm;
    if (!action || !readOnly || started.current || busy) return;
    started.current = true;
    setRunning(true);
    setRechecking(true);
    try {
      const result = await recheck(readOnly.check);
      if (!mounted.current) return;
      if (result === "applied") {
        action.onApplied?.();
        onClose();
      } else if (result === "missing" && !readOnly.mismatch) {
        // The list now proves the change is missing, so one new request may be confirmed.
        setReadOnly(null);
        setError({ ...action.notApplied, again: true });
        setSnapshot(() => capture());
      } else {
        setError(result === "missing"
          ? { title: "목록에서 변경을 확인하지 못했어요", message: "변경 요청은 접수됐지만 최신 목록에 아직 보이지 않아요. 같은 요청은 다시 보내지 않아요. 잠시 뒤 목록을 다시 확인해 주세요." }
          : { title: "목록을 확인하지 못했어요", message: "변경됐는지 아직 몰라요. 목록을 다시 확인한 뒤에 다시 시도할 수 있어요." });
      }
    } finally {
      started.current = false;
      if (mounted.current) { setRunning(false); setRechecking(false); }
    }
  }
  const card = pending.card;
  return (
    <dialog
      ref={ref}
      className={styles.popup}
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); e.stopPropagation(); close(); }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className={styles.popupHeader}>
        <h2 id={titleId}>{pending.title}</h2>
        {/* UI-001: popups show a close X; it only closes, and is locked while a request runs. */}
        <button type="button" className={styles.popupClose} aria-label="닫기" disabled={running} onClick={close}><LineIcon name="close" /></button>
      </div>
      {card ? (
        <div className={styles.popupCard}>
          {card.eyebrow ? <span className={styles.placeKind}>{card.eyebrow}{card.region ? <span className={styles.chip}>상세 주소 없음</span> : null}</span> : null}
          {card.name ? <strong>{card.name}</strong> : null}
          {card.line ? <span>{card.line}</span> : null}
          {card.line2 ? <span>{card.line2}</span> : null}
          {card.source ? <span className={styles.sourceLine}><LineIcon name={card.source.icon} />{card.source.text}</span> : null}
        </div>
      ) : null}
      {pending.changes?.map((change) => (
        <div key={change.label} className={styles.popupChange}>
          <span>{change.label}</span>
          <p><del>{change.before}</del><span aria-hidden="true"> → </span><span className={styles.srOnly}>에서 </span><b>{change.after}</b></p>
        </div>
      ))}
      {pending.rows ? (
        <dl className={styles.popupRows}>
          {pending.rows.map((row) => (
            <div key={row.label}><dt>{row.label}</dt><dd>{row.value}{row.count ? <b className={styles.countNumber}>{row.count}</b> : null}</dd></div>
          ))}
        </dl>
      ) : null}
      {pending.count ? <p className={styles.popupCount}><span>{pending.count.label}</span><b className={styles.countNumber}>{pending.count.value}</b></p> : null}
      {pending.body}
      {/* FP39a–c replace the note with the checking or failure card. */}
      {pending.note && !error && !(running && (verifying || rechecking)) ? <p className={styles.helper}>{pending.note}</p> : null}
      {!valid && !running && !final && pending.confirm ? <p role="alert" className={styles.fieldError}>목록이나 계정이 바뀌었어요. 닫고 최신 장소를 다시 선택해 주세요.</p> : null}
      {running && (verifying || rechecking) && pending.confirm ? (
        <div className={styles.popupChecking} role="status">
          <strong>{pending.confirm.checking}</strong>
          <p>{rechecking ? "목록을 다시 읽는 중이에요. 같은 요청을 다시 보내지 않아요." : pending.confirm.checkingMessage ?? "응답을 받지 못해 목록을 다시 읽는 중이에요. 같은 요청을 다시 보내지 않아요."}</p>
          <span className={styles.progress} aria-hidden="true"><span /></span>
        </div>
      ) : error ? <div className={styles.errorCard} role="alert"><strong>{error.title}</strong><p>{error.message}</p></div> : null}
      <div className={styles.popupActions}>
        {final ? final.map((button) => (
          <button key={button.label} type="button" className={button.danger ? styles.destructiveButton : button.primary ? "primary-button" : styles.secondaryButton} onClick={() => { onClose(); button.onClick(); }}>{button.label}</button>
        )) : pending.confirm ? (
          <>
            {readOnly ? (
              <button type="button" className="primary-button" disabled={busy || running} onClick={() => void readAgain()}>
                {running ? "확인 중…" : "목록 다시 확인"}
              </button>
            ) : (
              <button
                type="button"
                className={pending.confirm.danger ? styles.destructiveButton : "primary-button"}
                disabled={busy || running || !valid || Boolean(pending.confirm.disabled)}
                onClick={() => void confirm()}
              >
                {running ? (verifying ? "확인 중…" : pending.confirm.busyLabel) : error?.retry ? "다시 시도" : error?.again && pending.confirm.retryLabel ? pending.confirm.retryLabel : pending.confirm.label}
              </button>
            )}
            <button type="button" className={styles.secondaryButton} disabled={running} onClick={close}>{pending.confirm.cancelLabel ?? "취소"}</button>
          </>
        ) : (pending.buttons ?? []).map((button) => (
          <button key={button.label} type="button" className={button.danger ? styles.destructiveButton : button.primary ? "primary-button" : styles.secondaryButton} onClick={() => { onClose(); button.onClick(); }}>{button.label}</button>
        ))}
      </div>
    </dialog>
  );
}
