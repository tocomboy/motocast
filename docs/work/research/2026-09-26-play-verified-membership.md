# Play 설치 검증을 통한 신규 회원 가입 — 2026-09-26

## 확정 범위

AUTH-007: 서버가 Play 설치 증명을 검증한 신규 카카오 사용자는 초대 없이 일반 회원으로 가입한다. 기존 차단 회원·권한·소유권·예산은 유지한다. Preview와 Play 내부 테스트의 구현·검증·필요 배포가 승인됐다. 웹 Production 변경과 공개 출시는 포함하지 않는다.

현재 배포된 Android 0.1.0/code3에는 이 기능이 없다. 사용자가 Play 설치 성공을 보고했지만, 새 가입 방식·실제 로그인·다음 버전 업데이트 검증을 대신하지 않는다.

## 실행 계획

1. 완료: 정책 정본, 신뢰 경계 및 외부 Play Integrity 프로젝트 연결 확인.
2. 완료: 서버 증명 검증·원자적 회원 생성과 실제 DB/실패/권한 검사. Preview DB/Edge 및 비밀값4개 적용과 Google OAuth 연결 확인.
3. 완료: Figma P01~P03 디자인·Android 구현, 단위320개와 실제 Compose16개 동작 PASS.
4. 완료: PR75 고정 SHA를 Preview에 배포. 공개 앱 링크 인증 파일·버전·접근 경계9개 점검 PASS.
5. 진행: 최종 앱 승격·서명 후보와 내부 테스트 배포. Play 설치본 신규 가입·공유 링크·업데이트는 NOT_RUN.

## 작업 공간과 보존

- 웹 원본에는 다른 Android/날씨 작업의 dirty 파일이 있다. 원본의 AUTH-007 정책 부분만 갱신하며 기존 변경은 보존한다.
- 구현용 managed worktree: `C:/Users/User/.codex/worktrees/play-membership/MOTOCAST`, branch `review-play-membership`, base `origin/develop`. Preview CI-only 검토 절차를 따른다.
- Android: 기존 전용 저장소의 `feature/play-verified-membership`에서 진행한다.
- 원본에 있던 AUTH-006은 이미 확정된 SDK 로그인 선행 정책이며 격리 후보에도 해당 절만 포함한다. 다른 날씨 변경은 복사하지 않는다.
- 새 검증 자원은 생성 전 기존 자원·소유권·여유 공간을 확인한다. 실패 증거와 진행 중 자원은 보존한다.

## 확인된 보호 조건

- Google이 검증한 Play 라이선스/앱 일치, 승인된 패키지/인증서/버전, 서버의 사용자/환경/일회용 요청 결속이 모두 필요하다.
- 증명 실패·타임아웃·재전송·다른 사용자 요청은 신규 profile/membership 생성으로 이어지지 않는다.
- 기존 회원은 역할과 데이터를 보존하고, 차단 회원은 자동 재활성화하지 않는다.
- 설치된 앱/클라이언트가 전달한 boolean을 서버 권한 근거로 사용하지 않는다.

## 검증 상태

로컬 서버·실제 DB·Android 구현과 Hosted Preview 적용·비밀값 설정은 완료했다. 실제 Google 설치 증명·기기 신규 가입은 NOT_RUN이며, 아래 시간순 기록의 과거 대기 상태와 구분한다.

## 구현 및 확인 (진행 중)

