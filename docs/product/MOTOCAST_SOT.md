# MOTOCAST product source of truth

Last verified: 2026-09-05 (Asia/Seoul)

Diagnostic release addendum, 2026-09-16: the user approved PR and deployment of 0.2.2 after a Production `ROUTE_DURATION_TOTAL` failure was identified. Closed signed-duration categories improve observation of already-rejected responses without changing `SCOPE-002`, `ROUTE-001/004/006`, budget, persistence or public error contracts. This is not proof of a route fix or full-product acceptance. [Current diagnostic evidence](../archive/2026-09/2026-09-16-route-duration-diagnostic.md).

Production execution addendum, 2026-09-15: PR41/main89977ef is deployed publicly. The first real login identified missing empty-string Auth placeholders in the one-time transfer; an exact-two-user repair preserved all other Auth/app data, and the operator now initializes/verifies these nonsecret empty fields. Administrator login and live route/weather pass after repair. Other identities and remaining Production gates require their own evidence; the whole product gate is not yet declared complete. [Execution record](../archive/2026-09/2026-09-15-production-user-migration-plan.md).

Verification addendum, 2026-09-15: existing-admin Kakao browser login and the actual Preview route/weather/collection/share/revoke path passed. Controlled active-provider401 and internal-budget exhaustion verified stale/no-snapshot UI handling and sharing denial; original key/limit restoration, live recovery and exact test cleanup passed with existing data preserved. Production schema/functions and the authorized two-user data transfer are complete, while Production web promotion and its separate product gate remain NOT_RUN. This adds execution evidence without changing a product contract. [Current evidence and limits](../archive/2026-09/2026-09-15-production-user-migration-plan.md).

Verification addendum, 2026-09-06: approved temporary Auth/ownership checks passed149, and seeded missing/stale/naturally expired weather sharing checks passed11, each with exact cleanup readback and preserved real-user data. These are bounded Preview evidence, not full Kakao/provider/budget or Production completion. No confirmed product contract changed. [Sharing evidence and limits](../archive/2026-09/2026-09-06-negative-share-connected-proof.md), [remaining gates](../archive/2026-09/2026-09-06-preview-remaining-gates.md).

This document is the single source of truth for MOTOCAST product, security, cost, and operations decisions. A `CONFIRMED` entry is binding. A `NEEDS_INTERVIEW` entry blocks only the affected slice and must fail closed. A `DEPRECATED` entry remains as decision history.

## Authority and change protocol

Authority, highest first:

1. The user's current explicit interview decision.
2. The latest `CONFIRMED` decision in this document.
3. Live behavior verified in the repository or external service.
4. README files, older design notes, conversations, and handoffs.
5. Implementer assumptions.

When sources conflict, record the evidence here, explain user-visible and security/cost/data/operations impact, and obtain an explicit user choice. Do not silently change a confirmed decision. Keep superseded decisions as `DEPRECATED`, then synchronize code, schema, tests, README, and external settings.

## Decisions

### Product scope

#### SCOPE-001 — Service boundary

- Status: `CONFIRMED`
- Decision: Support private, acquaintances-only motorcycle rides within South Korea that finish less than 24 hours after departure. Crossing Seoul midnight is allowed; lodging, multi-day itinerary planning, public signup, and a public beta are out of scope. Deliver as a responsive web app and installable PWA.
- Rationale: The product is a small personal service for pre-ride planning.
- User impact: Invited riders can keep a route that returns after midnight, but cannot plan a 24-hour-or-longer or lodging-based itinerary.
- Affected: app navigation, validation, auth boundary, PWA manifest, deployment policy.
- Verification: computed return just below/at the 24-hour boundary, midnight-crossing route, unauthenticated/unauthorized access, and mobile/desktop/PWA smoke tests.
- Confirmed: 2026-08-30; midnight interpretation updated by user interview on 2026-09-01.

#### SCOPE-002 — Production truthfulness

- Status: `CONFIRMED`
- Decision: Connected Preview and Production must never present demo route or weather data as a successful provider result. Synthetic data is permitted only in an unmistakably labeled local/demo state.
- Rationale: A rider could otherwise rely on fabricated safety and weather information.
- User impact: Provider or configuration failures are shown as failures while saved data remains readable.
- Affected: planner UI, error states, fixtures, Preview/Production smoke tests.
- Verification: connected-mode failure tests and DOM assertions that distinguish demo, loading, error, stale, and live data.
- Confirmed: 2026-08-30.

#### SCOPE-003 — 웹·Android 기능 및 출시 일치

- Status: `CONFIRMED`
- Decision: 웹과 Android는 같은 제품의 사용자 기능·버그 수정을 같은 출시 단위로 진행한다. 두 플랫폼의 공통 서비스 버전(`MAJOR.MINOR.PATCH`)과 업데이트 내역을 함께 관리한다. Android의 `versionCode`, AAB 식별자와 웹 배포 SHA/ID는 플랫폼별로 따로 보존한다. 한쪽 구현·배포만으로 공동 출시 완료를 선언하지 않는다.
- Delivery: 하나의 작업 기록에 공통 수용 기준, 양쪽 PR·고정 SHA·버전/업데이트 내역, 플랫폼별 검사·배포·실기기 상태를 연결한다. 배포는 기존 호환성 의존 순서대로 실행하며, 웹 선행·Play 심사/전파 등 중간 상태는 명시한다. 필수 gate와 데이터 보존, Preview/Production 분리, 내부 테스트/정식 트랙 경계를 낮추지 않는다. 문서·자동화만 바뀌면 제품 버전이나 이미 게시된 바이너리를 불필요하게 바꾸지 않는다.
- Exceptions: 플랫폼 고유 인증·권한·주행 생명주기 등 기존에 확정된 차이는 유지하고 그 범위를 명시한다. 새로 한쪽 기능을 제외하거나 출시를 별도로 끝내려면 달라지는 범위를 사용자에게 확정받는다. 기존 역사적 업데이트를 양쪽 구현 완료로 소급 표시하지 않는다.
- Development: UI 기술도 React Native/Expo와 React Native Web의 공통 화면으로 단계적으로 통일한다. 2026-10-02 사용자 선택에 따라 이번 동작 수정을 현행 웹·앱에 먼저 함께 배포하고 공통 UI 이관을 계속한다. 공통 Figma·API·검증·업데이트 내역을 재사용하며 Kakao 인증, 지도, App Links, 백그라운드 주행과 플랫폼별 보안 저장소는 기존 계약을 보존한 네이티브 연결로 검증한다. 기존 세션·사용자 자료를 플랫폼 간 복사하지 않는다. 단순 동작 일치를 UI 기술 통일 완료로 보고하지 않는다.
- Verification: 같은 사용자 흐름을 양쪽에서 검사하고 `PASS/FAIL/ERROR/SKIP/NOT_RUN`을 분리한다. 전체화면 지도에서도 확대·이동, 경유지 확인 후 추가, 취소 시 코스 보존, 읽기 전용 공유 경계가 일치해야 한다. 실제 사용자 실기기 결과는 자동 검사·브라우저·서버·Play 게시 결과와 구분한다.
- Confirmed: 2026-10-01, 사용자의 웹·앱 동일 업데이트 및 프로젝트 규범 기록 요청.

### Navigation and favorites

#### UI-001 — 화면 복귀와 즐겨찾기 관리

- Status: `CONFIRMED`
- Decision: Android의 홈 이동 버튼은 제거하고 화면 상단 뒤로가기와 휴대폰 자체 뒤로가기로 직전 화면에 복귀한다. 팝업에는 닫기 X를 표시한다. 닫기·복귀가 실행 중 저장의 불명확한 결과나 이미 완료한 서버 변경을 되돌린 것처럼 표시해서는 안 된다.
- Favorites: 웹과 Android의 저장 장소 등록·수정·삭제와 별표 관리는 홈에서 여는 전용 즐겨찾기 페이지가 소유한다. 자주 찾는 곳 5개 / 라이딩 스팟 / 식당 세 목록과 시·도 필터, 독립 지도 핀 토글을 제공한다. 계정별 저장 장소 합계는 1,000개다. 장소 검색 화면은 선택만 수행하며, 추가 검색을 닫으면 관리 화면으로 돌아온다. 소유권·중복·동시 변경·불명확 결과 재조회 보호를 유지한다. 상세 계약은 PLAN-004를 따른다.
- Confirmation: 추가와 삭제 모두 화면 중앙의 작은 팝업에서 대상 장소와 동작을 다시 확인한다. 확인 버튼에서만 한 번 요청하며 취소·X·뒤로가기는 자료를 변경하지 않는다. 처리 중 중복 요청과 결과를 숨기는 닫기를 막는다.
- Verification: 선택 화면에 추가·삭제가 없음, 전용 페이지 추가·삭제·빈 상태·한도·실패·재진입, 실제 진입 위치로 뒤로가기, 팝업 X 및 시스템 뒤로가기, 작은 화면과 큰 글자를 검증한다.
- Confirmed: 2026-10-02, 사용자의 홈 버튼 제거·팝업 X·즐겨찾기 관리 분리 요청.

### Authentication and membership

#### AUTH-001 — Kakao authentication with active membership

- Status: `CONFIRMED`; invitation enrollment retired by the user on 2026-10-02.
- Decision: Use email-free Kakao identity with Supabase Auth and require active membership. New membership is created only through AUTH-007 Play-verified app admission. Web/PWA and debug/sideload clients may sign in existing active members but cannot enroll by invitation or by Kakao authentication alone.
- Existing users: Preserve all existing rider/admin memberships and data regardless of original enrollment route. Never reactivate a revoked membership through login or admission. Existing members do not need to enroll again in the app.
- User impact: Sign up with Kakao in the Google Play MOTOCAST app, then use the same account on the web. The web login page explains this before login and after a non-member login attempt. Remove invitation administration, input and redemption from current clients.
- Verification: active rider/admin success, revoked/non-member denial, no profile or membership created by web login, Play admission compatibility, retired direct RPC/endpoint denial and historical record preservation.
- Confirmed: 2026-10-02. Replaces the 2026-08-30 invitation enrollment policy; AUTH-004 identity and AUTH-007 proof protections remain.

#### AUTH-002 — Retired invitation records

- Status: `RETIRED` for creation and redemption; historical data protections remain.
- Decision: Stop invitation creation, reading by application roles, revocation and redemption through client endpoints/RPCs. Keep old tables, hashed tokens, migration history and membership attribution; do not delete or rewrite existing records. Old links navigate to app-first membership guidance without redeeming or transmitting their fragment. No raw token is logged or retained.
- Verification: RPC role denial and fail-closed bodies; old link causes no acceptance request; existing records and member roles/revocation remain unchanged. Do not roll back by restoring invitation enrollment after retirement.
- Confirmed: 2026-10-02.

#### AUTH-003 — Non-member OAuth account lifecycle

