# Preview 날씨 상태별 공유 차단 — 구현 계약

> **최신 완료 — 실제 연결11 PASS 및 정리 재조회 PASS:** 고정3983dec/999f776c의 세 번째 실행은11 PASS, 나머지 결과 분류0이다. 실제 missing/stale/expired preview·publish6개 거절과 후속 조건·정리를 통과했다. 별도 정리 재조회 PASS, 보호 지문 일치. [최종 연결 증거](2026-09-06-negative-share-connected-proof.md)를 우선하며 아래 실행 대기·실패·수정 기록은 보존 이력이다. 전체 Preview/Kakao/공급자·예산/Production 미완료는 유지한다.

> **최종 수정본 연결 READY:** 고정3983dec 도구/999f776c 래퍼 독립 APPROVE B/H/M/L0, 독립 unit26 PASS/AST1 PASS. writer 최종 local1 PASS/122.708초 및 기존 실제 관리 역할 사전 검증과 함께 실행 전 검사를 충족했다. 원래 승인 범위에서 새 r3 자원만 생성·검증·정리한다. 이전 실패 실행과 결과는 보존한다.

> **최종 시각 수정 후보 검증 완료:** manifest `3983dec19c7485675abc055dcb217c90ee76e7789e876d76de2ee5db558e855f`. 같은 시각을 유지하는 parser를 DB 초기 시각과 만료 대기에서 공유한다. unit26 PASS, source20 hash 일치, 최종 local 전체1 PASS/122.708초, 나머지 분류0. 실제 로컬 DB의 초기 fresh→missing/stale→자연 만료→expired 검사 후에만 child RPC를 대체했고, 비표준 search_path의 정확 cleanup/보호 지문·rollback까지 통과했다. 중간 후보의 자연 만료122.625초 PASS와 별개 최종 고정본 증거다. 중간 소수초4/5자리 parser ERROR1도 보존한다. 독립 delta 검토 중이며 새 연결 실행은 아직 NOT_RUN.

> **같은 원인의 시각 정밀도 추적:** PostgreSQL 소수초는 항상6자리가 아니며 Python3.10의 기존 parser가4/5자리에도 실패했다. 초기 DB 기준 시각과 만료 대기의 두 읽기 경계에서 같은 시각을 보존하도록 수정 범위를 확정한다. 제품 KMA 시각·저장 시각은 변경하지 않는다. 중간 로컬 실패를 보존하고 고정 후보의 자연 만료 검증이 통과하기 전 새 연결 시험을 반복하지 않는다.

> **로컬 전체 경로 보완 이력:** 시각 parser 수정 후 실제 자연 만료와 expired 사전 조건을 통과했다. 마지막 집계는 가짜 child 응답의 사례 이름 불일치로 assertion FAIL1이며, 실제 probe의 사례 이름으로 교정해 같은 최종 검사를 재실행한다. 성공 기대값6과 모든 기존 assertion은 유지한다. 이 과정의 가짜 child 응답은 실제 RPC 결과가 아니다.

> **2차 실패 원인 확정 / 국소 수정 READY:** 실제 로컬 전체 사전검사에서 initial-fresh/missing/stale PASS 뒤 `wait_for_expiry`의 `_instant`가 PostgreSQL `+HH` offset 표기를 Python3.10 `fromisoformat`으로 직접 읽다가 ValueError임을 재현했다. lead의 별도 최소 재현도 동일했다. writer 소유 범위를 runner의 해당 parser와 unit/local 전체 대기 회귀로 확장했다. `+HH`를 동일 instant의 `+HH:00`으로 읽고 invalid/naive는 고정 실패코드로 중단한다. 저장된 발표·예보·만료시각, DB clock, 실제120초 대기 조건은 변경하지 않는다. 최초 local 진단 harness의 anon 부재 AttributeError1은 도구 설정 실패로 보존하며 원격 원인으로 계산하지 않는다. 새 원격 실행은 아직 NOT_RUN.

