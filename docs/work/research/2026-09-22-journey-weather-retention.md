# 주행 날씨 캐시 자동 정리

현재 상태: 구현·실제 로컬 DB·자동 실행·필수 검사 완료. 신규 8파일 게시와 Preview 적용 승인 완료, 실행 대기. 기반은 Preview에 적용한 PR #74의 `a7c1cb5`이며 기존 원본의 미커밋 변경을 보존한다. 관련 결정은 WEATHER-001/002, COST-001/002, OPS-007과 확정된 주행 10분 갱신 계약이다.

## 작업 계획

1. 완료: 기존 캐시·사용량 원장·권한과 Preview 용량 읽기 확인, 삭제/재전송 경계 설계.
2. 완료: 정리 migration, 명시적으로 켜는 스케줄 SQL, 실제 PostgreSQL 경계·동시성 검사.
3. 완료: 변경 묶음 자체 검수·필수 검사·실행 증거. 게시와 Preview 적용은 고정 후보와 CI gate를 충족한 뒤 실행한다.

## 정리 계약

- 재사용 유효기간 10분은 그대로다. 만료한 ready payload만 `expired` 상태로 전환해 제거한다. token·generation은 당장 없애지 않는다.
- 서울 날짜 기준 오늘/어제의 발표 자료만 새 claim에 허용한다. 캐시 식별 행은 오늘-2일보다 오래된 발표이면서 lease·retry·expiry가 모두 지난 경우에만 삭제한다. 입장 허용 창과 삭제 창 사이 하루의 여유로 삭제 후 오래된 claim/start/finish가 살아나는 문제를 차단한다. 경로 복구는 항상 현재 발표 자료를 조회하므로 역사 자료 요청은 필요 없다.
- 개별 시도는 시작·완료 시각과 예약 날짜 모두 7일 보존 경계를 넘고 현재 캐시 token으로 참조되지 않을 때만 정리한다. 결과 미수신 시도도 같은 경계를 적용하며 별도 삭제 수로 보고한다. 결과를 성공/timeout으로 꾸미지 않는다.
- 일별 통합/종류별 사용량, 예산 정책, 회원·경로·공유·최종화 tombstone은 정리 대상이 아니다. 호출 수와 확보 용량을 환급하지 않는다.
- 각 단계 기본 250건, 최대 1,000건. 진행 중 잠긴 행은 `SKIP LOCKED`로 넘기고 다음 실행에서 처리한다. 정리끼리는 전용 짧은 advisory lock으로 겹침을 막는다. DB 소유자만 실행하며 anon/authenticated/service_role에는 실행 권한이 없다.
- 자동 실행은 별도 활성화 SQL로 5분마다 최대 1,000건씩 처리한다. 해당 job의 종료된 실행 기록만 7일 이후 제한 삭제해 스케줄 기록 자체의 누적도 막는다. migration만 적용해서 운영 작업이 켜지지는 않는다.
- 확장은 공식 Supabase Integrations에서 먼저 활성화하며 SQL은 확장 존재와 job 중지 권한을 확인한다. 준비가 안 되면 실행 전에 실패한다. 같은 이름에 다른 명령/DB/소유자가 있으면 덮어쓰지 않는다.
- 삭제된 공간은 autovacuum의 재사용 대상이며 파일 크기가 즉시 줄었다고 보고하지 않는다. `VACUUM FULL`, reset, 사용량 삭제는 사용하지 않는다.

## 완료 조건과 범위

실제 PostgreSQL에서 fresh migration, 만료 경계·살아 있는 요청·재시도 대기·소유자 교체·늦은 결과·권한·사용량 보존·배치 상한·잠금 경쟁·자동 실행을 검증한다. 정상 API 요청 계약은 기존 서버/Android 검증을 재사용하되 새 날짜 제한으로 영향받는 DB와 runtime 입력은 현재 날짜로 보완한다. 새 화면·Android 제품 코드·알림 기능·기상청 실제 호출은 이 독립 단위에 포함하지 않는다.

확인한 Preview는 cache 3행/32,768bytes, attempts 6행/32,768bytes, 전체 DB 23,080,083bytes다. 현재 시험 예산 40회/40MiB는 유지한다. 정상 운영의 2,000회/500MB 계정 배분은 그대로 저장 용량 안전성을 보장하지 않으므로 상시 활성화와 예산 확대는 별도 용량 검토 후 판단한다.

