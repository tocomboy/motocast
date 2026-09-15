"use client";

import Link from "next/link";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

import { currentVersion, releaseNotes } from "@/lib/releases";

import styles from "./release-announcement.module.css";

type ClaimOutcome = "hide" | "show" | "stale";
type AnnouncementState = "checking" | "dismissed" | "error" | "show" | "stale";

const currentRelease = releaseNotes[0];

async function claimAnnouncement(presentationId: string): Promise<ClaimOutcome> {
  const response = await fetch("/api/releases/claim", {
    body: JSON.stringify({ expectedVersion: currentVersion, presentationId }),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if ([204, 401, 403].includes(response.status)) return "hide";
  if (response.status === 409) return "stale";
  if (!response.ok) throw new Error("release claim failed");

  const body = await response.json() as { show?: unknown; version?: unknown };
  if (typeof body.show !== "boolean" || body.version !== currentVersion) {
    throw new Error("invalid release claim response");
  }
  return body.show ? "show" : "hide";
}

export function ReleaseAnnouncement() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mountedRef = useRef(false);
  const presentationIdRef = useRef<string | null>(null);
  const requestRef = useRef<Promise<ClaimOutcome> | null>(null);
  const [state, setState] = useState<AnnouncementState>("checking");

  const claim = useCallback(() => {
    if (!presentationIdRef.current) {
      presentationIdRef.current = crypto.randomUUID();
    }
    if (!requestRef.current) {
      requestRef.current = claimAnnouncement(presentationIdRef.current).catch((error: unknown) => {
        requestRef.current = null;
        throw error;
      });
    }
    return requestRef.current;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void claim().then(
      (outcome) => {
        if (mountedRef.current) {
          setState(outcome === "show" ? "show" : outcome === "stale" ? "stale" : "dismissed");
        }
      },
      () => {
        if (mountedRef.current) setState("error");
      },
    );
    return () => {
      mountedRef.current = false;
    };
  }, [claim]);

  useEffect(() => {
    if (state === "show" && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, [state]);

  const retry = () => {
    setState("checking");
    void claim().then(
      (outcome) => {
        if (mountedRef.current) {
          setState(outcome === "show" ? "show" : outcome === "stale" ? "stale" : "dismissed");
        }
      },
      () => {
        if (mountedRef.current) setState("error");
      },
    );
  };
  const close = () => dialogRef.current?.close();
  const keepFocusInside = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]"));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <dialog
        aria-labelledby="release-announcement-title"
        className={styles.dialog}
        onCancel={() => setState("dismissed")}
        onClose={() => setState("dismissed")}
        onKeyDown={keepFocusInside}
        ref={dialogRef}
      >
        <div className={styles.dialogBody}>
          <button className={styles.close} type="button" aria-label="업데이트 소식 닫기" onClick={close}>×</button>
          <p className={styles.version}>현재 v{currentVersion}</p>
          <h2 id="release-announcement-title">새로운 소식을 확인해 보세요</h2>
          <p className={styles.summary}>{currentRelease.summary}</p>
          <ul>
            {currentRelease.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
          </ul>
          <div className={styles.actions}>
            <button className={styles.confirm} type="button" onClick={close}>확인했어요</button>
            <Link href="/updates" onClick={close}>자세히 보기</Link>
          </div>
        </div>
      </dialog>

      {state === "error" ? (
        <aside className={styles.error} role="status">
          <span>업데이트 소식을 불러오지 못했습니다.</span>
          <button type="button" onClick={retry}>다시 시도</button>
          <Link href="/updates">업데이트 보기</Link>
        </aside>
      ) : null}
      {state === "stale" ? (
        <aside className={styles.error} role="status">
          <span>새 버전이 준비됐어요. 새로고침 후 확인해 주세요.</span>
          <button type="button" onClick={() => window.location.reload()}>새로고침</button>
          <Link href="/updates">업데이트 보기</Link>
        </aside>
      ) : null}
    </>
  );
}
