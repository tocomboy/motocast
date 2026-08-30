"use client";

import { useState } from "react";

import { getBrowserSupabase } from "@/lib/supabase/browser";

export function KakaoLoginButton({ inviteReady }: { inviteReady: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function login() {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setError("Supabase 환경변수가 설정되지 않았습니다.");
      return;
    }

    setLoading(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "kakao",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (authError) {
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
