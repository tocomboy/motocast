"use client";

import { useState } from "react";

export function KakaoLoginButton({ inviteReady }: { inviteReady: boolean }) {
  const [loading, setLoading] = useState(false);

  return (
    <div className="login-action">
      <form action="/api/auth/kakao/start" method="get" onSubmit={() => setLoading(true)}>
        <button className="kakao-button" type="submit" disabled={loading}>
          <span aria-hidden="true">K</span>
          {loading ? "카카오로 이동 중…" : "카카오로 계속하기"}
        </button>
      </form>
      {!inviteReady ? <p>기존 멤버는 로그인할 수 있습니다. 처음 가입하는 라이더는 관리자 초대 링크가 필요합니다.</p> : null}
    </div>
  );
}
