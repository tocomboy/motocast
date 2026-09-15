"use client";

import { useState } from "react";

import { getBrowserSupabase } from "@/lib/supabase/browser";

type InviteResult = {
  invite_token: string;
  expires_at: string;
};

export function InviteManager() {
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [status, setStatus] = useState("새 링크는 한 번 사용되거나 만료되면 다시 쓸 수 없습니다.");
  const [working, setWorking] = useState(false);

  async function createInvite() {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setStatus("Supabase 연결 설정을 확인해 주세요.");
      return;
    }

    setWorking(true);
    setInvite(null);
    const { data, error } = await supabase.rpc("create_invite", { valid_for: "7 days" });
    setWorking(false);

    const result = Array.isArray(data) ? (data[0] as InviteResult | undefined) : undefined;
    if (error || !result?.invite_token) {
      setStatus("초대 링크를 만들지 못했습니다. 관리자 권한과 연결 상태를 확인해 주세요.");
      return;
    }

    setInvite(result);
    setStatus("링크를 만들었습니다. 이 화면을 떠나면 원문 토큰은 다시 조회할 수 없습니다.");
  }

  const inviteUrl = invite && typeof window !== "undefined"
    ? `${window.location.origin}/invite#${invite.invite_token}`
    : "";

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setStatus("초대 링크를 클립보드에 복사했습니다.");
    } catch {
      setStatus("자동 복사가 차단되었습니다. 아래 링크를 직접 선택해 복사해 주세요.");
    }
  }

  return (
    <section className="admin-card" aria-labelledby="invite-title">
      <p className="eyebrow">ONE-TIME ACCESS</p>
      <h1 id="invite-title">라이더 초대</h1>
      <p className="admin-intro">7일 동안 유효한 일회용 링크를 만듭니다. 링크를 받은 사람은 카카오 로그인 후 이 모임의 라이더로 등록됩니다.</p>

      <button className="primary-button" type="button" onClick={createInvite} disabled={working}>
        {working ? "링크 만드는 중…" : "7일 초대 링크 만들기"}
      </button>

      {invite ? (
        <div className="invite-result">
          <label htmlFor="invite-url">초대 링크</label>
          <div className="invite-copy-row">
            <input id="invite-url" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} />
            <button className="ghost-button dark" type="button" onClick={copyInvite}>복사</button>
          </div>
          <small>만료: {new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(invite.expires_at))}</small>
        </div>
      ) : null}

      <p className="admin-status" role="status">{status}</p>
    </section>
  );
}
