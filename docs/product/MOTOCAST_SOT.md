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
- Decision: Share tokens use at least 32 random bytes; store only SHA-256 hashes. The public resolver returns the published snapshot only and never exposes owner source tables or management metadata.
- Rationale: A database leak must not produce usable public links.
- User impact: A lost link cannot be recovered; it can only be revoked and reissued.
- Affected: share RPC/endpoint, schema, logging, tests.
- Verification: no-plaintext search, resolver contract test, revoked/unknown token denial, access-log redaction.
- Confirmed: 2026-08-30.

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
- Decision: Use Vercel Hobby and the default `vercel.app` domain unless the user supplies a custom domain. Pin one currently supported Node.js LTS major consistently across `package.json`, CI, and Vercel. Vercel keeps only the three `NEXT_PUBLIC_*` variables; provider, service-role, origin, and budget secrets live in Supabase.
- Rationale: Avoid runtime drift and duplicate high-value secrets.
- User impact: Stable builds with a smaller credential exposure surface.
- Affected: package metadata, CI, Vercel project, Supabase secrets.
- Verification: official runtime documentation, project/API readback, build output, environment-name readback.
- Confirmed: 2026-08-30.

#### OPS-005 — Deployment protection

- Status: `NEEDS_INTERVIEW`
- Decision: Production must be reachable to invited riders through app authentication, not Vercel-team authentication. Choose the separate Preview protection policy before external Preview smoke testing.
- Rationale: Vercel Authentication limits access independently of MOTOCAST membership; Preview contains unreleased behavior and should have an intentional policy.
- User impact: Production works for acquaintances without Vercel accounts; Preview may be owner-only or test-link accessible.
- Affected: Vercel Deployment Protection, E2E automation, Preview instructions.
- Verification: anonymous HTTP response and protected/unprotected Preview access test.
- Recorded: 2026-08-30.

#### OPS-006 — Backup and free-plan operation

- Status: `CONFIRMED`
- Decision: Accept Supabase Free inactivity pauses, document a pre-ride availability check and a manual off-platform backup before real data, and use Vercel Dashboard/CLI/GitHub Deployment when Hobby lacks log drains.
- Rationale: Operate safely within free tiers without pretending they provide production-grade uptime or backup guarantees.
- User impact: Administrators perform a short readiness check before important rides.
- Affected: runbooks, backup procedure, operational checks.
- Verification: documented restore/readback drill using non-production data and dashboard/CLI log access.
- Confirmed: 2026-08-30.

## Live-state snapshot

This snapshot is evidence, not a permanent decision. Re-read live state before promotion.

### Verified 2026-08-30

- Git: local `develop` is `90f7f522bea5bb92c348b656bd80d8797d636653`, three commits ahead of `origin/develop` at `201e1ec12c967da57fb671fad294cf1d05b9d56c`; `main` and `origin/main` are `d0134ed93d7e0d8aed1123c5d693c665bbe646e8`. `.gitignore` remains a pre-existing user change and is excluded from MOTOCAST commits. No open PR or remote probe branch exists.
- GitHub: public repository; default `develop`; `main` required checks `verify` and `develop-only`; PR required with zero approvals; administrators and conversation resolution enforced; force pushes and deletion disabled.
- Vercel: project `tocomboys-projects/motocast`, GitHub repository linked, Production Branch `main`, Node.js `24.x`. One Ready Production deployment exists and its alias indicates the import-time `develop` source. The public alias returned HTTP 200 without a Vercel Authentication redirect at audit time. No custom domain exists.
- Vercel environment names: the three intended `NEXT_PUBLIC_*` names plus seven server-only/provider/budget names exist in both Production and Preview. Values were not read or printed.
- Supabase: project `obodvbyzptxeehgpcpkd` (`motocast`, Seoul `ap-northeast-1`, PostgreSQL 17.6.1) is `ACTIVE_HEALTHY` and locally linked. Migrations `20260830193000` and `20260830204000` are applied. Live ACL readback exposed Supabase default anonymous EXECUTE grants, so forward hardening migration `20260830212000` is pending review before application. Deployed Edge Functions and user-defined secret names remain empty. Secret values were not read or printed.
- Repository: initial schema plus invite-only forward migration and three Edge Functions exist; the UI still uses demo coordinates/results after successful provider invocation. Collection/share persistence UI and public share resolver are absent.

## Implementation status

### Implemented but not production-verified

- Responsive PWA shell and Kakao map canvas.
- Supabase browser/server client scaffolding and Kakao OAuth callback.
- Invitation, membership, collection, trip, cache, weather snapshot, share, and budget schema with initial RLS.
- Route and weather Edge Function drafts with server-enforced `car_type=7` and `avoid=motorway`.
- Basic schedule unit tests and CI workflows.

### Incomplete

- Live Supabase migration/function/Auth/provider/redirect/secrets deployment and post-deployment readback.
- AUTH-003 cleanup and invite lifecycle migration are implemented locally but awaiting independent delta review and live transaction tests.
- Real Kakao place search and verified-coordinate form state.
- Three real and distinguishable candidate orchestration, hard-return filtering, and ROUTE-003 resolution.
- Mapping route/weather responses into the UI; durable cache/stale behavior.
- Collection CRUD/version/apply UI and persistence.
- Immutable share preview/publish/resolver/revoke/reissue.
- Full RLS, concurrency, provider, browser, Preview, and Production tests.
- Vercel secret cleanup, runtime alignment, Preview protection decision, new `main`-origin Production deployment.

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
