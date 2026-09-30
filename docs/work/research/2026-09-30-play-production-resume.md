# PR79 Play 운영 대상 재개

## 승인과 완료 조건

2026-09-30 KST 사용자는 PR79를 재개하고 Play 가입을 포함한 운영 배포 승인이
유효함을 재확인했다. 추가 배포 승인 대기가 아니다. 실제 Android 기기 검증은
사용자가 직접 진행한다. 자동 검사·서명 후보 생성·Play 게시·실제 가입은 별도 결과다.
적용 결정은 AUTH-007, DATA-001/003, OPS-002/003/004/007이다.

기준 Web develop은 `251638492b4fe61f4de65131f4f8aa1d5ee9f143`,
main은 `259f4866a0cb96c33e84423a048d385aacda65f0`이다.
Android develop은 `f630fcd3cc29e5bcb980233cadeecbd35b26f081`,
main은 `99fa8a46d168aa2ae531b33f8b92631342cb2e06`이다.

## 실행 환경과 접근 확인

- PASS: 클라우드 준비 완료 후 `pwd`, Git 상태 조회, Node24.19.0, Java21 실행.
  이전 채팅의 `executor_registration_failed`는 이번 환경에서 재현되지 않았다.
- PASS: 네트워크 권한을 적용한 `git fetch`와 GitHub PR API 조회.
  기본 sandbox에서 proxy/socket 오류가 났지만 같은 정상 proxy 경로의 지원 권한으로 해결했다.
  proxy/TLS를 우회하거나 인증 파일을 복사하지 않았다.
- PASS: Supabase 연결 도구로 두 프로젝트 ACTIVE_HEALTHY와 schema/Edge 목록 조회.
- PASS: Vercel 팀·프로젝트·Production 배포 조회.
- SETUP_OR_IMPORT_FAILURE: Supabase CLI2.116.0의 projects/secrets 조회는
  `Access token not provided`. 연결 도구에는 secrets 설정 API가 없다.
- ERROR: GitHub Android Actions secrets/variables 이름 조회는 HTTP403
  `Resource not accessible by integration`. 값은 읽지 않았다.
- NOT_RUN: 연결 Preview 로그인/제품 검증. origin/project에 결속된
  `MOTOCAST_E2E_STORAGE_STATE`가 없으며 로그인된 브라우저 접근 도구도 없다.
- NOT_RUN: 실제 기기 설치·Play Integrity·신규 가입. 사용자가 검증을 담당한다.
  클라우드 adb 조회는 사용자 home의 `.android` 디렉터리 생성 권한 오류로 실패했으며,
  이를 연결 기기 0대라는 성공적인 조회로 해석하지 않는다.

개인 지침의 원격 main과 로컬 source는 `7e2f139be9f0c9af57754db3b82c082236ea314e`로
일치했다. 현재 source 지침을 읽고 워커는 gpt-6.1-sol/high로 실행했다.
전역 복원 check/apply는 권한 실행 문맥에 따라 ADD2 또는
`refusing a global home inside a Git repository`를 반환했다.
복원 성공·새 채팅 자동 적용·현재 메인 모델 변경을 주장하지 않는다.
이 별도 설정 문제는 정상 실행되는 제품 작업을 막지 않는다.

## 운영 상태 재조회

Production은 `dpl_9GuPPNhKsVNeq6xnitwfmKDWS1nJ`, main `259f4866…`, READY다.
로그인·업데이트는 HTTP200, nosniff/HSTS, 쿠키 없음이며 업데이트에0.4.2가 표시된다.
Preview 고정 주소의 로그인·업데이트는 같은 HTTP/헤더 검사를 통과하고0.5.1을 표시한다.
Preview App Links는200 JSON/서명3개, Production은404다.
이는 공개 HTTP 관측이며 로그인·기기 도메인 검증을 대신하지 않는다.

Production에는 migration14개와 Edge5개가 있다. SQL에서 Play challenge/budget 테이블과
begin RPC가 없음을 확인했다. Preview에는 migration20개와 Edge8개가 있으며
play-admission v3는 ACTIVE/JWT true다. 현재 운영 계정·회원·사용자 데이터는 수정하지 않았다.

## 수정 계약

서버는 신뢰된 `SUPABASE_URL`과 명시적인 `PLAY_ADMISSION_ENVIRONMENT`의 정확한
Preview/Production 조합만 허용한다. 임의 URL·환경 누락·불일치는 인증·DB·Google 호출 전에
503으로 닫는다. 인증서/version/검증 계정은 각 프로젝트 설정에서만 읽는다.
Preview의 새 환경 설정 등록 여부는 미확인이며 기존 함수 교체 전에 등록·readback해야
기존 가입을 중단하지 않는다.
Google 판정·프로젝트별 Kakao 인증·challenge·일회성/회수/역할 보존은 유지한다.

Android는 빌드별 backend/link 허용 주소와 공개 설정을 분리한다. Production에 Preview
키를 대신 넣지 않고 기존 Preview 세션·주행 저장소를 운영에서 열거나 전송하지 않는다.
기존 Play 업로드 서명은 유지하되 Production native 등록·공개키·앱 링크를 따로 검증한다.
code5는 저장소 이력상 다음 후보이며 Console의 미기록 업로드 여부는 게시 직전에 확인한다.