- Google Cloud: MOTOCAST Play / motocast-play-2026 / 710070840912, 조직 없음. 사용자는 MOTOCAST만 정리하고 기존 프로젝트는 유지하기로 선택했다. Play Integrity 약관 동의·프로젝트 연결 승인을 받아 연결 완료, LICENSED와 PLAY_RECOGNIZED 응답 활성화를 읽어 확인했다.
- Android 다음 후보: 0.2.0 / code4. 호환되는 가입 기능 추가이며 기존 code3 초대 로그인 API는 유지한다.
- 서버: 인증된 Kakao identity 확인 → 3분 일회용 challenge → Google 서버 decode → 승인된 패키지/서명 SHA256/버전/라이선스/hash/time 확인 → 원자적 rider/profile 생성. 기존 active 역할 보존, revoked 거부. DB는 3개 전용 내부 RPC만 추가하며 직접 DML은 거부한다.
- 요청 제한: 신규 사용자당 1시간 최대5개 challenge, 전체 검증 호출 서울 날짜당 최대500회. 실패한 Google 호출도 예약된 예산을 소모한다. 한 사용자당 challenge 행1개와 전체 일일 예산 행1개로 저장량을 제한한다. 원본 Play 토큰·Kakao 토큰은 DB/로그에 저장하지 않는다.
- 외부 네트워크: Google OAuth와 Play decode만 고정 목적지로 사용하며 리다이렉트/자동 재전송 금지, 각각5초·응답64KiB 한도. Preview 프로젝트 이외에서 신규 endpoint는 동작하지 않는다.
- 로컬 서버 Vitest34 PASS, Deno entrypoint check PASS.
- 실제 PostgreSQL: 전용 motocast_play_20260926, 기존 로컬 컨테이너의 platform auth schema만 복제하고 15개 제품 migration 새로 적용. 기존 auth35/collection125/ACL164 PASS, 새 가입8개 시나리오 PASS (동시 take6개 중1개, complete6개 idempotent 포함).
- 앞선 DB 시도는 검증 fixture의 두 시계 호출 사이1마이크로초 차이로 CHECK 실패1, 테스트 함수명이 concurrent 모듈을 가려 ERROR1. fixture/이름 수정 후 동일 task-owned DB와 migration hash를 확인해 재사용, 제품 보호 조건은 변경하지 않았다. 초기 실행 자료 보존.
- Android 최초 통합 기준선313 PASS/FAIL0/ERROR0/SKIP0, APK·lint PASS. 이후 추가된 신규 가입 회귀 테스트와 최종 후보 검증은 별도 진행 중.
- Figma B01 node157:3687 연결 재인증을 요청했고 사용자가 완료했지만 같은 도구가 여전히 재인증을 요구한다. 화면 변경은 대기, 인증 구현은 계속 진행한다.
- Hosted DB/Edge 적용, 새 Play release, 실제 Play proof/new-user/device update: NOT_RUN.

- 서버/웹 제품 후보0.5.0, Android0.2.0/code4로 버전을 선택했다. 기존 공개 이력은 보존한다.

## 2026-09-26 후속 검증

- npm ci PASS. Node20.20.2는 npm 공식 패키지로 사용자 캐시에 병행 사용하며 시스템 Node24를 교체하지 않았다.
- 웹/서버 단위682 PASS 및 lint/typecheck PASS. 후속 Google 오류·초과응답·timeout/no-retry 회귀 검사를 추가해 최종 재실행 중.
- Chromium 전체 최초45 PASS / 4 FAIL / 2 SKIP. 실패4건은0.5.0 출시 안내 추가에 따른 이전 문구·버전 목록 기대값 불일치였다. 수정 후 해당 파일5 PASS, build PASS. SKIP2는 기존 connected Preview 관리·실제 경로/저장/공유 시험이며 로컬 keyless 검증에서 필요한 외부 인증/명시적 실제 mutation 설정이 없으므로 통과 수에서 제외한다. 본 가입 계약의 실제 Google proof는 별도 NOT_RUN이다.
- Deno6개 entrypoint check PASS. CI 기존 check 명령에 신규 함수만 추가했으며 별도 job/중복실행은 추가하지 않았다.
- Android320 PASS / FAIL0 / ERROR0 / SKIP0, APK 및 lint PASS. UI/기기/실제 Play proof를 대신하지 않는다.
- 검증 전용 서비스 계정 생성과 JSON 키 생성 완료를 Google UI에서 확인했다. 프로젝트 IAM/Play 출시 역할 없음. 다운로드 event 경로 반환이 시간 초과되어 원본 파일 위치 확인 중이며 중복 키를 만들지 않았다. Preview secret 저장은 NOT_RUN이며 CI-only gate 후 적용한다.
- Figma 재인증 후에도 연결 오류가 계속되어 사용자에게 기존 화면 문구·초대 입력만 최소 변경하는 대안을 질문했다. 답변 전 화면 변경은 보류한다.