## 근거

- [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart): 스케줄 활성화/중지와 실행 기록 보존.
- [PostgreSQL SELECT](https://www.postgresql.org/docs/17/sql-select.html): 행 잠금과 SKIP LOCKED.
- [Supabase changelog](https://supabase.com/changelog): 현재 변경 검토; 관련 Cron/SQL breaking change 없음.
- [기존 Preview 실제 검증](2026-09-22-journey-weather-preview-live.md).

## 최종 검증

정확한 후보는 기존 공개 `a7c1cb5057d89ebee6adb6e50731554b0cf4f9c5` + 아래 8파일이다. 원본에만 있는 기존 초대 migration을 후보에 섞지 않고 재검증했다. 아직 새 commit/push는 없다. 원본에서 먼저 실행한 증거는 최종 후보 수치에 합산하지 않는다.

| 검사 | 결과 |
| --- | --- |
| 새 전용 PG17 DB의 모든 후보 migration 재생 | PASS |
| 실제 DB 기존 auth / 계획·공유 / ACL | 35 / 125 / 160 PASS |
| 실제 DB 기존 캐시·예산·동시성 | 12 PASS |
| 실제 DB 신규 보존·삭제·동시성 | 12 PASS |
| 분리된 네트워크 없는 DB의 실제 pg_cron | 6 PASS |
| 실제 Deno adapter + 로컬 DB + 합성 HTTP | 2 PASS |
| Node20.20.2 npm ci / lint / typecheck / build | PASS |
| 단위 | 685 PASS |
| Chromium | 49 PASS / 기존 연결 전용 2 SKIP |
| Deno 서버 진입점 | 7개 PASS |

최종 로컬 DB는 `motocast_weather_230dcb8046`, scheduler 전용 컨테이너는 `motocast-retention-cron-6012cc1dd6`다. scheduler 시험은 실제 5분 스케줄 등록을 먼저 검증하고, 동일 명령의 자동 실행 관찰에만 일시적으로 1초 간격을 사용했다. 다시 5분 구성으로 재적용한 뒤 정확한 job을 비활성화하고 컨테이너를 중지했다. 사용자 앱·기존 DB 컨테이너는 중지하지 않았다.

실제 runtime 동시10요청 × 표본13개는 자료1건, HTTP1회, 예산1회, 적중9/대기9, 응답1,685bytes, 전체1,464ms였다. 실제 느린 합성 HTTP도 timeout 뒤 확보 예산을 유지하고 즉시 재시도를 거절했다. 기상청 실제 네트워크 호출은 0회다. DB의 SQL 보호·동시성은 실제 PG 검증이며 외부 공급자 부하 측정은 아니다.

기존 게시 후보에는 포함되지 않는 별도 초대 migration까지 있는 원본에서도 먼저 321개 기존 DB + 12개 캐시 + 12개 정리 검사가 통과했다. 최종 후보의 기존 DB 수치는 320개이며 둘을 혼동하지 않는다.

## 실패·환경 차이 기록

- 초기 제한 셸 Python 발견 실패는 SETUP_OR_IMPORT_FAILURE. 기존 사용자 Python3.13을 사용해 해결했으며 새 SDK는 설치하지 않았다.
- 최초 runtime 실행은 검사 후 증거 JSON 쓰기 권한이 없어 ERROR. 동일 시험에 `.supabase` 쓰기만 허용한 재실행과 최종 후보 실행 PASS.
- 스케줄 시험의 초기 5회는 단독 이미지의 인증 테이블 소유권, 초기 임시 서버 종료, Nix postgres wrapper 이름, 확장 설치 권한, job 제어 권한의 준비 실패였다. r5는 등록만 PASS이고 자동 실행은 NOT_RUN이었다. 초기 실패 컨테이너는 중지·보존했다. 환경 준비를 명시하고 실제 postgres 역할로 실행한 r6 및 정확한 최종 후보 모두 6 PASS다. 제품 ACL이나 assertion을 약화하지 않았다.
- 기본 Windows 포트3100은 EACCES로 브라우저 시작 전 SETUP_OR_IMPORT_FAILURE. 기존의 canonical 설정을 import하고 포트만43100으로 바꾸는 시험 구성으로 49 PASS/2 SKIP. workers1/retries0/새 서버/전체 검사는 유지했다.
- 최초 현재 셸 Node24 실행도 PASS였지만 저장소·CI의 Node20 기준으로 전체 baseline을 다시 실행했다. 최종 수치는 Node20.20.2 결과이며 프로세스 PATH만 변경했다.

## 검수·배포·복구

직접 검수 결과: 현재 후보의 미해결 BLOCKER/HIGH/MEDIUM 없음. 독립 리뷰라고 부르지 않는다. 새 maintenance 함수는 SECURITY INVOKER·빈 search_path·DB 소유자 전용이다. 기존 11개 service_role RPC 허용 목록은 그대로이며 직접 table DML 권한을 늘리지 않았다. 삭제 경계와 claim 입장 제한 사이의 날짜 여유, 캐시→시도 잠금 순서, 진행 중 row의 SKIP LOCKED, 예산 원장 불변, cron job 이름 충돌·다른 기록 보존을 실행 증거로 확인했다.

현재 공개 PR #74는 여전히 a7c1cb5/Draft/미병합이다. 별도 단계로 쌓는 PR도 검토했으나 이번 변경은 미병합인 주행 캐시의 활성화 선행 조건이고 저장소의 CI-only PR→develop gate를 그대로 유지해야 하므로 기존 PR에 이 추가분만 묶는 구성을 준비했다. 기존 22파일 공개 승인을 신규 payload까지 확대하지 않는다.

공개·적용안은 아래 **8파일**만 추가 commit/push하여 PR #74를 갱신하는 것이다. 정확한 새 SHA CI 완료와 GitHub/Vercel 무배포 확인 후 Preview `lehjmbgfpoemqcwxowbx`에 새 migration, pg_cron 활성화, 아래 운영 SQL의 단일 job을 적용한다. 현재 만료된 공개 기상 payload 3건은 첫 실행에 비울 수 있으나 시도 6건은 7일 보존 조건 전에는 남는다. 실제 적용 직전 대상·건수·권한을 다시 읽는다. 일별 원장·개인 자료·웹 키·Production은 변경하지 않는다. 기상청40회/40MiB 시험 한도와 주행 flag=false도 이번 적용에서 유지한다.

1. `supabase/migrations/20260922075948_journey_weather_retention.sql`
2. `supabase/operations/enable_journey_weather_retention.sql`
3. `supabase/tests/database/journey_weather_retention.py`
4. `supabase/tests/database/journey_weather_retention_cron.py`
5. `supabase/tests/database/journey_weather_cache.py` — 고정 날짜 대신 DB의 현재 서울 날짜.
6. `supabase/functions/_tests/weather-cache.integration.ts` — 동일한 시험 날짜 보완.
7. 이 설계·검증·공개안 문서.
8. `docs/work/research/2026-09-22-journey-weather-retention-artifacts.json` — 후보/로그 해시와 실행 식별자.

중단·복구는 정확한 job의 `active=false`로 한다. 이미 비운 공개 예보는 다음 정상 조회로 다시 얻으며 과거 상세 시도는 복구하지 않는 폐기 가능한 기록이다. 일별 원장과 보호 함수·새 상태 제약은 유지한다. 정리 후 claim의 오래된 발표 제한을 되돌리거나 원장을 삭제해 예산을 복원하지 않는다.

Hosted 적용/새 SHA CI/스케줄 실제 readback/상시 주행 활성화는 NOT_RUN이다. Android 제품 APK는 변경하지 않았으며 앞선 실제 앱14+18검증은 역사적 유효 증거이지 신규 hosted migration 검증이 아니다. 정상 운영 배정의 저장 용량 상한·장기 운용은 이 로컬 검사로 완료 처리하지 않는다. 새 package/SDK 설치 없이 기존 Node20.20.2, Python3.13, Deno, Supabase CLI2.116.0, PostgreSQL17.6.1.166 이미지와 저장소 lockfile 의존성을 사용했다.

## 사용자 승인

2026-09-22 사용자가 위 8파일 commit·push와 기존 PR #74 갱신, 정확한 새 SHA CI 이후 Preview 5분 자동 정리 적용을 명시적으로 승인했다. PR 병합·주행 기능 활성화·예산 확대·Production은 포함하지 않는다.