> **최신 2차 실행 FAIL / 정리 완료:** d7a787b6 연결 실행은 PASS4/FAIL1/NOT_RUN6, ERROR/SKIP/DESELECTED/XFAIL/SETUP_OR_IMPORT_FAILURE 각0. setup3와 정확 정리1은 PASS, POSTCONDITIONS는 FIXTURE_EXECUTION_ERROR로 FAIL, 공유RPC6은 시작되지 않았다. 별도 정리 readback1 PASS/보호 지문 일치. 원래 result SHA256 `d9dd1d9675830aa17b185eee966e0a644878c31a51840143ea19c03c4f2cb6ce` 및 journal은 보존한다. 초기 권한/search_path 문제의 수정 효과는 확인됐지만 전체 run_child 실행 순서 검사가 부족했다. 새 원격 계정 생성 없이 local 실제 DB+전체 precheck/wait 경로로 예외를 재현 중이다. 전체 Goal 미완료, 실제 두 계정·자료 보존.

> **수정본 연결 실행 READY:** d7a787b6 도구와 c35f2569 래퍼 독립 APPROVE B/H/M/L0. 검토자 unit24 PASS/AST1 PASS, DB·네트워크 재실행 NOT_RUN. 앞선 writer local SQL1 PASS와 실제 preflight1 PASS를 함께 충족했다. 별도 `/tmp/motocast-negative-connected-20260906-r2`에 새11사례 결과와 소유권·정리 기록을 보존한다. 기존 실패 실행의 재개·재기록이 아니다.

> **최신 수정본 검증:** 고정 manifest `d7a787b66108b30cf4ff1fbd68377ad7d9af9b7bde12fe37272fb203846e35ad`. writer unit24 PASS / local SQL1 PASS, 나머지 분류0. 내부 builder를 호출하는 고정 SELECT만 관리 write 역할을 사용하고, 실제 관리 역할의 EXECUTE 권한을 새 계정 생성 전에 확인한다. 일반 조회는 읽기 전용으로 유지한다. cleanup transaction이 public search_path를 명시하며 모든 catalog/FK·원본hash·rowcount guard는 유지한다. 실제 Preview 새 preflight1 PASS/mutation0. 독립 delta 검토 중이며 새 연결 실행은 NOT_RUN. 원래 실패 도구 manifest58e8과 실행·정리 기록은 불변으로 보존했다.

> **최신 정리 복구 완료:** 별도 wrapper18b3002b의 독립 APPROVE(B/H/M/L0), AST1 PASS와 로컬 search_path 재현·원래 hash 정리 rollback1 PASS 뒤 정확 복구 실행 PASS 및 별도 readback1 PASS. 시험 public16행/Auth users·identities·sessions·refresh_tokens 부재와 보호 지문 일치를 확인했다. 복구의 최초 MEDIUM1(미확정 복구 재요청 가능성)은 일회 실행 guard로 해소했다. 원래 실행 PASS3/FAIL2/NOT_RUN6은 FAIL로 보존하고 정리 후 이를11PASS로 바꾸지 않는다. 원격 기존 자료·제품 권한·예산·Production 변경0. 다음 READY는 도구의 privileged SELECT 경계와 canonical cleanup search_path 수정·로컬 회귀·독립 검토이며, 새 연결 실행은 새 고정본 뒤 진행한다.

