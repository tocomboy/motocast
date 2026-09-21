# Android API 기반 — 현재 계약과 구현 준비 (#30)

- 근거: 2026-09-18 사용자의 #66 → #30 진행 순서, [Android 요구사항](2026-09-08-android-ride-requirements.md), [Issue #30](https://github.com/tocomboy/motocast/issues/30).
- 코드 기준: `31f87e9d622fd313a10ffffbfdcc7f88e32040d9` / `0.4.1`. 앞선 #66 변경은 공유 화면의 안내 상태만 수정한다.
- 상태: **소스 조사·계약 초안 작성 완료**. Android 앱, 신규 로그인 교환, OpenAPI 명세/호환 검사, native 실제 호출, 성능·예산 실측, 게시·배포는 **NOT_RUN**이다. #30 전체 완료를 뜻하지 않는다.
- 정본: [AUTH-001/003/004/005, SHARE-001~004, ROUTE-001/006/008](../../product/MOTOCAST_SOT.md). 확정된 이메일 미수집·초대 회원·소유권·이륜차 안전 조건을 유지한다.

## 1. 결론과 책임

Kotlin + Jetpack Compose 앱과 기존 TypeScript/Supabase 서버를 API로 분리한다는 기존 결정을 따른다. 앱은 입력·화면·기기 위치·주행 상태·알림을 담당하고, 서버는 인증 확인·회원 권한·소유권·경로/날씨·저장·호출 예산을 담당한다. 서버를 Kotlin으로 다시 쓰는 작업은 포함하지 않는다.

현재 경로 API는 이미 Bearer 토큰을 쓰지만, 웹 로그인 완료와 일부 Next.js API는 쿠키 및 동일 출처 요청에 묶여 있다. 따라서 웹 쿠키를 Android로 복사하거나 Origin을 위조해서 재사용하지 않는다. 기존 Edge/RPC 계약을 먼저 문서화하고, 별도 Android 인증 어댑터를 검증한 뒤 앱을 연결하는 순서가 적합하다. 이는 코드 조사에 따른 설계 판단이며 새 인증 경로의 성공 증거는 아니다.

## 2. 현재 API 목록 — 구현된 사실

Edge base는 `{supabaseOrigin}/functions/v1`, RPC base는 `{supabaseOrigin}/rest/v1/rpc`다. Android는 공개 프로젝트 설정과 사용자 토큰만 사용하며 provider key, service-role key, OIDC state/장소 서명 비밀값을 포함하지 않는다.

| 사용자 동작 | 기존 호출·입력 | 결과와 경계 | 소스 |
| --- | --- | --- | --- |
| 장소 검색 | POST `search-places`: `query`, `page`, `size` | `places`, `isEnd`. 검색 장소마다 `verificationToken`; query 정규화 후 2~100자, page 1~45, size 1~15 | [검색 parser](../../../supabase/functions/_shared/place-search.ts), [handler](../../../supabase/functions/search-places/index.ts) |
| 경로 계산 | POST `plan-route`: `planningId`, nullable `tripId`, `origin`, `destination`, ordered `waypoints`, `serviceDate`, `departureAt` | 검증된 추천 경로 한 개와 서버의 임시 저장. 이 응답만으로 최종 저장 성공은 아님 | [요청](../../../supabase/functions/_shared/route-request.ts), [handler](../../../supabase/functions/plan-route/index.ts) |
| 계획 저장 확정 | POST RPC `finalize_trip_plan`: `target_planning_id`, `target_trip_id` | trip UUID. 성공한 동일 planning/target에 이어서만 날씨·공유 진행 | [현재 호출 순서](../../../components/planner-dashboard.tsx) |
| 경로의 날씨 | POST `weather-timeline`: `tripId`, `candidateProfile`, `points[{id,label,longitude,latitude,eta}]` | 현재 경로와 결속된 예보. 정상·캐시·오래된 저장본 응답을 구분; HTTP 200만으로 최신 예보라고 판단하지 않음 | [요청](../../../supabase/functions/_shared/weather-request.ts), [handler](../../../supabase/functions/weather-timeline/index.ts) |
| 내 경로 저장 | POST `save-collection`: `saveOperationId`, nullable `collectionId`, `title`, `description`, `origin`, `destination`, `points` | `collectionId`, `versionId`, `versionNumber`. 장소/방문 순서/휴식만 저장; 출발 일정은 저장하지 않음 | [요청](../../../supabase/functions/_shared/collection-request.ts), [handler](../../../supabase/functions/save-collection/index.ts) |
| 공유 준비·발행·회수 | RPC `preview_trip_share`, `publish_trip_share`, `revoke_share` | `target_trip_id`로 준비, `approved_preview_token`으로 명시 발행, `target_share_id`로 회수. preview는 공개하지 않음 | [호출·결과 검사](../../../components/share-manager.tsx) |
| 공개 공유 읽기 | POST web `/api/shares/resolve`: `{token}` | `{snapshot}` 또는 404/503. 로그인 불필요, 원문 토큰은 body/메모리 범위로 제한 | [handler](../../../app/api/shares/resolve/route.ts), [parser](../../../lib/sharing/contracts.ts) |
| 공유를 새 일정/내 경로로 | web `/api/shares/course`, `/api/shares/save` → 회원 전용 RPC | 현재 쿠키 세션·동일 출처 JSON 검사 사용. Android용 Bearer 어댑터 또는 동일 회원 RPC 호출과 응답 검증 필요 | [course](../../../app/api/shares/course/route.ts), [save](../../../app/api/shares/save/route.ts) |
| 즐겨찾기 | RPC `add_place_favorite`, `remove_place_favorite` | 사용자별 3칸; 삭제는 slot + expected place ID; 서버 소유권·중복/동시성 검사 유지 | [현재 어댑터](../../../components/place-favorites-provider.tsx) |
| 삭제·초대·공지 | web `/api/trips/[tripId]`, `/api/invites/accept`, `/api/releases/claim` 및 관리 RPC | 앱 지원 필요 범위를 별도 명세. 웹 cookie endpoint를 native 지원으로 간주하지 않음 | [API 디렉터리](../../../app/api) |

