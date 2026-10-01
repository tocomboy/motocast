"use client";

import { useState } from "react";

export function KakaoLoginButton() {
  const [loading, setLoading] = useState(false);

  return (
    <div className="login-action">
      <form action="/api/auth/kakao/start" method="get" onSubmit={() => setLoading(true)}>
        <button className="kakao-button" type="submit" disabled={loading}>
          <span aria-hidden="true">K</span>
          {loading ? "카카오로 이동 중…" : "카카오로 계속하기"}
        </button>
      </form>
      <p>이미 가입했다면 같은 카카오 계정으로 로그인하세요.</p>
    </div>
  );
}
