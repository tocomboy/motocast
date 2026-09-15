# Preview 잔여 검증과 Production 승격 준비

> **최신 공유 차단 완료:** [실제 연결11 PASS](2026-09-06-negative-share-connected-proof.md)와 정확 정리 후속 PASS를 확보했다. missing/stale/expired 각2개의 실제 preview/publish 거절이며 합성 시험 자료를 사용했다. 아래 두 실패 실행은 이력으로 보존하고 모든 시험 자료는 정리됐다. 나머지 Kakao·공급자·예산·Production gate는 유지한다.

> **최신 후속:** [잔여 gate·인터뷰 결정 목록](2026-09-06-preview-remaining-gates.md)에 현재 두 실사용 계정 보존과 증거 범위를 통합했다. 공유 차단 도구의 첫 연결 실행은 PASS3/FAIL2/NOT_RUN6이며, 시험 자료16행/Auth1개의 정확 정리 복구·별도 readback은 PASS다. 원래 실패는 보존하고 도구의 관리 연결 차이 수정·재검토를 진행한다. 해당6개 RPC와 Kakao/공급자/예산/Production 미완료 상태를 유지한다.

> **최신 실행 완료 — 2026-09-06:** 사용자 승인 후 Preview 임시 Auth4개와 계획149사례를 실제 실행하여149 PASS/나머지 분류0, exact cleanup 후속1 PASS, 독립 evidence APPROVE B0/H0/M0/L0를 확보했다. 기존 public16테이블/Auth users 보호 지문 일치. [새 연결 증거](2026-09-06-preview-auth-connected-proof.md)를 우선하며 아래 승인 대기·149 NOT_RUN 표시는 과거 이력이다. Kakao/공급자·예산/negative 공유 및 Production은 여전히 미완료다. Vercel 최초API403은 공식CLI의 기존 세션 갱신으로 해소됐고 exact98afe02 READY 별칭을 재확인했다.

2026-09-05. 전체 Goal은 진행 중이다. Preview 정상 흐름의 성공이나 Production 승인 대기는 전체 완료가 아니다.

## 실행 계획

1. **완료** — 최신 인계와 실제 Git/CI/Web/Edge 대조.
2. **진행** — 기존 증거와 부족한 연결 검증을 구분하고 READY 범위를 실행.
3. **대기** — 발견된 국소 결함만 수정하고 고정 SHA 검토 → 비배포 review 브랜치 exact-head CI → 무배포 확인 → Preview 변경 → 기준 develop 불변 → 같은 SHA fast-forward → 연결 검증.
4. **대기** — 모든 Preview gate가 닫힌 뒤 구체적인 Production 승격안을 확정하고 사용자 승인 요청.
5. **대기** — 승인 후 같은 저장소 develop → main PR, 필수 검사, Production 배포와 초대 라이더 검증 및 정리.

## 확인한 기준

- `git fetch origin develop` 후 HEAD/origin/develop = `0b23aeabe48e25f1f52b8e00109d49f0c18761d2`, main = `d0134ed93d7e0d8aed1123c5d693c665bbe646e8`.
- 열린 PR 0. develop CI `33964276833` exact SHA success.
- Preview Vercel `dpl_Dhu32nBF2vwTLNtFhRhu84PhH7em` READY, develop 고정 별칭과 commit 일치. GitHub Deployment `6280594969` success.
- Preview weather-timeline v12/JWT true, plan-route v11, 나머지 세 함수 v8. JWT false는 kakao-oidc뿐이다.
- 인증 HTTP 200, nosniff/referrer-policy/permissions-policy/HSTS 확인. CSP 헤더는 없음; 이번 작업에서 변경하지 않았다.
- 제품 `8bd8878` 이후 비Markdown 변경 없음. [기존 연결 1 PASS와 정확 소유 정리](2026-09-05-kma-hour-correction-release.md)를 재사용하며 동일 공급자 호출을 반복하지 않는다.
- `.gitignore`와 기존 미추적 인계/조사 자료는 사용자 소유로 보존한다.

## READY: 변경 없는 접근 경계 확인