- Status: `CONFIRMED`
- Decision: Kakao web authentication without an active membership is signed out and denied application access. It may leave only the unavoidable dormant auth.users record; it must not create a public profile or membership. Show app-first signup guidance, without reactivating revoked accounts or disclosing private member details.
- Rationale: Authentication establishes identity; only AUTH-007 can create new application membership. Existing active memberships remain usable on the web.
- Verification: web non-member/revoked callback rejection and cookie cleanup, profile/membership readback, existing rider/admin login and Play admission regressions.
- Confirmed: 2026-10-02, superseding invitation-dependent enrollment.

#### AUTH-004 — Email-free Kakao OIDC boundary

- Status: `CONFIRMED`
- Decision: Use Kakao authorization-code OpenID Connect directly instead of Supabase Auth's hosted Kakao `signInWithOAuth()` start endpoint. Request only `openid`, optional `profile_nickname`, and optional `profile_image`; never request `account_email`. An application-origin start endpoint creates a separate 32-byte browser-binding secret in an HttpOnly `__Host-` cookie and sends only its SHA-256 hash to the public, JWT-exempt Supabase Edge Function. The Edge Function owns the exact allowlisted redirect, Client Secret, CSRF `state`, and a per-attempt raw nonce whose SHA-256 value is sent to Kakao. The browser-binding hash is signed into the attempt, encrypted into the handoff payload, and required by the atomic DB consume operation. The Kakao ID token, access token, raw nonce, and binding hash cross to the application only through a short-lived, encrypted, single-use handoff whose plaintext bearer appears only in a URL fragment and is immediately removed. The application verifies the app-origin binding cookie before calling Supabase `signInWithIdToken({ provider: "kakao" })`, including the access token and raw nonce, and only then applies the existing active-membership gate. Supabase Kakao remains enabled with `Allow users without an email`; Kakao OpenID Connect remains enabled. Failure at any state, nonce, browser binding, handoff, token or membership check fails closed and clears temporary authentication state.
- Rationale: Live Preview produced `KOE205` because hosted Supabase Auth hard-codes `account_email`, `profile_image`, and `profile_nickname` in the Kakao authorization request even when email-optional mode is enabled. Kakao permits `account_email` only for Biz or test apps, while the owner cannot register a business. Direct OIDC preserves Kakao login and Supabase session/RLS ownership without collecting email or placing the Kakao Client Secret in Vercel.
- User impact: Riders still press one Kakao login button. They may decline nickname or profile-image access and receive an application fallback profile; they are never asked for email. A failed or replayed login attempt returns a generic safe error and cannot create membership through a web callback.
- Affected: Kakao consent and OpenID settings, Supabase Kakao provider, public OIDC Edge Function and secrets, one-time handoff table/RPCs, login button, callback API, membership finalization, Preview/Production redirect registration, Auth tests and runbooks.
- Verification: authorize URL contains `openid`, `profile_nickname`, and `profile_image` but not `account_email`; state cookie and exact authenticated initiating-origin return tests, including a second allowed origin and provider failure; hashed nonce and `signInWithIdToken` nonce/access-token propagation; browser A handoff denial in browser B before session or invitation mutation; malformed/expired/replayed/cross-origin handoff denial; advancing-clock expiry; token exchange error redaction; optional OIDC `picture` profile preservation; one non-aborted request across React Strict Mode replay; no late navigation after the callback screen detaches; non-member/member/revoked flows; hosted Preview login and Auth identity readback.
- Operational invariant: `KAKAO_OIDC_STATE_SECRET` and `ALLOWED_ORIGINS` form the callback-verification environment and remain independently readable if Kakao provider credentials are missing. `KAKAO_REST_API_KEY` and `KAKAO_LOGIN_CLIENT_SECRET` are required only to start or exchange a provider code. The exact provider callback URI is derived only from the trusted `SUPABASE_URL`, never from the Edge runtime's internal `request.url`, and the same value is used for authorization and token exchange. Public HTTP, credentials, paths, queries, and fragments in that provider base fail closed; HTTP is accepted only for explicit loopback local development. A verified callback therefore returns to its authenticated initiating origin and clears temporary browser state even during provider-credential misconfiguration.
- Confirmed by user interview: 2026-08-31.

#### AUTH-005 — Hosted Supabase Kakao OAuth without email

- Status: `DEPRECATED`
- Decision: Do not rely on Supabase `signInWithOAuth({ provider: "kakao" })` plus `Allow users without an email` to omit `account_email`.
- Rationale: Supabase documentation describes that configuration, but the hosted provider implementation and live Preview request still include the unavailable email scope before user creation can reach the email-optional behavior.
- User impact: The discarded path always stops non-Biz users at Kakao `KOE205`; `AUTH-004` replaces it without requiring business registration.
- Affected: former login-button implementation and earlier Preview setup assumption.
- Verification: live authorize redirect scope readback and regression search showing the application no longer calls Kakao `signInWithOAuth`.
- Deprecated by user selection of `AUTH-004`: 2026-08-31.

#### AUTH-006 — Android Kakao SDK authentication

- Status: `CONFIRMED`
- Decision: Use the Kakao Android SDK for the native Android app. Prefer Kakao Talk login when available and provide Kakao Account login in the default browser when unavailable. A user cancellation ends the attempt; it must not automatically launch another login. Preserve the existing web flow in `AUTH-004`, email-free consent, first membership only by `AUTH-007` Play admission, active-member re-login, revoked-member denial, and server-side authorization.
- Identity/session boundary: Reuse the existing Kakao Developers application identity. Verify the SDK ID token with Supabase Auth before using a Supabase session for MOTOCAST APIs; a Kakao access token is not a MOTOCAST API bearer. Bind each login to a fresh nonce and current attempt, preserve audience/nonce verification, and prove the existing Supabase user ID is retained. Never merge accounts by email, copy web cookies, spoof Origin, or ship server secrets. Application access requires the server membership gate even after authentication succeeds.
- Affected: Android SDK dependency and callback, native platform/package/signing registration, SDK token handling, Supabase ID-token compatibility, secure app session lifecycle and membership UI. The previously proposed custom browser-to-app one-time exchange is an unselected alternative, not a required implementation.
- Verification: Kakao Talk installed/unavailable/cancel/error paths, missing OIDC token, nonce/audience rejection, duplicate/expired/stale callback, process death, token storage/logout, no email request, same-account identity and data ownership, new/active/revoked membership, existing web regression. Local SDK tests do not establish live provider compatibility.
- Confirmed by user: 2026-09-21, "SDK로 가자 확정해". SDK direction is final; actual registration, connected verification and deployment status must be recorded separately.

#### AUTH-007 — Play-verified membership without an invitation

