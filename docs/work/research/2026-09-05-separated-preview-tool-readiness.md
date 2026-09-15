# 분리 Preview 검증 도구 — 준비 계약

> **후속 공유 차단 완료:** 별도 도구로 [실제 연결11 PASS와 정리 재조회 PASS](2026-09-06-negative-share-connected-proof.md)를 확보했다. 기존149개 Auth 시험은 반복하지 않았다. 아래 negative 공유 미완료 표시는 당시 기록이며, 전체 Kakao/공급자/예산/Production 완료를 뜻하지 않는다.

> **최신 실행 완료 — 2026-09-06:** 사용자 승인 후 Preview 임시 Auth4개와 계획149사례를 실제 실행하여149 PASS/나머지 분류0, exact cleanup 후속1 PASS, 독립 evidence APPROVE B0/H0/M0/L0를 확보했다. 기존 public16테이블/Auth users 보호 지문 일치. [새 연결 증거](2026-09-06-preview-auth-connected-proof.md)를 우선하며 아래 승인 대기·149 NOT_RUN 표시는 과거 이력이다. Kakao/공급자·예산/negative 공유 및 Production은 여전히 미완료다. Vercel 최초API403은 공식CLI의 기존 세션 갱신으로 해소됐고 exact98afe02 READY 별칭을 재확인했다.

> **최신 완료 — 최종 로컬 SQL2 PASS:** 중단된 exec cell130은 missing, 관련 프로세스0을 확인한 뒤 이미 승인된 검증을 재실행했다. `python3 -m unittest -v test_local_sql` exit0, PASS2, FAIL/ERROR/SKIP/DESELECTED/XFAIL/SETUP_OR_IMPORT_FAILURE/NOT_RUN 각0. 로컬127.0.0.1:54322에서 각 시험 transaction을 rollback했고 종료 후 관련 프로세스0과 도구8파일 hash 일치를 확인했다. 과거 timeout/SETUP 실패 이력은 보존하되 실행 시스템 차단은 해소됐다. fetch 성공 후 HEAD/origin은98afe0231faf5b718c8812be7bc3e0b784b6eae3으로 일치한다. 이번 턴은 progress, Goal active/미완료. 실제 Preview 생성/로그인/fixture mutation0, 연결149사례 NOT_RUN. 아래 승인 미답변·실행 차단 표시는 과거 이력이다.

> 최신 사용자 응답: `진행해`로 마지막 로컬 SQL 실행 승인이 확보됐다. 승인 후 동일 검증 명령도 자동 실행 승인 검토 deadline으로2회(최초+1회 재시도) 시작하지 못했다. 읽기 전용 Docker 확인 역시2회 같은 시스템 오류였다. 사용자 승인은 유효하며 재확인하지 않는다. 현재 차단은 실행 시스템이며 아래의 승인 미답변 표시는 과거 이력이다. 최종 SQL2사례 NOT_RUN, 실제 fixture 생성/원격 mutation0 유지.

> 최신 감사: 동일 로컬 실행 차단이3개 연속 Goal 턴에 유지되고 승인 없는 독립 준비가 끝나 Goal을 BLOCKED/미완료로 기록한다. 직전 날씨 handler 격리16PASS는 별도 문서의 추가 근거이며 이 최종 SQL NOT_RUN이나 실제 연결 gate를 대체하지 않는다. 아래 active 표시는 당시 이력이다.

2026-09-05. **READY: 외부 서비스에 연결하지 않는 도구 구현·로컬 실패 시험·독립 검토.**

사용자 원래 작업의 검증 도구 준비 범위이다. 분리 설계 선택을 새 계정 생성 승인으로 해석하지 않는다. lead가 `/tmp/motocast-separated-auth-20260905/`의 시험 도구·로컬 테스트와 이 기록을 소유한다. 기존 저장소 코드·테스트, 사용자 `.gitignore`, 이전 미추적 자료는 보존한다.

1. 완료: `git fetch origin develop` 후 HEAD/origin `98afe0231faf5b718c8812be7bc3e0b784b6eae3` 불변 확인. 이전 턴은 가입 관계 실측과 독립 설계 검토로 progress다.
2. 완료: `/tmp/motocast-separated-auth-20260905/`에 `fixture_core.py`, `preview_http.py`, `preview_backend.py`, `role_probe.py`, `run_fixture.py`와 두 검증 파일을 구현했다. `foreign_keys.json`은 live 읽기 전용 metadata 27개를 고정한다. `source-hashes.json`에 최종 파일별 SHA-256을 기록했다. 앱 코드/설정/배포 변경은 없다.
3. 완료: 격리 최종25 PASS, 오류/실패/skip/deselected/xfail/setup/미실행0, 경고0. 독립 read-only 검토 B0/H0/M0/L0 — LOCAL TOOL PREPARATION ONLY. FK 보완 당시 로컬 SQL2 PASS였으나 최종 재실행은 자동 실행 승인 timeout2회로 시작하지 못했고, 권한 상승 없는 시도는 DB 연결 단계의 SETUP_OR_IMPORT_FAILURE2 (unittest 원문 ERROR2)였다. 후속 최종 재실행 SQL2 PASS로 닫았다. 이전 실패는 이력으로 유지한다.
4. NOT_RUN: 실제 Auth 신원 생성·초대·합성 자원·B 회수 seed와 정확 정리. 도구 고정본과 case 목록을 준비하고 실행 범위를 확정한 뒤 수행한다.
5. 미완료: 실제 Kakao 최초 가입 전 과정, active provider 실패/공용 예산 gate, 최종 Production 승인·배포·검증.

