# MOTOCAST product source of truth

Last verified: 2026-08-30 (Asia/Seoul)

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
- Decision: Support private, acquaintances-only motorcycle rides within South Korea that start and finish within 24 hours on the same calendar trip. Lodging, public signup, and a public beta are out of scope. Deliver as a responsive web app and installable PWA.
- Rationale: The product is a small personal service for pre-ride planning.
- User impact: Invited riders plan a single day; no overnight itinerary or public discovery flow is shown.
- Affected: app navigation, validation, auth boundary, PWA manifest, deployment policy.
- Verification: 24-hour input boundary tests, unauthenticated/unauthorized access tests, mobile/desktop/PWA smoke tests.
- Confirmed: 2026-08-30.

#### SCOPE-002 — Production truthfulness

- Status: `CONFIRMED`
- Decision: Connected Preview and Production must never present demo route or weather data as a successful provider result. Synthetic data is permitted only in an unmistakably labeled local/demo state.
- Rationale: A rider could otherwise rely on fabricated safety and weather information.
- User impact: Provider or configuration failures are shown as failures while saved data remains readable.
- Affected: planner UI, error states, fixtures, Preview/Production smoke tests.
- Verification: connected-mode failure tests and DOM assertions that distinguish demo, loading, error, stale, and live data.
- Confirmed: 2026-08-30.

### Authentication and membership

#### AUTH-001 — Invite-only Kakao authentication

- Status: `CONFIRMED`
- Decision: Use Supabase Auth with Kakao OAuth. Keep the Kakao subject separate from the internal Supabase user ID. Only administrators create cryptographically random, one-time invitation links. A valid invitation is required for first membership creation; an existing active member can sign in again without a fresh invite. Invitations expire and can be revoked; memberships can be revoked. A valid active membership is required to use rider data and provider functions.
- Rationale: Access is limited to known acquaintances without maintaining a custom password system.
- User impact: A rider enters through an invitation, signs in with Kakao, and loses access immediately after membership revocation.
- Affected: Supabase Auth, callback route, invitations, memberships, RLS, Edge Functions, admin UI.
- Verification: invite creation, expiry, revocation, one-time and concurrent consumption; active/revoked/admin/anonymous authorization tests.
- Confirmed: 2026-08-30.

#### AUTH-002 — Invitation token storage

- Status: `CONFIRMED`
- Decision: Generate invitation tokens from at least 32 random bytes, return the plaintext only at creation, and store only a SHA-256 hash. Claiming is transactional and row-locked so at most one distinct user succeeds.
- Rationale: Database disclosure must not reveal usable invitation links.
- User impact: Lost links cannot be retrieved and must be reissued.
- Affected: invitation RPCs, admin UI, logs, tests.
- Verification: schema/readback, no-plaintext search, two-session concurrency test, token redaction test.
- Confirmed: 2026-08-30.

#### AUTH-003 — Uninvited OAuth account lifecycle

- Status: `CONFIRMED`
- Decision: A Kakao OAuth completion without a valid invitation is signed out and denied all application access. It may leave only the minimum dormant `auth.users` record; it must not create a public profile or membership. Administrators receive a safe cleanup procedure for dormant records.
- Rationale: Supabase OAuth creates the Auth user before the application callback can claim an invitation. The callback and database therefore prevent profile creation until a claim succeeds and retain only the unavoidable Auth record when an uninvited login is denied.
- User impact: Both options deny app access, but the retained-record option stores minimal Kakao profile data for an uninvited person while strict cleanup needs a trusted server boundary and careful retry handling.
- Affected: Auth hooks/callback, profile creation flow, administrator cleanup procedure, privacy notice, tests.
- Verification: direct callback and expired/revoked invitation scenarios plus Auth/profile/membership readback.
- Confirmed by user interview: 2026-08-30.

### Ownership, collections, and sharing

#### DATA-001 — Per-user ownership and RLS

