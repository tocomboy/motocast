import Link from "next/link";
import { MotorcycleIllustration } from "@/components/motorcycle-illustration";

import { KakaoLoginButton } from "@/components/kakao-login-button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const messages: Record<string, string> = {
    membership_required: "아직 가입하지 않은 계정입니다. Google Play의 MOTOCAST 앱에서 카카오 로그인으로 먼저 가입해 주세요.",
    invalid_invite: "초대 가입은 종료되었습니다. MOTOCAST 앱에서 먼저 가입해 주세요.",
    invite_required: "MOTOCAST 앱에서 카카오 로그인으로 먼저 가입해 주세요.",
    not_invited: "이 계정에는 서비스 이용 권한이 없습니다.",
    callback: "로그인 확인 중 문제가 발생했습니다.",
  };

  return (
    <main className="login-page">
      <aside className="login-landscape" aria-label="라이딩 경로 장식">
        <h1>길 위의 날씨를<br />출발 전에 읽습니다.</h1>
        <div className="login-weather-notes"><span className="weather-note note-one">07:40 · 맑음 · 18°</span><span className="weather-note note-two">12:10 · 소나기 60%</span></div>
        <MotorcycleIllustration className="login-motorcycle" />
      </aside>
      <section className="login-card">
        <Link className="brand brand-dark" href="/" aria-label="MOTOCAST 홈">
          <span>MOTOCAST</span>
        </Link>
        <div className="login-copy">
          <p className="eyebrow">MOTOCAST</p>
          <div className="login-membership-notice">
            <strong>앱에서 먼저 가입해 주세요</strong>
            <p>Google Play의 MOTOCAST 앱에서 카카오 로그인으로 가입한 뒤, 같은 계정으로 웹을 이용할 수 있어요.</p>
          </div>
        </div>
        {params.error ? <p className="login-error" role="alert">{messages[params.error] ?? messages.callback}</p> : null}
        <KakaoLoginButton />
        <p className="login-footnote">카카오 이메일은 수집하지 않습니다.</p>
      </section>

    </main>
  );
}
