"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export function InviteFragmentConsumer() {
  const [status, setStatus] = useState("초대 정보를 안전하게 확인하는 중입니다.");
  const [failed, setFailed] = useState(false);
  const acceptanceRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (acceptanceRef.current) return;
    const token = window.location.hash.slice(1);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);

    async function acceptInvite() {
      try {
        const response = await fetch("/api/invites/accept", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
          cache: "no-store",
        });
        if (!response.ok) {
          window.location.replace("/login?error=invalid_invite");
          return;
        }
        setStatus("초대를 확인했습니다. 카카오 로그인 화면으로 이동합니다.");
        window.location.replace("/login");
      } catch {
        setFailed(true);
        setStatus("초대 정보를 확인하지 못했습니다. 네트워크 연결을 확인한 뒤 원래 초대 링크를 다시 열어 주세요.");
      }
    }

    acceptanceRef.current = acceptInvite();
  }, []);

  return (
    <div className="invite-status">
      <p className="login-error" role="status" aria-live="polite">{status}</p>
      {failed ? <Link className="text-link" href="/login">기존 멤버 로그인</Link> : null}
    </div>
  );
}