- 최종 웹 lint/typecheck PASS, Vitest683 PASS/FAIL0/ERROR0/SKIP0 (Google transport 실패 추가 포함). 중간1 FAIL은 Windows CRLF로 인해 기존 config 원문 검사와 불일치한 것으로, config.toml을 저장소의 LF로 복원 후 재실행했다. assertion/JWT 보호는 그대로다.
- 자체 검수: 사용자 identity는 서버 getUser/DB Kakao identity에서만 확정, privilege escalation/직접 DML/차단 회원 재가입 방지, 일회용 challenge·신선도·동시 요청·예산, 토큰 비기록, 고정 Google 목적지·시간/크기 제한을 대조했다. 독립 리뷰라는 의미가 아니다. 고정 SHA CI와 live proof는 별도다.
- 추가 개발 도구: 공식 gitleaks/gitleaks v8.30.1 Windows x64를 사용자 LocalAppData/MOTOCAST/Tools에 설치해 후보의 비밀값 검사를 수행한다. 기존 SDK/설정은 보존했다.

## Preview 적용 및 중단 지점

서버 후보 f0dae96df0ac445c6c3182c9c2a5f9dba3d5eb87, PR75, CI36218656235 PASS(단위683, Chromium49 PASS/2 SKIP, Deno6/lint/typecheck/build). GitHub Deployments0와 Vercel checks/statuses0 확인 후 Preview migration20260926044619(play_verified_membership, 로컬20260926040355 동일SQL), play-admission v1 ACTIVE/JWT true/bundle fe7528837afd7d1a815025107287b58a8040b002ea150a3ddce74dea02b1c89a 적용. 새 RLS2개/직접권한0/내부RPC3개service_role만/기존11+신규3 전체14/전체public service_role DML0/미인증401 PASS. 기존7개 Edge 버전은 그대로다. 새 challenge/budget 행0.

Android PR8 head7ed1dfacc1bd8bc3a473071e2666426cf1a2f16c, CI36218971258 Required PASS, Android5분34초/docs12초. 두 PR은 draft 미병합, develop/main 불변, 새 AAB/Play 배포/실제 신규 증명/기기 업데이트 NOT_RUN.

후속 잠금 검수에서 가능성을 조사했지만 실제 Play/초대 RPC 동시 완료9번째 DB 시나리오 PASS. 기존 초대의 consumed_by 외래키 잠금이 membership 삽입보다 먼저라 우려한 교착은 재현되지 않았다. 제품 SQL은 그대로 두며 추가 회귀 테스트는 다음 후보에 포함할 로컬 변경으로 보존한다. 같은 task-owned DB, 신규 자원 없음.

서비스 계정/키 생성은 완료, JSON 파일 경로와 Preview secret 저장은 미확인/NOT_RUN. Codex 브라우저 download event가 시간 초과되고 파일명으로 사용자 경로 검색 결과0, Play 공개 SHA256 복사도 Console 오류/빈 clipboard 반환. 중복 키를 만들거나 미확인 인증서를 허용하지 않았다. 사용자가 다운로드 저장 위치를 확인하도록 질문했다. 로컬 보호 디렉터리 LocalAppData/MOTOCAST/Signing/play-integrity는 owner-only DACL(1 grant), 파일0개로 준비했다. key 내용은 출력하지 않는다.

Figma 재인증 후에도 UNAUTHORIZED라 기존 화면 문구·초대 입력만 최소 변경하는 선택을 질문한 상태다. 답변 전 UI 변경/내부 출시를 보류한다. 새 가입은 secret 설정 부재로 fail-closed, 기존 회원·초대 경로는 유지한다. 키 위치/화면 선택 확인 → 정확한 Play 서명 SHA256과 secret 설정/Google 서버 연결 검사 → 최종 앱/UI 검증/PR 승격/서명 AAB/내부 출시 → Play 설치본의 실제 신규 가입·업데이트 확인 순서로 재개한다.

