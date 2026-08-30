import { cookies } from "next/headers";
import Link from "next/link";

import { KakaoLoginButton } from "@/components/kakao-login-button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; bootstrap?: string }>;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const localBootstrap = process.env.NODE_ENV !== "production" && params.bootstrap === "1";
  const inviteReady = Boolean(cookieStore.get("motocast_invite")?.value || localBootstrap);
  const messages: Record<string, string> = {
    invalid_invite: "초대 링크가 만료되었거나 이미 사용되었습니다.",
    invite_required: "가입하려면 유효한 초대 링크가 필요합니다.",
    not_invited: "이 계정에는 서비스 이용 권한이 없습니다.",
    callback: "로그인 확인 중 문제가 발생했습니다.",
  };

  return (
    <main className="login-page">
      <section className="login-card">
        <Link className="brand brand-dark" href="/" aria-label="MOTOCAST 홈">
          <span className="brand-mark">M</span>
          <span>MOTOCAST</span>
        </Link>
        <div className="login-copy">
          <p className="eyebrow">PRIVATE RIDING CIRCLE</p>
          <h1>길 위의 날씨를<br />출발 전에 읽습니다.</h1>
          <p>관리자가 초대한 라이더만 사용할 수 있습니다. 카카오 계정은 로그인에만 사용하고 라이딩 데이터는 내부 사용자 ID로 분리합니다.</p>
        </div>
        {params.error ? <p className="login-error" role="alert">{messages[params.error] ?? messages.callback}</p> : null}
        <KakaoLoginButton inviteReady={inviteReady} />
        <p className="login-footnote">초대 링크는 한 번만 사용할 수 있으며 관리자가 언제든 권한을 회수할 수 있습니다.</p>
      </section>
      <aside className="login-landscape" aria-label="라이딩 경로 장식">
        <div className="contour contour-one" />
        <div className="contour contour-two" />
        <span className="weather-note note-one">07:40 · 맑음 · 18°</span>
        <span className="weather-note note-two">12:10 · 소나기 60%</span>
        <svg viewBox="0 0 700 900" aria-hidden="true">
          <path d="M-20 760 C180 680 106 470 305 490 S410 221 720 164" />
        </svg>
      </aside>
    </main>
  );
}
