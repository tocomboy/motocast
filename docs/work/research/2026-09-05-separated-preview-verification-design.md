# Preview 분리 검증 설계

> **후속 공유 차단 완료:** 별도 도구로 [실제 연결11 PASS와 정리 재조회 PASS](2026-09-06-negative-share-connected-proof.md)를 확보했다. 현재 회원/타인 접근149개와 seeded negative 공유6개 RPC의 증거가 있으며, 아래 준비 대기 표시는 당시 이력이다. Kakao 신규 가입·active 공급자/예산·Production 검증은 미완료다.

> **최신 실행 완료 — 2026-09-06:** 사용자 승인 후 Preview 임시 Auth4개와 계획149사례를 실제 실행하여149 PASS/나머지 분류0, exact cleanup 후속1 PASS, 독립 evidence APPROVE B0/H0/M0/L0를 확보했다. 기존 public16테이블/Auth users 보호 지문 일치. [새 연결 증거](2026-09-06-preview-auth-connected-proof.md)를 우선하며 아래 승인 대기·149 NOT_RUN 표시는 과거 이력이다. Kakao/공급자·예산/negative 공유 및 Production은 여전히 미완료다. Vercel 최초API403은 공식CLI의 기존 세션 갱신으로 해소됐고 exact98afe02 READY 별칭을 재확인했다.

2026-09-05. 기준 제품: `develop` `98afe0231faf5b718c8812be7bc3e0b784b6eae3` (제품 변경 마지막 SHA `4f32485`). **설계·도구 준비 완료 / 시험 신원 생성 NOT_RUN / 전체 Preview 및 Production 미완료.**

## 확정 입력과 범위

- 사용자는 관리자 등록 계정 1개와 초대 링크에서 Kakao 로그인으로 가입한 실제 라이더 계정 1개를 보유한다. 둘 다 실제 이용 계정이며 모든 자료·권한·인증 설정을 보존한다.
- 사용자는 분리 검증 **설계**를 선택했다. 이 선택은 추가 Kakao 계정 준비, 시험 Auth 계정 생성, 권한 변경 또는 Production 승인을 뜻하지 않는다.
- 적용 계약: AUTH-001~004, COST-001~002, OPS-001~008. 공개 제품 로그인은 계속 Kakao이며 시험 인증 경로를 제품에 추가하지 않는다.
- lead 소유 파일은 이 설계와 `../handoffs/2026-09-05-preview-gates-resume.md`의 최신 상태 기록이다. 제품 코드·기존 테스트·설정·DB 변경은 이번 설계 범위 밖이다.

## 계획과 현재 상태

| 단계 | 상태 | 완료 기준 |
| --- | --- | --- |
| 인터뷰 및 읽기 전용 현황 대조 | 완료 | 실제 계정 보존, 가입 관계 집계, 인증 설정·트리거 확인 |
| 시험 신원·요청·정리 계약 | READY | 아래 역할표와 사전 조건, 정리 실패 처리 확정 |
| 독립 보안 설계 검토 | 완료 | 최초 MEDIUM 1 수정 후 APPROVE — DESIGN ONLY, B0/H0/M0/L0 |
| 구현·격리 검증·고정 도구 검토 | 완료 | 격리25 PASS, 최종 로컬 SQL2 PASS, 고정 도구 독립 APPROVE |
| Preview 시험 신원 생성 및 연결 검증 | NOT_RUN | 아래 사전 조건과 검토 통과; 별도로 확정한 실행 범위 내 수행 |
| 공급자/예산 실패 및 Production | 미완료 | 이 분리 검증으로 대체하지 않음 |

## 이번에 확인한 증거

Preview 관리 API로 인증 설정과 DB를 읽기 전용 조회했다. 원문 설정·계정 식별자·토큰·프로필은 보고에 남기지 않았다.