> **최신 실제 실행 FAIL / 정리 복구 우선:** 고정58e8a0d2 실행은 PASS3 / FAIL2 / NOT_RUN6, ERROR/SKIP/DESELECTED/XFAIL/SETUP_OR_IMPORT_FAILURE 각0. setup3개 이후 내부 builder를 호출한 읽기 전용 관리 역할의 EXECUTE 권한 거절로 RPC6개가 시작되지 않았다. cleanup은 관리 write 연결의 search_path 표현 차이로 catalog guard에서 중단됐다. 제품 권한 변경 없이 같은 잠금·전체 catalog/FK 검사를 `SET LOCAL search_path=public`에서 실행하고 rollback해201 PASS를 확인했다. 실제 scoped16행과 임시 Auth1개가 아직 정리 대상이며, 비fixture 보호 지문은 일치한다. 새 실행을 보류하고 원래 seed hash·정확 소유권을 유지하는 별도 cleanup-only 복구를 로컬 검사·독립 검토 중이다. 원래 실패 결과는 보존한다. 첫 진단 실행 자동 검토 timeout1은 프로세스 생성 전 발생했고 재시도는 사용자 interruption; 재개 후 진단 프로세스 부재를 확인하고 실제 진단을 완료했다.

> **연결 실행 READY:** 별도 launcher SHA256 `bdbf26650881dfc40addc723208132cb32a3f29e4b7e1280a89589307701d7de` 독립 APPROVE, AST1 PASS. 실제 preflight1 PASS와 아래 도구 검증으로 목표11사례의 실행 전 조건을 충족했다. 기존 사용자 승인 범위에서 실행·정리하며, 최초 Kakao 가입이나 공급자 장애·공용 예산 고갈의 증거로 확대하지 않는다. 최신 fetch의 HEAD/origin98afe02 일치, open PR0, develop CI33967071715 success. 제한 환경 GitHub 조회 ERROR2는 승인된 네트워크 조회로 해소했다.

> **최신 상태 — 실행 도구 검증 완료:** 고정 manifest `58e8a0d203c1995e4187d1fa7cacbe99de692b0562ef36cb6cb06c530d09e5bd`. 전체 독립 검토 및 catalog delta 검토 APPROVE, B/H/M/L 각각0. Unit21 PASS(실제 제품 parser 포함), lead 로컬 seed/cleanup SQL1 PASS, catalog rollback6 PASS, 실제 Preview 읽기 전용 preflight1 PASS. 나머지 결과 분류는 각0. 초기 실패 및 검토 이력은 아래 보존한다. 연결11사례는 아직 NOT_RUN이며, 별도 메모리 전용 실행 wrapper 검토 후 실행한다.

첫 수정 뒤 남았던 cleanup 중 신규 FK 추가 경쟁은 public16/auth.users에 ROW EXCLUSIVE 잠금을 얻은 다음 같은 transaction에서 전체 catalog/FK를 재검사하도록 해결했다. 잘못된 합성 정상 자료는 DB 시각을 기준으로 제품 parser가 수락하는 경로·날씨로 교정했고, 원격 생성 전에 실제 `parseSharedRideSnapshot`을 실행한다. 응답/예보 시각 재표기나 공급자 호출은 없다. baseline은 이제 사용자 자료가 없는 catalog288행/FK27행 원문과 hash를 함께 보관한다. Lead 소유는 pin/builder/baseline 3파일과 별도 launcher, writer 소유는 나머지 도구 파일이다.

2026-09-06 KST. **READY: 별도 시험 도구 구현·로컬 검증·독립 검토. 연결 실행은 해당 도구의 검증·검토와 실제 정의 대조 후 READY로 전환한다.** 사용자 최초 작업 및 시험 소유 계정·자료 생성/정리 승인 범위에서 진행한다. 기존 실사용 관리자/라이더를 변경하거나149개 고정 시험을 반복하지 않는다. 이번 후속은 기존 도구의 묵시적 변경이 아닌 별도 유한 실행이다.

## 목표·소유권·보존 조건

AUTH-001~004, COST-001~002, OPS-001~008과 [분리 설계](2026-09-05-separated-preview-verification-design.md)를 따른다. Lead가 `/tmp/motocast-negative-share-20260906/`의 구현·검증 도구, 이 계약과 최신 인계를 소유한다. 기존 `/tmp/motocast-separated-auth-20260905`의 core8파일·149PASS 결과·private journal은 불변이다. 제품 코드/권한/스키마/비밀/리전/예산을 바꾸지 않는다. 독립 architect의 read-only 제안을 lead가 채택한 구현 계약이며, 실행 도구의 독립 승인이나 연결 PASS가 아니다.

