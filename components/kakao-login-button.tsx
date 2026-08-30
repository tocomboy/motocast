"use client";

import { useState } from "react";

import { kakaoOidcStartUrl } from "@/lib/auth/kakao-oidc";
import { publicSupabaseEnv } from "@/lib/supabase/env";

export function KakaoLoginButton({ inviteReady }: { inviteReady: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function login() {
    setLoading(true);
    setError(null);
    try {
      const { url } = publicSupabaseEnv();
      window.location.assign(kakaoOidcStartUrl(url, window.location.origin));
    } catch {
      setLoading(false);
      setError("카카오 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  return (
    <div className="login-action">
      <button className="kakao-button" type="button" onClick={login} disabled={loading}>
        <span aria-hidden="true">K</span>
        {loading ? "카카오로 이동 중…" : "카카오로 계속하기"}
      </button>
      {!inviteReady ? <p>기존 멤버는 로그인할 수 있습니다. 처음 가입하는 라이더는 관리자 초대 링크가 필요합니다.</p> : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  );
}
