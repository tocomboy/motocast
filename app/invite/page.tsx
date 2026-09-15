import Link from "next/link";

import { InviteFragmentConsumer } from "@/components/invite-fragment-consumer";

export default function InvitePage() {
  return (
    <main className="login-page">
      <section className="login-card">
        <Link className="brand brand-dark" href="/" aria-label="MOTOCAST 홈">
          <span className="brand-mark">M</span>
          <span>MOTOCAST</span>
        </Link>
        <div className="login-copy">
          <p className="eyebrow">PRIVATE RIDING CIRCLE</p>
          <h1>라이더 초대를<br />확인합니다.</h1>
          <p>초대 토큰은 서버 요청 주소에 남기지 않고, 확인이 끝나면 카카오 로그인으로 이어집니다.</p>
        </div>
        <InviteFragmentConsumer />
      </section>
      <aside className="login-landscape" aria-label="라이딩 경로 장식">
        <div className="contour contour-one" />
        <div className="contour contour-two" />
        <svg viewBox="0 0 700 900" aria-hidden="true">
          <path d="M-20 760 C180 680 106 470 305 490 S410 221 720 164" />
        </svg>
      </aside>
    </main>
  );
}