## 공유 링크 앱 연결 결함 인수 · 2026-09-26

사용자가 다른 세션의 공유 링크 수정을 이 세션으로 인계하도록 요청했다.
인계 정본은 기본 웹 checkout의
`C:/Users/User/Desktop/coding/Side_Project/MOTOCAST/docs/work/research/2026-09-26-android-share-app-links.md`다.
실제 Android manifest에 autoVerify 한 줄, 기본 웹 checkout에 공개 assetlinks 응답과
proxy 제외 및 회귀 검사가 미커밋 상태로 있음을 확인했다. 본 가입 후보/추가 DB 검사와
다른 사용자 변경은 보존한다.

공유 연결은 가입 검증과 별도 완료 조건을 유지하되 사용자 요청에 따라 다음 Play
후보에 함께 반영한다. 공통 선행조건은 정확한 Play 서명 SHA-256이다. 공개 호스트
선택은 OPS-005의 Preview 보호에 영향을 주므로 선택 질문을 제시했으며, 선택 전
보호 해제나 신규 사이트 외부 배포는 하지 않았다. 가입 키 파일 위치와 최소 UI
변경 선택도 아직 미응답 상태다. 진행 순서와 실제 기기 완료 조건은 인계 정본에서
관리하며 이 단계에서 새 빌드·검사·외부 변경은 실행하지 않았다.

## 사용자 입력 없이 가능한 작업 진행 · 2026-09-26

사용자의 “할수 있는것 먼저 진행해” 요청으로 인계된 공유 인증 파일/회귀 검사와
정확한 proxy 제외를 이 격리 후보에 통합했다. 기본 checkout의 원본과 무관한 dirty는
그대로 보존한다. 공개 호스트 선택 전에도 가능한 구현·검토·검증·PR 반영을 진행하며,
호스트 변경·보호 해제·비밀값 적용·내부 출시는 별도 선행조건이 남아 있다.

- 웹: Node20.20.2에서 lint/typecheck, Vitest699 PASS/FAIL0/ERROR0/SKIP0,
  Chromium49 PASS/2 SKIP, build PASS. 기존 두 connected 시험은 실제 인증/서버 mutation
  입력이 없어 SKIP이며 통과 수에 포함하지 않는다. Deno6 entrypoint PASS.
- 최초 npm.cmd 실행은 시스템 Node24 launcher를 사용했다. 동일 소스를 명시적인 Node20
  실행기로 다시 검증했다. npm exec로 버전을 조회하는 과정에서 공식 npm의 node22.23.3이
  사용자 임시 npm cache에 추가됐지만 검증 기준이나 시스템 Node를 교체하지 않았다.
- 실제 로컬 build HTTP에서 설정 누락503/no-store와 합성 공개 지문 설정200/JSON을
  각각 확인했다. 두 응답 모두 cookie/redirect 없음 PASS. 임시 서버는 localhost3217의
  작업 소유 자식 process만 사용하고 종료했다. 공개 Hosted 검증으로 확대하지 않는다.
- DB9개 가입/경합 시나리오는 이전 동일 SQL·동일 회귀 코드의 실제 PASS 근거를 재사용한다.
  DB·migration·제품 auth 함수 변경은 없으며 추가 자원/중복 DB 실행은 만들지 않았다.
- Android autoVerify와 상태 문서를 9e7b79a942799ca7031f1e8574c826664e62690f에
  커밋/push했다.320 PASS/FAIL0/ERROR0/SKIP0(기존 Gradle 단위 결과 재사용), APK/lint,
  기기 시험 APK 컴파일, 문서44개, merged manifest의 verified filter1개 PASS.
  XML 확인 스크립트의 초기 null 처리 오류는 namespace XPath로 고쳐 재검증했다.
  PR8 후속 CI36221823304는 이 기록 시점 진행 중이다.
