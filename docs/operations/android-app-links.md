# Android 공유 링크 연결 준비

상태: 로컬 구현 후보. 공개 호스트·서명 설정·실제 Android 도메인 검증과 Play 배포는 미완료다.

Android는 HTTPS `/share#<token>`과 `/invite#<token>`을 받고, MainActivity가 처음 실행되거나
이미 실행 중일 때 같은 엄격한 URI 검사를 수행한다. 토큰은 fragment에 유지하고 query나
접속 로그로 이동하지 않는다. 서버의 익명 공유 읽기, 회수 및 회원 전용 저장 권한은 유지한다.

## 인증 파일 설정

`GET /.well-known/assetlinks.json`은 세션 갱신 없이 공개 인증서만 반환한다.
`MOTOCAST_ANDROID_APP_LINKS_SHA256`에 **Play 앱 서명** SHA-256 지문을 콜론 구분
32바이트 형식으로 넣는다. 서명 세대가 여러 개면 쉼표로 구분하며 최대10개까지 받는다.
SHA-1, 업로드 인증서, 비밀키를 대신 사용하지 않는다. 인증서 지문 자체는 공개 정보다.

2026-09-26 Console에서 읽은 공개 지문과 Integrity용 base64url 변환은
[서명 설정 후보](play-signing-certificates.json)에 기록했다. 현재 일반/양자 키와
Console의 Digital Asset Links 스니펫을 구분한다. 스니펫의 서명 세대 대응은 별도
미확인이며, 문서 생성 자체는 서버 설정 적용이나 실제 Play 증명 성공이 아니다.

정상 응답은 `application/json`, 상태200, 쿠키·redirect 없음, 최대300초 캐시다.
미설정 또는 형식 오류는503와 `no-store`로 드러낸다. 형식 검사는 그 지문이 실제 Play
서명인지 입증하지 않으므로 Console의 앱·서명 세대와 별도로 대조해야 한다.

인증 파일을 Next.js proxy에서 제외해도 Vercel 플랫폼 로그인 보호는 해제되지 않는다.
2026-09-26 사용자 요청으로 OPS-005에 현재 앱/테스터의 고정 호스트
`motocast-git-develop-tocomboys-projects.vercel.app`만 공개 예외로 추가하기로 확정했다.
기존 발행/수신 주소는 유지하며 다른 Preview 배포 URL의 Vercel 보호는 유지한다.
설정 적용만으로 인증 파일 코드 배포나 기존 code3 앱의 autoVerify 추가가 완료되지는 않는다.
공개 사이트에 회원 세션·검증 서비스 계정·서버 비밀값을 전달하지 않는다.

## 배포·복구·검증 경계

1. 최종 호스트와 실제 Play 서명을 확정하고 앱 링크 발행/파서/manifest/인증 JSON을 대조한다.
2. 최종 소스 검사와 CI를 통과한 후 승인된 대상에 인증 파일과 앱을 배포한다.
3. 외부 미인증 GET이 리다이렉트 없이200 JSON인지 확인한다.
4. Play 설치본의 도메인 검증과 앱 종료/실행 중 `/share` 수신을 각각 확인한다.
   앱 미설치, 잘못된 토큰, 회수된 공유 및 회원 전용 저장 거부도 구분한다.

서버 연결 파일 복구는 이전 검증 파일로 되돌리며 사용자 데이터는 삭제하지 않는다.
Android 복구는 이전 정상 소스를 더 높은 versionCode로 배포한다. 이미 기기에 캐시된
도메인 상태가 있으므로 서버 파일 복구만으로 즉시 연결이 바뀐다고 보장하지 않는다.
단위 검사와 APK 빌드는 위 실제 기기 확인을 대신하지 않는다.

공식 근거: [Android 웹사이트 연결 설정](https://developer.android.com/training/app-links/configure-assetlinks),
[Vercel 배포 보호 예외](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection).