임시 rider1명, profile/membership 각1, 사례별 trip/waypoint/recommended route/weather/grant 각3행으로 public 최대17행을 준비한다. 정상형태는 origin→lunch→destination의2legs로 고정한다. 이는 시험의 한 가지 유효 형태이며 현재 제품에서 lunch가 필수라는 뜻은 아니다. optional meal과 endpoint-only 경로 계약도 유지한다. share/invitation/collection/route draft/run/API budget/OIDC 신규 생성 계획은0이다.

Auth admin 생성과 password grant는 시험 신원에만 사용한다. 이메일은 예약 `.invalid`, email_confirm=true, hook/trigger 사전 검사, JWT issuer/subject/audience/role와 Auth `/user` 검증을 유지한다. membership은 정확 rider1행만 seed한다. 사용자 RPC 프로세스는 anon key와 시험 JWT만 받으며 관리 자격증명을 받지 않는다.

## 계획

| 단계 | 상태 | 완료 기준 |
| --- | --- | --- |
| source 대조·설계 | 완료 | 별도 lifecycle, 유한 자료, 정확 거절·정리 계약 채택 |
| 새 도구 구현 | READY / NOT_RUN | 아래 인터페이스와 실패 보존·복구 |
| 로컬 검증·고정 도구 독립 검토 | NOT_RUN | meaningful 실패 시험 및 rollback SQL, finding0 |
| hosted 정의·권한·자료 사전 조건 대조 | NOT_RUN | 로컬/source 대응 metadata와 실제 Preview 일치 |
| 연결6개 RPC·정리 | NOT_RUN | 아래 사례와 전체 부재/보호 지문 확인 |

## 핵심 사례

각 독립 trip은 먼저 정상 route-bound weather를 가진다. private `build_trip_share_snapshot`를 읽기 전용으로 호출하여 정상 weather를 확인하고 PostgreSQL의 `snapshot::text`에 대한 SHA256을 계산한다. Python 재직렬화로 snapshot hash를 만들지 않는다. 32-byte 난수의43자 base64url token과 hash, 같은 owner/trip, 정상 snapshot hash, 미소비/10분 만료를 갖춘 정확 grant를 seed한다. 원시 token은 메모리만 사용하고 journal/report/문서에 저장하지 않는다.

| 사례 | 정상 준비 후 조건 | preview/publish 기대값 |
| --- | --- | --- |
| 저장본 없음 | 정확 weather1행 삭제 | 각각 P0001 + SHARE_WEATHER_NOT_FRESH |
| 오래된 저장본 | stale metadata3필드만 완전하게 설정, issued/valid 시각 보존 | 각각 동일 |
| 만료 | 초기 DB clock+120초 valid_until을 유지한 채 자연 만료 대기, stale=false | 각각 동일 |

연결 RPC 목표는6개이며 setup/precondition/postcondition/cleanup의 최종 실행 집계는 실제 case manifest에서 별도 확정한다. elapsed wait만으로 만료를 단정하지 않고 실제 DB clock을 다시 조회한다. 120초가 정상 hash/grant 준비에 충분하지 않으면 먼저 준비 실패로 멈추며, 성공을 위해 이미 준비된 시각을 재표기하지 않는다. 네트워크로 exact equality를 재현했다고 주장하지 않는다.

RPC 직전 owner/trip, 정확 route1개와 유효한 legs, route/weather의 순서별 id/좌표/eta 일치, 목표 weather 선택, grant 미소비·미만료/정확 hash를 확인한다. stale/expired에서는 unchecked projector weather가 반드시 non-null이어야 한다. 없음은 정확 삭제 결과와 null 선택을 함께 확인한다. stale에는 미래 validUntil, expired에는 과거 validUntil과 stale=false가 필요하다. 잘못된 route/null weather로 우연히 같은 오류를 얻는 것은 목표 PASS가 아니다.

