"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  clearKakaoOidcHandoffFragment,
  isKakaoOidcHandoff,
  KakaoOidcCallbackLifecycle,
} from "@/lib/auth/kakao-oidc";

const COMPLETION_TIMEOUT_MS = 10_000;

export function KakaoOidcCallback() {
  const [lifecycle] = useState(() => new KakaoOidcCallbackLifecycle());
  const [status, setStatus] = useState<"pending" | "delayed" | "error">("pending");

  useEffect(() => {
    if (!lifecycle.enter(() => setStatus("delayed"), COMPLETION_TIMEOUT_MS)) {
      return () => lifecycle.leave();
    }
    const handoff = window.location.hash.slice(1);
    if (!clearKakaoOidcHandoffFragment(window)) {
      lifecycle.complete();
      void clearBrowserBinding();
      queueMicrotask(() => setStatus("error"));
      return;
    }
    if (!isKakaoOidcHandoff(handoff)) {
      lifecycle.complete();
      void clearBrowserBinding();
      queueMicrotask(() => setStatus("error"));
      return;
    }

    void (async () => {
      try {
        const response = await fetch("/api/auth/kakao/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handoff }),
          cache: "no-store",
        });
        const body = await response.json() as { redirect?: unknown };
        if (typeof body.redirect === "string" && body.redirect.startsWith("/") && !body.redirect.startsWith("//")) {
          window.location.replace(body.redirect);
          return;
        }
        throw new Error("OIDC_COMPLETION_FAILED");
      } catch {
        void clearBrowserBinding();
        setStatus("error");
      } finally {
        lifecycle.complete();
      }
    })();
    return () => lifecycle.leave();
  }, [lifecycle]);

  const error = status === "error";
  const delayed = status === "delayed";

  return (
    <main className="admin-page">
      <section className="admin-card">
        <p className="eyebrow">MOTOCAST</p>
        <div aria-live="polite" aria-busy={status === "pending"}>
          <h1>{error ? "로그인을 완료하지 못했습니다" : delayed ? "로그인 처리가 지연되고 있습니다" : "카카오 로그인을 확인하고 있습니다"}</h1>
          <p className="admin-intro">{error ? "처리 중 문제가 생겼습니다. 처음부터 다시 시도해 주세요." : delayed ? "서버에서 이미 시작된 처리는 완료될 수 있습니다. 조금 더 기다리거나 로그인 화면으로 이동해 주세요." : "잠시만 기다려 주세요."}</p>
        </div>
        {error
          ? <Link className="text-link" href="/login">로그인으로 돌아가기</Link>
          : delayed
            ? <Link className="text-link" href="/login" onClick={() => void clearBrowserBinding()}>로그인 화면으로 이동</Link>
            : null}
      </section>
    </main>
  );
}

async function clearBrowserBinding() {
  try {
    await fetch("/api/auth/kakao/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
      keepalive: true,
    });
  } catch {
    // The cookie has a five-minute hard expiry; never expose cleanup details.
  }
}