Edge의 [`requireMember`](../../../supabase/functions/_shared/auth.ts)는 토큰의 사용자 확인과 현재 active membership 조회를 수행한다. [`corsHeaders`](../../../supabase/functions/_shared/http.ts)는 Origin이 없으면 허용 헤더를 반환하고, 명시된 비허용 Origin은 거부한다. 이 소스 동작은 Android 실제 접근 성공이나 CORS를 인증으로 사용한다는 뜻이 아니다. JWT·회원·RLS/소유권 검증이 계속 필요하다.

### 데이터·실패·재시도 계약

- DTO(서로 주고받는 데이터 형식)는 위 parser와 실제 응답을 기준으로 별도 명세한다. Kotlin 타입 선언만으로 JSON을 신뢰하지 않는다. 날짜/시간·유한 좌표·nullable 필드·legacy share schemaVersion 1/2/3와 알려지지 않은 응답의 안전한 오류 표시를 검증한다.
- 모든 방문은 occurrence ID로 구분하며 반복 장소도 합치지 않는다. 일반 경유 20개·휴식 5개·전체 30개, 선택 식사 각각 최대 1개, 역할 간 순서를 유지한다. 외부 카카오맵의 경유지 5개는 별도 실행 한도다.
- 경로→저장 확정→날씨 순서를 한 앱 동작으로 묶되 단계별 실패를 숨기지 않는다. 지난 출발 거절, 서버 고정 이륜차 정책, 24시간 미만, target revision 검증을 클라이언트 선택으로 바꾸지 않는다.
- 현재 오류 형태는 통일돼 있지 않다. `plan-route`는 `{error,code}`, 장소/컬렉션의 일반 오류는 `{error}`, RPC는 PostgREST 오류다. 현행 wire 형식을 그대로 기록하고 앱 어댑터에서 `unauthenticated / forbidden / invalid / budget / unavailable / conflict / unknown` 등 내부 종류로 변환한다. 한국어 문자열만으로 자동 재시도 여부를 정하지 않는다. 부족한 기계 판별 코드는 호환 가능한 별도 서버 변경으로 다룬다.
- 로그인 만료와 비회원 거절, HTTP 429 일일 예산 소진, 안전 경로 없음, 날씨 stale/만료, 저장 실패를 별도 화면 상태로 다룬다. 오래된 데이터가 있으면 현재 결과로 위장하지 않고 표시한다.
- 결과가 불명확한 route/provider 호출은 자동 재시도하지 않는다. 중복 과금·중복 저장을 막기 위해 `planningId`/`saveOperationId`의 서버 retry 보장을 실제 DB 테스트로 확인한 호출만 같은 operation ID로 재시도한다. 공유의 소비된 preview capability는 재발행하지 않는다.
- 응답/기록에는 안전한 오류와 필요한 상관 ID만 허용한다. 토큰·헤더·쿠키·내부 SQL·실제 위치·전체 요청 본문을 로그에 넣지 않는다. 지금 새로운 telemetry를 배포하지 않는다.

