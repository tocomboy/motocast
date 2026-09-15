# Production 배포와 기존 두 사용자 데이터 이전

## Production 승격과 Auth 빈 문자열 보정

- PR44의 고정013f3b0 CI34961939760 및 배포 없는 review branch 확인 뒤 develop에 동일 SHA를 반영했다. 후속CI34962161606/34962165791·develop-only34962239986·Vercel PASS 후 승인된 PR41을 main으로 merge했다. main89977ef7147177cab43fe54f7f8de16a69646972와 후보 tree diff0, Production dpl_8ebLxXkN3RxdEdodYWK4kHxfPeJo READY 및 운영 별칭 일치다.
- 최초 운영 Kakao 로그인은 실패했다. Auth 로그에서 `confirmation_token`의 NULL을 문자열로 읽을 수 없다는 오류를 확인했다. 이전 대상 projection에서 인증 값 복제를 제외했으나 GoTrue가 요구하는 빈 문자열 초기화도 빠진 회귀다. 이전 시 선택한 앱 데이터와 신원 projection의 일치 PASS를 실제 로그인 성공으로 확대하지 않았기 때문에 운영 로그인 검사에서 발견했다.
- Preview 두 사용자의 인증 보조 문자열9개는 모두 빈 문자열이며 Production의5개는 NULL,4개는 빈 문자열이었다. 원본·대상 UUID2개 및 카카오 신원 매핑 일치,9개 칸에 실제 값 없음, 다른 auth 필드와13개 앱 테이블 해시 보존을 검사한 transaction으로 해당 두 행의 NULL만 빈 문자열로 보정했다. 계정 삭제·재생성·실제 인증 토큰/세션 복제·기존 값 덮어쓰기는 없다. 이후 실제 관리자 운영 Kakao 로그인·지도·기존 공유 조회 PASS다.
- 이전 도구는 auth.users에 아홉 고정 빈 문자열을 명시적으로 넣고 commit 전 모두 빈 문자열인지 검사하도록 수정했다. source snapshot projection과 원문 비복제 계약은 유지한다. 실제 격리 PostgreSQL17.6.1.166:55434에서 정상2행 초기화 및 NULL 주입 전체 rollback을 포함한18 PASS/0 FAIL/0 ERROR/0 SKIP, 최종15테이블0행, retained DB healthy다. 독립 테스트 목록으로 필드 계약을 검사하며 lead 검수 PASS, 제품·Edge·transport 변경은 없다.
- 공개 HTTP200, Vercel 로그인으로 우회되지 않음, HSTS/nosniff/referrer/permissions 헤더 PASS. 로그인 후 DOM에서 실제로 로드한 공개 JS11개를 확인해 Production Supabase 연결 있음·Preview 연결 없음·서버 KMA 키와 secret-key prefix 없음을 확인했다. 로그인 전 JS8개만으로는 환경 연결 문자열이 나타나지 않았고, 처음 헤더 키 대소문자 조회를 잘못해 미검출한 값은 정규화 후 확인했다.
- 신규 운영 실제 경로·예보 저장은 PASS이며 컬렉션·공유·예산·정리 검증을 진행한다. 사용자에게 기존 라이더 로그인을 요청했으나 현재 서버상 최근 운영 로그인 역할은admin뿐이어서 다른 계정 사용 가능 여부를 확인한다. 두 실사용 계정의 역할 변경·회수·재가입 시험은 하지 않는다. 전체 Production gate 완료 여부는 후속 실제 증거로 판정한다.
- 원인 근거: [Supabase Auth NULL confirmation_token 진단](https://supabase.com/docs/guides/troubleshooting/scan-error-on-column-confirmation_token-converting-null-to-string-is-unsupported-during-auth-login-a0c686). 코드 보완과 이후 결과는 기존 운영 승격의 필수 수정 범위이며 새 운영 배포 승인을 반복 요청하지 않는다.

## 최신 실행 — Preview 실제 로그인·정상·실패 경계 확인

- 제품이 동일한73f14a41cdd78aa13ce63e649de01132ea0a7648에서 Vercel 로그인 후 기존 카카오 세션을 통한 앱 로그인 완료를 직접 관찰했다. 이번 로그인 역할은admin이며 지도 준비·기존 공유 기록 조회 PASS다. 다른 라이더 및 최초 가입은 기존 사용자 확인 근거와 구분한다.
- 공개 장소만 사용한 시험에서 실제 장소 검색, 이륜차 경로 계산·DB 저장, 기상청 초단기예보 저장·표시, 컬렉션 저장, 공유 미리보기·발행·공유 페이지 조회·회수·회수 후 거절을 확인했다. 제품 코드·안전 조건은 변경하지 않았다.
- Preview 쓰기 중지 구간에 이번 시험 예보 한 행만21분 이전으로 조정했다. 내부 KMA 한도를 잠시 이미 사용한1회에 맞춘 뒤 active Edge와 UI에서 예산 소진 경고·이전 예보 표시·공유 비활성화를 확인했다. 실제 KMA 장부는1회 그대로여서 공급자 쿼터를 고갈시키지 않았다. 한도1000 저장·다이제스트 복원 PASS다.
- Preview KMA 키만 명확히 유효하지 않은 시험 값으로 잠시 교체해 실제 공급자401을 관찰했다. 이전 예보가 있으면 provider 오류·실패 시각과 함께 저장본을 표시하고, 예상 도착 시각을 바꿔 일치 저장본이 없으면 미조회·공유 비활성화를 유지했다. 기존 키는 기존 보호 파일과 저장 다이제스트를 먼저 대조한 뒤 복원했고, 다른 설정 보존·한도1000을 재확인했다. 복원 후 실제 예보 재조회·표시 PASS다. Production 설정은 이 실패 시험에서 바꾸지 않았다.
- 첫 예산 UI 시도는 시험 행을 PostgreSQL 마이크로초 시각으로 만들어 앱의 밀리초 계약에서 거절됐다. 시험 자료를 밀리초로 보정한 후 동일 제품 재검사 PASS다. 구현 guard를 완화하지 않았으며 첫 시도는 시험 설정 ERROR로 보존한다. Secrets POST201의 빈 본문을 이전 도구의 JSON-only adapter가 오류로 해석한 시도도 저장 상태를 읽어 확인한 뒤 처리했고, 쓰기를 맹목 재시도하지 않았다. 읽기 전용 소유권 조회에서 collection의 컬럼명을 잘못 사용한 HTTP400은 owner_id로 수정했으며 데이터 변경 전이었다.
- 시험 여행·컬렉션은 생성 전 행 해시와 새 ID·소유자·시험 제목·공유 회수 상태를 검사한 단일 transaction에서 기존 삭제 RPC로 정확히 정리했다. 모든 기존13개 앱 테이블 행의 해시가 보존됐고 원래 여행7/컬렉션1/버전3/날씨9로 돌아왔다. 회수된 시험 공유1개, 경로 실행 감사6개, 저장 재시도 감사1개는 제품 정책대로 보존한다. 기존14개 공유와45개 실행 감사·8개 저장 감사도 변경되지 않았다. 원문·세션·백업 파일은 만들지 않았으며 ID/행 해시/개수 검증 메타데이터만 보관했다.
- 실제 Edge 로그70건은 lifecycle66, 의도한 예산 차단2, 의도한 KMA_HTTP_STATUS_401 2건으로 분류됐다. 예상 밖 메시지0. 실패 호출도 내부 예산에서 환불하지 않았다.
- Preview의 이번 정상·예산·공급자 실패 경계는 PASS다. 남은 순서는 이 문서 후보의 고정 SHA 검수·CI·Preview 배포 확인 → 기존 develop→main PR41 승격 → Production의 main SHA·공개 환경·실제 로그인·제품 검증이다. Production 웹 배포와 운영 제품 gate는 아직 NOT_RUN이다. 아래 로그인 대기는 과거 이력이다.

## 현재 상태 — 기상청 실제 한도 확인·반영 완료

- 기상청 API허브의 로그인된 마이페이지 내부 프레임에서 개인 계정의 일간 한도 **20,000회·5GB**를 직접 확인했다. 확인 시 화면 사용량은0회·0.00000GB였다. 이전에는 내부 프레임을 놓쳐 계정 한도를 확인하지 못했으며, 아래 로그인 대기 기록은 당시 이력이다.
- `KMA_DAILY_LIMIT`는 `ultra_forecast`와 `short_forecast`에 각각 적용된다. Production은 종류별9,000회(합계18,000회), Preview는 종류별1,000회(합계2,000회)로 저장하고 저장 다이제스트 일치와 다른 비밀 설정 보존을 확인했다. 적용 전 양쪽의 오늘 KMA 장부는0행/0회여서 기존 장부 변경은 필요하지 않았다.
- **5GB는 공급자 계정 공용 한도**다. 앱은 전송 용량을 집계하거나 환경별로 예약하지 않는다. 90:10은 호출 횟수 배분이며 용량·카카오 월간·지도 SDK 가용성을 보장하지 않는다. 유료 사용은 활성화하지 않았다.
- 사용자 승인 범위의 두 계정·소유 데이터 이전과 운영 schema·함수·공급자 설정은 완료됐다. Preview 쓰기 중지는 유지한다. 현재 Preview 브라우저가 Vercel 로그인 화면이므로 실제 접속 검증은 로그인 후 진행한다. KMA 로그인은 더 이상 대기 조건이 아니다.
- 남은 순서: 현재 후보의 Preview 접속·잔여 실패 경계 검증 → 문서 후보 및 exact-SHA CI 확인 → 기존 develop→main PR41 승격 → main 배포·운영 실제 이용 검증. Production 웹 배포와 운영 제품 gate는 **NOT_RUN**이며, 과거 로컬/Preview 성공을 운영 통과로 대신하지 않는다.

## 2026-09-15 두 계정 실제 이전 완료

- 고정0e2669c40c2974798fba1d77793ee5be8c8d7f9d의 PR42 CI34955712529 PASS, CI-only GitHub Deployments0/Vercel checks0 확인 후 수정한 `--apply` 실행이 exit0으로 완료됐다. 단일 transaction 내부 내용·권한 검증과 commit 후 source/target snapshot 비교 모두 PASS다.
- Production 결과는 users2/identities2/profiles2/memberships2, 활성admin1/rider1, invitations2, collections1/versions3, trips7/waypoints15/route_cache7/weather9/shares14, drafts0/runs45/save_operations8이다. 최종 snapshot SHA2563bc4e51a67d11f23734c389482902547f21cbe627bedff8ca409d24d7e1b222e. Preview 원본과 모든 이전 대상 내용이 일치한다. 새 원문 파일·백업·세션·refresh-token 복사는 없다.
- PR42 MERGED 및 develop exact-SHA fast-forward 완료. 새 Preview dpl_5iCqM98YKzWxpAa46pd7o1wBT72b READY, develop/0e2669c 일치. PR41은 동일 후보의 Draft 상태로 실제 이전 완료와 남은 조건을 갱신했다. 새 Production 웹 배포·실제 사용자 로그인/제품 검증은 아직 NOT_RUN이다.
- 기상청 계정 탭을 직접 확인했으나 로그아웃·빈 로그인 입력 상태다. 로그인 창을 열고 사용자 로그인만 요청했다. 직접 계정 한도 확인은 로그인 후 재개한다. KMA 한도 확인 전 main을 병합하지 않았다. Preview 쓰기 중지 결정은 유지하며, 운영 전환 안내 전 새 데이터를 원본에 추가하지 않도록 한다.
- 아래 최초413 실패와 수정 기록은 완료 전 이력으로 보존한다. 원격 최신 실행 상태는 [PR41](https://github.com/tocomboy/motocast/pull/41)과 Notion 배포 기록에 반영했다.

## 2026-09-15 실제 이전 재개와 전송 경로 보완

- 사용자가 이전 중 Preview 저장·수정·가입 중지가 가능하다고 확인했다. 기상청 한도는 직접 확인하도록 요청했으나 실제 탭은 로그아웃·빈 로그인 입력 상태여서 로그인 창을 다시 열고 사용자에게 로그인만 요청했다.
- 후보17a65e4의 최초 `--apply`는 Management API HTTP413으로 종료됐다. 오류 코드는 쓰기 결과 불명확으로 분류했고 자동 재시도하지 않았다. 후속 읽기 전용 preflight와 별도 COUNT로 Production의 대상15테이블 모두0임을 확인했다. 원본 여행·컬렉션·공유 등 앱 내용 digest는 이전 준비 시점과 동일하다. Auth 시각 필드는 바뀌어 새 manifest를 사용한다.
- 요청 JSON 실제 크기는3,248,910bytes다. 복제된 원본 JSON을 별도 저장하지 않으면서 원자 처리를 유지하려고, Management API의 일괄 SQL 전송만 `psql` 표준입력의 단일 DB transaction으로 교체한다. source snapshot·target metadata·전후 검증은 기존 Management 조회를 유지한다.
- 공식 Management API의 PRIMARY pooler 설정과5분 만료 CLI login role을 사용한다. 실제 role은 postgres MEMBER이나 NOINHERIT이므로 transaction 안의 SET LOCAL ROLE postgres가 필요함을 읽기 전용 rollback 검사로 확인했다. 사용자/운영자 권한을 새로 부여하는 GRANT나 인증서 검증 해제는 없다.
- 기본 시스템 CA로는 인증서 검증이 실패했다. Supabase Studio 공식 소스가 지정한 공개 prod-ca-2021.crt를 전용 certificate 경로에 받아 `verify-full`로 연결을 검증했다. 공개 인증서 SHA256700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7. 이 파일에는 사용자 데이터나 비밀키가 없으며 백업을 만들지 않는 결정과 구분한다.
- 전송 수정 lead 검수 PASS. 실제 격리 PostgreSQL17.6.1.166:55434에서3.3MB 이상 stdin 전송·commit·내용/소수/메타명령 형태 문자열 보존, 오류 rollback, 충돌 무변경, TLS·대상·환경·TTL 검사 등17 PASS/0 FAIL/0 ERROR/0 SKIP. 최초 확장 검사14 PASS/3 FAIL은 이전 오류 코드 기대값과 PSQL 안의 SQL 문자열을 오인한 assertion을 고쳐 해결했다. 최종15테이블 행0과 DB healthy를 확인했다. psql14.24/Python3.10.12, 설치 변경 없음. 제품 소스는17a65e4와 동일하므로 기존 baseline을 재사용한다.
- 고정 파일 SHA256: operator a0651bae661579d67862d42919afed2f5a7b5c9861799a7538dce9203206d12c, transport99a8ab56f75947f734d95bc56db68442292fe5528710355c2cd80142ac889aa5, tests c3b829e8bf507c3c3a30ff2fffd541ea391c924766f17039a65640cd6d6595f8. 계정 이전과 main 배포는 후속 실행이며 현재 완료가 아니다. [Draft PR41](https://github.com/tocomboy/motocast/pull/41)은17a65e4 기준 verify/develop-only/Vercel PASS 상태이며 수정 후보 검증 후 갱신한다.

## 2026-09-15 재개 결정과 검증

- 사용자가 기존 Preview 카카오 앱을 공유하는 방향에서 실제 공급자 한도에 맞춘 증액과 Preview 할당 비율의 자율 결정을 승인했다. 운영 90% / Preview 10%로 결정한다. 앱 1561641이 계정의 카카오맵 무료 쿼터 대상이며 지도 ON, 카카오맵 유료 사용 OFF를 콘솔에서 확인했다. 이후 활성화한 앱에는 무료 지도 쿼터가 없으므로 별도 운영 앱 권고를 수정했다.
- 카카오 일간 제한 적용 및 저장 다이제스트 확인 PASS: 장소 검색 Production 90,000 / Preview 10,000, 현재 길찾기 9,000 / 1,000, 미래 길찾기 4,500 / 500. 각 합계는 공식 일간 무료 한도와 같다. 월간 300만 및 브라우저 지도 SDK 한도는 카카오 앱 전체에 적용되며 기존 내부 일간 RPC로 환경별 예약을 강제하지 않는다. 일간 배분만으로 월간 가용성을 보장했다고 기록하지 않는다.
- 기상청은 공개 일반회원 안내가 20,000건/일 및 5GB/일이다. 로그인 완료 답변 후 마이페이지 이동이 로그인 해제로 이어져 실제 계정 한도를 읽지 못했다. 사용자에게 실제 일 최대 호출 수·용량 두 값만 요청했다. KMA_DAILY_LIMIT는 예보 두 종류에 각각 적용되므로 전체 예산을 양쪽 종류에 중복 배정하지 않는다. 호출 수와 데이터 용량 제한을 구분한다.
- 증액 전 Preview 한도 네 개는 정확히 100, Production 한도 네 개는 미설정임을 관리 API의 저장 다이제스트와 비교해 확인했다. 현재 카카오 세 종류는 위 90:10 값으로 적용했다. KMA만 Preview 100·Production 미설정이다. 원문 키와 기존 개인 데이터의 새 백업은 만들지 않는다.
- PR #39, 고정 SHA 14e5c13c68ed2d4d3907a560b3bbbe612b1d969f: CI-only 검사 후 develop에 동일 SHA 반영, PR MERGED, develop CI 34941274636 PASS. Preview 별칭 dpl_83jR9vY5y6oop15dxqi6Ah6CreSs READY이며 해당 SHA와 일치한다. Production은 아직 변경 전이다.
- 운영과 같은 supabase/postgres:17.6.1.166에서 실제 3→11 migration upgrade PASS, 합성 계정 2개의 필드·관계 보존 PASS. 최종 DB 374 PASS/0 FAIL/0 ERROR/0 SKIP. 최초 CLI 기본 이미지 .165 불일치와 합성 fixture 간섭으로 pgTAP 1 FAIL했던 시도는 이력으로 유지한다. 정확한 .166 고정 및 고정 fixture만 정리한 후 수정 없는 동일 검사로 통과했다. 검증 리소스 55434 및 기존 리소스는 유지했다.

Production 공급자 REST/KMA/origin/place 설정과 Auth site/callback/Kakao client 연결을 적용했다. 기존 login secret은 Preview와 동일한 다이제스트, state secret은 다른 다이제스트임을 확인하고 유지했다. Vercel 세 변수는 sensitive여서 GET에서 숨겨진 값이었다. 빈 값이라는 초기 판정을 정정하고 올바른 운영 값을 Production 전용으로 PATCH 성공·범위 재확인했다. 값의 최종 연결은 실제 배포에서 확인한다. 카카오 콘솔의 운영 callback/domain 저장 직전 확인과 KMA 계정 한도 확인은 대기한다.

진행 순서: 공급자별 한도 배분·환경 설정 → 메모리 내 이전 스크립트 및 원자성 검증 → Production migration/계정·소유 데이터 이전 → develop→main PR와 실제 운영 확인. 아래 초기 조사값은 당시 이력이며 위 갱신을 우선한다.

### 운영 적용 후 확인

- 사용자 승인으로 카카오 앱 1561641의 운영 로그인 콜백과 JavaScript 지도 도메인을 추가 저장했다. 각각 설정을 다시 열어 `https://obodvbyzptxeehgpcpkd.supabase.co/functions/v1/kakao-oidc/callback`, `https://motocast-three.vercel.app` 등록과 기존 Preview 등록값 보존을 확인했다.
- Production에 누락된 8개 migration SQL을 실제 적용해 총 11개로 맞췄다. 관리 API가 부여한 실행 시각 version은 각 적용 성공 뒤 이름·신규 version·충돌 부재를 확인하는 transaction으로 저장소 원래 version에 맞췄다. migration 실행을 생략한 이력 조작은 하지 않았다.
- 두 환경의 public schema 비교 PASS: RLS 포함 16개 테이블, 127개 컬럼, 89개 제약, 13개 정책, 39개 함수 정의·권한이 동일하다.
- 고정 SHA 14e5c13의 변경 없는 Edge 소스로 Production 함수 5개 배포 완료. 모두 ACTIVE, 일반 함수 4개 JWT 검증 true, OIDC만 false다. 경로·날씨 함수는 Preview와 번들 해시 동일, 나머지 3개는 전체 파일 이름·내용 동일을 확인했다. 번들 경로 차이로 생긴 해시 차이를 소스 변경으로 오인하지 않는다.
- 이전 도구 lead 지적 3개는 RESOLVED다. 데이터에 없는 dollar-quote 구분자를 사용하고, PostgreSQL JSON을 text로 전송한 뒤 Decimal로 해석해 소수 정밀도를 보존하며, 쓰기 이후 오류는 결과 불명확·데이터 보존으로 표시하고 자동 재시도하지 않는다. 격리 PostgreSQL17.6.1.166:55434 실제 최종 검사 13 PASS/0 FAIL/0 ERROR/0 SKIP, 시험 후 관련 행 0. 중간 syntax 검사 shell 인용 오류 1회는 명령 수정 후 PASS이며 데이터에 영향이 없었다. 제품 코드는14e5c13과 동일하여 기존 제품 baseline을 재사용한다.
- 운영자 파일 SHA256 `814ea74690369dddd0c7bd1ac8c0129b90ef873b8a1c25f4bc40bdcc6a1a1f0c`, 시험 파일 SHA256 `128d95e8784e829f49a50de5c0ca07d781a6bd873e73e1cb8f64b8f8323b25c3`. 수정 후 실제 두 hosted 환경 preflight PASS: migration11·schema·동일 Kakao client·원본2사용자/2신원/활성admin1/rider1·대상15테이블 빈 상태·외래키 닫힘을 확인했다. 원문은 메모리에서만 다뤘으며 파일 백업이나 사용자 DML은 없다.
- 사전 manifest: users2, identities2, profiles2, memberships2, invitations2, collections1, versions3, trips7, waypoints15, route_cache7, weather9, shares14, drafts0, runs45, save_operations8. snapshot SHA256 `a5258b79c7823c498425d4692257f297d1361d221780494a80a65a1cd94861e4`. 적용 시 새 manifest를 검증하고 원본이 바뀌면 기존 준비 결과를 재사용하지 않는다.
- 운영 HTTP 검사: 일반 함수4개 익명401 PASS. OIDC 시작은 허용된 `/auth/kakao/callback` 복귀 주소에서 카카오 authorize302·정확한 운영 Edge callback·email scope 없음·binding cookie·no-store PASS. 최초 probe가 `/auth/callback`을 써400으로 거절된 것은 허용 경로 보호의 정상 응답이며 올바른 경로로 재검사했다. 실제 사용자 로그인 완료와 동등한 증거는 아니다.
- 사용자에게 이전 중 Preview 저장·수정·가입 중지 가능 여부를 확인 중이다. KMA 계정의 실제 일 최대 호출 수·용량 확인도 대기한다.

상태: **운영 schema·함수·카카오 주소 적용 완료 / Production 데이터 이전·main 배포 NOT_RUN**.

## 사용자 결정과 범위

2026-09-15 사용자가 Production 배포를 승인하고 신규 사용자 가입과 기존 사용자 접속이 가능하다고 확인했다. 관리자 포함 기존 두 사용자의 데이터를 그대로 이전하도록 요청했다. 가입·재접속은 사용자 확인 근거이며 이번 에이전트가 새로 실행한 브라우저 시험으로 집계하지 않는다.

이번 요청은 `OPS-007`의 환경 간 사용자 데이터 복사 금지에 대한 **이 두 사용자 및 소유 데이터의 일회성 Preview → Production 이전 예외**다. 상시 동기화, Production → Preview 복사, 원본 삭제, 다른 사용자 데이터, 인증 세션·공급자 키·예산 장부의 무조건 복사를 허용하지 않는다. 기존 지역(Preview 서울, Production 도쿄), 초대제, 소유권 보호, 무료 운영과 develop → main PR 경로는 유지한다. 새 배포는 과거 develop에서 생성된 Production 별칭의 계보를 검증된 main 배포로 교정한다.

## 계획과 진행

1. **완료:** 현재 두 환경, 이전 대상, 공유 카카오 앱 연결, 카카오·기상청 실제 한도와 호출 수90:10 적용·저장 확인.
2. **완료:** 최신 develop의 임시 복구 기능 제거9파일. 단위528 PASS, 브라우저20 PASS/연결 전용2 SKIP, lint/typecheck/Deno5/build PASS. 기존 사용자 작업 트리는 보존. PR39의 고정14e5c13 CI·develop 반영·Preview READY 확인.
3. **완료:** 같은 Kakao 신원을 쓰는 연결 방식과 실제 DB upgrade 검증, Production schema·함수·설정 적용, 백업 없는 메모리 내 두 사용자 데이터 이전 및 commit 후 전체 내용·역할 일치 검증.
4. **진행 중:** 실제 Preview 로그인·정상 및 실패 경계 PASS. 최종 문서 후보 검수·CI·Preview 확인 후 기존 develop → main PR41로 Production 배포.
5. **대기:** main 배포 SHA·별칭, Vercel 무로그인 접근, 두 계정 및 역할·데이터, 신규 초대, 경로·날씨·공유·차단 경계의 실제 검증과 최종 기록.

## 현재 확인한 근거

- 원격 develop `abcb1e92aae7cfd5c07f74e856cfb166472b94f6`, main `d0134ed93d7e0d8aed1123c5d693c665bbe646e8`.
- 실제 Preview 별칭은 `dpl_BUS4KfBbMi2BHDUAcKTir8rwwTrb`, develop/abcb1e9, READY.
- 실제 Production 별칭은 `dpl_7c5UdGv4VWcs4k1YwHNERhQZVuH8`, develop/201e1ec, READY. 기존 main과 다름.
- Vercel Production branch main, Node20.x, Vercel Authentication preview only를 실조회했다. 기존 CLI59.11.7의 공식 whoami 인증 갱신 후 조회 가능했다.
- Preview `lehjmbgfpoemqcwxowbx`: ACTIVE_HEALTHY와 DB 연결 PASS. Auth users2/identities2/profiles2/memberships2, 활성 admin1/rider1. trips7/collections1/collection_versions3/share_links14. 목록 도구의 추정 rows0은 실제 COUNT를 대신하지 않는다.
- Production `obodvbyzptxeehgpcpkd`: 위 계정·제품 항목의 실제 COUNT0. 다른 테이블·설정까지 비어 있다고 확대하지 않는다.
- Preview migrations11개, Production3개. Production에는 이후8개 migration이 필요하다.
- Production Auth site_url은 localhost, Kakao provider 비활성·client ID 없음. 공급자 REST/KMA 키·origin·예산 설정도 없다. 기존 OIDC state와 login secret 이름은 존재하므로 덮어쓰기하지 않는다.
- Preview는 Kakao provider 활성·email optional이며 정확 Preview callback으로 구성되어 있다.
- 격리 후보는 최신 develop에서 생성했다. 기존 fefb67d의 임시 복구 제거9파일만 writer가 적용·검증한다. 기존 root dirty 파일과 과거 WSL worktree, 고정 복구 자료는 보존한다.

## 계정·데이터 이전 설계 조건

- Kakao 회원번호는 앱별로 다르다. Production에서 사용할 앱이 확정되고 기존 두 신원과 연결되는 증거를 확보해야 한다. 닉네임·이메일 추정 매칭으로 관리자 또는 라이더 권한을 이전하지 않는다.
- 같은 공급자 신원을 사용하는 경우에도 auth.users UUID와 auth.identities의 일관성, 가입 트리거, 회원 역할, 외래키를 실제 복구 리허설에서 확인한다. 별도 앱이면 각 계정의 실제 인증으로 안전한 신원 매핑을 먼저 확정한다.
- **사용자 최신 결정: 백업하지 않음.** 제안된 로컬 원문 백업은 자동 승인 심사가 범위·저장 위치의 명시적 승인 부족으로 거절해 실행되지 않았다. 사용자는 이후 "이전 실패해도 상관없어 백업하지마"라고 지시했다. 원문 백업 파일·전체 export·복구용 사본을 로컬이나 별도 원격 위치에 만들지 않는다. 필요한 전송은 메모리에서 처리하고 원본 Preview를 삭제하지 않는다. source/target/project/SHA·시각·해시·행 수 등 비밀 없는 검증 메타데이터만 기록한다. 인증값·개인 위치·일정·원본 JSON을 로그·Notion·Git에 출력하지 않는다.
- 이전 범위는 두 사용자와 그 소유 프로필·회원권한·여행/경유/도로/날씨·컬렉션/버전·공유 및 필요한 감사/재시도 연결이다. 관계를 닫힌 집합으로 산출하고 대상의 사전 충돌0을 확인한다. 새로운 행이 생기거나 원본이 바뀌면 이전 manifest를 무효화하고 변경분을 재검토한다.
- 활성 세션·refresh token·진행 중 OIDC handoff·단기 preview grant는 환경 간 이전하지 않는다. 두 사용자는 Production에서 같은 카카오 계정으로 새 로그인한다.
- 공유 snapshot은 내용·발행시각·회수 상태를 보존한다. 이전만으로 회수된 링크를 되살리거나 만료된 날씨를 새 정보로 바꾸지 않는다. 기존 링크의 Preview 도메인과 Production 도메인은 별개이며 원문 bearer token을 저장하지 않는 구조를 존중한다.
- 원본은 최종 검증까지 그대로 보존한다. 최종 snapshot 이후의 쓰기 유실을 막을 cutover 절차를 확정하고, 대상 DML은 원자 처리·정확 행 수·소유권·내용 digest·외래키 검증을 포함한다.
- Production의 사전 상태·충돌 부재, migration dry-run과 실패 시 원자 rollback, 무료 quota와 초기 예산, 공급자 환경 소유권, 배포 전후 호환 복구 경로를 확인한 뒤 외부 변경을 시작한다. 사용자의 백업 생략 위험 수용은 테스트·신원 검증·원본 보존·데이터 일관성 검증 생략이나 파괴적 명령 허용으로 확대하지 않는다. reset/DROP/무조건 DELETE/DB downgrade는 하지 않는다.

## 현재 남은 외부 조건

카카오·기상청 콘솔 확인, Preview의 Vercel·카카오 로그인과 정상·공급자 실패·예산 차단 검증을 완료했다. Production 승격 후 실제 로그인·제품 검증이 남았다. 기존 계정을 삭제·회수하거나 가입 재현용으로 재생성하지 않는다. 배포 승인 자체를 다시 묻지 않는다.

## 근거

- [기존 Production 준비안](2026-09-05-production-promotion-packet.md)
- 기존 복구 제거 후보 fefb67d는 역사적 로컬 근거이며 현재 release SHA는14e5c13이다.
- [Supabase Auth 사용자 이전](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects)
- [Kakao 앱별 사용자 식별자](https://developers.kakao.com/docs/ko/kakaologin/group-app)

이 문서는 현재 실행 결과와 역사적 준비·실패 기록을 함께 보존한다. 두 사용자 데이터 이전은 위 commit 후 일치 증거로 완료됐으며 Production 웹 배포·운영 제품 검증 완료와 구분한다.