성공 preview RPC는 전역 만료 grant DELETE를 수행하므로 정상 준비 수단으로 금지한다. 실제 deployed builder/projector/preview/publish/helper 정의·ACL과 대상 columns/check/FK/trigger/RLS가 기준에 부합하는지 mutation 전에 대조한다. preview에서 예상 밖 성공이면 이후 실행을 중단하고 발생한 정확 시험 자원/범위 밖 영향의 정리 가능성을 확인한다. 다른 오류를 기대 오류로 대체하거나 assertion을 완화하지 않는다.

각 거절 뒤 grant 행/소비 상태와 trip/route/보존 시각이 그대로이며 새 grant/share0인지 확인한다. 공개 resolver와 브라우저 표시, active KMA 실패·예산 고갈 및 Kakao 최초 가입의 증거로 확대하지 않는다.

## 구현 인터페이스와 정리

별도 manifest/lifecycle/backend/probe를 둔다. 기존 lifecycle의 고정 역할·허용 mutation을 상속으로 우회하지 않는다. 고정 HTTP transport 패턴을 재사용하되 필요한 기존 모듈 의존성이 있으면 source hash를 전제조건에 포함한다. manifest는 모든 UUID/owner/parent, case ID, 최대 자료와 source/schema fingerprints를 가진다. private0700/0600, 배타 생성/단일 writer lock/fsync와 요청 전 intent를 유지한다.

응답 유실은 결과가 성공이든 실패든 완료/정리 의무를 남긴다. 정확 ID 조회만으로 late commit 가능성을 무시하지 않는다. 재시작은 정리 복구만 허용하며 미확인 mutation을 반복 실행하지 않는다.

정리 순서는 grant → weather → route → waypoint → trip → profile/membership → Auth다. transaction 안에서 row lock·scope/원본 이미지·정확 rowcount/FK를 재검사한다. 없음 사례에서 앞서 삭제한 weather0행은 intent/confirmed와 실제 부재가 일치할 때만 예상 상태다. manifest 밖 자식/외부 참조, row 변경, 불일치는 rollback/FAIL로 남기며 실제 자원을 삭제 범위에 넣지 않는다.

시험 public/Auth users/identities/sessions/refresh_tokens 부재와 비fixture public16테이블/Auth users 보호 지문 일치 후에만 cleanup_complete다. 동시 이용에 따른 지문 변화도 자동 복원하거나 보존 PASS로 처리하지 않는다. 관리 서비스 감사 기록은 지우지 않는다.

필수 로컬 검증: schema/함수 drift, 잘못된 parent/미등록·중복ID, route/weather 불일치, stale metadata 불완전, invalid/expired grant의 대체 PASS 방지, journal 실패, 생성/seed/RPC/cleanup 응답 유실, 신규 FK/외부 참조, 정리 중 행 변경/rowcount 불일치, 재시작 복구. 최종 도구 고정 hash와 독립 read-only 검토가 필요하다. 기존149사례를 복제·반복하지 않는다.

실사용 행 변경, 성공 preview, provider/공용 예산 호출, 신규 권한·스키마 변경이 필요해지면 해당 범위를 중단한다. 현재 두 Kakao 계정의 가입 상태는 보존하고 신규 신원 부족 gate는 별도로 유지한다.

## 구현 준비 실측 — catalog 기준

fetch 후 HEAD/origin98afe02 불변. Lead는 contract_pin.py/build_contract_baseline.py/contract-baseline.json을 소유하고 writer는 같은 임시 디렉터리의 나머지 도구·검증 파일을 소유한다. 독립 read-only reviewer는 catalog pin만 별도 검토 중이다. writer 소유 파일을 lead가 대신 수정하지 않는다.