- 목표 계약: AUTH-001~005, COST-001/002, OPS-001/002/007. 실제 Preview의 비로그인 접근 거절, 초대 요청 출처/형식 보호, 로그인 시작 설정, 관리자 화면 접근 및 현재 DB ACL을 검증한다.
- 소유: lead가 이 계획과 저장소 밖 owner-private 검증 도구/결과만 작성한다. 제품·테스트 기존 파일, DB 영속 데이터, 사용자 권한, quota, 배포 설정의 변경 없음.
- 접근: 기존 Preview 인증 자료는 읽기 전용 화면 확인에만 사용. 비로그인 검사는 별도 context에서 Supabase/초대/OIDC 쿠키와 localStorage를 제외하고 Preview 보호 쿠키만 유지한다.
- 로그인 시작은 Kakao 인가 redirect까지 확인하며 공급자 로그인 완료로 계산하지 않는다. 무효 입력의 초대 요청은 신규 초대나 회원을 만들지 않는다.
- 보존: 비밀/인증값/장소/공유 토큰 출력 금지, 화면·trace·video 비활성. 실제 사용자 회수 및 실제 일일 쿼터 소진 금지. Preview 서울/Production 도쿄 유지.
- 검증: 실패는 고정된 안전한 시나리오 이름으로 기록. HTTP 결과/쿠키 속성은 값 없이 assertion. DB는 읽기 전용 권한·migration 조회만 수행. 테스트별 PASS/FAIL/ERROR/NOT_RUN을 구분한다.
- 중단: 환경 결속 실패, 새로운 공급자 호출 또는 영속 변경 필요, 테스트 소유 증명 불가, 정본과 실제 설정 충돌. 해당 항목만 멈추고 독립 항목은 계속한다.

## 계정 의존성

현재 발견된 로그인 자료만으로 독립 라이더 A/B 및 회수/비회원 전체 흐름을 증명할 수 없다. 사용자에게 테스트 Kakao 계정 A/B 준비와 직접 로그인 가능 여부를 요청했다. 인증값은 채팅/문서로 받지 않는다. 계정이 준비되기 전 해당 역할의 연결 결과는 NOT_RUN이다.

## READY: 정확한 예보 만료시각 표시

- 근거: `lib/weather/status.ts`와 `components/shared-ride-snapshot.tsx`의 만료 표시는 `< now`, 기존 공유 허용은 `> now`이므로 정확한 validUntil에서 공유 거절과 만료 표시가 불일치한다.
- 계약: WEATHER-002, SHARE-003. validUntil 이전은 유효, 정확한 시각과 이후는 만료. stale 원인·나이 표시와 공유 허용 정책을 보존한다.
- lead 소유 파일: 위 두 제품 파일, `lib/weather/status.test.ts`, `tests/e2e/weather-timeline.spec.ts`, 이 계획 및 이번 증거/승격안 문서. 새 정책·스키마·Edge·인증·예산 변경 없음.
- 검증: 기존 public formatter에서 before/exact/after 경계의 실패 재현 후 최소 비교 수정. 실제 공유 renderer를 사용하는 결정적 Chromium 테스트도 정확한 시각에서 만료를 요구한다. 이는 합성 응답 브라우저 시험이며 공급자 실패 연결 gate가 아니다.
- 완료: 전체 필수 검사, 고정 SHA 독립 검토, 비배포 review 브랜치 exact-head CI 및 무배포 확인, 기준 develop 불변과 같은 SHA fast-forward, Preview Web/함수 불변 확인. KMA 정상 호출은 반복하지 않는다.
- 중단: 기존 저장/공유 계약 변경 필요, 소유 파일 밖 제품 변경 필요, 검증 실패 또는 원격 기준 변경.

## 실행 환경 오류

- 최초 fetch는 `.git/FETCH_HEAD` 읽기 전용 제한으로 실패했고 같은 승인된 명령의 escalation에서 성공했다.
- 읽기 전용 판독기 최초 두 실행은 `python` 명령 없음으로 시작하지 못했다. `python3`로 수정한 두 조회가 성공했다. 제품 테스트 수치와 별도인 도구 실행 오류 2건이다.
- Docker 상태 조회는 소켓 접근 제한으로 실패했다. local DB 검증은 아직 NOT_RUN이며 실행 환경 확인 전 임의 reset/start를 하지 않는다.

## 증거와 부족분

