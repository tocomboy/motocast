"use client";

import { LineIcon } from "@/components/line-icon";
import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./saved-places-manager.module.css";

export function SavedDialog({
  title,
  onClose,
  onBack,
  children,
  locked = false,
  fullScreen = false,
  accessibleTitle = title,
  wide = false,
  sheet = false,
}: {
  title: string;
  onClose: () => void;
  /** Shows a back arrow before the title (Figma FP02, FP20, FP26). */
  onBack?: () => void;
  children: ReactNode;
  locked?: boolean;
  fullScreen?: boolean;
  accessibleTitle?: string;
  /** Two-column registration layout on desktop (Figma FPW02, FPW03). */
  wide?: boolean;
  /** Bottom sheet for a short list of choices (#124 G11, G12, GI01). */
  sheet?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const focus = document.activeElement;
    ref.current?.showModal();
    return () => {
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`${styles.dialog}${fullScreen ? ` ${styles.fullScreen}` : ""}${wide ? ` ${styles.wideDialog}` : ""}${sheet ? ` ${styles.sheet}` : ""}`}
      aria-labelledby={fullScreen ? undefined : id}
      aria-label={fullScreen ? accessibleTitle : undefined}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (locked) return;
        if (onBack) onBack();
        else onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={sheet ? (e) => { if (e.target === e.currentTarget && !locked) onClose(); } : undefined}
    >
      <header>
        {onBack ? (
          <button type="button" className={styles.backButton} aria-label={`${accessibleTitle} 뒤로`} disabled={locked} onClick={onBack}>
            <LineIcon name="chevron-left" />
          </button>
        ) : null}
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          aria-label={`${accessibleTitle} 닫기`}
          disabled={locked}
          onClick={onClose}
        >
          <LineIcon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