- Play 현재 일반/양자 서명 SHA256은 clipboard를 비운 뒤 각 버튼에서 읽어 구분했다.
  Console이 직접 제공하는 연결 JSON 지문까지 공개 설정 후보 JSON에 기록했다.
  스니펫 지문의 세대 대응과 실제 Play proof는 별도 미확인이다. 설정 후보는
  `docs/operations/play-signing-certificates.json`, 절차는 `docs/operations/android-app-links.md`다.
- Figma 재확인도 재인증 오류다. 기존 B01 화면 코드 변경은 보류한다. JSON 서비스 키
  파일 위치, 공유 공개 호스트 결정, 화면 최소 변경 선택은 아직 미응답이다.
- 서버 비밀값·Vercel 보호·Play 트랙 변경 없음. 새 AAB/실제 Play 가입·기기 링크 검증은
  NOT_RUN이며 후보 PR 병합 전 상태를 유지한다.

### 이번 진행의 최종 확인

위 중간 기록 이후 서버236f5d5c4931ff37eab44704b7447d7c32a416a8의
CI36221944855 PASS(verify2분38초), Android9e7b79a942799ca7031f1e8574c826664e62690f의
CI36221973624 Required PASS를 확인했다. 앞선 Android36221823304는 PR edited 이벤트로
취소되어 PASS로 세지 않으며 후속 같은 head 검사가 성공했다. Android의 manual-only
targeted job3개 SKIP은 PR 필수 검사와 별도다. 제목/본문 후속 수정으로 중복 CI를
일으키지 않도록 이번 완료 기록은 먼저 로컬에 보존한다. 두 PR은 draft/OPEN/미병합이다.
서버 새 head의 GitHub Deployments0/Vercel check0/status0을 CI 종료 후 다시 확인했다.

추가로 승인된 기존 로컬 업로드 키를 이용해 **검증용** Play0.2.0/code4 AAB/APK를
생성했다. release 단위320 PASS/FAIL0/ERROR0/SKIP0, lint, 서명, 패키지·비디버그,
zipalign/native16KB PASS. Play/debug 가입 flag 분리, Cloud 프로젝트 번호 및 release
App Links manifest도 PASS. 이 소스는 UI/호스트가 미완료여서 출시 후보로 승격하지 않는다.
AAB SHA256: `d01bf73b3e9f3da2f198232e72c1f63917968ecc73bae6eabae2b1a72ed53a81`.
Android 로컬 `verification-logs/play-internal/9e7b79a-preflight/`에 AAB/APK/로그/근거를
보존했다. 최종 main 소스에서 다시 만들어야 하며 Play 업로드·기기 실행은 NOT_RUN이다.
서버 키 파일·공개 호스트·UI 선택/연결이 해결되면 단계5를 재개한다. Notion 기록은
필수 접근 확인 도구 미노출로 NOTION_UPDATE_PENDING을 유지한다.

## 고정 앱/테스터 주소의 Vercel 로그인 제거 · 2026-09-26

사용자 요청: "vercel 로그인 없이 앱 + 카카오 로그인 만으로 볼 수 있게".
기존 공개 호스트 결정 대기를 해소했다. 현재 발행/수신 호스트를 유지하고 Vercel
Deployment Protection Exceptions에 이 호스트 하나만 추가한다. 다른 Preview URL,
Production 코드/서버, 카카오 회원 권한·공유 회수·서버 키는 변경하지 않는다.

실행 계획: (1) DONE 설정 화면과 정확한 호스트·기존 인증 경계 확인 및 OPS-005 갱신,
(2) DONE 고정 호스트 예외 저장·새로고침 확인,
(3) DONE 무인증 페이지/개인 API/공유 오류/다른 Preview 보호 readback,
(4) DONE 결과 기록. 인증 파일 신규 코드 배포와 Play 신규 앱 출시는 별도 단계이며
키 파일/UI 선행조건은 계속 남아 있다. 기존236f5d5/9e7b79a의 통과한 소스 검증을
재사용하며 이번 설정 변경을 새 기기/App Links 성공으로 확대하지 않는다.

