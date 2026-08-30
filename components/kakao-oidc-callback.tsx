"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { clearKakaoOidcHandoffFragment, isKakaoOidcHandoff } from "@/lib/auth/kakao-oidc";

const COMPLETION_TIMEOUT_MS = 10_000;

export function KakaoOidcCallback() {
  const started = useRef(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const handoff = window.location.hash.slice(1);
    if (!clearKakaoOidcHandoffFragment(window)) {
      queueMicrotask(() => setError(true));
      return;
    }
    if (!isKakaoOidcHandoff(handoff)) {
      queueMicrotask(() => setError(true));
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), COMPLETION_TIMEOUT_MS);
    void (async () => {
      try {
        const response = await fetch("/api/auth/kakao/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handoff }),
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json() as { redirect?: unknown };
        if (typeof body.redirect === "string" && body.redirect.startsWith("/") && !body.redirect.startsWith("//")) {
          window.location.replace(body.redirect);
          return;
        }
        throw new Error("OIDC_COMPLETION_FAILED");
      } catch {
        setError(true);
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  return (
    <main className="admin-page">
      <section className="admin-card">
        <p className="eyebrow">MOTOCAST</p>
        <div aria-live="polite" aria-busy={!error}>
          <h1>{error ? "로그인을 완료하지 못했습니다" : "카카오 로그인을 확인하고 있습니다"}</h1>
          <p className="admin-intro">{error ? "처리 중 문제가 생겼습니다. 처음부터 다시 시도해 주세요." : "잠시만 기다려 주세요."}</p>
        </div>
        <Link className="text-link" href="/login">{error ? "로그인으로 돌아가기" : "로그인 취소"}</Link>
      </section>
    </main>
  );
}
