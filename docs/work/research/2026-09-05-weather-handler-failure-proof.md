# 실제 weather handler의 격리 실패 검증

> **최신 범위 보완:** 이후 임시 Auth 권한149 PASS와 [별도 seeded 공유 차단 연결11 PASS](2026-09-06-negative-share-connected-proof.md)가 완료되고 모든 시험 자원을 정리했다. 이 문서의 handler16 PASS는 계속 격리 증거다. 아래 승인 대기와 공유 fixture 미완료 기록은 당시 상태이며, active v12 공급자·예산 실패 및 전체 Production gate는 아직 미완료다.

2026-09-05. **READY — 제품 코드 변경 없이 현재 handler와 auth/예산 helper를 실행하는 격리 시험.**

기준 develop/origin `98afe0231faf5b718c8812be7bc3e0b784b6eae3` 불변. 앞선 로컬 DB 실행 승인 요청은 미답변이며 이번 검사는 해당 SQL 명령을 실행하거나 우회하지 않는다. 원래 Preview 검증 목표의 독립 준비 범위다.

- 목표 계약: COST-001~002, AUTH-001, 날씨 request/response exact issuance 및 기존 HH00/:45 선택 규칙을 보존한다. 예산 미설정/0/소진은 외부 공급자 요청 전에 차단되고, 이미 저장한 snapshot은 실패 종류와 함께 stale로 반환된다. 저장본이 없으면 안전한 오류를 반환한다. stale 표시 DB mutation 실패를 성공으로 위장하지 않는다.
- 소유 파일: lead가 `/tmp/motocast-weather-handler-20260905/`의 도구와 이 문서만 작성한다. repo의 weather index/auth/http/KMA helper, 사용자 파일, settings/secrets, 예산/DB는 변경하지 않는다.
- 방법: 기존 검증 복사본에 설치된 TypeScript compiler로 현재 `supabase/functions/weather-timeline/index.ts`와 실제 shared/auth.ts의 의존 모듈을 읽어 ESM으로 변환한다. 외부 SDK import만 가짜 createClient로 대체하고 Deno.serve callback을 포착한다. fetch는 네트워크를 쓰지 않는 고정 실패 adapter다. 실제 Request를 callback에 전달해 status/body, budget RPC 호출 수와 순서, provider 요청 수, 저장본 조회·stale marker 호출 및 안전한 진단을 확인한다. 최초 esbuild 시도는 해당 패키지 부재로 SETUP_OR_IMPORT_FAILURE1이며, 추가 설치 없이 이미 설치된 TypeScript5.9.3을 사용하도록 실행기를 수정했다.
- 증거 한계: `ISOLATED_CURRENT_HANDLER`이며 실제 Preview DB/RLS, 실제 quota, 실제 KMA 실패, 실제 Kakao 로그인 증거가 아니다. active v12 실패 gate와 기존 정상 공급자 연결 PASS를 대체하지 않는다.
- 검증 기준: 회원 거절, budget missing/zero/exhausted와 저장본 없음/있음, 공급자 실패의 예산 선예약, fresh cache에서 무호출, stale mark 실패, 안전한 진단. PASS/FAIL/ERROR/SKIP/DESELECTED/XFAIL/SETUP_OR_IMPORT_FAILURE/NOT_RUN을 구분한다.
- 중단 조건: 외부 네트워크 접근, 실제 인증자료 필요, 실제 DB 쓰기, source/정본 불일치. 테스트용 fallback이나 assertion 완화로 통과시키지 않는다.

## 진행 상태

1. 완료: 실제 소스와 기존 helper 테스트 대조; 요청 처리 전체 실패 순서의 실행 근거 부족 확인.
2. 완료: 현재 handler 격리 실행 16 PASS. 실제 SDK/네트워크/DB는 연결하지 않았다.
3. 완료: 고정 도구 hash 독립 read-only 검토 APPROVE — 격리 proof 한정, B0/H0/M0/L0. 검토자는 입력11개 hash/고정 commit 일치까지 독립 확인했고 시험은 재실행하지 않았다.
4. 미완료: active Preview failure/budget 연결 gate 및 전체 Production 목표.

## 실행 증거

명령은 `node /tmp/motocast-weather-handler-20260905/handler-proof.test.mjs`이다. TAP 원문에 각 16사례 이름과 `tests16/pass16/fail0/cancelled0/skipped0/todo0`가 출력됐다. PASS16/FAIL0/ERROR0/SKIP0/DESELECTED0/XFAIL0/SETUP_OR_IMPORT_FAILURE0/NOT_RUN0은 이 격리 실행에만 해당한다. 최초 esbuild 부재는 별도 SETUP_OR_IMPORT_FAILURE1로 보존한다. `node --test` 실행은 파일 단위 PASS1만 표시했으므로 사례별16PASS 근거로 사용하지 않는다.

| 사례 | 수 | 확인한 결과 |
| --- | --- | --- |
| 한도 missing/0/소수/소진 × 저장본 없음/있음 | 8 | provider 요청0; 미설정 RPC0, 소진 RPC1; 없음은503/429, 있음은 원래 발표·만료시각과 forecasts 유지 + stale 종류/대상 식별자 확인 |
| 공급자 HTTP 실패 × 저장본 없음/있음 | 2 | 실제 consumeBudget helper의 예약 RPC가 가짜 provider보다 먼저1회; 없음502, 있음stale/provider |
| 공급자 네트워크 실패 | 1 | 민감한 합성 오류 문자열 미노출, 기존 snapshot 발표시각 유지 |
| fresh cache + 한도0 | 1 | cache조회200, budget/provider/stale marker 모두0 |
| stale marker DB 실패 | 1 | 성공 weather payload 없음, 외부호출0, 원래 budget error429 |
| 비정상 예산 예약 반환값0 | 1 | provider 요청0, persistence 실패로 기존 snapshot 반환 |
| 비로그인/회원회수 | 2 | 401/403; route/snapshot 조회와 예산/provider 호출 전 거절 |

제품 handler/auth 포함11개 source 입력 hash는 모두 고정 git98afe02의 해당 파일과 byte 단위로 일치했다. 입력별 SHA-256은 외부 도구 디렉터리 `source-inputs.json`에 있다. 도구 hash는 `d10a1a8d590c16a49a64868242210ece9a852178c627f62757e1786363707584`다. 제품 파일 변경, dependency 설치, DB 접속, provider 호출, 원격 mutation, commit/push/배포는0이다.

## 남아 있는 실제 연결 조건

이 검사는 현재 handler가 실패를 어떻게 처리하는지에 대한 추가 근거다. 실제 회원 세션/RLS, 실제 KMA 오류 이후의 저장본 쓰기·읽기, 실제 예산 장부 조건 및 공유 preview/publish 거절을 입증하지 않는다. 원래 Preview gate는 그대로 미완료이며, 시험 계정 준비와 별도 합성 snapshot 제어는 분리 도구 계약을 따른다. 마지막 로컬 SQL 실행 승인 요청도 계속 미답변이다.

최종 `git diff --check` PASS. 이번 턴은 실제 handler 격리 실행 증거와 독립 검토를 추가했으므로 progress다. 승인 대기를 살아 있는 도구/프로세스의 verified wait로 기록하지 않는다. 전체 Goal은 미완료/active이며 Production 승격 승인은 요청하지 않는다.