### 적용 결과

Vercel `tocomboys-projects/motocast`의 Deployment Protection Exceptions에
고정 호스트1개를 추가하고 새로고침 후 목록 유지를 확인했다. 기본 Require Log In은
켜진 상태이며 Protected Sourcemaps/다른 설정은 변경하지 않았다. 원래 `/login`의
HTTP302 Vercel `/sso-api` 이동은 아래 공개 readback에서 사라졌다.

- `/login`:200, 카카오 로그인 화면 PASS.
- `/share`:200, 공개 공유 진입 화면 PASS.
- `/admin/invites`:307 `/login`, 비로그인 관리자 화면 접근 거부 PASS.
- `/api/shares/course`:쿠키/토큰 없는 합성 요청401, 개인 코스 조회 거부 PASS.
- `/api/shares/resolve`:합성 유효형식 토큰에404, 없는 공개 공유 거부 PASS.
- 동일 배포의 별도 URL `motocast-j3b65mtp1-tocomboys-projects.vercel.app/login`:
  302 Vercel 로그인, 다른 개발 URL 보호 유지 PASS.
- `/.well-known/assetlinks.json`:404. Vercel 차단은 해소됐지만 신규 인증 파일 코드는
  아직 배포되지 않았으므로 실제 App Links 성공은 NOT_RUN이다.

검증은 비로그인 HTTP 요청만 사용하고 실제 공유 토큰/쿠키/회원 데이터는 읽거나
수정하지 않았다. readback은 로컬 `verification-logs/play-admission/public-origin-readback.json`,
설정 화면은 이 세션의 `vercel-fixed-origin-public.png`로 보존했다. 현재 제공 중인
웹 소스6826174와 Android code3은 그대로다. 카카오 신규 가입/실기기 로그인은 이번
설정 readback으로 검증하지 않았다. 복구는 이 도메인 예외 한 개를 회수하는 방식이며
카카오 회원/사용자 데이터나 배포 코드를 되돌릴 필요는 없다. 복구 실행은 하지 않았다.

이번 변경은 정책/운영/작업 기록4개만 변경하므로 이전 동일 제품 코드의 로컬 검사
근거를 재사용한다. 비밀값 검사와 정확한 docs diff를 확인하고 기존 PR75에 반영한다.

### Node.js 지원 종료 대응 후 작업 기준 갱신

사용자의 Vercel Node.js 경고 수정 요청에 따라 독립 PR76이 develop에 반영됐다.
현재 Preview 소스는 `9bcf151fa7af3ae8003fef4db980e1a5a11f1547`, 실제 Vercel
런타임은 Node.js 24.21.0이다. 이전6826174 기준은 과거 증거이며, 이후 PR75
승격 전 기준 검사는 새 develop SHA와 비교해야 한다. PR75에도 해당 변경을
병합하여 Node20을 재도입하지 않도록 했다. 기존 OPS-005 공개 주소 예외,
Play 가입/앱 링크 준비와 모든 미완료 조건은 유지한다.

통합 후 로컬 Node24.12.0: lint/typecheck, Deno6 entrypoints, build PASS;
Vitest699 PASS/0 FAIL/0 SKIP, Chromium49 PASS/2 기존 연결 전용 SKIP.
런타임 PR의 깨끗한 Node24 의존성 설치와 동일한 의존성 버전을 사용했다.
PR75는 CI 전용 브랜치로 유지하며 이 통합 커밋을 웹에 배포하지 않는다.
별도 [Node24 작업 기록](2026-09-26-node24-runtime.md)에 설정/배포/복구 근거를 남겼다.

## Figma·검증 키 복구 및 설정 적용

사용자의 "막혀있던 내용들 진행해봐"에 따라 기존 Preview/내부 테스트 범위로 재개했다.
Figma whoami와 B01 디자인 읽기 PASS. Android 기존 원본을 보존하고 P01(192:1915),
P02(192:1938), P03(192:1961)을 만든 뒤 초대 없는 Play UI를 구현했다. Android 기록은
`docs/play-signup-ui.md`이며 단위320개·실제 Compose16개 동작(4화면 크기) PASS다.
서버 SQL·가입 endpoint 소스는2feeb1b 이후 변경하지 않았다.