- Status: `CONFIRMED`; rollout and real device verification are recorded separately in release evidence.
- Decision: A new user authenticated with Kakao may create a rider membership without an invitation only after the server verifies a fresh Play Integrity proof for an approved MOTOCAST Play build. Web/PWA and debug/sideload entry allow only existing active members under AUTH-001. Invitation enrollment is retired. Existing active members keep normal sign-in and refresh; this exception does not require a new proof on every existing-member request.
- Verification boundary: Require Google-verified `LICENSED` and `PLAY_RECOGNIZED` verdicts, the approved package/signing-certificate/version, and fresh request binding to the authenticated user, target environment and one-time admission challenge. A client flag, installer name, copied token, native app key or successful Kakao login alone is not admission evidence. Missing, stale, replayed, cross-user or unevaluated proofs and provider outages must not create a profile or membership.
- Membership boundary: Create only a normal rider, atomically and idempotently. Preserve existing roles and data. A revoked membership must never be reactivated through this path, even with a valid proof. Keep server-side active-membership checks, per-user RLS and API budgets. Do not match Google and Kakao identities by email or collect a new email scope.
- Scope: The 2026-09-30 user approval for PR #79 extends the existing Play internal-track admission to Production and supersedes the initial Preview-only rollout restriction. Public-track release is not newly authorized. Require an exact trusted runtime mapping: `PLAY_ADMISSION_ENVIRONMENT=preview` with `SUPABASE_URL=https://lehjmbgfpoemqcwxowbx.supabase.co`, or `production` with `https://obodvbyzptxeehgpcpkd.supabase.co`. Unset, unknown or mismatched settings fail closed before Auth/RPC/Google calls; request URLs and headers cannot select the environment. Certificates, versions, Cloud project ID and service-account settings remain project-local without cross-project fallback or copying. The existing project-local authenticated user, random challenge hash and database lookup bind the proof. This runtime guard adds no schema change and preserves JWT verification; rollout of the existing reviewed Play migration remains subject to the release gates. Before every guard deployment, verify the target project flag and configuration readback. Live activation, deployed versions and real-device proof are separate evidence in the current release record; historical setup notes are not current status. Before any future public-track release, reconsider admission scope; the internal tester list is not a durable server membership allowlist.
- Revocation: Play licensing proves app entitlement, not current internal-tester-list membership. Removing a tester does not automatically revoke an existing MOTOCAST membership. Use the existing administrator membership revocation for service access.
- Supersedes: New membership requires this verified Play path after the 2026-10-02 retirement of invitation enrollment (AUTH-002). Existing active memberships remain valid regardless of their original admission method. Other identity, session, ownership and denial requirements remain binding.
- Acceptance: Real Google proof from a Play-installed build; new/active/revoked/admin users; altered/missing/expired/replayed/cross-user/wrong-environment/package/certificate/version proofs; provider timeout; concurrent/retried admission; role preservation; no unauthorized profile creation; web/debug non-member denial and existing-member regression; code-free Android UI; actual installation, login and Play update evidence recorded separately.
- Confirmed by user: 2026-09-26, "Play 설치 검증을 통과한 신규 사용자는 초대 없이 가입으로 정책 변경하자"; implementation and necessary Play internal release authorized by "필요하면 플레이스토어 배포까지 진행해". Production rollout for PR #79 approved 2026-09-30; actual hosted activation and device verification are separate evidence.
- Plan and evidence: [Play membership implementation](../archive/2026-09/2026-09-26-play-verified-membership.md).
- Official basis: [Integrity verdicts](https://developer.android.com/google/play/integrity/verdicts), [standard request binding](https://developer.android.com/google/play/integrity/standard).

### Ownership, collections, and sharing

#### DATA-001 — Per-user ownership and RLS

- Status: `CONFIRMED`
- Decision: Every rider-owned record is keyed to the internal user and protected by Row Level Security. User A cannot read or mutate User B data. Browser code never uses the service-role key. Deleting a saved trip aggregate is allowed only through an active-member, exact-owner RPC; its waypoints, route cache, weather, and preview grants cascade, while an already issued immutable share snapshot remains unchanged until separately revoked.
- Rationale: Routes and schedules reveal sensitive location information.
- User impact: Each rider sees and manages only their own plans, collections, and shares.
- Affected: all rider tables, policies, RPC grants, browser/server clients, owned-trip deletion API.
- Verification: User A/B, administrator, revoked member, and anonymous matrix on every table and RPC; owner-only trip deletion, child cascade, cross-user denial, and issued-share immutability.
- Confirmed: 2026-08-30.

#### DATA-003 — Trusted aggregate mutation boundary

- Status: `CONFIRMED`
- Decision: The browser may request planning actions but cannot directly create or mutate route-backed trip aggregates, immutable collection versions, weather snapshots, share snapshots, or Kakao OIDC handoffs. The service role has no direct DML on any current application table, cannot execute public functions outside ten reviewed internal RPCs, and does not inherit direct table DML or function EXECUTE on future objects created by the migration role. Five RPCs own provider/budget aggregate work; two additional RPCs create and atomically consume only a hashed, encrypted, short-lived OIDC handoff. Three AUTH-007 RPCs issue, reserve and complete one-time Play admissions with bounded per-user/global attempts. Trusted Edge Functions use these narrow SECURITY DEFINER boundaries, while direct table mutation remains denied.
- Rationale: RLS ownership alone cannot prove that browser-supplied route JSON came from the motorcycle-safe provider boundary or preserve multi-table invariants.
- User impact: A new plan is saved only after its one verified `recommended` route is ready. Legacy three-route plans remain readable, while partial, expired, replayed, cross-user, or browser-forged route sets fail explicitly.
- Affected: route Edge Function, route draft tables, trip/route/waypoint policies, finalization and selection RPCs, planner UI.
- Verification: browser/service-role direct-DML denial across every application table and operation, future-table/function default-ACL probes, exact fourteen-function service-role allowlist (seven baseline, three Play admission, four weather budget/cache RPCs) (five provider/aggregate RPCs, two OIDC handoff RPCs and three AUTH-007 admission RPCs), one-route current and exact-three legacy finalization, mandatory-point/order/dwell matching, non-null route totals, durable plan-and-route payload hashes across draft cleanup, authenticated target-trip identity and `updated_at` revision binding, stale-update and wrong-target rejection, planning-id consumption, expiry, replay, cross-user, stage-versus-finalizer and two-finalizer races, and forced mid-write transaction rollback tests.
- Confirmed as security implementation of `DATA-001` and `ROUTE-001`: 2026-08-30.

#### DATA-002 — Riding collections

- Status: `CONFIRMED`
- Decision: Store user-owned riding collections as immutable, complete-course versions containing the verified origin, verified destination, and ordered selected waypoint occurrences. Every persisted occurrence is active and has one route-compatible meaning: a zero-dwell role-free pass-through, a positive-dwell optional rest, or a positive-dwell meal stop (legacy lunch/dinner remain readable). Each occurrence keeps its own stable ID, waypoint kind, dwell, stop role, and custom-winding marker, so the same Kakao place may appear more than once without collapsing the rider's intended order. A collection card can replace the current plan with the complete latest course. Each save carries a client-generated operation ID bound to the canonical payload hash; an exact retry after an unknown response returns the original collection/version result, while reuse for a different payload fails explicitly.
- Rationale: Kakao favorites are replaced by an app-owned, provider-independent collection.
- User impact: Riders can reuse a whole ride rather than reconstructing its endpoints and stops. “공유 준비” on a collection applies that complete course, then requires a new safe route and weather result before opening the concise route-and-weather share preview; it never publishes automatically.
- Affected: collection schema, CRUD UI, trip planning, RLS, versioning.
- Verification: endpoint/point semantic parity at browser, Edge, and DB boundaries; CRUD/order/version/apply; repeated-place occurrence identity; 0–5 rests; lost-response and concurrent same-operation retry without duplicate versions; changed-payload operation-ID rejection; direct-share preview sequencing; and cross-user denial.
- Confirmed: 2026-08-30. Complete-course meaning confirmed by user interview on 2026-09-01.
- Preview compatibility: Waypoint-only Preview versions remain stored but are not presented as complete courses. The user explicitly declined a compatibility guarantee for disposable Preview collection data; no destructive rewrite is required.

#### SHARE-001 — Explicit immutable sharing

- Status: `CONFIRMED`
- Decision: Sharing is off by default and occurs only after a complete rendered preview and explicit publish action. The rendered approval and public view summarize the travel route and segment weather without duplicating raw waypoint coordinates or unselected route candidates. A share is an immutable snapshot; later source edits do not change it. Owners can revoke and issue a new link. No automatic redaction or automatic publication occurs. Entry from a collection card has the same boundary: it first applies the complete course and calculates a fresh route plus route-bound weather whose validity is still strictly in the future, then opens the same concise preview exactly once. A stale or expired snapshot remains visible only as reference information and cannot satisfy share preparation. Existing schemaVersion 1 links remain readable when a field added later is absent; new snapshots still emit the complete current allowlist.
- Rationale: The user controls when complete route information leaves the private owner boundary.
- User impact: A shared link shows exactly the approved snapshot until revoked; reissuing creates a different link.
- Affected: snapshot format, token endpoint, preview/publish/revoke UI, RLS, cache headers.
- Verification: immutability, revocation, reissue, anonymous view, owner-only management, cross-user denial, source-table non-exposure, and legacy schemaVersion 1 fixture compatibility.
- Confirmed: 2026-08-30.

#### SHARE-002 — Share token handling

- Status: `CONFIRMED`
- Decision: Share tokens use at least 32 random bytes; store only SHA-256 hashes. Public links carry the bearer in a URL fragment, copy it only to component-local memory, and synchronously remove the fragment before resolver access or third-party map code can run; fragment-removal failure stops resolution. The public resolver returns the published snapshot only and never exposes owner source tables, management metadata, or internal place-verification proofs. All user-facing ride, place, schedule, route, and weather information remains in the full preview without automatic redaction.
- Rationale: A database leak must not produce usable public links.
- User impact: A lost link cannot be recovered; it can only be revoked and reissued. The owner's list shows only currently active shares; revoked entries are hidden without deleting their immutable records. A successful revoke may still display its completion notice. Active-only list visibility was confirmed by the user on 2026-09-21 and also applies to the planned Android client.
- Affected: share RPC/endpoint, schema, logging, tests.
- Verification: no-plaintext search, synchronous fragment removal before one Strict Mode resolver request, removal-failure denial, resolver contract test, revoked/unknown token denial, access-log redaction.
- Confirmed: 2026-08-30.

#### SHARE-003 — Preview-to-publish capability

- Status: `CONFIRMED`
- Decision: A complete route-and-weather share preview issues a cryptographically random, ten-minute, single-use approval capability whose plaintext is returned only to that owner and whose SHA-256 hash and snapshot hash are stored. Both preview and publication rebuild through the same server-side projector and reject missing weather, stale weather, and weather whose `validUntil` is less than or equal to PostgreSQL's advancing `clock_timestamp()` value. The freshness decision must continue to advance inside a long-running transaction rather than freeze at its start. Publication row-locks the grant and source trip, requires an identical allowlisted snapshot hash, consumes the capability, and creates the immutable share in one transaction. Direct browser inserts or updates of shares and snapshots are denied.
- Rationale: A client-side equality check leaves a race in which the source can change after preview and before publish.
- User impact: The published link is guaranteed to contain the exact full snapshot most recently approved; an expired, reused, or stale preview requires a new preview.
- Affected: preview/publish RPCs, grant table, share UI, snapshot allowlist, RLS and grants.
- Verification: exact preview/publish, missing/stale/exact-expiry weather rejection at preview, weather becoming stale after preview rejection at publish, source-change rejection, capability expiry, single-use, concurrent use, nested-field allowlist, direct-DML denial, revoke and reissue tests; collection-triggered preview waits for route/weather persistence and consumes one request across React Strict Mode effect replay.
- Confirmed as security implementation of `SHARE-001`: 2026-08-30.

#### SHARE-004 — Save a received share as an owned course

- Status: `CONFIRMED`
- Decision: A received link opens the existing immutable riding summary. For links issued after this feature, an authenticated active member can explicitly save the shared course as a new owned collection. The server captures the verified origin, destination and ordered point occurrences privately at publication; the public resolver never exposes verification proofs. Copy uses the token to select that immutable course, binds ownership to the current member and uses an operation ID for exact retry. The original owner's later edits do not change the copy. Dates, departure time, route results and weather are excluded from the saved course; applying any saved course requires choosing a new departure date and time.
- Rationale: A rider can reuse a received course without inheriting another rider's schedule or submitting unverified public snapshot data as a new course.
- User impact: New links support “내 경로로 저장” and “새 일정으로 출발”. The latter privately retrieves the course after active-member authentication and opens a blank schedule without automatically saving or calculating. Older plans without verified reusable input require recalculation before publication. No compatibility copy is promised for previously issued links.
- Affected: trusted plan persistence, private share course column, authenticated copy and course-read RPC/APIs, public summary action, collection application. Private reusable input stays in component memory; embedded planning uses memory navigation so application view hashes cannot be mistaken for a replacement share bearer.
- Verification: active/anonymous/revoked and cross-user ownership, public proof nonexposure, immutable repeated point order/dwell, schedule omission, exact/concurrent retry and changed-payload denial, stale browser-response isolation, same-origin JSON enforcement.
- Confirmed: 2026-09-17. The user separately authorized backup and deletion of all users' prior shared links, saved courses and riding records, preserving accounts and memberships; execution evidence belongs to the release record.
- Target UX amendment, 2026-09-18: `ROUTE-008` adds primary `경로 실행` directly from the public summary without saving or creating a schedule. `새 일정으로 출발` and `내 경로로 저장` remain separate secondary actions with their existing authenticated preparation/save boundaries. The summary's `홈으로` action navigates home; it does not prepare a new schedule. This is a design contract, not a claim that the deployed application already implements it.

### Trip inputs and schedule

#### PLAN-001 — Place identity and validation

- Status: `CONFIRMED`
- Decision: Origin, destination, optional meals, and waypoints are selected from Kakao place search and stored with validated coordinates. Free text is never treated as a verified place. Validate South Korea bounds, string lengths, waypoint count, dwell, and date/time range at both client and trusted server boundaries.
- Rationale: Route and weather correctness depends on real coordinates.
- User impact: Typed text remains unconfirmed until a search result is selected.
- Affected: place search proxy/UI, plan schema, route/weather inputs.
- Verification: selected/unselected UI states and malformed/boundary input tests.
- Confirmed: 2026-08-30.

#### PLAN-002 — Schedule constraints

- Status: `CONFIRMED`
- Decision: The rider enters only the ride date and departure time. A departure earlier than the trusted server clock is rejected before provider or budget work; the browser's Seoul date/time minimum is guidance only, and the exact trusted-clock boundary remains valid. The single recommended route shows its computed expected return from provider travel time plus only the meals and rests the rider selected; there is no user-entered desired return or hard return and no deadline warning/filter. Meals are optional and can repeat within the total waypoint limit. The rider may add 0–5 ordered rest occurrences, each defaulting to 30 minutes with independently editable dwell. Repeating the same place is allowed because occurrences have distinct stable IDs. A route with no meal, rest, or winding point is a valid direct origin-to-destination course. Restaurant break time is displayed only and never automatically rejects or rewrites a route. The route may cross Seoul midnight but must return less than 24 hours after departure.
- Rationale: The rider decided that the useful output is the route-derived expected return, while two separate return constraints add unnecessary input burden.
- User impact: Riders enter fewer times and confirm the recommended route's honest expected return, including next-day early-morning returns.
- Affected: route request contract, schedule engine, planner UI, share snapshot schema, trip persistence compatibility, tests.
- Verification: trusted-clock past/exact-boundary tests and browser minimum; lunch omitted/selected and dinner omitted/selected; direct endpoint-only route; 0/1/5/6 rest boundaries, repeated-place occurrence identity, order/add/remove/dwell; selected meal/rest/custom-waypoint dwell; midnight-crossing expected return; exact 24-hour rejection; optional `lunchStop` in the current browser/Edge/DB/share contract; schemaVersion 1/2 compatibility.
- Confirmed by user interview: 2026-09-01 (option B; midnight-crossing candidates explicitly retained; recommended multiple-rest limit 5 accepted; lunch made optional).
- Confirmed UX amendment, 2026-09-30: Opening an empty departure picker suggests the nearest non-past Seoul five-minute slot (00, 05, …, 55), including the next date/month/year at midnight. Existing explicit selections are preserved. The rider must confirm before the schedule is applied; opening or confirming the picker does not calculate or publish. Past dates/times remain an intentional failure, including a suggestion that expires while the dialog stays open. Reused courses still omit the source schedule and require the rider to confirm a fresh schedule.
- Persistence note: Existing `trips.desired_return_at` and `trips.hard_return_at` remain non-public legacy columns for a non-destructive first-version migration. The trusted Edge boundary supplies an undisplayed same-day compatibility value only to satisfy the old storage function. It never filters the recommended route, appears in the current UI, or appears in current schemaVersion 3 shares. SchemaVersion 2 shares remain readable under their historical no-return-input contract. A future column cleanup requires its own reviewed migration.

#### PLAN-003 — Unified ordered waypoints

- Status: `CONFIRMED`
- Decision: Origin and destination enclose one rider-controlled ordered waypoint list. When adding an occurrence, the rider selects `waypoint`, `meal`, or `rest`; every occurrence can move across every other role so the visible list is the exact provider, ETA, persistence, collection, and share order. A plain waypoint is a mandatory zero-dwell pass-through. Meals are optional, default to 60 minutes, have editable dwell, and have no separate count limit beyond the thirty total waypoint limit. Rest defaults to 30 minutes, has editable dwell, and is limited to five occurrences. Plain waypoints are limited to twenty and all roles together to thirty. Repeated physical places remain distinct by occurrence ID.
- Rationale: Separate winding, meal, and rest editors reconstructed the request as winding points first, then lunch, rests, and dinner, which could silently route the rider through the right places in the wrong order.
- User impact: The rider sees and edits one actual visit sequence instead of predicting how several independent sections will be merged.
- Affected: planner authoring state and accessibility, route request construction, collection application, map labels, connected Preview fixtures, README and operations guidance.
- Compatibility: The current tables and schemaVersion 3 contracts already persist one ordered point array with `kind`, `stopRole`, dwell, and occurrence ID, so no table or stored-data rewrite is required. Migration `20260902123000_ordered_waypoint_limits.sql` replaces only the collection/current-plan validators so the 20-item limit follows role-free `pass-through` meaning instead of a client-controlled legacy bit. Public Edge writers and the browser collection reader canonicalize that compatibility marker to `winding=true`; current product copy and map legends call the role `경유` and never imply provider-derived winding. Existing immutable schemaVersion 1/2 snapshots are not rewritten.
- Verification: mixed-role add/type-change/dwell/move/remove; repeated meals, legacy lunch/dinner compatibility, and 5/20/30 boundaries; incomplete place refusal; exact UI-to-request role order; collection save/apply round trip; route/ETA/map/share occurrence order; mobile and desktop keyboard, focus, label and overflow checks.
- Confirmed by user interview: 2026-09-02.
- Confirmed amendment, 2026-10-02: Merge lunch/dinner authoring into 식사 (`meal`), with no separate meal count limit. Existing lunch/dinner data and immutable shares remain readable and are not rewritten; applying an old course to the editor normalizes only its draft roles to meal while preserving occurrence IDs, order, and dwell. New meal readers and server validators precede new writers. The existing less-than-24-hour rule remains. The add-waypoint dialog opens the existing favorites three-tab screen, preserves role/dwell on cancel/back, and creates an occurrence only after explicit place confirmation. This does not request a route or weather.
- Confirmed amendment, 2026-10-05 (user decision, supersedes the meal default-60/editable dwell above): every meal occurrence uses a fixed 45-minute dwell on web and Android (route editor, add-waypoint and saved-place flows, collection or received-course application, restaurant recommendation). The UI shows a short note (`식사는 45분으로 계산해요.`) instead of a dwell input. Applying a saved course or received course normalizes meal (and legacy lunch/dinner) draft dwell to 45 while preserving occurrence IDs, order and other roles; stored collections and immutable shares are not rewritten. Trusted Edge boundaries that accept a new client-authored meal dwell (`plan-route`, `save-collection`, `recommend-restaurants`) accept only 45 for meal/lunch/dinner dwell, so an older client that still sends another meal dwell fails with an explicit input error asking for an app update. `journey-route` is excluded because it only verifies that the request equals the server-held stored course or immutable share snapshot; enforcing 45 there would make existing stored courses and shares permanently unusable, which the same decision preserves; rest dwell (default 30, editable) and pass-through rules are unchanged.

#### PLAN-004 — Shared place favorites within each rider account

- Status: `CONFIRMED`
- Decision: Each rider can save up to 1,000 private single places across riding spots and restaurants, with an optional alias and up to five starred places shared across origin, waypoint and destination selection. Star removal retains the saved place. Exact-place deletion removes its star but never rewrites existing courses or immutable shares. Existing three-slot favorites migrate with original place and star intact; legacy clients retain their three-slot compatibility view.
- Registration: verified search selection and map long-press coordinates are both included. The existing signed coordinate-resolution path must validate the selected point before registration. Preserve the original signed name/address/coordinates; aliases are separate metadata. Derive the 17-province filter from the stored original address once, and expose unrecognized legacy addresses as unknown without repeated provider requests.
- User impact: three lists (자주 찾는 곳 / 라이딩 스팟 / 식당), province filter and independently toggled spot/restaurant pins. All four layer combinations retain the map and current draft points. Pin selection opens details; explicit waypoint confirmation selects role/dwell and appends before destination with a new occurrence ID. No route/weather calls happen until 경로 다시 계산. Edited inputs invalidate old route/weather/share state and survive recalculation errors.
- Affected: canonical saved_places table, owner-only revision-checked RPCs, compatibility view, web/Android management and pickers. A bookmark is not proof of a provider-validated route; existing signed-place validation still runs when planning or saving a course.
- Verification: account isolation, active-member checks, direct-DML denial, limits and simultaneous additions, old-data preservation, stale revisions, uncertain receipt readback without automatic resend, responsive/accessibility dialogs, unchanged saved snapshots, and actual SDK quota measurements separate from network observations.
- Confirmed: original scope 2026-09-17; superseded limits and integrated saved-place scope in Issue #99, 2026-10-02. User explicitly confirmed total 1,000 and arbitrary-coordinate registration during implementation.

#### PLAN-005 — Saved-restaurant meal recommendation

- Status: `CONFIRMED`
- Decision: After the current inputs have a calculated and stored recommended route, the rider may request meal recommendations for 1 or 2 actual restaurant visits (not a candidate count). Only the rider's own saved places with kind `restaurant` are eligible; no external place search adds new restaurants. Each meal has a desired Seoul time and an editable meal dwell (default 60). Added driving time is the route driving time with the restaurant(s) minus the existing route driving time, excluding dwell. The default added-driving limit is 30 minutes and applies to the sum for two restaurants; the default arrival tolerance is ±30 minutes around each desired time. Both are rider-editable and are never widened automatically. The second restaurant's arrival includes the first restaurant's added driving and meal dwell. Insertion keeps the existing visit order and ROUTE-001 motorcycle constraints. Feasible candidates are ordered by added driving time. A recommendation never adds a waypoint by itself; only explicit selection and confirmation inserts `meal` occurrences, after which the existing PLAN-004 rule requires an explicit recalculation.
- User impact: Clear distinct states for no saved restaurants, normal no-result (`조건에 맞는 음식점이 없습니다`), partial two-meal results (the rider may add only the available one), invalid combinations, calculation failure with retry, and a changed route that blocks old results. Business hours are not available from the current provider and are shown as `영업정보 없음 · 방문 전 확인`; they never filter candidates (#33 data source remains open).
- Cost and truthfulness: The trusted server reads the owner's stored route and saved restaurants, rejects a route basis that differs from the displayed result, and evaluates a bounded set of candidates with real Kakao Mobility calls (at most 6 for one meal and 14 for two), consuming the existing `directions`/`future_directions` daily budget before each call under COST-001/002. A straight-line prefilter limits which saved restaurants are evaluated and its coverage is reported; arrivals and added time are estimates until the rider recalculates. Candidate-level no-route results exclude only that candidate; budget, configuration, provider and response failures fail the request instead of becoming an empty result.
- Affected: `recommend-restaurants` Edge Function, web and Android riding summary, recommendation sheet/dialog, waypoint insertion, contracts, tests.
- Verification: 1/2 meals, combined added-driving limit, inclusive arrival tolerance, first-meal dwell shift, partial result, no result, no saved restaurants, calculation failure, stale route basis and stale client result blocking, explicit insertion order and occurrence IDs, budget-before-call and call caps, motorcycle parameters on every call. Design and evidence: [restaurant recommendation record](../work/research/2026-10-05-restaurant-recommendation.md).
- Confirmed: user request, 2026-10-05.
- Amendment, 2026-10-05 (user decision, supersedes the user-editable limit and tolerance above): the rider no longer enters an added-driving limit. Each candidate shows its added driving (`주행 +{n}분`; two restaurants show `두 곳 합계 주행 +{n}분`) and results stay sorted by it. The server applies a fixed internal cap of 60 minutes (combined for two restaurants), which also sets the 30 km straight-line prefilter radius; call caps are unchanged. The arrival tolerance becomes the `원하는 식사 시간` window: default ±30 minutes, adjusted with −/+ buttons in 30-minute steps between ±30 and ±90. Nothing is widened automatically. Request contract 2.0.0 removes `detourLimitMinutes`. The recommended meal dwell is the fixed 45 minutes of the PLAN-003 amendment of the same date.

#### UI-001 — Mobile and desktop riding workflow

- Status: `CONFIRMED`
- Decision: Implement the approved Figma home, route editor, riding summary and saved-route collection as separate navigable views, with responsive search, schedule, waypoint, favorite, sharing and saving dialogs. Preserve current route safety, active-member ownership and explicit share approval. Saved courses contain places/order/rest, never the departure date or time.
- User impact: Home distinguishes a new route from saved routes. The motorcycle remains to the right with space from the edge. Editing follows origin → ordered waypoints → destination → reset. Results show map, weather emoji/text, ride/rest duration and estimated arrival. Choosing a saved course requests a new schedule.
- Responsive contract: up to 767px uses 20px gutters and one-column flows; 768–1199px uses 32px gutters, 360px editor and two-column saved cards; 1200px and above uses at most 1280px content, 456px editor and three-column saved cards. Result map/weather stacks below 1024px to preserve card readability, as permitted by the approved intermediate-width design. Desktop reference width is 1440px.
- Verification: complete navigation including back/cancel/error/retry, 320/390/768/1024/1440px clipping and scrolling, minimum 44px touch controls, focus/keyboard behavior, stable occurrence IDs and single-line waypoint number labels. Prototype examples never become fabricated live results.
- Confirmed: Figma design requests and explicit application implementation request, 2026-09-17.

### Routes and motorcycle safety

#### ROUTE-001 — Mandatory motorcycle constraints

- Status: `CONFIRMED`
- Decision: Every Kakao route request, including split legs and future traffic calls, sets `car_type=7`, `avoid=motorway`, and reflects road closures. These values are server-owned and cannot be disabled by client input. Never fall back to a passenger-car route.
- Rationale: Kakao documents car type 7 as motorcycle and `motorway` as exclusion of motorway/automobile-only road.
- User impact: If a compliant route cannot be returned, planning fails explicitly instead of showing an unsafe substitute.
- Affected: route provider adapter, request logging, tests, failure UI.
- Verification: intercepted request assertions for every call path; only documented `result_code=1` maps to no-route while malformed/unknown results fail as provider-contract errors; no-fallback test; real legal-route smoke test.
- Confirmed: 2026-08-30.

#### ROUTE-002 — Three candidate identities

- Status: `DEPRECATED`
- Decision: Offer up to three distinguishable candidate identities: balanced, winding, and shortest. A successfully finalized plan still contains three distinct geometries, and weather never changes their ordering. If Kakao cannot supply a genuinely different and more-curved estimated winding route, do not finalize a partial or duplicate plan; explain that the rider can add a custom winding waypoint and recalculate.
- Rationale: The rider chose three comparison goals.
- User impact: The UI compares three named route strategies when all are honest and safe. A missing provider alternative is shown as an actionable unavailable state rather than a fake third success.
- Affected: orchestration, provider request strategy, UI, tests.
- Verification: candidate identity/uniqueness tests and weather-order independence.
- Confirmed: 2026-08-30.
- Interview update: On 2026-08-31 the real Preview provider returned no distinct winding alternative and `SAFE_ROUTE_NOT_FOUND` was observed twice. The user selected option A: keep a maximum of three honest candidates, retain three-geometry finalization, and require a custom winding waypoint when the provider pools still cannot produce the third geometry.
- Deprecated: 2026-09-01. Replaced by `ROUTE-006`; the user removed multi-candidate comparison from the first version because Kakao does not guarantee a motorcycle winding route, duplicate avoidance increased failure and API cost, and the product's core is the rider-authored course with road geometry, return time, and weather.

#### ROUTE-003 — Winding candidate derivation

- Status: `DEPRECATED`
- Decision: User-authored winding waypoints are mandatory inputs to balanced, winding, and shortest candidates alike. A winding-only point is strictly a zero-dwell `pass-through` with no meal/rest role; every candidate preserves its order together with required lunch, dinner, and selected rest stops. For the winding candidate, first obtain the normal `RECOMMEND` baseline through that same ordered point list and then inspect the full `RECOMMEND + alternatives` pool for each chunk, choosing a geometry-distinct route only when its curvature exceeds that baseline. If the alternatives request returns no route or no more-curved geometry, inspect one `TIME + alternatives` pool under the same motorcycle constraints. This search applies whether or not the rider supplied a custom winding-only point: a custom point fixes where all candidates must pass, but does not permit the winding candidate to duplicate the balanced geometry. Baseline chunks may be retained where Kakao has no local alternative, but at least one chunk in the completed winding route must be genuinely distinct and more curved. Otherwise return `WINDING_ROUTE_UNAVAILABLE`; the UI asks the rider to adjust or add a custom winding waypoint. The no-custom-point UI labels a successful result `와인딩 추정`; it must never imply that Kakao provides a native winding priority.
- Rationale: Labeling a normal recommended route as winding would mislead riders.
- User impact: Saved winding points are preserved in every candidate. Riders receive a third candidate only when the provider supplies enough trustworthy geometry through those same points; otherwise they get a clear waypoint adjustment action instead of a duplicate or mislabeled route.
- Affected: collection semantics, route orchestrator, candidate availability UI, provider cost.
- Verification: provider-request contract tests, overlapping winding/stop rejection, defense-in-depth required-stop preservation, no-custom-waypoint scenario, distinctness and labeling tests.
- Confirmed by user interview: 2026-08-30.
- Interview update: On 2026-08-31 the user approved the priority-pool fallback and explicit custom-waypoint recovery after the provider legally returned no distinct alternative. The earlier guarantee that every no-waypoint request would still produce a third candidate is deprecated because Kakao documents one-or-more results, not multiple distinct results.
- Interview update: On 2026-09-01 authenticated Preview smoke proved that the previously confirmed candidate-specific scope omitted the selected custom point from balanced and shortest routes. This conflicted with the latest Goal's required-pass wording. The user explicitly changed the decision so all three candidates must traverse every selected custom winding point; if Kakao cannot still provide three distinct geometries, finalization fails honestly instead of dropping the point.
- Deprecated: 2026-09-01. Replaced by `ROUTE-006`; automatic alternative-pool winding estimation and `WINDING_ROUTE_UNAVAILABLE` are no longer part of new plans. Custom winding remains a rider-authored mandatory pass-through meaning, not a provider-derived route class.

#### ROUTE-004 — Waypoint splitting

- Status: `CONFIRMED`
- Decision: Preserve the one visible mixed-role waypoint order, required pass-throughs, every selected meal and rest, segment ETA, and dwell across provider request splitting. Up to five rests may repeat the same physical place while retaining distinct IDs and ordered visits. Never omit or regroup a point merely to satisfy a provider limit.
- Rationale: Kakao endpoints impose waypoint limits and long plans may require multiple safe calls.
- User impact: The planned route visits stops in the order the rider approved.
- Affected: route orchestration, budget accounting, ETA engine.
- Verification: maximum waypoint boundary, 0/1/5 accepted rests and 6 rejected rests before provider work, repeated-place occurrence order, multiple chunks, one atomic budget reservation and one provider call per chunk, current-to-future endpoint transition, required stop order, dwell/ETA continuity, and fail-closed termination without hidden retry after an intermediate provider error.
- Confirmed: 2026-08-30.

#### ROUTE-005 — Road geometry and map marker truthfulness

- Status: `CONFIRMED`
- Decision: Before a successful route calculation, never connect selected places with a synthetic straight line. After success, draw only validated Kakao Mobility road `vertexes`, replace the prior polyline and weather state immediately after a new calculation, and fit bounds to the complete road geometry plus markers. Mark origin, destination, lunch, dinner, rest, and mandatory pass-through waypoints with role-specific markers whose visible letter and accessible legend supplement color. In the main planner, the safety/data status, accessible marker legend, and route metrics remain in normal document flow outside the map surface so they never cover the road geometry on mobile or desktop; the metrics use one `경로 요약` heading instead of repeating `추천 경로`, and the mobile plan-edit control stays in the header instead of floating over the map or route details. Public and approval-preview shares likewise keep the role legend and compact route facts in normal flow after the map rather than covering provider geometry. A new route response preserves each accepted point's stop role and occurrence order; a displayed live result never re-derives those roles from form fields changed after calculation. When multiple roles share exact coordinates, render one composite marker that keeps every role letter visible instead of stacking indistinguishable pins. A new plan's single recommended route must traverse every selected waypoint. An older immutable shared snapshot created under the deprecated candidate-specific policy can still contain an approved legacy winding-only point that its balanced or shortest route did not traverse; it remains visible as `선택 경로 미통과`, and this compatibility marker never alters or extends the provider polyline. Every omitted legacy point is also listed in an always-visible normal-flow notice outside the fixed-height map, independent of SDK loading or failure, rather than in a hover-only or clipped map overlay. Empty geometry, SDK failure, authorization failure, or an invalid domain is an explicit failure and never becomes a synthetic success.
- Rationale: A point-to-point line can look rideable while crossing roads or terrain that the provider never routed, and identical markers make the actual stop order hard to verify.
- User impact: Riders see the real road shape without status, legend, or summary cards covering it, and can distinguish every planned role at a glance and through assistive text.
- Affected: Kakao map canvas, planner/share map-point classification, Kakao type boundary, responsive styles, unit/Playwright/Preview tests.
- Verification: no pre-route polyline; exact provider path readback; role-specific marker image/title and non-color legend; planner status/legend/summary outside the map with no overlap at 320/390/820/1440 widths; mobile route-edit control in the summary action area, outside the map and without covering metrics, with a 44px minimum target; one visible riding-result heading (the approved redesign uses `라이딩 결과`); public/preview share legend and route facts outside the map; bounds over road and marker points; a new calculation replaces the previous route and weather without stale canvas state; SDK/error states; connected Preview at mobile and desktop widths.
- Confirmed by user Goal: 2026-09-01; planner map information hierarchy reconfirmed by user: 2026-09-05.

#### ROUTE-006 — Single rider-authored recommended route

- Status: `CONFIRMED`
- Decision: A new plan calculates, atomically stores, displays, and shares exactly one `recommended` route. The trusted server sends the rider's origin, the exact mixed-role waypoint order from `PLAN-003`, and destination to Kakao Mobility with fixed `priority=RECOMMEND`, `car_type=7`, `avoid=motorway`, `roadevent=0`, and detailed road geometry. It never requests `alternatives`, never performs automatic winding estimation, and never accepts client-supplied route policy fields. A plain waypoint is a user-authored, zero-dwell mandatory pass-through, not a provider classification. Provider failure is explicit and categorized into safe no-route, temporary provider failure, budget/configuration refusal, invalid response, persistence failure, and invalid input so the rider receives an actionable next step. It never falls back to a passenger-car route, a synthetic detour, or a straight line.
- Rationale: Kakao does not guarantee a motorcycle winding route. Manufacturing three distinct candidates increased duplicate risk, hard failures, API calls, and cost without advancing the product's core job: show the rider's chosen course on real roads with an honest return time and arrival weather.
- User impact: Riders no longer compare balanced, estimated-winding, and shortest cards. They enter the course they want and receive one safe recommended road route with distance, riding time, dwell, expected return, and ETA weather.
- Affected: route request/response contracts, Kakao provider adapter, planner UI, weather profile, route staging/finalization and single-use planning lifecycle, route cache, share schemaVersion 3, tests, README, Preview deployment.
- Compatibility: New records use the private `recommended` profile and one route row. Constraints are expanded without deleting legacy profiles. A legacy three-route plan remains readable and newly sharing it uses its existing balanced route as the representative route; its schemaVersion 3 weather segment IDs are normalized to the public `recommended-*` identity only after route-coordinate-ETA binding succeeds. Existing immutable schemaVersion 1/2 shares remain byte-stable and readable; every newly issued share is schemaVersion 3 with a singular `route` and no candidate-selection field. A pre-migration exact-three draft may finalize only as a new trip; targeting an existing trip is rejected because that legacy payload has no trusted target identity/revision binding. Each planning ID has a durable `staging → consumed` tombstone plus immutable plan and recommended-route payload hashes, so an exact pre-finalize retry is idempotent while a changed route after draft cleanup or a late post-finalize retry cannot resurrect or replace the aggregate.
- Verification: exactly one provider invocation per split chunk; fixed safety parameters and absent `alternatives`; server-side selected winding-only limit before budget/provider use; ordered mandatory point and occurrence-role matching; dwell/return/24-hour boundaries; DB-side road distance/duration totals, numeric Korea-bounded vertices, `0.005` requested-point endpoint snap tolerance separated from `0.0002` road continuity within and across legs, second-road/section and missing-field rejection, durable plan/route hash comparison, authenticated target-trip identity plus `updated_at` revision binding, wrong-target/stale-update rejection, and finalization-time revalidation; one-draft atomic finalization and concurrency; one route row; legacy three-route finalization/read compatibility; schemaVersion 3 singular share with accepted occurrence `stopRole` plus immutable schemaVersion 1/2 parsing; no candidate UI at mobile/desktop; real Preview route, geometry, ETA weather, collection, and share smoke.
- Confirmed by user interview: 2026-09-01.

#### ROUTE-007 — Preserve total provider time and estimate intermediate arrivals

- Status: `CONFIRMED`
- Decision: Preserve each provider request's summary duration as its total riding time. When it differs from the sum of section durations, allocate that total proportionally using the original section-duration weights and whole-second largest-remainder rounding with stable input-order ties. Allocate each resulting section total among its original road-duration weights in the same way. Unchanged totals preserve original timing. Add rider dwell separately; subsequent provider departures, weather ETAs, displayed arrival/return and persisted timings all use the same allocated values.
- Rationale: The upstream API documents time fields but does not guarantee exact summary/section equality. The strict equality guard rejected an observed successful future-provider response. The rider selected preservation of the total with explicit estimated intermediate times instead of replacing the total with the section sum.
- User impact: Intermediate arrivals are application estimates, not provider-guaranteed per-waypoint predictions. The live planner explains proportional allocation; share views continue to describe arrival/return as estimates. Existing immutable snapshots and stored plans are not rewritten.
- Safety and compatibility: Keep raw road-to-section checks, all distance/point/geometry/motorcycle checks and budget accounting. Reject unsafe or noninteger time inputs/sums and a proportional allocation that cannot represent positive-duration sections. Never increase the provider total to repair an unrepresentable allocation. Preserve exact internal road/section/leg totals and finalization/weather binding without changing DB validators or schema. The old mismatch-only diagnostic instrumentation is retired with this correction.
- Verification: original failure through provider adapter/orchestrator becomes accepted; signed mismatches, exact matches, integer remainders, zero road weights, invalid/unsafe inputs, geometry/point rejection, next-chunk departure/dwell and under-24-hour limits; browser and DB acceptance of the exact normalized output; actual Preview and Production route/weather checks.
- Confirmed by user: 2026-09-16, “권장대로 진행하자”. Implementation and deployment evidence: [duration investigation](../archive/2026-09/2026-09-16-route-duration-diagnostic.md).

#### ROUTE-010 — Provider distance mismatch and actionable map errors

- Status: `CONFIRMED` (2026-10-01 user correction).
- Decision: Do not reject an otherwise valid provider route solely because its summary distance differs from the sum of validated section distances. Use the section sum as the normalized distance, without redistributing or inventing road distances. This supersedes ROUTE-007's retention of that upstream equality guard only. Finite safe-integer values, road-to-section consistency, ordered requested points, geometry continuity, motorcycle restrictions, call budgets and persisted normalized totals remain enforced.
- User correction: “전체 거리와 구간 거리 합계” was an excessive constraint intended for removal. The earlier recorded ROUTE-007 removed the timing equality while retaining distance; this correction resolves that divergence prospectively. It is not evidence that the historical request was replayed.
- Map provider errors: Official result codes 101–107 produce closed, actionable public codes and a popup explaining the affected origin/waypoint/destination, too-close endpoints or road incident. Never reflect provider text/URLs/coordinates/secrets. Retain input and prior saved results; no automatic retry, point substitution, omission or passenger-car fallback. Unknown/malformed responses keep their failure boundary.
- Design and verification: Figma M04 `200:2266`; backend adapter/orchestrator regression, web/Android popup and no-save/no-weather-on-failure tests; same prepared public five-point scenario before/after the candidate. Historical 2026-09-30 inputs were not retained and the user has no saved course, so exact historical replay remains unavailable.

#### ROUTE-008 — Execute the summarized course in KakaoMap

- Status: `CONFIRMED`. 0.4.0 deployed; phone launch USER_REPORTED PASS. 0.4.1 Figma amendments are the current release candidate; installation/device matrix remains separately unverified.
- Owner summary: Replace the owner's riding-summary edit action with `경로 실행` on mobile and desktop. Keep the back action as the route/date/time editing entry; do not add a separate editing page or a duplicate handoff button to the editor. Execute only a real calculated result that still matches the current course and schedule. Changed inputs require recalculation; demonstration data and an old result must not be handed off as the displayed current plan.
- Received-share summary: Make `경로 실행` primary and pass the valid published origin, every ordered waypoint occurrence and destination directly, without saving, new-schedule creation or MOTOCAST route/weather recalculation. An already readable public snapshot does not require the private copy/planning endpoint for this external handoff. Historical time/weather and calculated results remain reference-only, never a fresh current ride result; historical age alone does not require owner-style recalculation before passing places. State this in the shared summary before confirmation. `새 일정으로 출발` imports the course for the recipient to choose their own date/time and recalculate route/weather; `내 경로로 저장` saves to their collection for later. Both are secondary and retain their existing authorization. Replace the ambiguous top arrow with `홈으로` linked to home.
- Boundary: Pass origin, every ordered waypoint occurrence and final destination to KakaoMap. Count all ordinary, lunch, dinner, rest and repeated visits, excluding origin/final destination. More than five blocks handoff with `현재 경유지 {n}개 - 경유지 5개 제한 초과` and asks the rider to reduce the count. Never truncate, deduplicate, reorder or split automatically. The internal planning limits remain unchanged.
- Shared over-limit recovery: Offer `새 일정으로 출발`, where the rider manually reduces intermediate visits to five or fewer and recalculates. The immutable shared course itself is not edited. Missing/invalid coordinates, incomplete or ambiguous visit order, failed resolution and known revoked/unavailable shares block execution instead of guessing or omitting places. Confirmation/retry stays bound to the same currently displayed, successfully resolved snapshot; token replacement, navigation or a late response invalidates an earlier attempt.
- Confirmation: Before opening KakaoMap, emphasize `경유지 최대 5개` and `자동차전용도로 제외` with `카카오맵에서 직접 선택해 주세요.`, and require explicit confirmation. Per Figma comments #26–28, remove other confirmation prose and the separate installation button/panel. Revalidate the appropriate source identity (owner result/current inputs or displayed shared snapshot), place validity, count and order at confirmation and every retry. The confirmation does not prove or change external vehicle/road settings. Internal ROUTE-001/004/005/006/007 policies remain unchanged.
- Platform: PC opens the official HTTPS route URL in a new tab. Android/iPhone web or PWA opens the KakaoMap app. If it does not open or is not installed, provide the official platform store and explicit return/retry guidance; do not fall back to mobile web routing. Web code must not claim reliable installation detection, completed installation, app-open success or navigation start from a timeout/visibility event. Android uses the documented Intent official-store fallback. iOS attempts a delayed official-store redirect only while the same source remains current and foregrounded; visibility/pagehide/blur, cancel and unmount cancel it. This is a best-effort request, not installation detection. Store recovery links remain reachable on the post-attempt panel; unknown mobile OS is never guessed.
- Preservation and privacy: Preserve the selected course through store departure/return, revalidate before retry, and fail visibly if recovery is unavailable. Never auto-run after installation/return. External URLs allow only documented place/coordinate/transport fields, never login/share/place-verification tokens. Link generation adds no route/weather/provider request or database mutation.
- Future Android: The same `경로 실행` intent will check installation and location permission, start the rider's location-tracking session and persistent ride controls while MOTOCAST is foreground, then open KakaoMap. A failed launch request cleans up only the newly started attempt. Actual navigation confirmation, GPS tracking, alerts and native lifecycle remain the separate Android #31/#32 scope, not part of this web slice.
- Verification and design: [Issue #59](https://github.com/tocomboy/motocast/issues/59), [implementation plan and Figma state map](../archive/2026-09/2026-09-18-kakaomap-handoff-plan.md). Verify owner freshness and public snapshot identity as distinct contracts; direct shared execution must neither invoke private course-copy/planning nor persist a ride. Tokens, internal IDs/proofs and historical schedule/weather stay out of the external URL.
- Confirmed by user: 2026-09-18, install KakaoMap when absent; replace redundant summary editing with `경로 실행`; connect future native GPS before external handoff. The subsequent instruction authorizes Figma, Git and documentation preparation first, not application implementation or deployment.
- Superseding user decision, 2026-09-18: Shared summaries also execute directly; this replaces the previous requirement to prepare the recipient's own plan first. Owner recalculation remains unchanged. Update the existing preparation PR #67, Figma, documents, Issues and Notion only; no application implementation, merge or deployment.

- Subsequent implementation authorization, 2026-09-18: Implement and verify before merging/deploying v0.4.0. The user will validate actual KakaoMap app handoff on their phone; record it as pending, never infer device success from automated tests. GPS remains separate.

#### ROUTE-009 — Select a waypoint on the map

- Status: `CONFIRMED` by user request on 2026-10-01; implementation and deployment are recorded separately.
- Decision: Support map zoom/pan and long press to choose a waypoint in the owner planner on web and Android. Resolve the selected coordinate through the existing authenticated place API, show the address in a confirmation popup above the map, and add an ordinary zero-dwell waypoint only when the user presses `경유지로 추가`. The 2026-10-01 clarification requires Figma-first design of this popup; the earlier full-screen-picker WIP is superseded. Cancel, late response, provider failure and an unmapped point leave the course unchanged. Shared maps remain read-only while supporting camera gestures.
- Boundary: Preserve the selected coordinate, including mountain parcels without a road address. Never invent a road, snap to a different POI, strip `산`, or use client-supplied unsigned coordinates as trusted places. Coordinate lookup consumes the existing Local free quota; no extra allowance or automatic retry is introduced. Existing waypoint/order/count, route recalculation and share-approval invalidation contracts remain mandatory.
- Verification: web/native request and response parity, signed coordinate binding, member/revoked/budget denial, no-result/error/cancel/stale response, drag/pinch versus long press, unchanged shared snapshots, and actual SDK camera behavior. User real-device validation remains distinct from emulator and mock tests.
- Evidence: [map and mountain-weather investigation](../archive/2026-10/2026-10-01-map-weather.md). Current Preview success at the reported public addresses does not establish the cause or correction of the historical weather complaint.

### Weather

#### WEATHER-001 — Forecast selection and role

- Status: `CONFIRMED`
- Decision: Combine segment ETA and KMA grid forecast. Use ultra-short forecast for ETA within six hours, village short-term forecast after six hours through five days, and mark later ETA outside the forecast window without a detailed provider call. Weather is reference information and does not affect route scoring.
- Rationale: Forecast relevance is tied to passage time while route preference remains rider-controlled.
- User impact: Each meaningful route point shows forecast source/window and expected arrival weather.
- Affected: KMA adapter, grid conversion, cache, timeline UI.
- Verification: six-hour and five-day exact boundaries, grid fixtures, no-call beyond window, ranking independence.
- Confirmed: 2026-08-30.

#### WEATHER-002 — Snapshot and stale behavior

- Status: `CONFIRMED`
- Decision: Persist the last successful forecast snapshot with issue, retrieval, validity, and stale-observation times. On provider, budget, configuration, persistence, or request-validation failure, keep it readable when a matching snapshot exists and label it stale with a safe structured failure kind and reason, full Seoul date/time, elapsed age, and independently advancing expiry state; never present stale data as current.
- Reconfirmed by user, 2026-09-05: preserve the current exact request/response issuance binding while seeking authoritative KMA response-selection rules. An earlier single-issuance diagnostic is not permission to accept that payload or to stamp it with the requested issue time. The policy choice is resolved; the supplier contract remains unverified.
- Superseding evidence decision, 2026-09-05: the user explicitly approved evaluating and adopting an empirically validated request-selection correction when official guidance does not explain the observed response. Exact requested/returned issuance, grid, values, duplicate and required-category validation remain mandatory. Two matching historical samples allow candidate design, not implementation readiness: establish the selection rule, publication-delay and six-hour ETA boundary criteria before READY. No offset acceptance, response restamping, or automatic model substitution is authorized.
- Rationale: Stored trip information remains useful during an outage without hiding freshness risk.
- User impact: Riders see the last known forecast and how old it is.
- Affected: snapshot schema, cache policy, UI, logs/status.
- Verification: success-then-failure test, safe failure-kind mapping including malformed provider JSON, complete-or-empty stale metadata DB constraint, multi-day age, clock advance through the validity boundary, simultaneous failure/expiry display, cache response compatibility, and no-snapshot failure state.
- Confirmed: 2026-08-30.

### Cost and failure handling

#### COST-001 — Free-tier hard stop

- Status: `CONFIRMED`
- Decision: Do not enable paid APIs, paid plans, or automatic billing. Atomically consume an internal daily budget in Asia/Seoul time before each external request. Missing, non-positive, or exhausted limits fail closed. Stored plans and snapshots remain readable.
- Rationale: This is a small private service with a zero-paid-API constraint.
- User impact: New calculations may stop for the day, but saved rides remain available.
- Affected: budget RPC, Edge Functions, provider consoles, status UI, operations.
- Verification: missing/zero/boundary/concurrent/exhausted budget tests and saved-data read tests.
- Confirmed: 2026-08-30.

#### COST-002 — Failed provider call accounting

- Status: `CONFIRMED`
- Decision: Every attempted provider request consumes the internal daily budget even when the provider returns an error or times out. Budgets are reserved immediately before the external call and are not refunded. In the normal and provider-error paths one reservation corresponds to one provider attempt. If the committed budget RPC response itself is lost, the reservation remains consumed even though the Edge Function fails closed before it can prove or start the provider call; the ledger is therefore an intentionally conservative hard-stop counter, not billing-grade evidence of confirmed external requests.
- Rationale: The current implementation consumes before calling and therefore counts attempts. Refunding saves quota during outages but adds transactional complexity and can allow retry storms or mismatch provider-side counting.
- User impact: Repeated provider failures can exhaust calculations earlier, preventing retry storms and unexpected provider usage while saved data stays readable.
- Affected: budget ledger/RPC, provider adapters, retry policy, metrics.
- Verification: timeout/4xx/5xx scenarios, concurrency, normal-path provider-count reconciliation, and an ambiguous budget-RPC-response case that proves no unreserved provider call and permits only conservative over-counting.
- Confirmed by user interview: 2026-08-30.

#### OPS-001 — Observable failures

- Status: `CONFIRMED`
- Decision: Provider, persistence, authorization, and invariant failures are never returned as success. User errors contain no stack, SQL, internal path, connection string, token, or key. Operators can distinguish live, cached, stale, budget-exhausted, configuration-missing, and provider-failed states without logging sensitive data.
- Rationale: Failures must be actionable without leaking secrets or misleading riders.
- User impact: Clear safe status replaces silent fallback.
- Affected: error contracts, logging, UI, monitoring.
- Verification: response/log redaction tests and status transition tests.
- Confirmed: 2026-08-30.

### Platform and delivery

#### OPS-002 — Supabase boundary

- Status: `CONFIRMED`
- Decision: Supabase owns Auth, Postgres/RLS, immutable data, provider Edge Functions, and server-only provider/budget secrets. The service-role key is used only in an explicitly reviewed trusted server boundary and is never shipped to the browser.
- Rationale: Centralize sensitive provider calls and data authorization behind RLS.
- User impact: Browser clients hold only publishable credentials and user sessions.
- Affected: Supabase project, Edge Functions, Vercel environment, clients.
- Verification: environment-name readback, bundle/secret scan, RLS and function authorization tests.
- Confirmed: 2026-08-30.

#### OPS-003 — Git and CD topology

- Status: `CONFIRMED`
- Decision: `develop` is the default development branch and deploys Preview. `main` is Production and accepts only a same-repository `develop -> main` PR. Required checks are `verify` and `develop-only`; the `verify` workflow runs the repository baseline and Deno-checks all six maintained Edge Function entrypoints, including the public `kakao-oidc` authentication boundary and Preview-only `play-admission`. Administrator enforcement, conversation resolution, no force push, and no deletion remain enabled. Human approvals remain zero until a real reviewer is designated. Other branches must not auto-deploy; deployment-excluded review/rollback branches use a slash-free `review-*` or `rollback-*` name and require live zero-deployment proof before being relied upon.
- Rationale: Separate continuous development from explicit production promotion.
- User impact: Production changes only after a visible promotion gate.
- Affected: GitHub settings/workflows, Vercel Git integration, `vercel.json`.
- Verification: GitHub API readback, disposable wrong-source probe when routing changes, matching Preview/Production SHA.
- Confirmed: 2026-08-30.
- Interview update: On 2026-08-31 live CI readback showed that `verify` omitted `kakao-oidc` while the verification SoT required all five Edge Function entrypoints. The user selected the recommended strict option: add `kakao-oidc` to CI and require a fresh push/CI/Preview readback rather than relying only on the local Deno result.

#### OPS-004 — Vercel runtime and secrets

- Status: `CONFIRMED`
- Decision: Use Vercel Hobby and the default `vercel.app` domain unless the user supplies a custom domain. Pin Node.js `24.x` consistently across `package.json`, `.nvmrc`, GitHub CI, and Vercel. Vercel keeps only the three `NEXT_PUBLIC_*` variables; provider, service-role, origin, and budget secrets live in Supabase.
- Rationale: Node.js 20 reached end of life and Vercel disables new Node.js 20 builds on 2026-10-01. Use supported Node.js 24 for reproducible local, CI and deployment validation. Keeping server-only values in Supabase reduces credential exposure.
- User impact: Stable builds with a smaller credential exposure surface.
- Affected: package metadata, CI, Vercel project, Supabase secrets.
- Verification: official runtime documentation, project/API readback, build output, environment-name readback.
- Confirmed by user interview: 2026-08-30.
- Runtime update 2026-09-26: the user requested investigation and correction of the Vercel Node.js warning. This supersedes the original Node.js 20 baseline; dependency versions, product behavior, authentication and deployment approval boundaries remain unchanged. See [runtime migration evidence](../archive/2026-09/2026-09-26-node24-runtime.md).
- Interview update: On 2026-08-31 deployment-level readback found seven server-only values mistakenly targeted to both Preview and Production. The user confirmed that no Production credentials had been created, so those values were Preview credentials rather than Production authority. They were removed from Vercel entirely; future Production server credentials remain owned only by Supabase secrets under this confirmed decision.

#### OPS-005 — Deployment protection

- Status: `CONFIRMED`
- Decision: Production is reachable through Kakao authentication and active MOTOCAST membership without Vercel-team authentication. Keep Vercel Authentication on other Preview deployment URLs, but exempt the fixed Android/tester origin `https://motocast-git-develop-tocomboys-projects.vercel.app` so testers need only the app's Kakao login and membership checks. Play enrollment continues to require AUTH-007 verification; web/development entry requires an existing active membership and directs new users to the Play app.
- Rationale: Android App Links and testers must reach the fixed origin without a Vercel account. Other development deployment URLs remain protected.
- User impact: The fixed tester origin's login page, explicitly published share snapshots and public App Links certificate are reachable without Vercel login. Private courses, writes and membership remain protected by application authentication and server authorization.
- Affected: Vercel Deployment Protection, E2E automation, Preview instructions.
- Verification: anonymous Production and the fixed tester origin reach the application; other protected Preview URLs remain challenged. Private APIs still reject anonymous/nonmember access; revoked or invalid share tokens are denied. App Links certificates must return public JSON without a Vercel redirect.
- Confirmed by user interview: 2026-08-30; fixed tester-origin exception approved 2026-09-26 ("vercel 로그인 없이 앱 + 카카오 로그인 만으로 볼 수 있게").

#### OPS-006 — Backup and free-plan operation

- Status: `CONFIRMED`
- Decision: Accept Supabase Free inactivity pauses, document a pre-ride availability check and a manual off-platform backup before real data, and use Vercel Dashboard/CLI/GitHub Deployment when Hobby lacks log drains.
- Rationale: Operate safely within free tiers without pretending they provide production-grade uptime or backup guarantees.
- User impact: Administrators perform a short readiness check before important rides.
- Affected: runbooks, backup procedure, operational checks.
- Verification: documented restore/readback drill using non-production data and dashboard/CLI log access.
- Confirmed: 2026-08-30.

Temporary operations amendment to OPS-006, confirmed by the user 2026-09-15: run a removable daily 04:00 Asia/Seoul GitHub Actions job in the separately approved private `tocomboy/motocast-operations` repository against the two existing Supabase Free projects, using only each project's publishable key and read-only anonymous database RPC calls. This reduces inactivity-pause risk without promising uninterrupted service, mutating user data, or consuming Kakao/KMA quotas. That private repository owns all implementation, scheduler and configuration; this public product repository retains only the documentation pointer. Provide environment-specific stop switches and remove the feature when a plan/environment change makes it unnecessary. The user performing such a change must follow the [separate lifecycle and removal record](../operations/temporary-supabase-keepalive.md); no billing-management access or automatic plan detection is added. This amendment supersedes passive acceptance of pauses only for this bounded mitigation, preserving manual availability checks and other free-plan limitations.

#### OPS-007 — Preview data isolation

- Status: `CONFIRMED`
- Decision: Use a second Supabase Free project dedicated to Vercel Preview. Preview must use separate Auth users, rider data, provider secrets, budgets, and publishable credentials from Production; migrations and Edge Function code remain version-aligned. Authenticated browser automation is bound to the exact develop Preview origin and Preview project identity, stores its session only in an owner-private external file, disables credential-bearing artifacts, and fails before mutation for every other origin or project.
- Rationale: A Preview defect or test must not read, mutate, or spend against Production identities, plans, shares, or secrets. Supabase Free currently permits two active free projects in one organization, which fits the small private-service boundary without adding a paid service.
- User impact: Preview testing uses disposable test identities and data; real riders and Production plans remain isolated.
- Affected: Supabase projects, migrations, Auth providers and redirects, Edge Functions, Vercel Preview environment variables, Playwright configuration/auth state, runbooks.
- Verification: distinct project references and environment-name ownership readback, schema/function parity, Preview test identity, fail-closed local/arbitrary-HTTPS/Production test targets, private non-symlink state file, and negative checks showing no Production data is reachable.
- Confirmed by user interview: 2026-08-30.

- Interview update, 2026-09-15: The user approved Production deployment and a one-time transfer of the existing administrator and rider with their owned data from Preview to Production, and reported successful new signup and existing-user access. This narrowly supersedes the cross-environment user-data copy prohibition for these two users. Preserve ownership, roles and source Preview data; do not infer permission for ongoing synchronization, raw session transfer, provider-key reuse or budget-ledger copying. The user explicitly declined backups and accepted transfer-failure risk. No backup/export file is created; in-memory transfer, source preservation, atomic failure handling and required identity/data validation remain mandatory. See the [current execution plan](../archive/2026-09/2026-09-15-production-user-migration-plan.md). User-reported login success is distinct from new agent execution evidence.

Operational clarification for OPS-007, 2026-09-15: The user subsequently approved continuing with the existing Kakao app and raising internal limits to provider quotas, with the lead choosing the Preview allocation. Use the free-quota-eligible app 1561641 for both environments; assign Production 90% and Preview 10% of each verified provider allowance. This explicitly permits that app's provider credentials to serve both environments. Keep Supabase projects, publishable keys, OIDC state/place-verification secrets, user sessions and budget ledgers separate. Kakao-wide monthly and browser-map quotas remain shared provider limits; per-operation daily budgets do not enforce a monthly or browser-SDK reservation. KMA's two forecast operations must share its environment allocation rather than each receiving the full account quota. Retain the zero-paid-service rule and record account-specific quota verification in the execution plan.

#### OPS-008 — Production Supabase region

- Status: `CONFIRMED`
- Decision: Keep the current Production project in AWS `ap-northeast-1` (Tokyo) and the isolated Preview project in Seoul `ap-northeast-2`. No region replacement or migration is required for this release.
- Rationale: Live readback corrected an earlier mistaken region label: `ap-northeast-1` is Tokyo, not Seoul. Preview is already isolated in Seoul. Replacing Production now minimizes migration risk but requires recreating or repurposing one of the two Free projects; keeping Tokyo avoids project replacement but retains Japan data residency and modest additional latency.
- User impact: Core behavior is the same; the choice changes data location, expected latency, and the operational work needed before launch.
- Affected: Supabase Production project, Vercel Production variables, Kakao OAuth redirects, secrets, migrations, backup and cutover plan.
- Verification: explicit user decision, project region readback, empty/pre-cutover data audit, and final Production project reference evidence.
- Recorded: 2026-08-30.
- Interview history: On 2026-08-31 the user deferred every Production Supabase/Vercel change until the Preview gate is complete. The subsequent user instruction to retain the current Tokyo/Seoul regions resolves the region choice. Production deployment, credentials, migrations, and main promotion still require their separate post-Preview approval; region confirmation alone does not authorize those changes.

#### RELEASE-001 — Versioned user updates

- Status: `CONFIRMED`
- Decision: Use SemVer-based product versions and concise Korean, user-facing release notes. Keep package and release-data versions aligned. A public `/updates` page contains only curated product summaries, and a shared footer links the version to that page. On the first authenticated application visit after an update, show a dismissible, mobile-compatible summary once per active member and version, with server-side atomic persistence across devices and concurrent tabs. Each member has an independent record. Re-reading the page never resets the record.
- Rationale: Riders should understand meaningful changes without reading development history or repeatedly dismissing the same announcement.
- User impact: Show only the latest version's 2–4 meaningful changes automatically; prior notes remain available on demand. Close controls and Escape remain available. A display reservation records first access; retry of the same presentation is idempotent. A lost response or closed tab does not prove the rider read the message.
- Affected: package version, release data, public updates page, application announcement component, same-origin claim endpoint, owner-bound `release_announcements` table and authenticated claim function. No role grants, user migration, route/weather or sharing contract changes.
- Verification: package/lockfile/latest-note consistency, user A/B separation, repeat/new-version/concurrent claims, anonymous/revoked/non-member denial, no direct table access, Strict Mode and detached-request behavior, desktop/mobile dismissal and navigation. Keep local, actual DB and hosted evidence distinct.
- Confirmed: User requested version conventions, concise updates, PR merge and Production deployment on 2026-09-16, then added one-time per-user mobile popup requirements. Details: [version and release-note rules](../rules/versioning-and-release-notes.md).

## Current state

Release and deployment evidence is recorded in [GitHub Releases](https://github.com/tocomboy/motocast/releases), and open work is tracked in [GitHub Issues](https://github.com/tocomboy/motocast/issues). The pre-2026-10-05 live-state snapshot and implementation status are archived in [SOT live-state and implementation status](../archive/2026-09/sot-live-state-and-implementation-status.md).

## Deprecated decisions

#### DEPRECATED-006 — Candidate-specific custom winding points

- Status: `DEPRECATED`
- Decision: Apply a user-authored winding-only waypoint only to the winding candidate and omit it from balanced and shortest candidates.
- Rationale: Authenticated Preview smoke showed that this made a point the rider described as required disappear from two candidates and their maps. The intermediate all-candidate policy was subsequently replaced by the single-route `ROUTE-006` decision.
- User impact: New plans calculate one route through every selected custom winding point. Older immutable share snapshots remain readable and truthfully label a historically omitted point without extending the provider geometry.
- Affected: trusted candidate policy, route/provider tests, map marker smoke, sharing compatibility, documentation.
- Verification: the one recommended request retains the exact ordered winding points; actual Preview exposes their markers and provider geometry; legacy snapshots preserve truthful omission markers.
- Deprecated by user interview: 2026-09-01.

#### DEPRECATED-007 — Automatic winding alternatives and availability error

- Status: `DEPRECATED`
- Decision: Request `RECOMMEND + alternatives` and optionally `TIME + alternatives`, require a more-curved geometry, and fail with `WINDING_ROUTE_UNAVAILABLE` when a distinct third route is unavailable.
- Rationale: Kakao does not guarantee an automatic motorcycle winding alternative. The workflow increased calls, budget consumption, duplicate-route risk, and user-visible failure while the rider already controls the intended course through custom waypoints.
- User impact: New plans no longer promise or search for an automatic winding candidate and never show `WINDING_ROUTE_UNAVAILABLE`; they return one explicit safe recommended route or a general safe-route failure.
- Affected: removed candidate/estimated-winding modules, provider parameters, planner copy, tests, budget expectations, Preview route smoke.
- Verification: repository search finds no live alternatives request, winding-estimation implementation, or new-plan error mapping; legacy docs and schemaVersion 1/2 fixture labels remain only as compatibility evidence.
- Deprecated by user interview: 2026-09-01; replaced by `ROUTE-006`.

#### DEPRECATED-005 — User-entered desired and hard return constraints

- Status: `DEPRECATED`
- Decision: Require both a desired return and a hard return, warn after the desired time, and exclude candidates after the hard time or after Seoul midnight.
- Rationale: The user chose route-derived expected return only and explicitly allowed candidates that cross midnight. Replaced by `PLAN-002` and the less-than-24-hour service boundary in `SCOPE-001`.
- User impact: The planner no longer asks for two speculative return times; it shows each candidate's calculated return instead.
- Affected: planner input, route request, schedule timeline, candidate UI, sharing schema, tests, legacy persistence adapter.
- Verification: removed-field impact search, midnight-crossing and 24-hour boundary tests, schemaVersion 2 omission, and schemaVersion 1 compatibility.
- Deprecated by user interview: 2026-09-01.

#### DEPRECATED-004 — Guaranteed automatic winding candidate

- Status: `DEPRECATED`
- Decision: Guarantee that a rider without a custom winding waypoint always receives a third automatic winding candidate from `alternatives=true`.
- Rationale: Real Preview evidence and Kakao's documented one-or-more response cardinality show that a distinct alternative is not guaranteed. Replaced by the confirmed `ROUTE-002`/`ROUTE-003` priority-pool attempt and explicit custom-waypoint recovery.
- User impact: The application never relabels a duplicate or less-curved route as winding merely to reach three cards.
- Affected: route orchestration, provider budget, failure contract, planner notice, tests.
- Verification: no-distinct pools return `WINDING_ROUTE_UNAVAILABLE`; one distinct more-curved chunk permits a complete candidate; custom waypoint remains available.
- Deprecated by user interview: 2026-08-31.

#### DEPRECATED-001 — Kakao favorites as product storage

- Status: `DEPRECATED`
- Decision: Automatically import or reference Kakao Map favorites.
- Rationale: Replaced by MOTOCAST-owned, per-user riding collections.
- User impact: Riders explicitly build or save collections in MOTOCAST.
- Affected: collection model and planner UI.
- Verification: no Kakao favorites dependency exists.
- Deprecated: 2026-08-30.

#### DEPRECATED-002 — KakaoNavi automatic handoff in v1

- Status: `DEPRECATED`
- Decision: Automatically populate the KakaoNavi app from a plan.
- Rationale: First release stores and displays the plan for manual rider use.
- User impact: Riders review and enter navigation details themselves.
- Affected: v1 scope and UI.
- Verification: no automatic handoff call is exposed.
- Deprecated: 2026-08-30.

#### DEPRECATED-003 — Automatic share redaction

- Status: `DEPRECATED`
- Decision: Automatically remove selected route information when sharing.
- Rationale: The user chose full preview and explicit publication without automatic deletion or redaction.
- User impact: The rider sees and approves the complete immutable snapshot.
- Affected: share preview and snapshot generation.
- Verification: preview equals the published snapshot and no hidden transform occurs.
- Deprecated: 2026-08-30.

## Primary-source evidence

- Kakao Mobility Driving Directions and reference: motorcycle `car_type=7`, `avoid=motorway`, supported priorities, and waypoint limits. https://developers.kakaomobility.com/affiliate-en/navi-api/directions.html and https://developers.kakaomobility.com/affiliate-en/navi-api/reference.html
- Kakao Developers quota: current free quotas and separately priced additional usage. https://developers.kakao.com/docs/en/getting-started/quota
- KMA APIHub village forecast endpoints and parameters. https://apihub.kma.go.kr/apiList.do?seqApi=10
- Vercel supported Node.js versions and Hobby limits. https://vercel.com/docs/functions/runtimes/node-js/node-js-versions and https://vercel.com/docs/plans/hobby
