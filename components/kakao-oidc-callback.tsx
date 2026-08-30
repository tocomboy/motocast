"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { isKakaoOidcHandoff } from "@/lib/auth/kakao-oidc";

export function KakaoOidcCallback() {
  const started = useRef(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const handoff = window.location.hash.slice(1);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    if (!isKakaoOidcHandoff(handoff)) {
      queueMicrotask(() => setError(true));
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
        setError(true);
      }
    })();
  }, []);

  return (
    <main className="admin-page">
      <section className="admin-card" aria-live="polite" aria-busy={!error}>
        <p className="eyebrow">MOTOCAST</p>
        <h1>{error ? "로그인을 완료하지 못했습니다" : "카카오 로그인을 확인하고 있습니다"}</h1>
        <p className="admin-intro">{error ? "로그인 요청이 만료되었거나 이미 사용되었습니다. 처음부터 다시 시도해 주세요." : "잠시만 기다려 주세요."}</p>
        {error ? <Link className="text-link" href="/login">로그인으로 돌아가기</Link> : null}
      </section>
    </main>
  );
}