Google JSON 다운로드가 다시 파일을 전달하지 않아 동일 계정에 로컬 생성 RSA2048
공개 X.509 인증서를 등록했다. 비공개 PKCS8·서비스 계정 JSON은 소스 밖 owner-only
폴더에 보관했다. 공개키 readback 일치, OAuth200 및 합성 잘못된 token의 decode400
INVALID_ARGUMENT PASS. 이는 실제 Play 설치 증명 성공을 뜻하지 않는다.
사용자가 미사용 키2개 삭제를 승인했고, d125c4146f3b…와 a8cb24263f1c… 삭제 후
사용자 관리 키는 a998e254020d…1개만 남음을 Console에서 확인했다. 만료2027-09-26
전 교체가 필요하다. 계정 IAM/Play 출시 역할은 추가하지 않았다.

Preview `lehjmbgfpoemqcwxowbx`에 PLAY_ADMISSION_SERVICE_ACCOUNT, PROJECT_ID,
CERTIFICATES, VERSIONS(4)를 저장하고4개 SHA256 digest를 로컬 입력과 대조했다.
Supabase CLI는 로그인 없음 ERROR로 쓰지 않았으며, 승인된 프로젝트의 비밀값 UI를
사용했다. secret 변경 후 play-admission은v3/ACTIVE/JWTtrue, 코드 bundle hash는
기존fe752883…와 동일하다. 다른7개 함수의 코드 배포는 하지 않았다.
설정 전 PR75 head2feeb1b CI PASS·GitHub Deployments0·Vercelchecks/status0 재확인.

키/인증 토큰은 로그·명령 인자·저장소에 기록하지 않았다. 로컬 readback은
`verification-logs/play-admission/google-key-readback.json`와`secret-digests.json`이다.
Production 변경 없음. 웹 인증 파일 배포·최종 앱 승격/내부 출시 및 실제 신규 가입은
다음 단계이며, 위 설정만으로 완료 처리하지 않는다.

## Preview 웹 배포 확인

서버 PR75 head33add25646fad98d43a136f71ecdfdaf928c0c51의 CI36229365274 PASS,
배포 전 GitHub Deployments0/Vercel checks0/status0을 확인했다. origin/develop이
검토 기준9bcf151임을 직전 재확인하고 동일33add25로 fast-forward했다. PR75 MERGED.
배포 dpl_7hznXgnHkVkmoStVRb5dyLd9ZWvZ는 develop/Preview/Ready, 빌드30초다.
GitHub Deployment6676577894 success, push 이후CI36229541011도 PASS다.

- assetlinks200 JSON, 쿠키·redirect 없음, Console 공개 SHA256 3개 일치 PASS.
- login/updates의0.5.0과 공개share200 PASS.
- 비회원 admin307/login, 개인course401, 합성 없는 공유404 PASS.
- 다른 Preview URL의 Vercel302 보호, 무인증play-admission401 PASS.
- 총9개 HTTP 점검 PASS. 실제 신규 가입·기기 도메인 검증과 업데이트는 NOT_RUN.

고정 SHA 자체 검수에서 인증·권한·원자적 가입·예산·키 비노출·앱 취소·Play/개발
UI 분리를 대조했으며 미해결 BLOCKER/HIGH는 없다. 독립 리뷰라는 의미가 아니다.
새 키/환경 설정·배포 증거는 로컬 verification-logs/play-admission에 보존했다.
Vercel connector403은 인증된 기존 브라우저로 확인을 마쳤고 우회 토큰을 만들지 않았다.
문서 동기화는 앱 링크 상태/서명 설정/인증 운영/이 작업 기록만 수정했다.
README의 AUTH-007 설명·제품 정책·DB 구조는 변경 없음, 시간순 과거 기록은 보존한다.
Production main259f486 및 Production 프로젝트는 변경하지 않았다.
