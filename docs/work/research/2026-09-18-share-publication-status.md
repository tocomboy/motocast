# 공유 미리보기 발행 상태 — Issue #66

- 기준: `develop` / `31f87e9d622fd313a10ffffbfdcc7f88e32040d9`, 제품 버전 `0.4.1`.
- 과제: [공유 발행 상태 문구 #66](https://github.com/tocomboy/motocast/issues/66).
- 정본: [SHARE-001 / SHARE-002 / SHARE-003](../../product/MOTOCAST_SOT.md#share-001--explicit-immutable-sharing).
- 최초 범위: 로컬 수정·검증. 아래 9월 18일 결과는 당시 기록이며, 9월 21일 배포 진행 상태는 마지막 절에서 구분한다.

## 사용자 결정과 작업 순서

2026-09-18 사용자는 “2는 추후 버그 발생시 수정하는걸로 하고 1 -> 3 순서로 갈거야”라고 결정했다. #66 공유 문구 수정·검증 뒤 [Android API 기반 #30](https://github.com/tocomboy/motocast/issues/30)을 준비한다. 카카오맵 [#59](https://github.com/tocomboy/motocast/issues/59)의 잔여 PC/Android/iPhone·PWA·미설치/스토어 복귀 검증은 다음 개발의 선행조건에서 제외하고 실제 버그 발생 시 대응한다. 미실행 검증은 `NOT_RUN`이며 통과나 전체 제품 검증 완료로 바꾸지 않는다. 이 순서 결정은 새 운영 배포나 인증 정책 변경을 의미하지 않는다.

## 문제와 수정

`components/share-manager.tsx`는 발행 성공 뒤에도 현재 미리보기 상단에 `아직 공개되지 않았습니다.`를 고정 출력했다. 기존 발행 결과를 현재 trip/session과 결속하여 표시하고, 해당 링크의 회수 성공 여부를 같은 상태에 보관한다.

| 현재 미리보기 | 상단 안내 | 링크와 발행 버튼 |
| --- | --- | --- |
| 생성 완료·발행 전 | 아직 공개되지 않았습니다. | 승인 정보가 유효할 때 발행 가능 |
| 발행 성공 | 공유 링크를 발행했습니다. | 발행 링크 표시, 소비된 승인으로 재발행 불가 |
| 해당 링크 회수 성공 | 공유 링크를 회수했습니다. | 링크 원문 제거, 새 미리보기 안내 |
| 새 미리보기 생성 성공 | 아직 공개되지 않았습니다. | 새 승인으로 발행 가능, 기존 발행 기록 유지 |
| 회수·재생성 실패 | 마지막 확인된 발행 상태 유지 | 실패는 기존 live status로 표시 |
| trip/session 변경 | 이전 미리보기·발행 결과 숨김 | 기존 경계 유지 |

발행/회수 RPC, 불변 snapshot, 명시적 승인, 토큰 만료, DB 권한과 API 호출 수는 바꾸지 않는다. 상단 안내는 현재 화면에서 확인한 결과이며 다른 기기에서의 회수를 실시간 구독하는 기능은 아니다.

## 실행 검증

- 환경: WSL Node `20.20.0`, tracked 기준 소스와 변경을 복사한 키 없는 `/tmp/motocast-share-66-p9OZHX`. 기존 설정·인증 자료는 복사하지 않았다.
- `npm ci`: PASS, lockfile의 408개 패키지 설치. 새 SDK/전역 도구 설치 없음. 기존 Playwright Chromium 사용.
- 수정 전 회귀 검사: **15 PASS / 2 FAIL**. 발행 성공 후 고정 문구를 재현했다.
- 수정 후 관련 검사: **17 PASS / 0 FAIL**. 발행→회수→재생성, 실패 시 상태 보존, 새 미리보기와 이전 이력 분리, session 변경 시 숨김 포함.
- 전체 단위: **75 files / 646 PASS / 0 FAIL**. ESLint·TypeScript·Deno 5개 진입점·production build: **PASS**.
- `npm run test:e2e`: **49 PASS / 2 SKIP / 0 FAIL**, Chromium 1 worker / retry 0. 기존 연결 전용 SKIP은 PASS에 포함하지 않는다.
- 연결 전용 공유 테스트에 발행/회수/재생성 상단 문구 검사를 추가했다. 이 변경의 실제 Preview 공유/회수 실행은 **NOT_RUN**이다.

## 문서 영향과 다음 단계

- Update: 이 기록, README의 다음 작업, 카카오맵 실행 계획의 잔여 검증 처리, Android 요구사항의 착수 순서.
- Verified unaffected: SHARE-001/002/003의 승인·불변 공유·토큰 계약, 검증/배포 규범, DB schema/migrations, 운영 복구 지침. 기존 확정 계약을 복원하는 UI 수정이다.
- Archive/history excluded: 이전 릴리스 당시 검증·대기 기록은 보존한다.
- 자체 검수: 현재 preview/발행 결과의 trip/session 결속, 성공한 정확한 링크 회수, 실패 시 발행 상태 보존, URL 원문 제거와 재발행 승인 보호를 대조했다. 변경 범위의 미해결 BLOCKER/HIGH/MEDIUM 0. 독립 리뷰가 아닌 단독 자체 검수다.
- 최종 검사: 단위·브라우저 검사에 사용한 소스 3개와 현재 파일의 SHA-256/bytes 일치 PASS, Markdown 상대 링크·앵커 검사 PASS, 변경 8개 파일의 비밀값 패턴 검사 발견 0, 일반/CRLF-aware `git diff --check` PASS. 새 인증·DB gate를 실행한 것으로 확대하지 않는다.
- 다음 단계 준비: [#30 API·로그인 계약 초안](2026-09-18-android-api-contract-preparation.md)을 작성하고 Notion 프로젝트의 결정·다음 행동을 갱신했다. 설계 준비와 앱/서버 구현·게시·배포 결과는 구분한다.

## 2026-09-21 공유 수정 배포와 Android 환경 분리

사용자가 공유 문구 확인·배포와 별도 Android 개발 환경 구성을 요청했다. 공유 수정은 `0.4.2` 호환 패치로 배포하며 package/lockfile/releases를 함께 갱신한다. Android 앱 코드는 이 웹 릴리스에 포함하지 않는다. DB·Edge Functions·회원 권한·공유 RPC 변경은 없다.

진행 계획:

1. COMPLETE — 현재 공유 상태 변경 자체 검수, 버전 일치와 필수 로컬 검사. 기존 수정·실패 기록 보존.
2. IN_PROGRESS — 고정 후보의 CI 전용 PR, 무배포 확인, develop/Preview와 실제 발행·회수·새 미리보기 검증.
3. PENDING — develop → main 승격, 정확한 Production 버전·배포·공유 동작·로그 검증, 태그·Release 게시.
4. PENDING — 웹 작업 폴더와 별도 Android 프로젝트·도구 구성, Preview 연결 설정과 빌드 검증. 앱 로그인·주행 기능 구현은 별도 #30 이후 범위.

완료 조건은 공유 상태가 실제 배포에서 확인되고, 별도 Android 환경에서 재현 가능한 개발 빌드가 성공하는 것이다. 신규 라이더·예산 소진 등 전체 제품의 기존 미실행 검증은 이번 UI 패치 성공으로 대신하지 않는다.

### 0.4.2 최종 로컬 후보 검증

- 환경: WSL Node 20.20.0 / npm 10.8.2, 인증정보 없는 별도 소스 복사본. Windows 소유권 확인이 필요한 Git/WSL 호출은 사용자 실행 환경에서 수행했다. 기존 작업 폴더·설정·계정을 보존했다.
- 첫 설치는 비로그인 셸이 Node 12.22.9를 선택하여 SETUP_OR_IMPORT_FAILURE. 기존 Node 20 경로를 명시한 뒤 `npm ci` PASS. 도구 업그레이드나 검증 완화는 없다.
- 단위 **75 files / 646 PASS / 0 FAIL**. ESLint, TypeScript, Deno 5개 진입점, production build **PASS**.
- 첫 Chromium **45 PASS / 4 FAIL / 2 SKIP**: 새 버전에서 공지 문구·릴리스 개수의 이전 기대값이 남은 검사 오류. 새 공유 안내와 이전 0.4.1 이력을 함께 검사하도록 수정했다. 최종 전체 Chromium **49 PASS / 0 FAIL / 2 SKIP**, worker 1 / retry 0. SKIP 2개는 기존 실제 연결 전용이며 PASS에 포함하지 않는다.
- 자체 검수: SHARE-001/002/003의 명시적 발행, 소비된 승인 재사용 금지, 정확한 링크 회수, 회수 후 원문 제거, 실패 시 마지막 상태 보존, trip/session 격리 및 새 미리보기와 발행 이력 분리를 확인했다. 미해결 BLOCKER/HIGH/MEDIUM 0. API·DB·인증 경계와 이전 릴리스 이력은 유지한다.
- 복구: 운영 웹의 직전 v0.4.1 결과물과 같은 DB/API 계약을 사용한다. 문제 발생 시 실제 운영 배포 ID와 영향 범위를 확인한 뒤 웹 결과물을 복구하며 데이터 초기화·DB downgrade는 필요하지 않다.
- 문서 영향: Update — README, 본 기록, 기존 Android 준비·요구사항과 카카오맵 잔여 검증 기록. Verified unaffected — 제품 공유 계약, 검증·운영 규범, DB schema/migration, 인증·비용 정책. 과거 검증·릴리스 기록은 당시 결과로 보존한다.