- active admin 1 / rider 1이며 각각 Kakao identity 및 profile이 1개 계정에 연결돼 있다. 소비된 초대장 연결은 admin 0 / rider 1이다. 사용자 설명과 일치한다.
- 이메일 인증 경로 활성, CAPTCHA 비활성, 비밀번호 유출 확인 비활성. 조회된 사용자 생성 전후·비밀번호 검증·토큰·메일·SMS hook 활성 플래그는 모두 false다. auth/public의 비내장 DB trigger 조회 결과는 0개다.
- 이는 **HISTORICAL_USER_ATTESTED + READ_ONLY_DB_CORROBORATION**이다. 당시 브라우저의 시작→리다이렉트→Kakao→초대 수락 전 과정을 이번에 재실행한 PASS로 세지 않는다.
- Preview Auth health는 GoTrue `v2.196.0`이다. 같은 버전 공식 소스에서 `adminUserCreate`의 client UUID 지정·`EmailConfirm` 직접 확인 처리와 password grant의 이메일 활성 검사·비밀번호 검증·토큰 발급을 확인했다. 두 handler에 메일 발송 호출은 보이지 않는다. 실제 시험 계정 생성/로그인은 NOT_RUN이며, 실행 직전 설정·버전 재확인과 token 발급 하위 호출/삭제 경로의 부작용 점검은 유지한다.
- 외부 조사는 Exa로 [공식 createUser 문서](https://supabase.com/docs/reference/javascript/auth-admin-createuser), [배포 버전의 생성/삭제 구현](https://github.com/supabase/auth/blob/v2.196.0/internal/api/admin.go), [배포 버전의 password grant 구현](https://github.com/supabase/auth/blob/v2.196.0/internal/api/token.go)을 확인했다. 최초 master 조회보다 이 버전 고정 근거를 우선한다.

## 두 종류의 검증

| 대상 | 현재 증거 | 분리 시험이 추가할 증거 | 계속 남는 부분 |
| --- | --- | --- | --- |
| 최초 초대 + Kakao 가입 | 사용자 확인 + DB 연결 기록 | 시험 세션의 실제 `claim_invite`·회원 생성·재사용 거절 | 실제 Kakao 브라우저 최초 가입 전 과정 |
| 기존 회원 재접속 | 초대 없이 active membership 확인하는 구현 | 시험 세션의 무초대 회원 판정 | 실제 라이더 브라우저 재로그인은 사용자와 별도 관찰 |
| 관리자/A/B/회수/비회원/익명 | 기존 local suite, hosted ACL 103 PASS | 실제 Preview Auth JWT와 PostgREST/RPC의 권한 거절 | Kakao 세션 발급 자체의 검증과 구분 |
| 타인 계획·컬렉션·공유 | 기존 local suite | 실제로 존재하는 시험 자원에서 A↔B, 관리자→타인 거절 | 미존재 UUID 404로 대체 금지 |
| 저장본 없음·stale·만료 공유 차단 | local 계약, 배포 UI 만료 표시 | 합성 seed + 실제 DB 읽기/negative RPC | active weather v12가 실패 후 저장본을 만드는 경로 |
| 공급자 실패·예산 부족/소진 | 기존 격리 검사 | 이번 역할 분리로 추가되지 않음 | 공용 예산/실공급자에 영향 없는 별도 설계 |

실제 JWT를 쓰더라도 데이터는 합성 준비물이므로 결과 이름은 `CONNECTED_AUTH_FIXTURE` 또는 `CONNECTED_SEEDED_CONTROL`로 구분한다. 특권 seed/정리 성공은 제품 권한 시험 PASS가 아니다. HTTP 200이나 빈 배열만으로 거절을 판단하지 않고 기대된 코드·영향 행 수·전후 시험 자원 상태를 함께 확인한다.

## 최소 시험 신원과 역할 순서

새 Supabase Auth 신원은 최대 4개: 시험 관리자 T, 라이더 A, 라이더 B, 인증된 비회원 N. 익명은 인증 없는 독립 클라이언트다. 실제 admin/rider 세션을 시험 mutation에 사용하지 않는다.

1. 서버 전용 시험 준비기가 매 실행 난수 UUID와 manifest를 먼저 기록한다. T의 membership/profile만 특권 seed로 준비한다. Auth JWT role은 네 신원 모두 `authenticated`이며 T의 앱 관리자 역할은 membership에만 둔다.
2. T의 실제 인증 요청으로 초대를 생성하고 A/B가 실제 `claim_invite`를 실행한다. N은 초대를 받지 않는다. 이것은 Kakao 가입 검증이 아니다.
3. A/B 각각 소유한 계획·컬렉션·공유 fixture를 고정 UUID로 준비한다. 소유자 조회 성공을 먼저 확인한 뒤 다른 주체의 조회·수정·삭제·공유 관리 거절을 확인한다. T도 타인 자료에 대한 소유권 우회가 허용되지 않아야 한다.
4. 현행 hardening migration은 authenticated의 membership/invitation UPDATE를 철회하며 관리자 회수 RPC/앱 경로도 확인되지 않는다. 따라서 T의 직접 UPDATE는 거절을 기대한다. 이후 **시험 준비기만 B의 정확한 UUID**를 대상으로 `revoked_at`을 seed하고, B의 이미 발급된 JWT로 즉시 재요청하여 권한 거절을 확인한다. 이는 `CONNECTED_SEEDED_CONTROL`이며 관리자 제품 회수 기능의 PASS가 아니다. A는 계속 자기 자료를 읽을 수 있어야 한다. 기존 실제 회원은 어떤 변경 요청의 대상에도 포함하지 않는다.
5. N/익명은 회원 기능·관리자 기능을 사용할 수 없어야 한다. 공개 공유 조회는 제품의 공개 resolver 계약에 맞춰 허용/회수 거절을 검증한다. 공개 공유를 회원 전용이라고 잘못 판정하지 않는다.
6. 회수 후 B의 자료 정리는 시험 준비기의 정확한 소유권 검사로 수행한다. 정리를 위해 B를 다시 가입시키거나 실제 계정을 승격하지 않는다.

각 단계의 요청 목록·최대 생성 수·기대 오류를 구현 전 case manifest에 고정한다. 특권 membership 변경은 B의 회수 seed 1건에 한정한다. 초대 만료·회수도 시험 준비기가 정확한 시험 초대에만 상태를 seed하고 실제 `claim_invite` 거절을 확인한다. 동일 사용자 재시도·다른 사용자 재사용은 별도 정확한 시험 초대마다 독립 기대값을 둔다. 첫 성공 뒤 재시도는 같은 초대만 사용한다. 관리자 회원/초대 회수 기능 부재는 별도 제품 부족분으로 남기고 시험 편의를 위해 UPDATE grant나 우회 RPC를 추가하지 않는다.

## 시험 도구의 책임 분리

- `FixtureLifecycle` module: Preview 환경 결속, 사전 부재 확인, privileged seed, mutation 전 정리 의무 기록, 정확 소유권 및 정리 확인을 담당한다. 공개 interface는 prepare/cleanup이며 범위 밖 행을 수정할 권한으로 시험 결과를 만들지 않는다.
- `RoleProbe` module: 주입받은 각 시험 사용자의 실제 Auth 세션으로 기존 app/PostgREST/RPC interface를 호출한다. 관리 key 또는 임의 JWT 서명·`SET ROLE`·SQL claim 설정을 받지 않는다. 리다이렉트 대상도 같은 Preview allowlist로 제한한다.
- `EvidenceRecorder` module: 고정 case 이름, 결과 분류, 안전한 오류 코드와 건수만 기록한다. 응답 본문·URL query·헤더·쿠키·원시 인증 상태는 출력하지 않는다. 브라우저 screenshot/trace/video는 끈다.

시험 준비와 정리에 필요한 management/service 권한은 시험 요청 프로세스와 분리한다. `service_role`의 앱 테이블 직접 DML 금지를 변경하거나 service JWT로 사용자 거절 사례를 대신하지 않는다. 제품 코드에 시험용 우회 endpoint를 넣지 않는다.

## 생성 전 반드시 충족할 사전 조건

- 대상은 Preview `lehjmbgfpoemqcwxowbx`와 승인된 develop origin뿐이다. Production ref/alias, 임의 origin, 결속 불명확 세션은 네트워크 mutation 전에 실패시킨다.
- 배포된 Auth 버전의 생성·password grant 경로, 활성 hook/trigger/외부 검증 및 호출 권한을 확정한다. `createUser(email_confirm=true)`와 password grant만 사용한다. signup/OTP/inviteUserByEmail/resetPasswordForEmail/이메일 변경은 호출하지 않는다. 실제 메일 주소·전화번호는 사용하지 않는다. 예약 `.invalid` 도메인과 고강도 난수 비밀번호를 사용하되 이것만으로 무발송 증명을 대신하지 않는다.
- Auth 생성 API의 client UUID 지원을 배포 버전에서 확인한다. SDK가 이를 노출하지 않으면 검토된 서버 HTTP 요청을 사용한다. 요청 전 UUID·실행 nonce·역할을 manifest에 fsync하고 해당 UUID가 Auth/앱에 없음을 확인한다. 생성 응답 유실 시 정확 UUID로만 결과를 회수한다. 지원 여부가 불분명하면 생성하지 않는다.
- private manifest는 저장소 밖 owner-only 디렉터리 0700, 파일 0600, 배타 생성한다. 비밀번호·세션은 별도 private 파일/메모리에서만 관리한다. 이름 접두어나 사용자가 수정 가능한 metadata만으로 소유권을 판단하지 않는다. Auth의 서버 관리 app_metadata 실행 marker + 사전 등록 UUID + 실행 전 부재 + 정확 부모 관계를 모두 확인한다.
- 생성된 시험 identity가 기대 provider/UUID이며 JWT의 issuer·audience·subject가 Preview 시험 신원과 일치하는지 비공개 검사한다. 로그에는 값 대신 검증 결과만 남긴다.
- 정상 provider·지도 요청은 발생시키지 않는다. 기존 공급자 정상 연결 PASS를 재사용한다. 해당 예산 장부, 한도, secrets, 공용 함수 설정을 쓰지 않는다.
- 전역 정리가 있는 `stage_route_candidate_internal`, 성공 `preview_trip_share`, `create_kakao_oidc_handoff_internal`은 이번 시험에서 호출하지 않는다. 실제 Kakao 관찰은 별도 단계이다.
- missing/stale/expired negative share 시험은 정확히 fixture 소유인 유효 형태 route와 snapshot/grant를 준비하고, 현재 RPC가 해당 이유로 거절하는지 확인한다. 우연한 필드 누락·잘못된 grant로 먼저 거절되면 목표 사례는 FAIL이다. 실제 DB clock을 사용하며 공유 허용을 위해 만료를 재표기하지 않는다.
- 현행 스키마의 FK·cascade·restrict·trigger를 고정해 cleanup 사전 점검을 마친다. 기존 hosted 금지 full rollback fixture/dblink suite를 Preview에 실행하지 않는다.

## 정리와 보존 계약

정리 의무는 **요청 전** 기록한다. 응답 유실·비정상 HTTP·case timeout에서도 의무를 해제하지 않는다. 생성·변경 범위는 유한한 manifest로 제한한다.

1. 시험 신원의 정확한 UUID와 metadata를 다시 확인한다. 실제 두 계정 또는 manifest 밖 외부 FK 참조가 발견되면 cascade/delete를 중단한다. 기존 계정 자료를 정리 목록에 편입하지 않는다.
2. 초대 생성 RPC는 ID 대신 token/expiry를 돌려준다. token은 출력 없이 hash로 exact ID를 회수한다. 응답 유실이면 사전 확인된 시험 T의 생성 초대 목록과 mutation journal을 대조한다. 단 하나의 의무에 단 하나의 행이라는 결속이 불명확하면 추측하지 않고 정리 실패로 기록한다.
3. 시험 공유를 정확 ID로 회수하고, 독립 snapshot을 가진 share row도 정리한다. 정확한 시험 trip 자식·grant/planning 자료, 컬렉션 및 버전을 FK 순서로 정리한다. active A의 `delete_owned_trip` 결과는 실제 RPC 증거로 기록할 수 있지만 회수 B의 privileged cleanup은 별도 기록한다.
4. 소유자는 시험 신원인데 부모가 실제 자원인 경우도 범위 밖이다. 그런 교차 참조를 만든 시험은 허용하지 않는다. 삭제·UPDATE에는 UUID와 기대 owner/parent 조건을 모두 넣고 예상 행 수와 다르면 rollback 및 FAIL 처리한다. 광역 DELETE, 날짜/접두어 기준 삭제, 전역 정리는 금지한다.
5. 시험 초대의 소비 기록을 정리한 뒤 membership/profile 및 Auth 신원을 정확 UUID로 삭제한다. B 회수 상태는 cleanup 동안 유지한다. Auth 삭제가 JWT를 즉시 무효화한다고 가정하지 않으며, membership 부재로 앱 접근이 차단되는 것을 확인한다. 사용 가능한 시험 세션의 logout은 해당 신원에만 수행한다.
6. manifest의 모든 시험 자원·Auth identity·세션 잔존 여부와 실제 계정·권한 보존을 읽기 전용으로 확인한다. 실제 자료의 비공개 전후 무결성 비교에 차이가 있으면 자동 복원하지 않는다. 정상 동시 이용과 시험 영향의 구분이 불가능하면 보존 검증은 미확정/FAIL로 남긴다.
7. 모든 obligation이 정리된 뒤 시험 비밀번호/세션 private 파일만 제거하고 비밀 없는 receipt를 남긴다. 불확실성이 있으면 복구에 필요한 manifest를 0600으로 보존한다. 플랫폼 감사 기록은 지우지 않으며 시험용 합성 식별 기록이 남을 수 있음을 정리 보고에 구분한다.

`PASS/FAIL/ERROR/SKIP/DESELECTED/XFAIL/SETUP_OR_IMPORT_FAILURE/NOT_RUN`을 모두 집계한다. 정리 실패는 적어도 FAIL 1이며 전체 연결 실행을 PASS로 종결하지 않는다. 재시도 성공으로 원래 실패를 없애지 않는다.

## 다음 실행과 남은 한계

독립 read-only security reviewer는 최초 관리자 회수 인터페이스 불일치 MEDIUM 1건을 제기했다. 위 특권 fixture 상태 준비/실제 사용자 요청 분리로 수정한 뒤 동일 reviewer의 delta 검토에서 **APPROVE — DESIGN ONLY, B0/H0/M0/L0**를 받았다. 고정 SHA 구현/배포 승인은 아니다. 문서 공백·결과 분류·명백한 인증 접두어 부재·로컬 링크 검사 4 PASS/0 FAIL 및 `git diff --check` PASS. 제품 테스트와 새 연결 사례는 NOT_RUN이며 기존 최종 SHA 증거를 반복 실행하지 않았다. 설계와 최신 인계만 로컬 작성했고 commit/push/배포는 하지 않았다.

도구 구현·시험·독립 검토는 [후속 준비 계약](2026-09-05-separated-preview-tool-readiness.md)에 따라 완료됐다. 다음 단계는 해당 문서의 Preview 실행 범위 확정이다. 실제 시험 신원 4개와 합성 자료 생성·B 회수·정확 정리의 실행 범위는 검토 가능한 도구와 case manifest가 준비된 뒤 확정한다. 이번 문서는 코드 구현이나 연결 시험의 통과 증거가 아니다.

공급자 실패와 missing/exhausted 예산은 active handler 및 공용 장부 때문에 여전히 별도 설계가 필요하다. 격리 handler와 로컬 예산 시험은 준비할 수 있지만 active Preview 실패 gate로 바꾸어 쓰지 않는다. 남은 Preview gate가 닫히기 전 Production 승격 승인안을 최종안으로 제출하지 않는다. `main`, Production 설정·비밀·DB·별칭 및 확정 리전은 변경하지 않는다.

## 공유 차단 연결 검증 — 고정 소스 대조 후속

기준은 fetch 후 HEAD/origin `98afe0231faf5b718c8812be7bc3e0b784b6eae3`이다. 이는 **READ_ONLY_SOURCE_AUDIT**이며 새 DB/브라우저 실행 PASS가 아니다. 앞선 임시 Auth4개·149사례 실행 승인 질문은 미답변이며, 이 후속이 해당 고정 도구나 승인 범위를 확대하지 않는다.

소유 범위는 이 설계의 부족분 기록과 최신 인계뿐이다. 목표는 실제 저장본 상태가 공유 준비와 발행을 차단했다는 증거를 구분하는 것이다. 제품 코드·고정 시험 도구8파일·remote 데이터는 변경하지 않는다. 후속 구현은 아래 사전조건·자원 확장·독립 검토가 확정되기 전 READY가 아니다.

| 사례 | 기존 직접 근거 | 연결 시험에 필요한 준비와 기대 결과 | 현재 상태 |
| --- | --- | --- | --- |
| 저장본 없음 | local suite의 missing weather preview 사례 | 소유 trip과 유효한 recommended route는 존재, route-bound weather0. preview에서 SHARE_WEATHER_NOT_FRESH | NOT_RUN |
| 오래된 저장본 | local suite의 complete stale metadata와 preview 거절 | route와 일치하고 validUntil은 미래인 snapshot에 완전한 stale metadata. 소유 조회로 원래 발표시각·만료시각·stale 유지, preview 거절 | NOT_RUN |
| 예보 만료 | local suite의 정확 경계와 advancing clock 사례 | route-bound snapshot의 validUntil이 DB clock 이전임을 확인. stale과 분리해 preview 거절 | NOT_RUN |
| 준비 후 저장본 없음/오래됨/만료의 발행 | local suite의 stale-after-preview/expiry-after-preview 사례 | 같은 owner/trip, 미소비·미만료 token hash와 정상 fresh snapshot hash를 가진 시험 grant. 이후 해당 날씨 상태만 정확 seed하고 publish에서 SHARE_WEATHER_NOT_FRESH | NOT_RUN |
| 정리·보존 | 기본 도구의 로컬 SQL2 PASS는 기본 fixture 범위 | 확장 route/weather/grant를 manifest와 FK·owner/parent·행 수 검증에 포함. 실패 요청 뒤 grant 미소비·새 share0·범위 밖 전후 보존 확인 | NOT_RUN |

근거 파일과 실행 순서:

- `supabase/migrations/20260901140000_complete_course_collections.sql:564`의 최종 wrapper는 unchecked projector 뒤 weather null/stale 또는 `validUntil <= clock_timestamp()`를 SHARE_WEATHER_NOT_FRESH로 거절한다.
- `supabase/migrations/20260901020000_single_recommended_route.sql:838`의 projector는 실제 소유 trip, recommended 우선 route, leg와 weather의 id/좌표/eta 일치 및 created_at 최신순을 사용한다. source 대조상 이 구현을 후속 migration에서 unchecked로 rename했다. route 누락이나 route/weather 불일치로 우연히 null이 된 사례는 의도한 stale/expiry 사례로 세지 않는다.
- `supabase/migrations/20260830224500_review_boundary_hardening.sql:735`의 preview는 builder 성공 뒤 전역 expired/consumed grant DELETE를 수행한다. 기존 실사용 자료를 보존하는 연결 시험에서 정상 preview를 사전 준비 수단으로 호출하지 않는다.
- 같은 파일:766의 publish는 token 형식·owner/trip·미소비·미만료 grant → trip 소유권 잠금 → 최신 weather builder → snapshot hash 비교 → grant 소비·share 생성 순서다. SHARE_PREVIEW_REQUIRED, TRIP_NOT_FOUND, SHARE_PREVIEW_STALE는 목표 weather 거절의 대체 PASS가 아니다.
- `supabase/tests/database/plan_collection_share.test.sql:496`, `:596`, `:624`, `:670`은 기존 local 사례다. 역할을 SQL로 설정하는 rollback suite 전체를 hosted에 실행하지 않는다. 기존 local suite는 정상 preview RPC도 호출하므로 안전 검토 없이 hosted 시험으로 전용할 수 없다.

연결 시험에서 정확한 시각 equality를 네트워크 요청으로 재현했다고 주장하지 않는다. exact equality는 기존 deterministic/local 증거로 유지하고 hosted는 실제 DB clock 기준 이미 만료된 자료의 거절을 확인한다. 최초 정상 snapshot hash 준비는 검토된 읽기 전용 builder 결과로 계산하고, grant는 정확 시험 자료에만 seed하는 별도 CONNECTED_SEEDED_CONTROL 설계가 필요하다. 소스 조회만으로 deployed DB 정의가 동일하다고 단정하지 않으며 후속 구현 전 읽기 전용 정의 대조를 포함한다.

현재 고정 기본 도구는 permission-only trip 및 빈 공유 payload를 준비하며 route/weather/grant 추가 seed가 없다. 위 사례를 기본149개 결과에 포함하거나 별도 근거 없이 완료로 바꾸지 않는다. 공급자 장애 후 stale 생성, 날씨 UI 표시, 실제 Kakao 가입도 이 DB 거절 시험만으로 닫히지 않는다.