## 3. 로그인 — 기존 계약과 native 차이

현재 [`start`](../../../app/api/auth/kakao/start/route.ts)는 HttpOnly `__Host-` 브라우저 결속 쿠키를 만들고, [`complete`](../../../app/api/auth/kakao/complete/route.ts)는 동일 출처 JSON·그 쿠키·1회 handoff를 확인한 뒤 Supabase 세션 쿠키를 설정한다. [`finalizeAuthenticatedLogin`](../../../lib/auth/login-finalization.ts)은 초대 사용 또는 기존 활성 회원 여부를 확인한다. 이것은 **웹 구현**이며 native 앱이 browser cookie 없이 호출할 수 있는 session exchange API가 아니다.

후속 인증 슬라이스의 보존 조건:

1. 카카오 계정 subject와 Supabase user ID를 구분하고 기존 회원을 같은 소유자로 식별한다. `account_email`은 요청하지 않는다. 최초 회원 생성에는 유효한 초대가 필요하고 기존 활성 회원은 새 초대 없이 로그인한다.
2. 앱이 로그인 시도를 시작할 때 시도별 비밀값을 소유하고 응답을 그 시도에 결속한다. 다른 앱/기기, 잘못된 callback, 중복·만료·취소·재시작 후 낡은 응답은 세션과 회원 상태를 바꾸지 못해야 한다.
3. 시스템 브라우저/Custom Tabs를 이용하는 직접 OIDC 확장을 우선 설계 후보로 조사한다. provider secret은 기존 서버에 두고, 앱으로 돌아오는 정보는 짧은 수명의 1회 교환 코드로 제한한다. 장기 session token을 deep-link query/fragment로 넘기지 않는다. 교환 코드·앱 비밀값·redirect 결속, 서버 세션 발급과 저장소는 **아직 미구현/미확정**이며 기존 browser handoff를 그대로 노출하지 않는다.
4. 앱 링크 소유권, 앱 식별자, debug/release 서명 분리, 정확한 callback allowlist와 안전한 session 저장/갱신/로그아웃을 검증한다. `assetlinks.json`의 package/signing 값은 실제 앱을 정한 뒤 확인하며 지금 임의로 게시하지 않는다.
5. 기존 웹의 browser-binding, state/nonce, single-use/expiry, 오류 정리·초대 거절을 유지한다. 새 native 경로는 별도 보안 검수·실제 회원/비회원·동시 교환 테스트 뒤 도입한다. 현재 AUTH-004와 다른 인증 계약이 필요하면 해당 차이를 사용자에게 제시한 뒤 확정한다.

### 공식 근거와 해석의 구분

