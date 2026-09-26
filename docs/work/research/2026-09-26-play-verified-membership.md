# Play 설치 검증을 통한 신규 회원 가입 — 2026-09-26

## 확정 범위

AUTH-007: 서버가 Play 설치 증명을 검증한 신규 카카오 사용자는 초대 없이 일반 회원으로 가입한다. 기존 차단 회원·권한·소유권·예산은 유지한다. Preview와 Play 내부 테스트의 구현·검증·필요 배포가 승인됐다. 웹 Production 변경과 공개 출시는 포함하지 않는다.

현재 배포된 Android 0.1.0/code3에는 이 기능이 없다. 사용자가 Play 설치 성공을 보고했지만, 새 가입 방식·실제 로그인·다음 버전 업데이트 검증을 대신하지 않는다.

## 실행 계획

1. 완료: 정책 정본, 신뢰 경계 및 외부 Play Integrity 프로젝트 연결 확인.
2. 로컬 완료, 고정 SHA/CI 검수 진행: 서버 증명 검증·일회용 가입 요청·원자적 회원 생성과 실제 DB/실패/권한 검사.
3. 진행: Android 로그인 320 PASS, Figma 연결 오류로 화면 변경만 대기. 서명 후보는 후속.
4. 대기: 정확한 소스의 CI/Preview 적용, 실제 Play 증명 검증, 내부 테스트 새 버전 배포·설치/로그인/업데이트 확인.

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

로컬 서버·실제 DB·Android 인증 구현 검증은 아래 기록을 따른다. Play Integrity 프로젝트 연결 완료. Hosted DB/Edge/secret 적용, 실제 Google 증명·새 앱 출시는 아직 NOT_RUN이다.

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
