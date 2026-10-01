"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Replace an old fragment without reading, sending, or redeeming its contents. */
export default function RetiredInvitePage() {
  useEffect(() => { window.location.replace("/login?error=membership_required"); }, []);
  return <main className="login-page"><section className="login-card">
    <h1>앱에서 먼저 가입해 주세요</h1>
    <p>초대 가입은 종료되었습니다. MOTOCAST 앱에서 카카오 로그인으로 가입한 뒤 이용할 수 있어요.</p>
    <Link href="/login">로그인 화면으로</Link>
  </section></main>;
}