- Status: `CONFIRMED`
- Decision: Every rider-owned record is keyed to the internal user and protected by Row Level Security. User A cannot read or mutate User B data. Browser code never uses the service-role key.
- Rationale: Routes and schedules reveal sensitive location information.
- User impact: Each rider sees and manages only their own plans, collections, and shares.
- Affected: all rider tables, policies, RPC grants, browser/server clients.
- Verification: User A/B, administrator, revoked member, and anonymous matrix on every table and RPC.
- Confirmed: 2026-08-30.

#### DATA-003 — Trusted aggregate mutation boundary

- Status: `CONFIRMED`
- Decision: The browser may request planning actions but cannot directly create or mutate route-backed trip aggregates, immutable collection versions, weather snapshots, or share snapshots. Trusted Edge Functions stage provider-verified route candidates under the authenticated owner and a short-lived planning ID; an owner-only RPC atomically finalizes exactly one balanced, winding, and shortest set. Aggregate selection and deletion use narrow owner-checked RPCs, while direct table mutation remains denied.
- Rationale: RLS ownership alone cannot prove that browser-supplied route JSON came from the motorcycle-safe provider boundary or preserve multi-table invariants.
- User impact: A plan is saved only after all three verified candidates are ready; partial, expired, cross-user, or browser-forged route sets fail explicitly.
- Affected: route Edge Function, route draft tables, trip/route/waypoint policies, finalization and selection RPCs, planner UI.
- Verification: browser-role direct-DML denial, service-role staging, exact-three/one-plan finalization, expiry, replay, cross-user, and transaction rollback tests.
- Confirmed as security implementation of `DATA-001` and `ROUTE-001`: 2026-08-30.

#### DATA-002 — Riding collections

- Status: `CONFIRMED`
- Decision: Store user-owned riding collections as ordered waypoint templates with waypoint kind, dwell, selected state, custom-winding marker, and immutable versions that can be applied to a plan.
- Rationale: Kakao favorites are replaced by an app-owned, provider-independent collection.
- User impact: Riders can build and reuse custom winding routes as waypoint sequences.
- Affected: collection schema, CRUD UI, trip planning, RLS, versioning.
- Verification: CRUD/order/version/apply tests and cross-user denial.
- Confirmed: 2026-08-30.

#### SHARE-001 — Explicit immutable sharing

- Status: `CONFIRMED`
- Decision: Sharing is off by default and occurs only after a full preview and explicit publish action. A share is an immutable snapshot; later source edits do not change it. Owners can revoke and issue a new link. No automatic redaction or automatic publication occurs.
- Rationale: The user controls when complete route information leaves the private owner boundary.
- User impact: A shared link shows exactly the approved snapshot until revoked; reissuing creates a different link.
- Affected: snapshot format, token endpoint, preview/publish/revoke UI, RLS, cache headers.
- Verification: immutability, revocation, reissue, anonymous view, owner-only management, cross-user denial, source-table non-exposure.
- Confirmed: 2026-08-30.

#### SHARE-002 — Share token handling

- Status: `CONFIRMED`
- Decision: Share tokens use at least 32 random bytes; store only SHA-256 hashes. The public resolver returns the published snapshot only and never exposes owner source tables, management metadata, or internal place-verification proofs. All user-facing ride, place, schedule, route, and weather information remains in the full preview without automatic redaction.
- Rationale: A database leak must not produce usable public links.
- User impact: A lost link cannot be recovered; it can only be revoked and reissued.
- Affected: share RPC/endpoint, schema, logging, tests.
- Verification: no-plaintext search, resolver contract test, revoked/unknown token denial, access-log redaction.
- Confirmed: 2026-08-30.

#### SHARE-003 — Preview-to-publish capability

- Status: `CONFIRMED`
- Decision: A full share preview issues a cryptographically random, ten-minute, single-use approval capability whose plaintext is returned only to that owner and whose SHA-256 hash and snapshot hash are stored. Publication row-locks the grant and source trip, rebuilds the allowlisted snapshot, requires an identical hash, consumes the capability, and creates the immutable share in one transaction. Direct browser inserts or updates of shares and snapshots are denied.
- Rationale: A client-side equality check leaves a race in which the source can change after preview and before publish.
- User impact: The published link is guaranteed to contain the exact full snapshot most recently approved; an expired, reused, or stale preview requires a new preview.
- Affected: preview/publish RPCs, grant table, share UI, snapshot allowlist, RLS and grants.
- Verification: exact preview/publish, source-change rejection, expiry, single-use, concurrent use, nested-field allowlist, direct-DML denial, revoke and reissue tests.
- Confirmed as security implementation of `SHARE-001`: 2026-08-30.