| 항목 | 기존 증거 | 이번 실제 연결 결과 | 남은 필수 범위 |
| --- | --- | --- | --- |
| 정상 경로·날씨·컬렉션·공유·회수·재발행·정리 | 제품8bd8878의 실제 1 PASS | 비Markdown 동일·배포 버전 불변 확인, 호출 재실행 없음 | 이 정상 시나리오 닫힘 |
| 초대·Kakao 로그인 | 최초 관리자 로그인 과거 성공, callback/claim은 주입 단위검사 | 초대 missing/foreign origin, cross-site, non-JSON, invalid token 거절5 PASS; 실제 app→Edge→Kakao 인가 redirect와 scope1 PASS; 쿠키 정리1 PASS | 새 초대 수락→Kakao 인증 완료→회원 생성, 무초대/만료/회수 초대 거절 NOT_RUN |
| 관리자·비로그인 | 기존 한 세션의 관리 heading smoke | 관리자 초대 화면 읽기1 PASS, 비로그인 계획/관리자 거절2 PASS | 실제 A/B/회수/비회원 및 타인 자원 경계 NOT_RUN |
| DB 권한 | 로컬 fixture RLS/동시성 및 과거 linked ACL | 읽기 전용103 PASS/0 FAIL: 앱16테이블 RLS, service-role DML 거절, 정확7함수 allowlist 및 다른 public 함수 거절 | 역할별 실제 신원·기존 자원 행동 검사 및 future-object 생성 probe NOT_RUN |
| 존재하지 않는 계획 | 기존 local DELETE 테스트 | 비로그인 random UUID DELETE404 1 PASS | 타인 소유의 존재하는 자원 거절 증거가 아님 |
| 공급자 실패·저장본 없음 | 과거 KMA 실패 및 현재 주입 handler 회귀 | NOT_RUN | active v12의 안전한 시험 전용 실패 조건 없음 |
| 실패 후 stale·저장 자료 조회 | mock handler/DB, 합성 public-share 브라우저 표시 | NOT_RUN | 실제 실패→실제 snapshot stale 저장→owner 재조회 |
| 만료·공유 차단 | 로컬 실제 DB missing/stale/exact/advancing-clock 시험, mock UI | NOT_RUN; 정확한 만료 표시 결함은 아래 국소 회귀로 수정 준비 | 실제 Preview 소유 snapshot 및 preview/publish 거절 |
| 예산 부족·소진·저장 자료 조회 | local DB/동시성, budget-before-call 및 실패 주입 | NOT_RUN | 공용 장부를 건드리지 않는 active 함수 실패 조건 필요 |

연결 접근 도구 `/tmp/motocast-preview-gates-20260905/access-check.cjs` 최종 SHA256 `cfa3b7557a590863b18d330f77b3fd848935dad5fc266bc8a21ff4351a7d0ef6`: 독립 보안 APPROVE B0/H0/M0/L0. 최초 M1(무효 토큰으로 출처 검사를 구별하지 못함)을 유효 형식의 합성 token으로 교정한 뒤 reviewer가 RESOLVED 판정했다. 실행은 **PASS11 / FAIL0 / ERROR0 / SKIP0 / DESELECTED0 / XFAIL0 / SETUP_OR_IMPORT_FAILURE0 / NOT_RUN0**이다. 이 NOT_RUN0은 해당11개 실행에 한하며 위 표의 미실행 gate를 지우지 않는다. 쿠키 context·브라우저 정리 완료, 신규 영속 자원0, 실제 Kakao 로그인 및 KMA/도로 공급자 호출0이다.

12:12–12:15 UTC 조회: Preview 함수 로그2건, error/failed/failure 표시0, 상한100 미도달. Vercel 로그12건 모두 info: HTTP200 3/307 3/400 5/404 1이다. 400은 다섯 무효 초대 요청, 404는 존재하지 않는 trip의 거절이며 예상 동작이다. error level0, HTTP5xx0이다. 원문은 repository 밖 owner-private 디렉터리/0600 파일에만 보존한다.

