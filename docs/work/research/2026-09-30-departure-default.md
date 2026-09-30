# 0.5.1 출발 일정 기본값과 월말 테스트 수정

## 범위와 결정

2026-09-30 사용자는 전역 설정 확인, 월말 테스트 수정, 과거 날짜·시간 거부 유지,
가장 가까운 5분 출발 기본값과 배포를 요청했다. 운영에 미배포인 develop의
Google Play 가입 기능(0.5.0)을 포함하는 배포 범위도 명시적으로 선택했다.
적용 계약은 PLAN-002, UX-001, SHARE-004, AUTH-007, OPS-002/003이다.

빈 선택창을 열 때 서울 기준 현재 이후 5분 시각을 제안한다. 14:02→14:05,
23:58→다음 날00:00이며 정확한 5분 경계는 유지한다. 기존 명시 일정은 보존한다.
제안·취소는 부모 일정에 쓰지 않고, 확인은 일정만 적용하며 계산·공유를 시작하지 않는다.
확인 시 현재 시각을 다시 검사한다. 서버의 신뢰 시각·provider·예산 거부는 변경하지 않는다.
컬렉션/받은 공유의 원래 일정은 복사하지 않는다.

## 변경과 원인

- departure helper에 5분 기본값을 추가하고 기존 1분 minimum/strict past 판정을 보존했다.
- 일정 dialog에서 열 때 제안하고 분 선택을 00–55의 5분 단위로 제공한다.
- 공유 준비 테스트가 당월 마지막 날08:00을 고르던 결함을 수정했다.
  테스트 시간을 서울9월30일17:57에 고정하고 다음 달1일08:00을 직접 선택한다.
- live E2E의 미래 출발 생성도 5분 단위로 맞췄다.
- package/lockfile/출시 기록/업데이트 화면 검증을0.5.1로 맞췄다.
  기존0.5.0 출시 기록은 보존한다.

## 전역 설정

원격 dev-environment/main과 보존된 source HEAD는
`7e2f139be9f0c9af57754db3b82c082236ea314e`로 일치했다.
현재 런타임의 전역 AGENTS.md와 config.toml이 없었고 check는 ADD2를 보고했다.
허용된 scoped 실행으로 정본 복원 후 check 종료0/Planned mutations0을 확인했다.
프로젝트 설정, 인증, provider, 권한은 변경하지 않았다.
설정 파일 복원과 이 에이전트의 지침 읽기는 확인했으나 새 채팅의 자동 복원,
환경 편집 화면의 시작 스킬 저장 상태와 현재 메인 모델 선택은 미확인이다.
워커는 routing에 따라 gpt-6.1-sol/high를 지정해 실행했다.

## 검증

- 수정 전 focused: PASS6 / FAIL5. 과거 시각 거부 자체가 정상이며 테스트 일정만 잘못됐다.
- 수정 후 focused: PASS24 / FAIL0. 초·밀리초/시간/일/월/연도/윤년, 취소/재열기,
  기존 명시 시각 보존, 확인 전 만료, 공유 준비의 자동 계산 없음 포함.
- release metadata: PASS3 / FAIL0.
- npm ci --offline: PASS (고정 lockfile, 기존 cache).
- npm run lint/typecheck: PASS.
- Deno2.9.6: 6개 entrypoint check PASS.
- npm test: 78 files / PASS712 / FAIL0.
- npm run build: PASS (Node24.19.0).
- 로컬 Chromium 첫 실행: SETUP_OR_IMPORT_FAILURE1 (webServer 시작 실패).
  허용된 로컬 서버/브라우저 실행 권한으로 재실행 PASS49 / FAIL0 / SKIP2.
  SKIP2는 기존 연결 Preview 전용 검사이며 통과 수에 포함하지 않는다.
- 연결 Preview/Production 로그인, 실제 경로/날씨/저장/공유 및 Play 신규 가입: NOT_RUN.

## 배포 준비와 한계

기준 develop은 `17e6faf84176d3dab687e9cce46c794ee83fa5e3`,
Production main은 `259f4866a0cb96c33e84423a048d385aacda65f0`이다.
먼저 slash-free review branch의 exact-head CI와 zero-deployment를 확인한다.
이후 동일 SHA의 develop Preview, 연결 검증, develop→main 승격 순서다.
태그/Release는 정확한 Production 배포 검증 후에만 발행한다.

현재 readback에서 Production은 기존14개 migration과5개 Edge Function이며
Play 가입 migration/function은 없다. AUTH-007 함수는 Preview 프로젝트만 허용한다.
운영 Play 활성화는 이 경계와 Android 대상/검증 계정 구성을 함께 준비해야 하며,
웹 소스에 포함됐다는 사실을 실제 운영 가입 성공으로 보고하지 않는다.
현재 작업에 Preview 로그인 storage state와 Vercel 관리 인증은 제공되지 않았다.
Vercel connector는 project 조회 인자 검증 오류, list_teams는 빈 목록을 반환했다.
GitHub 연결의 원격/CI/배포 상태 읽기는 가능하다.

새 일정 UI는 DB/Edge 변경 없이 기존 데이터와 호환된다. UI 복구는 이전 검증된
웹 commit을 정상 승격 절차로 배포하고 회원/코스/공유/예산 데이터는 보존한다.
이 작업은 Play 배포에 필요한 비밀값을 새로 만들거나 Preview에서 복사하지 않는다.

## 직접 검수

변경 diff와 관련 호출 경계를 직접 검토했다. 독립 리뷰라는 의미는 아니다.
- Correctness: 기본값과 strict minimum 분리, 명시 선택 보존, fresh clock 재검사 확인.
- Security: auth/token/DB/서버 경계를 변경하지 않고 제안으로 API를 호출하지 않음.
- Data integrity: ISO timestamp/서울 시간 변환과 자정·월말·윤년 경계 PASS.
- Route safety: provider/예산/이륜차 조건 변경 없음, 기존 전체 단위 검사 통과.
- UI/accessibility: 기존 dialog/focus/오류 흐름 보존, 12개 분 선택, responsive E2E 통과.
- Operations: CI-only 후보 준비. 운영 승격은 연결 Preview gate, Play 운영 대상 구성,
  Vercel 관리 확인을 해결하기 전 차단 상태다. 현 변경 코드의 미해결 finding은0건이다.