### Trip inputs and schedule

#### PLAN-001 — Place identity and validation

- Status: `CONFIRMED`
- Decision: Origin, destination, required lunch, optional dinner, and waypoints are selected from Kakao place search and stored with validated coordinates. Free text is never treated as a verified place. Validate South Korea bounds, string lengths, waypoint count, dwell, and date/time range at both client and trusted server boundaries.
- Rationale: Route and weather correctness depends on real coordinates.
- User impact: Typed text remains unconfirmed until a search result is selected.
- Affected: place search proxy/UI, plan schema, route/weather inputs.
- Verification: selected/unselected UI states and malformed/boundary input tests.
- Confirmed: 2026-08-30.

#### PLAN-002 — Schedule constraints

- Status: `CONFIRMED`
- Decision: Store departure, desired return, and hard return. Desired return is a soft constraint shown as a warning; any candidate later than hard return is excluded. Lunch is required; dinner is nullable. Only user-selected rests count, with a default dwell of 30 minutes. Restaurant break time is displayed only and never automatically rejects or rewrites a route.
- Rationale: Riders retain control while the hard return remains enforceable.
- User impact: Late-but-allowed candidates are warned; impossible candidates are absent.
- Affected: trip schema, schedule engine, planner UI, candidate filtering.
- Verification: lunch/dinner/rest and desired/hard return boundary tests.
- Confirmed: 2026-08-30.

### Routes and motorcycle safety

#### ROUTE-001 — Mandatory motorcycle constraints

- Status: `CONFIRMED`
- Decision: Every Kakao route request, including split legs and future traffic calls, sets `car_type=7`, `avoid=motorway`, and reflects road closures. These values are server-owned and cannot be disabled by client input. Never fall back to a passenger-car route.
- Rationale: Kakao documents car type 7 as motorcycle and `motorway` as exclusion of motorway/automobile-only road.
- User impact: If a compliant route cannot be returned, planning fails explicitly instead of showing an unsafe substitute.
- Affected: route provider adapter, request logging, tests, failure UI.
- Verification: intercepted request assertions for every call path; no-fallback test; real legal-route smoke test.
- Confirmed: 2026-08-30.

#### ROUTE-002 — Three candidate identities

- Status: `CONFIRMED`
- Decision: Present exactly three distinguishable candidate identities: balanced, winding, and shortest. Weather never changes their ordering.
- Rationale: The rider chose three comparison goals.
- User impact: The UI consistently compares three named route strategies and explains unavailable candidates.
- Affected: orchestration, provider request strategy, UI, tests.
- Verification: candidate identity/uniqueness tests and weather-order independence.
- Confirmed: 2026-08-30.

#### ROUTE-003 — Winding candidate derivation

- Status: `CONFIRMED`
- Decision: User-authored winding waypoints are mandatory inputs to the winding candidate. When none exist, request Kakao alternatives and choose a distinct motorcycle-safe candidate using a documented geometry-curvature heuristic. The UI labels this result `와인딩 추정`; it must never imply that Kakao provides a native winding priority.
- Rationale: Labeling a normal recommended route as winding would mislead riders.
- User impact: Saved winding points are preserved. Without them, riders still receive a third candidate but can see that winding quality is an application estimate.
- Affected: collection semantics, route orchestrator, candidate availability UI, provider cost.
- Verification: provider-request contract tests, no-custom-waypoint scenario, distinctness and labeling tests.
- Confirmed by user interview: 2026-08-30.

#### ROUTE-004 — Waypoint splitting