환경 readback: Preview/Production 모두 ACTIVE_HEALTHY, 서울/도쿄 일치. Preview migration11개와 로컬 일치(최신20260902123000). Vercel Node20.x, 보호preview-only, Production branch main. 세 public 이름은 develop 지정 Preview 항목과 기존 공통 Preview/Production 항목으로 존재하며 비공개 서버 이름은 없다. Production 값의 올바른 프로젝트/app 귀속은 이름 존재만으로 확정하지 않는다.

도구 후속 오류: User-Agent 없는 API 조회 HTTP403 두 번 후 기존 성공 판독기와 같은 User-Agent로 회복했다. 거절의 공급자 내부 원인은 단정하지 않는다. 로컬 `.vercel/project.json` 부재1건은 실제 배포의 project/owner ID 조회로 대체해 Vercel readback 성공. Docker 읽기 조회도 escalation 성공; `supabase_db_motocast` 실행 중이며 변경하지 않았다.

## 실패 조건 준비의 경계

독립 설계 검토는 현재 KMA host/fetch가 고정이고 예산이 회원별이 아닌 provider·operation·서울 날짜별 공용임을 확인했다. 브라우저 응답 가로채기·별도 임시 함수·로컬 fixture 성공은 active v12의 공급자/예산 실패 실측을 대체하지 않는다. 실제 사용자 권한 변경, 공용 quota 소진, 임의 provider key/공용 limit 변경은 실행하지 않았다.

별도 선택 가능한 준비는 exact test-owned trip/route/snapshot을 trusted SQL로 만들고 실제 세션의 negative-only 공유 RPC를 확인하는 시험이다. 이는 **CONNECTED_SEEDED_CONTROL**(실제 Preview 인증·DB, 합성 seed)로 명시해야 한다. `stage_route_candidate_internal`은 전역 만료 draft를, 성공 `preview_trip_share`는 전역 만료/소비 grant를 정리하므로 무조건 시험 소유 범위라고 간주하지 않는다. 기존 관리자 계정의 사용 범위와 exact owner/UUID·권한·정리 계약을 확정하기 전 이 seed는 NOT_RUN이다.

## 문서 분류와 현재 완료 범위

`update-project-docs` 기준으로 이 계획/증거와 [Production 준비안](2026-09-05-production-promotion-packet.md)은 Update이다. 제품 정본·README·기존 운영 문서의 전체 Preview 미완료, 고정 리전, 승인 전 Production 변경 금지 계약은 Verified unaffected이며 역사적 기록은 덮어쓰지 않는다. 만료 표시 수정의 배포 결과는 확정된 뒤 별도 최신 실행 기록으로 추가한다. 기존 사용자 미추적 문서는 Archive excluded가 아닌 보존 대상이며 이번 changed set 밖이다.

## 만료 표시 작성자 검증

- 실제 기존 formatter에 새 before/exact/after 경계 검사를 실행: **PASS6 / FAIL1**, 정확 validUntil에서만 실패했다. 수정 후 **PASS7 / FAIL0**. 이 최초 FAIL은 숨기거나 skip하지 않은 회귀 재현이다.
- 두 제품 비교를 `<`에서 `<=`로 변경했다. 공유 허용·DB freshness·KMA 요청/응답·시계 갱신 주기는 그대로다. 공유 페이지의 기존 실제 renderer 시험은 시계를 로드 전 고정해 30초 후 정확 validUntil, 그다음 갱신의 만료 표시를 확인한다.
- 환경파일 없는 독립 복사본에서 `npm ci`407 packages, lint/typecheck, Deno 다섯 진입점 PASS. 원본과 검증 복사본의 비Markdown·사용자 `.gitignore` 제외191파일 바이트 동일.
- 전체 Vitest **59 files / PASS528 / FAIL0 / pending0 / todo0**. 로컬 keyless Chromium **PASS20 / 기존 connected SKIP2 / FAIL0 / retry0**. ERROR/DESELECTED/XFAIL/SETUP_OR_IMPORT_FAILURE0. DB 변경·local DB 재실행은 NOT_RUN(표시 전용 변경).
- 별도 `npm run build`도13 routes PASS, `git diff --check`와6파일의 token/key 패턴 검사·새 문서 상대링크 검사 PASS다. 고정 SHA 검토, review branch CI·무배포 확인과 Preview release 결과는 진행 중이며 완료 결과로 계산하지 않는다. 이 문서는 작성자 검증 시점 기록이다.