계약은 `2026-09-05-separated-preview-verification-design.md`를 따른다. 시험 도구는 고정 Preview ref 외 대상으로 접근하지 않고, privileged 준비/정리와 실제 사용자 JWT 요청을 분리한다. 네트워크 mutation을 수행하기 전 private manifest와 정리 의무를 영속 기록한다. 계정 생성 결과 불명확·예상 외 참조·정리 실패는 실패로 남기고 실사용 계정을 복구나 정리 대상으로 편입하지 않는다. 실제 계정 가입·로그인 인증 상태, 장소 입력, invite/share bearer를 로그에 출력하지 않는다.

관리자 직접 membership/invitation UPDATE는 현재 권한상 거절이 정답이다. 회수 상태는 시험 준비기의 exact-B seed로 만들고 해당 결과를 `CONNECTED_SEEDED_CONTROL`로 구분한다. Auth 신원은 `CONNECTED_AUTH_FIXTURE`이며 Kakao 가입 PASS로 바꾸지 않는다. 기존 공급자 정상 연결은 무효화할 변경이 없으므로 재실행하지 않는다.

중단 조건: live credential/계정 생성/원격 mutation이 필요한 로컬 시험, 실제 자원과 교차 참조, 불명확한 삭제 범위, 제품 계약 변경 필요. 해당 부분만 보류하고 독립 준비를 계속한다. 임시 도구 변경은 앱 배포가 아니며 최종 제품 SHA CI 증거를 대체하지 않는다.

## 실제 준비와 검증 근거