- Status: `CONFIRMED`
- Decision: Preserve waypoint order, required stops, selected optional points, segment ETA, and dwell across provider request splitting. Never omit a required point merely to satisfy a provider limit.
- Rationale: Kakao endpoints impose waypoint limits and long plans may require multiple safe calls.
- User impact: The planned route visits stops in the order the rider approved.
- Affected: route orchestration, budget accounting, ETA engine.
- Verification: boundary waypoint counts, split safety parameters, order/dwell/ETA continuity.
- Confirmed: 2026-08-30.

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
- Decision: Persist the last successful forecast snapshot with issue and retrieval times. On provider failure, keep it readable and label it stale with a safe failure reason; never present stale data as current.
- Rationale: Stored trip information remains useful during an outage without hiding freshness risk.
- User impact: Riders see the last known forecast and how old it is.
- Affected: snapshot schema, cache policy, UI, logs/status.
- Verification: success-then-failure test, age calculation, no-snapshot failure state.
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
- Decision: Every attempted provider request consumes the internal daily budget even when the provider returns an error or times out. Budgets are consumed immediately before the external call and are not refunded.
- Rationale: The current implementation consumes before calling and therefore counts attempts. Refunding saves quota during outages but adds transactional complexity and can allow retry storms or mismatch provider-side counting.
- User impact: Repeated provider failures can exhaust calculations earlier, preventing retry storms and unexpected provider usage while saved data stays readable.
- Affected: budget ledger/RPC, provider adapters, retry policy, metrics.
- Verification: timeout/4xx/5xx scenarios, concurrency and provider-count reconciliation.
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
- Decision: `develop` is the default development branch and deploys Preview. `main` is Production and accepts only a same-repository `develop -> main` PR. Required checks are `verify` and `develop-only`; administrator enforcement, conversation resolution, no force push, and no deletion remain enabled. Human approvals remain zero until a real reviewer is designated. Other branches do not auto-deploy.
- Rationale: Separate continuous development from explicit production promotion.
- User impact: Production changes only after a visible promotion gate.
- Affected: GitHub settings/workflows, Vercel Git integration, `vercel.json`.
- Verification: GitHub API readback, disposable wrong-source probe when routing changes, matching Preview/Production SHA.
- Confirmed: 2026-08-30.

#### OPS-004 — Vercel runtime and secrets

- Status: `CONFIRMED`
- Decision: Use Vercel Hobby and the default `vercel.app` domain unless the user supplies a custom domain. Pin Node.js `20.x` consistently across `package.json`, GitHub CI, and Vercel. Vercel keeps only the three `NEXT_PUBLIC_*` variables; provider, service-role, origin, and budget secrets live in Supabase.
- Rationale: Node.js 20 is already the locally and CI-verified baseline, so aligning Vercel down from its current 24.x setting avoids an unnecessary runtime migration while removing drift. Keeping server-only values in Supabase reduces credential exposure.
- User impact: Stable builds with a smaller credential exposure surface.
- Affected: package metadata, CI, Vercel project, Supabase secrets.
- Verification: official runtime documentation, project/API readback, build output, environment-name readback.
- Confirmed by user interview: 2026-08-30.

#### OPS-005 — Deployment protection

- Status: `CONFIRMED`
- Decision: Production is reachable through MOTOCAST invitation and Kakao authentication without Vercel-team authentication. Enable Vercel Authentication for Preview deployments only.
- Rationale: Preview contains unreleased behavior and test data, while invited acquaintances must be able to reach Production without owning a Vercel account.
- User impact: Preview requires authorized Vercel access; Production uses only the application's invitation and Kakao login boundary.
- Affected: Vercel Deployment Protection, E2E automation, Preview instructions.
- Verification: anonymous Production response reaches the application; anonymous Preview is challenged; an authorized Preview smoke test can proceed.
- Confirmed by user interview: 2026-08-30.

#### OPS-006 — Backup and free-plan operation

- Status: `CONFIRMED`
- Decision: Accept Supabase Free inactivity pauses, document a pre-ride availability check and a manual off-platform backup before real data, and use Vercel Dashboard/CLI/GitHub Deployment when Hobby lacks log drains.
- Rationale: Operate safely within free tiers without pretending they provide production-grade uptime or backup guarantees.
- User impact: Administrators perform a short readiness check before important rides.
- Affected: runbooks, backup procedure, operational checks.
- Verification: documented restore/readback drill using non-production data and dashboard/CLI log access.
- Confirmed: 2026-08-30.