초기 catalog 비교2회는 FAIL(MISMATCH)이었다. 로컬 search_path에 auth/extensions가 있어 타입·FK·기본 인자·RLS 조건이 schema-qualified 대신 축약형으로 표시된 것이 원인이었다. 대표4개 schema 정의를 읽어 확인했고 원문 함수/권한을 변경하거나 assertion을 완화하지 않았다. 로컬 rollback transaction에서 search_path만 public으로 고정한 뒤 재비교했다.

최종 읽기 전용 비교 **PASS1**: public 함수/권한·column·constraint·policy·table·trigger의 catalog284개가 local=Preview, migration11개 일치, critical function10개 body가 migration 원문 및rename순서와 일치. hosted incoming FK27개도 고정했다. 같은 baseline으로 로컬 `assert_contract`를 실행해 추가 **PASS1**을 확인했다. 이는 schema 사전 보호 도구 검증이며 새 사용자 RPC6개는 여전히 NOT_RUN이다. public/auth 사용자 자료, 설정, supplier mutation0.

baseline에는 catalog/FK SHA256과 migration별sourcehash만 저장했다. 실제 계정·자료·token은 없다. 정리전에도 같은 guard를 실행한다. 새 도구의 단위·rollbackSQL·최종고정hash/독립검토는 진행 중이며 실패한 초기 비교2개를 최종PASS로 지우지 않는다.

## 첫 구현과 독립 검토 — 연결 실행 보류

writer가 별도 core/backend/probe/runner/source_guard 및 unit/localSQL을 구현했다. 초기 unit assertion1FAIL은 정확 결과 index 수정으로 해소했고, 중간 catalog baseline 교체 중 source guard 실패1도 보존한다. 최종 초기 고정 도구 단위19 PASS/나머지0. writer localSQL 첫 시도는 연결환경 SETUP_OR_IMPORT_FAILURE1, lead의 승인된 로컬DB 경로에서는 SQL1 PASS(정상 seed/builder,missing/stale precondition,expired 초기fresh,정확정리)다. 이SQL1은6개 실제RPC나 자연만료경과를 실행한 증거가 아니다.

catalog pin 독립review 최초 HIGH1/MEDIUM2는 rewrite규칙,열권한,함수/테이블실행소유자누락이었다. 해당투영을추가해 catalog288/FK27/migrations11/body10 local=Preview PASS, delta APPROVE B0/H0/M0/L0. 실제 로컬rollback regression3 PASS: DELETE rewrite규칙추가,service_role열UPDATEgrant,securitydefiner소유자변경 모두guard가거절. 이전catalog284근거는이수정전이력이다.

전체도구 첫 고정manifest `d3c7e384f86b76292e171f345fb6bb98f7ab7834b1ad8ddb4df71e96f998c4ee` independentreview는 **NEEDS_FIXES HIGH2/MEDIUM2**다.

- H1: 부모잠금전 scope검사로동시자식insert가후속cascade정리에포함될수있음. 부모먼저잠금후정확scope/FK/행이미지재검사필요.
- H2: seed응답유실복구가현재행hash를기준으로재채택하고owner/parent/원본이미지를입증하지못함. 증거없으면failclosed중단.
- M1: weather JSONnull을SQL IS NOT NULL이객체로오인. jsonb_typeofobject와정확route/weather/grant연결검사및실제SQL실패검증필요.
- M2: seed유실+정리실패/commit응답유실후재개가중복seed_recovered또는SEED_OUTCOME_UNRESOLVED로막힘. durablecleanup상태순서로재개하고복합실패회귀필요.

writer에4finding국소수정지시했고도구소유권은그대로다. 고정핀3파일은read-onlyreview완료로변경하지않는다. 수정후새hash·unit·필요SQL·같은reviewer delta가완료되어야연결READY다. 새remoteAuth/fixture/provider/quota/Production mutation0. 실행예정결과는 setup3+RPC6+postcondition1+cleanup1의11사례이며 **모두NOT_RUN**이다. 기존149PASS와혼합하지않는다.