## 추가 서버 의존성

Android `RideClient`는 `journey-route`/`journey-weather`를 호출하지만 Production에는
두 함수와 주행 cache/retention/capacity migration이 없다. 해당 서버 원본은 별도
[PR74](https://github.com/tocomboy/motocast/pull/74)의 draft 후보
`ef0234471796cab2838fa2a5116ad8180feca912`이며 현재 develop과 충돌한다.
Preview 배포 이력은 PR74의 Production 승격·정상 호출 배정·운영 검증을 입증하지 않는다.
완전한 운영 Android 배포 전에 이 호환 의존성을 검토·통합·검증해야 한다.
가입 배포 승인만으로 미검증 주행 코드를 자동 병합하거나 기능을 숨기지 않는다.

## 서버 후보 검증과 직접 검수

- PASS: 새 runtime factory와 기존 proof 집중 검사72개.
- PASS: `npm ci`, lint, typecheck, Deno6개 진입점, production build.
- PASS: 전체 Vitest79파일/749개, 로컬 Chromium49개.
- SKIP: 기존 연결 Preview 전용 Chromium2개. 로그인·가입 성공 근거로 계산하지 않는다.
- PASS: 변경 파일의 credential-pattern 검사0건, `git diff --check`.
- 직접 검수: 정확한 환경 매핑, 요청 URL/header의 환경 선택 불가, 두 프로젝트의
  개별 인증서/version/검증 계정, 외부 challenge/proof 거절, Kakao 사용자 확인,
  Origin 거부, 기존 role/revocation/budget 흐름을 대조했다. DB/회원 행 변경은 없다.
  테스트의 합성 서비스 계정·Google 판정은 실제 Play 설치 증명이 아니다.
- Android 검수에서 release/debug 패키지 assertion과 foreign-AAD 암호문 fixture의
  거짓 통과 가능성을 발견해 보완했다. Android의 최종 수치는 해당 저장소 기록을 따른다.

## 남은 실행 순서

1. 변경한 서버·Android 후보의 로컬 검사와 직접 검수, 고정 SHA의 CI.
2. 서버 CI-only 후보의 Deployments/Vercel checks/status0 확인.
3. Supabase 관리 인증으로 Preview 환경 설정 등록/readback 후 정확한 함수 후보 배포.
   연결 Preview 로그인과 Play 신규 가입 검증. 실제 기기는 사용자가 담당한다.
4. 운영 백업·복구 대상 확인 후 호환 migration/함수와 프로젝트별 Play 설정 적용/readback.
   Production Kakao native 허용, 공개 앱 설정, Play 앱 서명/버전 allowlist,
   App Links 지문을 대상별로 확인한다. Preview 비밀값을 읽거나 복사하지 않는다.
5. Android의 주행 서버 의존성과 실제 운영 설치 검증 조건 충족 후 후보 승격·서명·내부 트랙 게시.
6. Preview gate 충족 후 PR79 develop→main 승격, 정확한 main SHA의 Production와
   초대 Rider/Play 가입·핵심 제품 검증, 그 다음 v0.5.1 tag/Release.

운영 복구는 검증한 호환 소스로 정상 승격하며 기존 회원과 새 테이블을 보존한다.
신규 Play 가입만 닫을 때 version allowlist를 비우고 기존 회원의 로그인은 유지한다.

## 사용자가 맡는 실제 Play 설치 확인

아래는 운영 설정·후보 서명·내부 트랙 게시 이후 실행한다. 현재 code4 Preview 앱이나
서명하지 않은 개발 APK로 통과 판정을 내리지 않는다.

1. Play 내부 테스트에서 지정된 운영 후보 버전/code로 업데이트한다. 같은 Play 패키지의
   Preview→Production 업데이트에서 이전 Preview 로그인이 자동 재사용되지 않아야 한다.
2. 초대 없이 **운영에 아직 가입하지 않은 테스트 Kakao 계정**으로 가입한다.
   앱에서 Play 검증·가입 후 홈 진입을 확인하고, 담당자가 운영 membership의 일반 rider
   생성과 Preview 무변경을 별도로 읽어 확인한다. 계정·토큰·초대 코드는 보고에 넣지 않는다.
3. 기존 운영 회원은 정상 로그인하고 기존 관리자 역할은 보존돼야 한다.
   사전에 준비한 회수 테스트 회원은 Play 가입으로 복구되지 않아야 한다.
4. 앱 재실행·로그아웃·재로그인, 운영 호스트의 공유/초대 링크 열기와 회수된 공유 거절을
   확인한다. 공개 장소로 경로·날씨·저장·공유 및 주행 서버 의존성을 각각 검증한다.
5. 보고는 설치 버전/code, 각 항목 PASS/FAIL/NOT_RUN과 개인정보 없는 오류 문구만 남긴다.
   실패한 실제 가입을 재설치·초대 우회·합성 증명으로 성공 처리하지 않는다.

NOTION_UPDATE_PENDING: 현재 Notion 도구 안내가 선행 요구하는 `get_tool_access`가
제공 도구 목록에 없어 프로젝트 검색·기록 갱신을 실행하지 못했다.
PR79의 재개 상태와 이 문서의 검증/차단 요약을 기존 프로젝트·진행 과제에 반영해야 한다.
