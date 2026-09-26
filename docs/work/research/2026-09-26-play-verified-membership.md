# Play 설치 검증을 통한 신규 회원 가입 — 2026-09-26

## 확정 범위

AUTH-007: 서버가 Play 설치 증명을 검증한 신규 카카오 사용자는 초대 없이 일반 회원으로 가입한다. 기존 차단 회원·권한·소유권·예산은 유지한다. Preview와 Play 내부 테스트의 구현·검증·필요 배포가 승인됐다. 웹 Production 변경과 공개 출시는 포함하지 않는다.

현재 배포된 Android 0.1.0/code3에는 이 기능이 없다. 사용자가 Play 설치 성공을 보고했지만, 새 가입 방식·실제 로그인·다음 버전 업데이트 검증을 대신하지 않는다.

## 실행 계획

1. 완료: 정책 정본, 신뢰 경계 및 외부 Play Integrity 프로젝트 연결 확인.
2. 완료: 서버 증명 검증·일회용 가입 요청·원자적 회원 생성, 실제 DB/실패/권한 검사 및 고정 SHA CI 후 Preview DB/Edge 적용. 비밀값 설정은 별도 대기.
3. 진행: Android 로그인 320 PASS. Figma 연결 오류로 화면 변경만 대기하며, 공유 App Links 준비 코드를 기존 후보에 통합한다.
4. 진행: 공유 인증 파일과 추가 가입 동시성 검사의 후속 후보 검증 및 PR 갱신. 도메인 선택·키 파일이 필요한 외부 설정은 보류.
5. 대기: 실제 Google 연결, 최종 UI/서명 후보, 내부 테스트 배포 및 Play 설치본 가입·공유 링크·업데이트 확인.

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

로컬 서버·실제 DB·Android 인증 구현 검증과 Hosted Preview DB/Edge 적용은 아래 최신 기록을 따른다. Play Integrity 프로젝트 연결 완료. 서버 비밀값 설정, 실제 Google 증명·새 앱 출시는 아직 NOT_RUN이다.

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