- 실제 Preview Auth 생성/로그인/seed/mutation은 **0 / NOT_RUN**이다. credential 파일도 생성하지 않았다. 관리 API의 metadata와 Auth GET 기반 **읽기 전용 preflight 1 PASS**: 고정 프로젝트, Auth v2.196.0, 이메일 활성/CAPTCHA·외부 hook 비활성, public16테이블/비내장 trigger0, 고정 FK27개, 새 계획 UUID 부재를 확인했다. 기존 Auth·자료의 원문은 출력하지 않았다.
- 공식 소스는 Exa로 확인했다. v2.196.0 [Auth admin 생성/삭제](https://github.com/supabase/auth/blob/v2.196.0/internal/api/admin.go), [password grant](https://github.com/supabase/auth/blob/v2.196.0/internal/api/token.go), [토큰 발급 하위 구현](https://github.com/supabase/auth/blob/v2.196.0/internal/tokens/service.go)의 해당 경로에 이메일 발송은 없고, 토큰 발급 hook은 실행 전 false를 요구한다. Auth refresh_tokens는 sessions를 참조하는 ON DELETE CASCADE이며 실제 metadata로 확인했다. 로그에는 이 schema 정보만 기록했다.
- 구현된 요청 목록은 회수 전70/회수 후73이다. 신원 세션 준비1, 초대 A/B 수락2·같은 초대 재시도2, 정리1을 합쳐 계획149사례다. 이 수치는 실행 PASS 수가 아니다. 중간 실패 시 이미 수행한 PASS/FAIL/ERROR를 유지하고 나머지는 NOT_RUN이다. 통신 실패와 자식 프로세스 timeout에도 고정 사례 이름만 담긴 진행 기록을 보존한다.
- 자원 최대량은 Auth4, 초대2, trip/collection/version/share 각2, profile/membership 각3이다. 합성 permission fixture이며 route/weather/provider 계산이나 공개 공유 payload 유효성 검증을 대체하지 않는다. 회수는 시험 B의 membership seed1건이고 기존 관리자/라이더를 변경하지 않는다. 만료/회수 초대 추가 상태, negative weather/share seed 및 Kakao 브라우저는 후속 별도 사례로 남는다.
- 초기 독립 검토 HIGH1/MEDIUM2는 늦은 create commit, 강제 종료 잠금, FK 삭제 경계 문제였다. 미확정 create 부재를 정리 완료로 취급하지 않고, OS flock 잠금과 강제 종료 복구 시험, 고정 FK/트랜잭션 내 FK·행 이미지 재검사로 수정해 해소했다. 집계 후속 MEDIUM1은 통신 예외의 이전 PASS 유실이며 streaming report와 회귀 시험으로 해소했다.
- 로컬 대상은 `supabase_db_motocast`, `127.0.0.1:54322`로 읽기 전용 확인했다. 이전 SQL2 PASS는 단일 rollback transaction에서 generated seed/정리/보존 hash 확인과 새로운 incoming FK가 생길 때 삭제 전 거절을 검증했다. reset·재시작·다른 DB 정리는 하지 않았다.
- 마지막 권한 없는 SQL 시도의 초기 연결 실패가 local verifier 자식 프로세스/파일 정리 경고도 드러냈다. 생성자 실패에 자기 자식만 정리하는 처리를 추가하고 격리 회귀를 보완했다. 마지막 `ps -C psql -o pid=,comm=`은 출력0이며 남은 psql 프로세스는 발견되지 않았다. 최종25 PASS는 `python3 -W error::ResourceWarning -m unittest -v test_fixture`로 경고 없이 실행했다.
- 최종 `git diff --check` PASS. 제품 변경이 없으므로 앱 전체 baseline/새 commit/CI/배포는 NOT_RUN이며 이전 develop98afe02 증거를 새 도구 실행 PASS로 사용하지 않는다.

## 과거 실행 차단 이력

자동 실행 승인 검토가 `python3 -m unittest -v test_local_sql` (cwd `/tmp/motocast-separated-auth-20260905`)에 대해 두 번 deadline을 넘겨 실행 요청을 거절했다. 위험하다는 판정은 아니며 프로세스가 시작되었다는 증거도 없다. 권한 상승 없는 실행은 DB 연결에 실패했다. 최종 로컬 SQL 검증의 실행 권한 경로를 해결해야 하며 그 전 실제 fixture 생성 승인을 요청하지 않는다. 기존 일반적인 로컬 검증 승인을 철회된 것으로 해석하지 않지만 현재 자동 실행 승인 차단은 별도로 기록한다.

전체 Goal은 active/미완료이며 이번 턴은 도구 구현·격리 검증·실제 preflight·독립 finding 해소가 있어 progress다. Production 승인 단계는 아직 아니다.

## Preview 실행 범위 확정안

도구 준비 READY / 원격 실행 NEEDS_DECISION. 이전 인터뷰는 분리 설계 선택이고 최근 승인은 로컬 SQL 실행이었다. 별도 시험 Auth 생성·권한 seed·정확 삭제를 아래 범위로 확정한다. Production 승인이 아니다.

| 항목 | 범위 |
| --- | --- |
| 대상 | 서울 Preview만. 기존 실사용 관리자/라이더의 계정·자료·권한 보존 |
| 최대 생성 | Auth4개(T/A/B/N), 초대2개, trip/collection/version/share 각2개, profile/membership 각3개 |
| 인증 | `.invalid` 시험 계정의 admin 생성·password grant. 이메일·SMS·외부 메시지 발송 없음 |
| 요청 | 회수 전70 + 회수 후73 + 인증 준비1 + 초대 수락2 + 동일 사용자 재시도2 + 정리1 = 계획149사례 |
| 회수 | 시험 B의 membership만 특권 seed1건. 실제 B JWT의 권한 거절 확인; 관리자 제품 회수 기능 PASS로 세지 않음 |
| 비용 | 경로·지도·KMA 공급자 호출0. 공용 예산 장부·한도·비밀·결제 변경0 |
| 정리 | 요청 전 private journal, 정확 UUID/server marker/owner/parent/FK 확인 후 시험 자료와 Auth만 삭제. 기존 자료 비공개 전후 비교 |
| 중단 | 전제 변화, 예상 외 참조, 소유권 불명확, 정리 실패는 실패로 기록. 실제 자료 자동 복원·광역 정리 금지 |
| 감사 | 플랫폼 시험 감사 기록은 지우지 않음. 비밀 없는 receipt 보존 |

고정본은 `/tmp/motocast-separated-auth-20260905/source-hashes.json`의8파일. 격리25 PASS, 최종 로컬 SQL2 PASS, 독립 APPROVE B0/H0/M0/L0(LOCAL TOOL PREPARATION ONLY)를 재사용한다. 승인 후 실행 직전 hash·읽기 전용 preflight를 확인하고, private journal → 시험 신원/세션 → T 준비와 A/B 초대 수락 → 합성 자료 → 회수 전 요청 → exact-B seed → 회수 후 요청 → 정확 정리·보존 확인 → 결과 기록 순으로 진행한다. Credential은 메모리 또는 저장소 밖0600 파일로만 관리한다. 제품 코드·commit/push·배포 변경은 이번 시험에 필요하지 않다.

통과해도 실제 Kakao 최초 가입 브라우저 전 과정, 추가 초대 만료/회수 상태, 유효한 route/weather 기반 negative 공유 RPC, active provider 실패·공용 예산 차단의 부족한 연결 gate는 남는다. 해당 항목을 격리 PASS로 대체하지 않으며 전체 Preview 완료 전 Production 승격 승인을 요청하지 않는다.