#### OPS-007 — Preview data isolation

- Status: `CONFIRMED`
- Decision: Use a second Supabase Free project dedicated to Vercel Preview. Preview must use separate Auth users, rider data, provider secrets, budgets, and publishable credentials from Production; migrations and Edge Function code remain version-aligned.
- Rationale: A Preview defect or test must not read, mutate, or spend against Production identities, plans, shares, or secrets. Supabase Free currently permits two active free projects in one organization, which fits the small private-service boundary without adding a paid service.
- User impact: Preview testing uses disposable test identities and data; real riders and Production plans remain isolated.
- Affected: Supabase projects, migrations, Auth providers and redirects, Edge Functions, Vercel Preview environment variables, runbooks.
- Verification: distinct project references and environment-name ownership readback, schema/function parity, Preview test identity, and negative checks showing no Production data is reachable.
- Confirmed by user interview: 2026-08-30.

#### OPS-008 — Production Supabase region

- Status: `NEEDS_INTERVIEW`
- Decision: Choose whether the current Production project remains in AWS `ap-northeast-1` (Tokyo) or is replaced with a Seoul `ap-northeast-2` project before real rider data is accepted.
- Rationale: Live readback corrected an earlier mistaken region label: `ap-northeast-1` is Tokyo, not Seoul. Preview is already isolated in Seoul. Replacing Production now minimizes migration risk but requires recreating or repurposing one of the two Free projects; keeping Tokyo avoids project replacement but retains Japan data residency and modest additional latency.
- User impact: Core behavior is the same; the choice changes data location, expected latency, and the operational work needed before launch.
- Affected: Supabase Production project, Vercel Production variables, Kakao OAuth redirects, secrets, migrations, backup and cutover plan.
- Verification: explicit user decision, project region readback, empty/pre-cutover data audit, and final Production project reference evidence.
- Recorded: 2026-08-30.

## Live-state snapshot

This snapshot is evidence, not a permanent decision. Re-read live state before promotion.

### Verified 2026-08-30

- Git: the second independent-review correction is committed at `dabb36b3f296dcec4feff08ae7a8e09c2f30269d`; independent delta review of the new head is pending. `.gitignore` remains a pre-existing user change and was excluded from the commit. No open PR or remote probe branch was present at the last live readback.
- GitHub: public repository; default `develop`; `main` required checks `verify` and `develop-only`; PR required with zero approvals; administrators and conversation resolution enforced; force pushes and deletion disabled.
- Vercel: project `tocomboys-projects/motocast`, GitHub repository linked, Production Branch `main`. Following the user interview, API readback now reports Node.js `20.x` and `ssoProtection.deploymentType=preview`, so Preview requires Vercel Authentication while Production remains outside that platform gate. One Ready Production deployment still comes from the import-time `develop` source. No custom domain exists.
- Vercel environment names: the three intended `NEXT_PUBLIC_*` names plus seven server-only/provider/budget names exist in both Production and Preview. Values were not read or printed.
- Supabase Production: project `obodvbyzptxeehgpcpkd` (`motocast`, Tokyo `ap-northeast-1`, PostgreSQL 17.6.1) is `ACTIVE_HEALTHY` and locally linked. Migrations `20260830193000`, `20260830204000`, and reviewed privilege hardening `20260830212000` are applied. Live ACL readback passes 6/6 assertions; all 11 public tables have RLS enabled. `search-places`, `plan-route`, and `weather-timeline` are deployed as active version 1, but the current functions are not yet redeployed and user-defined secret names remain empty. Secret values were not read or printed.
- Supabase Preview: project `lehjmbgfpoemqcwxowbx` (`MOTOCAST_Preview`, Seoul `ap-northeast-2`, PostgreSQL 17.6.1) is separately `ACTIVE_HEALTHY` and currently empty/unlinked. The earlier no-write dry run confirmed the then-current four migrations through `20260830223000` were pending. The repository now contains a fifth review-hardening migration, `20260830224500`; a new dry run and all writes remain blocked until fixed-SHA independent review passes. Production and Preview refs are distinct. Full migrations/functions/provider secrets/Auth settings are not yet applied.
- Local database: a minimal Supabase PostgreSQL 17 instance incrementally applied all five migrations. The current review-hardening migration reapplies successfully. The latest combined Auth/RLS/budget, live ACL, and plan/collection/share suites pass `91/91`. Separate two-connection suites pass collection/FK `4/4` and invitation/budget/share publication concurrency `7/7`; each suite now exits nonzero if any assertion is false. A destructive fresh reset/apply is `NOT_RUN` pending explicit approval to erase only the disposable local database at `127.0.0.1:54322`. These local results do not replace connected Preview/Production verification.
- Writer verification for the correction: ESLint passes; Vitest passes `27 files / 136 tests`; Deno checks all four Edge Function entrypoints; TypeScript and the production build pass in an exact writable `/tmp` copy because the Windows-mounted workspace intermittently returned `EROFS` for generated cache files. The temporary validation copy was deleted afterward. This environment error is not reported as a product-test failure.
- Repository: verified Kakao place selection, three server-owned route strategies, custom winding waypoint editing, hard-return exclusion, and actual provider geometry rendering are connected in the planner. Route ETA weather, collection version/apply UI, explicit immutable sharing, and the public resolver are implemented and locally verified, but the new migration and function are not yet hosted or browser-smoke-tested.