- [RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252)는 native OAuth에서 외부 사용자 에이전트와 공개 클라이언트의 PKCE를 요구한다. 여기서의 구현 제안은 앱의 시도 비밀을 코드 교환에 결속하는 방향이다. MOTOCAST의 현재 직접 OIDC flow가 이미 PKCE를 구현했다고 주장하지 않는다.
- [Android App Links](https://developer.android.com/training/app-links/about)는 웹 도메인과 앱의 연계를 Digital Asset Links로 확인한다. 앱 링크만으로 사용자 인증·회원 권한이 생기는 것은 아니다.
- [Supabase 모바일 deep link](https://supabase.com/docs/guides/auth/native-mobile-deep-linking)는 모바일 복귀 설정을 설명한다. 그 예시를 현행 쿠키/OIDC 흐름과 자동 호환된다고 보지 않는다.
- [Supabase Kakao 문서](https://supabase.com/docs/guides/auth/social-login/auth-kakao)는 이메일 없이 provider를 설정할 수 있다고 안내한다. 그러나 이 저장소는 같은 안내와 실제 hosted scope가 달랐던 근거로 AUTH-005를 폐기했다. 문서만으로 `signInWithOAuth`를 복원하지 않는다. 변경을 검토한다면 최신 실제 authorize scope와 기존 계정 identity의 별도 증거가 먼저 필요하다.
- [Kakao Android 로그인 문서](https://developers.kakao.com/docs/en/kakaologin/android)는 SDK 통합의 공식 출발점이다. SDK를 대안으로 택하려면 native client audience·nonce·동일 계정 식별·Supabase 교환 호환을 추가 확인해야 한다. SDK의 존재가 현행 서버와의 호환 증거는 아니다.
- [Supabase changelog](https://supabase.com/changelog.md)를 2026-09-18 조회했다. 이번 준비에서 SDK/서버 업그레이드는 하지 않는다. 계정별 현재 provider 설정·쿼터는 조회하지 않았으며 과거 무료 한도 수치를 현행 확정값으로 재사용하지 않는다.

## 4. 구현 순서와 완료 조건

2026-09-21 별도 로컬 `MOTOCAST-Android` 프로젝트의 Kotlin/Compose Preview 개발 환경과 APK 빌드 기반을 구성했다. 아래 단계 C의 로그인·장소 검색 연결 완료와 구분한다. 같은 날 사용자가 공유 목록에 현재 공개 중인 링크만 표시하고 `회수됨` 항목을 숨기도록 확정했으며, Android 공유 화면에도 이 계약을 적용한다. 회수 기록은 서버에 보존하고 성공 직후 완료 안내는 유지한다.

각 단계는 별도 검토 가능한 작업이다. 현재 #66과 Android 인증/DB/앱 변경을 같은 제품 릴리스에 묶지 않는다.

| 단계 | 포함 / 제외 | 완료 조건 | 현재 |
| --- | --- | --- | --- |
| A. 계약 고정 | 기존 Edge/RPC/웹 adapter의 요청·응답·오류와 소유권 명세. runtime·CI 변경 제외 | 실제 parser에 맞는 OpenAPI/JSON 예제, TS↔Kotlin 호환 fixture, 버전 호환 규칙·오류 mapping 검사 | 소스 목록·차이 조사 완료, 기계 명세·fixture NOT_RUN |
| B. native 로그인 경계 | 기존 원칙을 보존한 앱 복귀·세션 교환. GPS·추천 제외 | cold/warm start, 취소, 다른 앱/기기 탈취, replay·동시 소비·만료, 기존/신규 초대·회수 회원, 웹 회귀와 실제 Preview | 설계 후보 정리, 구현/실측 NOT_RUN |
| C. 최소 Android 연결 | Kotlin/Compose 앱에서 로그인·회원 확인·장소 검색 한 흐름. 서버 전환 제외 | 앱/웹/서버 독립 빌드 경계, 키 비노출, 안전한 session 복원·401/403/429·네트워크 실패 처리 | NOT_RUN |
| D. 계획·저장·공유 연결 | 기존 route/finalize/weather/collection/share/favorite 계약 | 웹과 같은 DTO/순서·소유권·예산, 오래된 응답 차단, 재시도·동시성·실제 기기 검증 | NOT_RUN |
| E. 주행 기능 | #31 GPS → #32 날씨/알림 → #33 음식점. 품질·무료 예산 #34를 함께 검증 | 실제 단말·네트워크·동시 10명 조건 및 측정 기준 확정. 경로 5초·추천 3초, 실제 무료 예산 입증 | 후속, NOT_RUN |

OpenAPI의 버전은 제품 표시 버전과 구분한다. 앱의 이전 버전도 남아 있을 수 있으므로 선택 필드 추가와 nullable/enum 확장 허용 범위를 정하고, 필수 필드 제거·의미 변경은 새 계약 버전과 이행 기간으로 처리하는 안을 검토한다. 이번 문서 자체가 endpoint 버전이나 호환 기간을 운영에 적용하지 않는다.

장소 검색/경로 요청마다 provider budget을 소비하는 현재 서버 책임을 유지한다. 요청 중복 통합·공유 캐시·주행 알림 이력의 소유권은 서버에서 일관되게 설계하되 native 주행 session/notification API가 이미 있다고 가정하지 않는다. 음식점 운영시간 원천과 품질, 현재 무료 한도·실제 계정 설정, 성능 백분위/실패율은 해당 단계의 미확정 항목이다. #59 웹 카카오맵 실기기 검증을 이 작업의 선행조건으로 다시 넣지 않는다.

## 5. 이번 준비의 검증 한계

소스 경로·현재 호출·요청 parser·로그인 cookie/Origin 경계 및 공식 문서를 대조했다. 서버 구현·DB·인증 설정·Android SDK·CI/CD는 변경하지 않았고 앱/서버 실제 왕복은 NOT_RUN이다. #66의 646 단위/49 Chromium PASS는 웹 수정의 회귀 증거이며 Android 성공 증거가 아니다. 다음 구체 작업은 **A: 현행 계약의 기계 명세와 호환 fixture**이며, B의 새 인증 계약은 별도 범위에서 검수한다.