## Implementation status

### Implemented but not production-verified

- Responsive PWA shell and Kakao map canvas.
- Supabase browser/server client scaffolding and Kakao OAuth callback.
- Invitation, membership, collection, trip, cache, weather snapshot, share, and budget schema with initial RLS.
- Verified Kakao place search with a selected-versus-typed UI state.
- Balanced, winding, and shortest route orchestration with server-enforced `car_type=7`, `avoid=motorway`, hard-return exclusion, no passenger-car fallback, and provider waypoint/geometry continuity validation.
- Custom winding waypoint editing and an honestly labelled `와인딩 추정` alternative when no custom winding point exists.
- Safe provider-contract parsing and actual route geometry rendering; example and live states remain visibly distinct.
- Transactional plan persistence and ordered collection versioning begin in `20260830223000`. Migration `20260830224500` adds trusted Edge-only route staging, three distinct route-geometry finalization, verified-place collection persistence through `save-collection`, route-bound weather snapshot persistence and stale observation, immutable aggregate DML denial, narrow owner RPCs, a ten-minute single-use preview capability, snapshot-local waypoint IDs, and an explicit nested-field share allowlist. Neither migration is deployed to either hosted project.
- Public share bearer tokens are emitted as `/share#<token>` and resolved by a fixed-path `POST /api/shares/resolve`, so the token is not placed in the initial hosting request path. The service worker bypasses `/share` and does not cache the shared page or resolver response.
- Route ETA is connected to the weather request contract, with exact six-hour/five-day model boundaries, per-request deduplication, recent cache reuse, durable same-route snapshots, explicit stale fallback, and KMA grid conversion regression coverage. Hosted provider execution remains unverified.
- Vercel project runtime and deployment protection now match `OPS-004` and `OPS-005` by API readback.
- Basic schedule unit tests and CI workflows.

### Incomplete

- Current Edge Function code redeployment, Auth provider/redirect/secrets configuration, and post-deployment readback.
- AUTH-003 migrations and sensitive RPC ACLs are live and independently approved; full OAuth and A/B/admin/revoked connected tests remain pending.
- Actual Kakao route and KMA response smoke tests; provider-backed candidate distinctness remains unverified.
- Deploying and connected-testing route ETA weather, collection CRUD/version/apply, and immutable share preview/publish/resolver/revoke/reissue.
- Resolving `OPS-008` for the Production Supabase region before real rider data is accepted.
- Full RLS, concurrency, provider, browser, Preview, and Production tests.
- Vercel secret cleanup, Preview public-variable isolation, and a new `main`-origin Production deployment. Runtime alignment and Preview-only deployment protection are already configured and still require deployment-level smoke verification.

## Deprecated decisions

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
