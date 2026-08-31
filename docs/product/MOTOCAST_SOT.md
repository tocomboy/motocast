# MOTOCAST product source of truth

Last verified: 2026-09-01 (Asia/Seoul)

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

### Authentication and membership

#### AUTH-001 — Invite-only Kakao authentication

- Status: `CONFIRMED`
- Decision: Use Supabase Auth with a Kakao identity, with the email-free OIDC boundary defined by `AUTH-004`. Keep the Kakao subject separate from the internal Supabase user ID. Only administrators create cryptographically random, one-time invitation links. A valid invitation is required for first membership creation; an existing active member can sign in again without a fresh invite. Invitations expire and can be revoked; memberships can be revoked. A valid active membership is required to use rider data and provider functions.
- Rationale: Access is limited to known acquaintances without maintaining a custom password system.
- User impact: A rider enters through an invitation, signs in with Kakao, and loses access immediately after membership revocation.
- Affected: Supabase Auth, callback route, invitations, memberships, RLS, Edge Functions, admin UI.
- Verification: invite creation, expiry, revocation, one-time and concurrent consumption; active/revoked/admin/anonymous authorization tests.
- Confirmed: 2026-08-30.

#### AUTH-002 — Invitation token storage

- Status: `CONFIRMED`
- Decision: Generate invitation tokens from at least 32 random bytes, return the plaintext only at creation, and store only a SHA-256 hash. Invitation links put the bearer token in the URL fragment (`/invite#<token>`), immediately remove it from browser history, and send it only in a JSON body to a fixed no-store POST endpoint that requires the same HTTP origin and rejects cross-site/non-JSON requests before setting the short-lived HttpOnly claim cookie. Claiming is transactional and row-locked so at most one distinct user succeeds.
- Rationale: Database disclosure must not reveal usable invitation links.
- User impact: Lost links cannot be retrieved and must be reissued.
- Affected: invitation RPCs, admin UI, fixed accept endpoint, logs, service worker, tests.
- Verification: schema/readback, no-plaintext search, no dynamic token-path route, same-origin JSON/CSRF denial, same-user retry, invalid/expired/revoked cases, and two-session distinct-user concurrency.
- Confirmed: 2026-08-30.

#### AUTH-003 — Uninvited OAuth account lifecycle

- Status: `CONFIRMED`
- Decision: A Kakao OAuth completion without a valid invitation is signed out and denied all application access. It may leave only the minimum dormant `auth.users` record; it must not create a public profile or membership. Administrators receive a safe cleanup procedure for dormant records.
- Rationale: Supabase OAuth creates the Auth user before the application callback can claim an invitation. The callback and database therefore prevent profile creation until a claim succeeds and retain only the unavoidable Auth record when an uninvited login is denied.
- User impact: Both options deny app access, but the retained-record option stores minimal Kakao profile data for an uninvited person while strict cleanup needs a trusted server boundary and careful retry handling.
- Affected: Auth hooks/callback, profile creation flow, administrator cleanup procedure, privacy notice, tests.
- Verification: direct callback and expired/revoked invitation scenarios plus Auth/profile/membership readback.
- Confirmed by user interview: 2026-08-30.

#### AUTH-004 — Email-free Kakao OIDC boundary

- Status: `CONFIRMED`
- Decision: Use Kakao authorization-code OpenID Connect directly instead of Supabase Auth's hosted Kakao `signInWithOAuth()` start endpoint. Request only `openid`, optional `profile_nickname`, and optional `profile_image`; never request `account_email`. An application-origin start endpoint creates a separate 32-byte browser-binding secret in an HttpOnly `__Host-` cookie and sends only its SHA-256 hash to the public, JWT-exempt Supabase Edge Function. The Edge Function owns the exact allowlisted redirect, Client Secret, CSRF `state`, and a per-attempt raw nonce whose SHA-256 value is sent to Kakao. The browser-binding hash is signed into the attempt, encrypted into the handoff payload, and required by the atomic DB consume operation. The Kakao ID token, access token, raw nonce, and binding hash cross to the application only through a short-lived, encrypted, single-use handoff whose plaintext bearer appears only in a URL fragment and is immediately removed. The application verifies the app-origin binding cookie before calling Supabase `signInWithIdToken({ provider: "kakao" })`, including the access token and raw nonce, and only then applies the existing invitation and membership gate. Supabase Kakao remains enabled with `Allow users without an email`; Kakao OpenID Connect remains enabled. Failure at any state, nonce, browser binding, handoff, token, invitation, or membership check fails closed and clears temporary authentication state.
- Rationale: Live Preview produced `KOE205` because hosted Supabase Auth hard-codes `account_email`, `profile_image`, and `profile_nickname` in the Kakao authorization request even when email-optional mode is enabled. Kakao permits `account_email` only for Biz or test apps, while the owner cannot register a business. Direct OIDC preserves Kakao login and Supabase session/RLS ownership without collecting email or placing the Kakao Client Secret in Vercel.
- User impact: Riders still press one Kakao login button. They may decline nickname or profile-image access and receive an application fallback profile; they are never asked for email. A failed or replayed login attempt returns a generic safe error and cannot create membership without a valid invitation.
- Affected: Kakao consent and OpenID settings, Supabase Kakao provider, public OIDC Edge Function and secrets, one-time handoff table/RPCs, login button, callback API, invitation finalization, Preview/Production redirect registration, Auth tests and runbooks.
- Verification: authorize URL contains `openid`, `profile_nickname`, and `profile_image` but not `account_email`; state cookie and exact authenticated initiating-origin return tests, including a second allowed origin and provider failure; hashed nonce and `signInWithIdToken` nonce/access-token propagation; browser A handoff denial in browser B before session or invitation mutation; malformed/expired/replayed/cross-origin handoff denial; advancing-clock expiry; token exchange error redaction; optional OIDC `picture` profile preservation; one non-aborted request across React Strict Mode replay; no late navigation after the callback screen detaches; invitation/member/revoked flows; hosted Preview login and Auth identity readback.
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
- Decision: The browser may request planning actions but cannot directly create or mutate route-backed trip aggregates, immutable collection versions, weather snapshots, share snapshots, or Kakao OIDC handoffs. The service role has no direct DML on any current application table, cannot execute public functions outside seven reviewed internal RPCs, and does not inherit direct table DML or function EXECUTE on future objects created by the migration role. Five RPCs own provider/budget aggregate work; two additional RPCs create and atomically consume only a hashed, encrypted, short-lived OIDC handoff. Trusted Edge Functions use these narrow SECURITY DEFINER boundaries, while direct table mutation remains denied.
- Rationale: RLS ownership alone cannot prove that browser-supplied route JSON came from the motorcycle-safe provider boundary or preserve multi-table invariants.
- User impact: A plan is saved only after all three verified candidates are ready; partial, expired, cross-user, or browser-forged route sets fail explicitly.
- Affected: route Edge Function, route draft tables, trip/route/waypoint policies, finalization and selection RPCs, planner UI.
- Verification: browser/service-role direct-DML denial across every application table and operation, future-table/function default-ACL probes, exact seven-function service-role allowlist (five provider/aggregate RPCs plus two OIDC handoff RPCs), exact-three/one-plan finalization, expiry, replay, cross-user, two-session finalizer race, and forced mid-write transaction rollback tests.
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
- Decision: Sharing is off by default and occurs only after a full preview and explicit publish action. A share is an immutable snapshot; later source edits do not change it. Owners can revoke and issue a new link. No automatic redaction or automatic publication occurs. Existing schemaVersion 1 links remain readable when a field added later is absent; new snapshots still emit the complete current allowlist.
- Rationale: The user controls when complete route information leaves the private owner boundary.
- User impact: A shared link shows exactly the approved snapshot until revoked; reissuing creates a different link.
- Affected: snapshot format, token endpoint, preview/publish/revoke UI, RLS, cache headers.
- Verification: immutability, revocation, reissue, anonymous view, owner-only management, cross-user denial, source-table non-exposure, and legacy schemaVersion 1 fixture compatibility.
- Confirmed: 2026-08-30.

#### SHARE-002 — Share token handling

- Status: `CONFIRMED`
- Decision: Share tokens use at least 32 random bytes; store only SHA-256 hashes. Public links carry the bearer in a URL fragment, copy it only to component-local memory, and synchronously remove the fragment before resolver access or third-party map code can run; fragment-removal failure stops resolution. The public resolver returns the published snapshot only and never exposes owner source tables, management metadata, or internal place-verification proofs. All user-facing ride, place, schedule, route, and weather information remains in the full preview without automatic redaction.
- Rationale: A database leak must not produce usable public links.
- User impact: A lost link cannot be recovered; it can only be revoked and reissued.
- Affected: share RPC/endpoint, schema, logging, tests.
- Verification: no-plaintext search, synchronous fragment removal before one Strict Mode resolver request, removal-failure denial, resolver contract test, revoked/unknown token denial, access-log redaction.
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
- Decision: The rider enters only the ride date and departure time. Each route candidate shows its computed expected return from provider travel time plus required meals and user-selected rest dwell; there is no user-entered desired return or hard return and no deadline warning/filter. Lunch is required; dinner is nullable. Only user-selected rests count, with a default dwell of 30 minutes. Restaurant break time is displayed only and never automatically rejects or rewrites a route. A candidate may cross Seoul midnight but must return less than 24 hours after departure.
- Rationale: The rider decided that the useful output is the route-derived expected return, while two separate return constraints add unnecessary input burden.
- User impact: Riders enter fewer times and compare candidates by honest expected return, including next-day early-morning returns.
- Affected: route request contract, schedule engine, planner UI, share snapshot schema, trip persistence compatibility, tests.
- Verification: departure-date validation; lunch/dinner/rest dwell; midnight-crossing expected return; exact 24-hour rejection; no removed fields in the browser/Edge contract or schemaVersion 2 share; schemaVersion 1 compatibility.
- Confirmed by user interview: 2026-09-01 (option B; midnight-crossing candidates explicitly retained).
- Persistence note: Existing `trips.desired_return_at` and `trips.hard_return_at` remain non-public legacy columns for a non-destructive first-version migration. The trusted Edge boundary supplies an undisplayed same-day compatibility value only to satisfy the old storage function. It never filters a candidate, appears in the current UI, or appears in schemaVersion 2 shares. A future column cleanup requires its own reviewed migration.

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

- Status: `CONFIRMED`
- Decision: Offer up to three distinguishable candidate identities: balanced, winding, and shortest. A successfully finalized plan still contains three distinct geometries, and weather never changes their ordering. If Kakao cannot supply a genuinely different and more-curved estimated winding route, do not finalize a partial or duplicate plan; explain that the rider can add a custom winding waypoint and recalculate.
- Rationale: The rider chose three comparison goals.
- User impact: The UI compares three named route strategies when all are honest and safe. A missing provider alternative is shown as an actionable unavailable state rather than a fake third success.
- Affected: orchestration, provider request strategy, UI, tests.
- Verification: candidate identity/uniqueness tests and weather-order independence.
- Confirmed: 2026-08-30.
- Interview update: On 2026-08-31 the real Preview provider returned no distinct winding alternative and `SAFE_ROUTE_NOT_FOUND` was observed twice. The user selected option A: keep a maximum of three honest candidates, retain three-geometry finalization, and require a custom winding waypoint when the provider pools still cannot produce the third geometry.

#### ROUTE-003 — Winding candidate derivation

- Status: `CONFIRMED`
- Decision: User-authored winding waypoints are mandatory inputs to the winding candidate. A winding-only point is strictly a zero-dwell `pass-through` with no meal/rest role; required lunch, dinner, and selected rest stops can never be removed from balanced or shortest candidates by a winding marker. When no custom winding-only point exists, first obtain the normal `RECOMMEND` baseline and then inspect the full `RECOMMEND + alternatives` pool for each chunk, choosing a geometry-distinct route only when its curvature exceeds that baseline. If the alternatives request returns no route or no more-curved geometry, inspect one `TIME + alternatives` pool under the same motorcycle constraints. Baseline chunks may be retained where Kakao has no local alternative, but at least one chunk in the completed estimated-winding route must be genuinely distinct and more curved. Otherwise return `WINDING_ROUTE_UNAVAILABLE` and ask for a custom winding waypoint. The UI labels a successful result `와인딩 추정`; it must never imply that Kakao provides a native winding priority.
- Rationale: Labeling a normal recommended route as winding would mislead riders.
- User impact: Saved winding points are preserved. Without them, riders receive a third candidate only when the provider supplies enough trustworthy geometry; otherwise they get a clear waypoint action instead of a mislabeled route.
- Affected: collection semantics, route orchestrator, candidate availability UI, provider cost.
- Verification: provider-request contract tests, overlapping winding/stop rejection, defense-in-depth required-stop preservation, no-custom-waypoint scenario, distinctness and labeling tests.
- Confirmed by user interview: 2026-08-30.
- Interview update: On 2026-08-31 the user approved the priority-pool fallback and explicit custom-waypoint recovery after the provider legally returned no distinct alternative. The earlier guarantee that every no-waypoint request would still produce a third candidate is deprecated because Kakao documents one-or-more results, not multiple distinct results.

#### ROUTE-004 — Waypoint splitting

- Status: `CONFIRMED`
- Decision: Preserve waypoint order, required stops, selected optional points, segment ETA, and dwell across provider request splitting. Never omit a required point merely to satisfy a provider limit.
- Rationale: Kakao endpoints impose waypoint limits and long plans may require multiple safe calls.
- User impact: The planned route visits stops in the order the rider approved.
- Affected: route orchestration, budget accounting, ETA engine.
- Verification: boundary waypoint counts, split safety parameters, order/dwell/ETA continuity.
- Confirmed: 2026-08-30.

#### ROUTE-005 — Road geometry and map marker truthfulness

- Status: `CONFIRMED`
- Decision: Before a successful route calculation, never connect selected places with a synthetic straight line. After success, draw only validated Kakao Mobility road `vertexes`, replace the prior polyline immediately when the selected candidate changes, and fit bounds to the complete road geometry plus markers. Mark origin, destination, lunch, dinner, selected rest, custom winding, and other waypoints with role-specific markers whose visible letter and accessible legend supplement color. In a full shared snapshot, an approved winding-only point that balanced or shortest intentionally does not traverse remains visible as `선택 경로 미통과`; this marker never alters or extends the provider polyline. Empty geometry, SDK failure, authorization failure, or an invalid domain is an explicit failure and never becomes a synthetic success.
- Rationale: A point-to-point line can look rideable while crossing roads or terrain that the provider never routed, and identical markers make the actual stop order hard to verify.
- User impact: Riders see the real road shape and can distinguish every planned role at a glance and through assistive text.
- Affected: Kakao map canvas, planner/share map-point classification, Kakao type boundary, responsive styles, unit/Playwright/Preview tests.
- Verification: no pre-route polyline; exact provider path readback; role-specific marker image/title and non-color legend; bounds over road and marker points; candidate replacement without stale canvas; SDK/error states; connected Preview at mobile and desktop widths.
- Confirmed by user Goal: 2026-09-01.

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
- Decision: `develop` is the default development branch and deploys Preview. `main` is Production and accepts only a same-repository `develop -> main` PR. Required checks are `verify` and `develop-only`; the `verify` workflow runs the repository baseline and Deno-checks all five deployed Edge Function entrypoints, including the public `kakao-oidc` authentication boundary. Administrator enforcement, conversation resolution, no force push, and no deletion remain enabled. Human approvals remain zero until a real reviewer is designated. Other branches do not auto-deploy.
- Rationale: Separate continuous development from explicit production promotion.
- User impact: Production changes only after a visible promotion gate.
- Affected: GitHub settings/workflows, Vercel Git integration, `vercel.json`.
- Verification: GitHub API readback, disposable wrong-source probe when routing changes, matching Preview/Production SHA.
- Confirmed: 2026-08-30.
- Interview update: On 2026-08-31 live CI readback showed that `verify` omitted `kakao-oidc` while the verification SoT required all five Edge Function entrypoints. The user selected the recommended strict option: add `kakao-oidc` to CI and require a fresh push/CI/Preview readback rather than relying only on the local Deno result.

#### OPS-004 — Vercel runtime and secrets

- Status: `CONFIRMED`
- Decision: Use Vercel Hobby and the default `vercel.app` domain unless the user supplies a custom domain. Pin Node.js `20.x` consistently across `package.json`, GitHub CI, and Vercel. Vercel keeps only the three `NEXT_PUBLIC_*` variables; provider, service-role, origin, and budget secrets live in Supabase.
- Rationale: Node.js 20 is already the locally and CI-verified baseline, so aligning Vercel down from its current 24.x setting avoids an unnecessary runtime migration while removing drift. Keeping server-only values in Supabase reduces credential exposure.
- User impact: Stable builds with a smaller credential exposure surface.
- Affected: package metadata, CI, Vercel project, Supabase secrets.
- Verification: official runtime documentation, project/API readback, build output, environment-name readback.
- Confirmed by user interview: 2026-08-30.
- Interview update: On 2026-08-31 deployment-level readback found seven server-only values mistakenly targeted to both Preview and Production. The user confirmed that no Production credentials had been created, so those values were Preview credentials rather than Production authority. They were removed from Vercel entirely; future Production server credentials remain owned only by Supabase secrets under this confirmed decision.

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
- Decision: Use a second Supabase Free project dedicated to Vercel Preview. Preview must use separate Auth users, rider data, provider secrets, budgets, and publishable credentials from Production; migrations and Edge Function code remain version-aligned. Authenticated browser automation is bound to the exact develop Preview origin and Preview project identity, stores its session only in an owner-private external file, disables credential-bearing artifacts, and fails before mutation for every other origin or project.
- Rationale: A Preview defect or test must not read, mutate, or spend against Production identities, plans, shares, or secrets. Supabase Free currently permits two active free projects in one organization, which fits the small private-service boundary without adding a paid service.
- User impact: Preview testing uses disposable test identities and data; real riders and Production plans remain isolated.
- Affected: Supabase projects, migrations, Auth providers and redirects, Edge Functions, Vercel Preview environment variables, Playwright configuration/auth state, runbooks.
- Verification: distinct project references and environment-name ownership readback, schema/function parity, Preview test identity, fail-closed local/arbitrary-HTTPS/Production test targets, private non-symlink state file, and negative checks showing no Production data is reachable.
- Confirmed by user interview: 2026-08-30.

#### OPS-008 — Production Supabase region

- Status: `NEEDS_INTERVIEW`
- Decision: Choose whether the current Production project remains in AWS `ap-northeast-1` (Tokyo) or is replaced with a Seoul `ap-northeast-2` project before real rider data is accepted.
- Rationale: Live readback corrected an earlier mistaken region label: `ap-northeast-1` is Tokyo, not Seoul. Preview is already isolated in Seoul. Replacing Production now minimizes migration risk but requires recreating or repurposing one of the two Free projects; keeping Tokyo avoids project replacement but retains Japan data residency and modest additional latency.
- User impact: Core behavior is the same; the choice changes data location, expected latency, and the operational work needed before launch.
- Affected: Supabase Production project, Vercel Production variables, Kakao OAuth redirects, secrets, migrations, backup and cutover plan.
- Verification: explicit user decision, project region readback, empty/pre-cutover data audit, and final Production project reference evidence.
- Recorded: 2026-08-30.
- Interview update: On 2026-08-31 the user explicitly deferred every Production Supabase/Vercel change until the Preview gate is complete. The decision remains `NEEDS_INTERVIEW`; neither hosted Production project nor its data may be reset, migrated, or reconfigured in the Preview phase.

## Live-state snapshot

This snapshot is evidence, not a permanent decision. Re-read live state before promotion.

### Verified 2026-08-31

- Git: fixed SHA `b21ad28ba28a5428ab5ca62fe55c44239c7816f1` resolved the earlier route `HIGH`, service-role ACL, selection race/liveness, and advancing stale-clock findings. Its delta review found four weather-contract `MEDIUM` findings, which correction commit `7efab91` addressed. The next fixed SHA `b17dd6eaa406cea2d1678545016b3927a685edaa` received route, data-integrity, and UI approval with zero findings, while correctness found one remaining `MEDIUM`: a syntactically valid JSON `null` KMA response escaped as a generic request error. Correction commit `232281e` normalized non-object provider JSON to `KMA_INVALID_RESPONSE`; implementation SHA `2250d7e4b791d9d16319b64c0d73645696f66fd0` then received independent correctness, security, data-integrity, route-safety, and UI approval with `BLOCKER 0 / HIGH 0 / MEDIUM 0 / LOW 0`. Full rendered DOM/focus behavior remains an explicit Preview browser-gate verification item rather than a local-unit completion claim. `.gitignore` remains a pre-existing user change and is excluded.
- GitHub: public repository; default `develop`; `main` required checks `verify` and `develop-only`; PR required with zero approvals; administrators and conversation resolution enforced; force pushes and deletion disabled. Local and remote `develop` match fixed SHA `f66f63ce6d8d582c21a749a06819e483ef05d095`. CI run `33367514183` succeeded, and job `99411141245` explicitly Deno-checked all five Edge Function entrypoints including `kakao-oidc`. The pre-existing user `.gitignore` change remains excluded.
- Vercel: project `tocomboys-projects/motocast`, GitHub repository linked, Production Branch `main`, Node.js `20.x`, and `ssoProtection.deploymentType=preview`. Preview deployment `dpl_84HdWPDXg3PFT6u7oA5fFGw7qFqF` is Ready at the fixed `develop` alias for SHA `f66f63ce6d8d582c21a749a06819e483ef05d095`. Preview requires Vercel Authentication while Production remains outside that platform gate. The unchanged import-time Production deployment remains Ready; no Production redeploy or promotion occurred.
- Vercel environment names: `develop` Preview has exactly the three branch-specific public Config names needed by the browser. Name-only readback shows no Vercel server-only/provider/budget variable. Production credentials and all Production changes remain deferred until the post-Preview `OPS-008` interview.
- Supabase Production: project `obodvbyzptxeehgpcpkd` (`motocast`, Tokyo `ap-northeast-1`, PostgreSQL 17.6.1) is `ACTIVE_HEALTHY` and locally linked. Migrations `20260830193000`, `20260830204000`, and reviewed privilege hardening `20260830212000` are applied. Live ACL readback passes 6/6 assertions; all 11 public tables have RLS enabled. `search-places`, `plan-route`, and `weather-timeline` are deployed as active version 1, but the current functions are not yet redeployed and user-defined secret names remain empty. Secret values were not read or printed.
- Supabase Preview: project `lehjmbgfpoemqcwxowbx` (`MOTOCAST_Preview`, Seoul `ap-northeast-2`) is `ACTIVE_HEALTHY`. Site URL and callback allowlist match the fixed `develop` Preview origin. All six migrations are applied. All 14 public application tables, including `kakao_oidc_handoffs`, have RLS enabled; service role has no direct table DML and exactly seven reviewed internal RPC grants. `search-places`, `plan-route`, `weather-timeline`, and `save-collection` are active version 3 with JWT verification enabled; `kakao-oidc` is active version 4 with JWT verification disabled. Exactly ten user-defined Edge Function secret names are present; values were not read or printed. The first real Kakao identity completed the direct OIDC flow and was explicitly approved and registered as the sole active Preview administrator/profile; both the planner and `/admin/invites` returned 200 for that session.
- Local database: after renewed exact Docker/workdir/port readback and explicit user approval, only the disposable PostgreSQL 17 database at `127.0.0.1:54322` was reset from empty. All six migrations, including `20260831213000_email_free_kakao_oidc.sql`, applied in order and the latest migration reapplied successfully. Final pgTAP results after the first independent-review corrections are Auth/RLS/budget `32/32`, plan/collection/share/weather `53/53`, live ACL `116/116`, invitation/budget/share concurrency `7/7`, collection concurrency `4/4`, route finalization concurrency `10/10`, and OIDC handoff/browser-binding/advancing-clock/ACL `11/11`: total `233/233`, `not ok 0`. The OIDC two-consumer case proves exactly one ciphertext return and one `OIDC_HANDOFF_INVALID`; a foreign browser binding and a handoff expiring after transaction start both fail. Service role retains no direct application-table access and has exactly seven reviewed internal RPC grants. Neither hosted project was reset or mutated.
- Writer verification for initial fixed SHA `33b6fc36e74ef13ae5901311f2e1b58a94cae76c`: a fresh writable `/tmp` copy passed `npm ci` (`401` packages), dependency-tree readback, ESLint, TypeScript, Vitest (`40 files / 209 tests`), and the Next.js production build; Deno checked all five Edge Function entrypoints and the then-current database passed `224/224`. Independent review found browser-unbound login handoff `HIGH 1`, fragment-removal failure `HIGH 1`, database clock/ACL `MEDIUM 2`, callback recovery `MEDIUM 1`, and profile/documentation `LOW 3`; that SHA is rejected. Correction SHA `7a1653282b9842e4c83ff18425c8692bf78e0dd5` resolved the transferable handoff, DB clock/ACL, profile, fragment, timeout, route, and documentation findings; data-integrity and route-safety approved with zero new findings. Its correctness/UI review found one overlapping Strict Mode/cancellation state-transition `MEDIUM`, and correctness/security found incomplete secure app-binding cleanup and bootstrap-picture `LOW` findings. SHA `92dcb0c943b783ec088cd1f5222f122b6b5a153f` resolved those issues with a tested single non-aborted request lifecycle, truthful delayed-processing text, app-origin cleanup endpoint, full `__Host-` deletion attributes, app-routed provider failures, and bootstrap `picture`; final five-axis review nevertheless rejected it for two new state-transition defects: callback failure selected the first allowed origin instead of the authenticated initiating origin (`MEDIUM 1`, overlapping `LOW 1` across the other review axes), and a late completion could override the user's navigation after leaving the callback screen (`MEDIUM 1`). The current correction recovers only an HMAC-authenticated allowlisted return origin, uses it for every verified provider/exchange/persistence failure, leaves an unverifiable attempt at a generic provider-origin error, tracks callback-screen attachment without aborting the request, and suppresses late redirect/state updates after detach. A fresh writable copy passes ESLint with zero warnings, TypeScript, Vitest (`40 files / 217 tests`), the Next.js production build including start/complete/cancel Kakao routes, and Deno checks for all five Edge Function entrypoints; the unchanged local DB remains at its previously executed `233/233`, `git diff --check` passes, and the names-only sensitive-value scan remains required before the new fixed commit. A new fixed SHA and final delta reviews remain pending. The mounted-cache Vitest/TypeScript and sandbox-network Deno starts are recorded as setup failures; successful writable-copy reruns are counted separately and do not erase them.
- OIDC correction review history: the preceding pending statement records its then-current stage and is superseded by this result. Fixed SHA `23c54c69d59fd7838fd0f9dd61079c9f25632742` received security, data-integrity, route-safety, and UI approval with zero findings, but correctness found `MEDIUM 3`: callback recovery coupled state/allowlist access to provider credentials, Edge failure assertions covered only a helper, and Strict Mode/detach assertions covered only the lifecycle helper. That SHA is rejected. Fixed SHA `601c1a323ceff01b729b5041452f3ab28f4d4c9a` separates verification environment from provider credentials, delegates the deployed callback path to an injected handler with provider-denial/configuration/exchange/persistence/unauthenticated execution tests, and renders the actual callback under React Strict Mode. Independent correctness, security, data-integrity, route-safety, and UI/accessibility delta reviews each report `BLOCKER 0 / HIGH 0 / MEDIUM 0 / LOW 0`; all prior findings are `RESOLVED`.
- Hosted OIDC runtime finding: the first actual Kakao browser login proved that Supabase Edge exposed an internal `http://...` `request.url`; deriving `redirect_uri` from it caused Kakao to reject a registered HTTPS callback. The reviewed correction derives one exact callback URI from trusted `SUPABASE_URL`, shares it between authorize and token exchange, and rejects non-loopback HTTP or malformed provider bases. After deployment, the real Preview flow completed successfully, created exactly one Kakao Auth identity, returned the expected pre-membership `invite_required` state, and then allowed the explicitly approved first-admin bootstrap. Invitation, revoked-member, and second-rider isolation flows remain pending.
- HTTPS callback review history: fixed SHA `9c66cc52e8c97a3b07642bcc0db0dd52e2ee4222` passed clean-copy `npm ci` (`404` packages), ESLint, TypeScript, Vitest (`42 files / 225 tests`), the Next.js Webpack production build, all five Deno entrypoints, diff check, and a no-value-output sensitive scan. Independent route-safety review approved with zero findings. Correctness and UI/accessibility independently reported the same `MEDIUM`: helper-only assertions did not execute the deployed `/start` and token-request wiring, so the original internal-HTTP regression could return while tests stayed green. Correctness also reported `LOW 3` for empty query/fragment markers, IPv6 loopback normalization, and stale status evidence. Security and data-integrity reviewer starts failed because the selected review model was at capacity and are not approvals. SHA `9c66cc5` is rejected. Correction SHA `51b6a071ac005efe3a1e692755f5369a1e432cd4` extracts the production request handler, executes an internal-HTTP start and callback through that handler, asserts the same trusted HTTPS callback in the authorize redirect and token POST body, closes the empty-component and IPv6 boundaries, and makes ciphertext tampering deterministic. Its targeted handler/helper/callback suite passes `12/12`; the synchronized clean copy passes ESLint, TypeScript, Vitest (`43 files / 226 tests`), the Next.js Webpack production build, all five Deno entrypoints, staged diff check, and the no-value-output sensitive scan. Independent correctness, security, data-integrity, route-safety, and UI/accessibility reviews each report `BLOCKER 0 / HIGH 0 / MEDIUM 0 / LOW 0`; the prior `MEDIUM 1 / LOW 3` are `RESOLVED`. The route reviewer additionally passed `34/34` focused tests. Connected Preview browser testing remains `NOT_RUN` until deployment. The exact approved local PostgreSQL 17 target at `127.0.0.1:54322` remains at `233/233`; no migration, DB test, RPC, RLS, route, weather, collection, or budget file changed. Hosted Preview and Production are unchanged.
- Repository: verified Kakao place selection, three server-owned route strategies, custom winding waypoint editing, route-derived expected return, and actual provider geometry rendering are connected in the planner. Route ETA weather, collection version/apply UI, explicit immutable sharing, and the public resolver are implemented, locally verified, and hosted in Preview, but the current return-input and winding corrections still require fixed-SHA review and Preview redeployment.
- Kakao Map runtime finding: a key-preserving request from the fixed Preview origin returned `403 NotAuthorizedError` with `App(MOTOCAST Preview) disabled OPEN_MAP_AND_LOCAL service`. This proves that the JavaScript key reached Kakao but the app-level Map/Local product is disabled. Under `COST-001`, it may be activated only after the Kakao dashboard confirms free-quota eligibility and no Biz Wallet, paid API, or automatic billing requirement. The reviewed correction replaces the prior indefinite `카카오 지도 불러오는 중` state with an explicit SDK error path and ten-second timeout; actual place/route/weather smoke remains blocked until free-only activation and the new Preview deployment.
- Map correction review history: fixed SHA `6669ff9af8179bbec90a0b91df10e3f3725a1398` is rejected. Correctness reported `HIGH 1 / MEDIUM 2` because connected SDK failure still displayed synthetic geometry and normal/unmount transitions lacked regression coverage; route safety reported a separate `HIGH 1` because old demo geometry could remain visible under a new live badge; security reported `MEDIUM 1 / LOW 1` because a public-share fragment remained available to later third-party map code and partial SDK initialization could escape the safe error state. Data integrity approved with zero findings, and the UI reviewer start failed at model capacity and is not an approval. Correction SHA `0b3973c1dab895132de52d67dbbc1998208d6657` renders synthetic geometry only in explicit keyless demo mode, keys readiness to the current geometry, hides and makes the old canvas inert until successful redraw, catches partial SDK/script failures, removes share fragments before a single Strict Mode resolver call, and fails closed on history-cleanup failure. Correctness, security, data-integrity, and route-safety delta reviewers marked all preceding findings `RESOLVED` with zero new findings. UI/accessibility reported `MEDIUM 2`: bottom-positioned map status could be obscured by planner/share summary cards, and removing the live region on `ready` omitted an audible completion transition. SHA `3c9de0fa4db38418b2294113fd3bdc4f7122775b` kept a stable live region and moved it upward; all non-UI reviewers approved, while UI marked those two findings resolved but found the same positioning root cause at 320px where wrapped top badges could cover it (`MEDIUM 1`). Rather than tuning another fixed offset, final implementation SHA `e5a5fe3b27fd9e135c9292154e2ab456d4c8f508` centers loading/demo/error in an independently stacked bounded card and makes only ready visually hidden while preserving its audible live-region completion. Final UI/accessibility, correctness, and route-safety delta reviewers report `BLOCKER 0 / HIGH 0 / MEDIUM 0 / LOW 0`; all earlier findings are `RESOLVED`, with no regression. A synchronized writable copy passes focused tests `13/13`, ESLint, TypeScript, full Vitest `45 files / 237 tests`, the 13-route production build, and all five Deno entrypoint checks; the unchanged DB remains at the earlier `233/233`. Preview redeployment and 320px/desktop browser smoke remain pending.
- Preview map/place/route runtime update: reviewed SHA `7fc021ee9ff5475e2023d7ca028f33665157d3e2` passed CI `verify`, deployed Ready at the fixed `develop` Preview alias, and passed authenticated map and `팔당역` place-search smoke. The server canonicalizes only the provider's exact Kakao place host to HTTPS, and the connected map draws no point-to-point fallback line. The first real three-candidate calculation then failed only the estimated winding candidate. Safe log readback at `2026-08-31T14:18:50Z` and `14:19:04Z` showed `SAFE_ROUTE_NOT_FOUND`; Kakao's official future-directions contract allows one-or-more results for `alternatives=true` and does not guarantee a distinct alternative. The user approved the `ROUTE-002`/`ROUTE-003` priority-pool and custom-waypoint recovery correction. Its new fixed SHA, reviews, Preview function deployment, and actual route/weather smoke remain pending.
- Current correction writer evidence: the explicitly approved disposable local PostgreSQL target at `127.0.0.1:54322` was identified before reset, all seven migrations applied from empty, the latest migration reapplied, and the RLS/RPC/ACL/share/budget/collection/invite/route-finalization/OIDC suites passed `236/236`. An environment-file-free writable copy passed `npm ci` (`407` packages, `0` vulnerabilities), ESLint, TypeScript, all five Deno entrypoints, Vitest (`47 files / 263 tests`), deterministic Chromium Playwright (`9 PASS / 2 SKIP`; the two connected Preview cases remain deliberately unexecuted), the 13-route production build, diff check, and the corrected names-only secret scan. The mounted source previously produced cache-write setup failures, and one older temporary build detected an unintended leftover `.env.local`; neither is counted as product GREEN, and the clean-copy reruns are the writer evidence. A fixed commit, six-axis independent review, CI, Preview deployment, authenticated route/weather/storage smoke, and all Production work remain pending.
- Second-review correction evidence on 2026-09-01: reviewer findings identified a post-calculation draft-time render crash, real schemaVersion 1 share incompatibility, coarse route identity, next-day ambiguity, non-advancing public weather expiry, shared marker correlation, 320px legend overlap, and a Preview command that could target local or Production. The working correction keeps persisted route timestamps separate from edited drafts, normalizes only actual legacy v1 shapes, fingerprints every vertex at six decimals in browser/Edge/database boundaries, labels next-day times, advances public freshness every 30 seconds, correlates snapshot waypoints by ordered verified place identity, and binds all authenticated automation to the exact develop Preview origin and Supabase project. Migration `20260901010000_owned_trip_deletion.sql` adds only an active-member, exact-owner trip deletion RPC so disposable live-test plans can be cascade-cleaned without service-role or direct table DML; immutable issued shares remain independent. After exact local target readback, all eight migrations applied from empty and reapply dry-run was up to date. Local database suites pass `217/217 + 4/4 + 7/7 + 10/10 + 11/11 = 249/249`. The first production-mode Playwright run truthfully failed one 320px overlap (`9 PASS / 1 FAIL / 2 SKIP`), and the focused correction rerun passed `1/1`. The final environment-file-free writable copy then passed `npm ci` (`407` packages), ESLint, TypeScript, Vitest (`50 files / 274 tests`), all five Deno entrypoints, production Chromium Playwright (`10 PASS / 2 SKIP`; only connected Preview cases skipped), and the 13-route production build including the owned-trip API. Missing, arbitrary HTTPS, exact Preview without state, and local-with-external-URL probes all failed closed before test collection. A new fixed commit, six-axis delta review, CI, and connected Preview gate remain pending; Production remains unchanged.
- Third-review working correction on 2026-09-01: independent review of `1547432` left no BLOCKER/HIGH but found cross-runtime half-tie fingerprint drift, non-serialized draft backfill, late/ambiguous live-test cleanup, native Windows owner-private state uncertainty, malformed waypoint-position coercion, shared markers omitted by candidate-specific winding policy, and a missing preview-capability cascade assertion. The current working tree uses the same positive integer microdegree half-up identity in Edge/browser/PostgreSQL, locks route drafts inside an explicit migration transaction before function replacement and backfill, proves a concurrent writer waits, captures exact test-owned IDs before UI assertions, fails closed on unknown cleanup state, rejects native Windows authenticated automation, strictly validates numeric positions, and keeps route-omitted approved points as explicitly labelled non-traversed markers. After exact target readback, the corrected eight migrations applied from empty, dry-run reported `upToDate`, and local DB suites pass `220/220 + 4/4 + 7/7 + 11/11 + 11/11 = 253/253`. Focused TypeScript, Playwright collection, and unit tests pass; full writer verification, a new fixed SHA, six-axis delta review, CI, and connected Preview remain pending. Production remains unchanged.
- Review-process incident: a read-only data reviewer omitted explicit `GET` while querying GitHub deployments and unintentionally created empty Preview deployment record `6177684104` for parent SHA `f66f63c`. Readback proved it had no status, environment URL, or Production flag and triggered no Vercel deployment. The lead deleted that exact metadata record under the temporary-resource cleanup rule and verified `404`; existing Vercel deployment record `6176733391`, code, Supabase, and Production were untouched.

## Implementation status

### Implemented but not production-verified

- Responsive PWA shell and Kakao map canvas; the fail-loud map SDK timeout, exact-host place URL normalization, and road-geometry-only correction are reviewed and deployed. The current local correction adds lettered, color-independent role markers and an accessible legend for every stop type; authenticated Preview marker smoke is pending.
- Supabase browser/server client scaffolding plus an email-free Kakao OIDC start/callback/consume flow. The flow requests only `openid`, `profile_nickname`, and `profile_image`, validates signed state, hashed nonce, and app-origin browser binding, transports tokens through an encrypted two-minute one-time handoff rather than a request URL, and completes the Supabase session with Kakao ID-token verification. The trusted-HTTPS correction is deployed and the real first-admin Preview login succeeds.
- Invitation, membership, collection, trip, cache, weather snapshot, share, and budget schema with initial RLS.
- Kakao place search with a selected-versus-typed UI state; the server validates the provider's exact place host and upgrades Kakao's documented HTTP detail URL to HTTPS before returning it to the browser.
- Balanced, winding, and shortest route orchestration with server-enforced `car_type=7`, `avoid=motorway`, a computed-return duration below 24 hours, no passenger-car fallback, and provider waypoint/geometry continuity validation. The current correction pools validated `RECOMMEND` alternatives and conditionally one `TIME` alternatives request per chunk; it requires at least one more-curved distinct chunk before finalizing an estimated winding route.
- Custom winding waypoint editing and an honestly labelled `와인딩 추정` alternative when no custom winding point exists. If no honest provider alternative exists, the route stays incomplete and the UI asks the rider to add a custom winding waypoint.
- Safe provider-contract parsing and actual route geometry rendering; connected maps draw no point-to-point fallback line before calculation and use only validated Kakao Mobility road `vertexes` after success. Example and live states remain visibly distinct.
- Transactional plan persistence and ordered collection versioning begin in `20260830223000`. Migration `20260830224500` adds trusted Edge-only route staging, three distinct route-geometry finalization, verified-place collection persistence through `save-collection`, route-bound weather snapshot persistence and stale observation, immutable aggregate DML denial, narrow owner RPCs, a ten-minute single-use preview capability, snapshot-local waypoint IDs, and an explicit nested-field share allowlist. Both migrations are deployed to Preview only; Production remains unchanged.
- Migration `20260831213000_email_free_kakao_oidc.sql` adds the encrypted one-time OIDC handoff table and its two service-role-only atomic RPCs. It is verified in the disposable local database and deployed to Preview; Production remains unchanged.
- Public share bearer tokens are emitted as `/share#<token>`, copied to component-local memory, synchronously removed from browser history, and resolved by a fixed-path `POST /api/shares/resolve`, so the token is unavailable to later third-party map code and is not placed in the initial hosting request path. Resolution fails closed if history cleanup fails. The service worker bypasses `/share` and does not cache the shared page or resolver response.
- Invitation bearer tokens are emitted as `/invite#<token>`, removed from browser history, and accepted only by same-origin JSON `POST /api/invites/accept` before the HttpOnly OAuth claim cookie is set. Cross-site/non-JSON requests are rejected without a cookie; dynamic invitation token paths were removed and the service worker bypasses `/invite`.
- Provider calculation and transactional plan finalization share one synchronous UI lock. Candidate selection, recalculation, collection application, and sharing stay blocked through persistence; generation/trip identity and weather-request identity prevent late results from overwriting the current plan.
- Route ETA is connected to the weather request contract, with exact six-hour/five-day model boundaries, per-request deduplication, recent cache reuse, durable same-route snapshots, explicit stale fallback, full multi-day age and expiry display, and KMA grid conversion regression coverage. Hosted provider execution remains unverified.
- Vercel project runtime and deployment protection now match `OPS-004` and `OPS-005` by API readback.
- Unit/integration tests plus a one-worker headless Chromium Playwright layer for 320/390/820/1440 responsive, route, weather, collection/share, and authenticated Preview scenarios. CI now runs the same deterministic `npm run test:e2e`; the external login state stays outside the repository and bearer-producing live tests disable browser artifacts.
- Playwright local verification now runs a fresh keyless production server with zero retries and checks service-worker registration. Preview/auth/live commands accept only the fixed develop Preview origin plus the Preview Supabase project-bound private storage state; authenticated artifacts are disabled, and test-owned share, collection, and trip cleanup fails loudly.

### Incomplete

- Fixed-SHA review and Preview deployment of the priority-pool estimated-winding correction.
- Connected browser verification of invitation login and revoked-member denial; direct OIDC and first-admin bootstrap are complete.
- AUTH-003 migrations and sensitive RPC ACLs are live and independently approved; full OAuth and A/B/admin/revoked connected tests remain pending.
- Actual successful Kakao three-candidate route and KMA response smoke tests; the first real route attempt proved the explicit no-distinct-winding failure path. Preview Map/Local activation, map rendering, and place search are complete.
- Authenticated connected smoke testing for route ETA weather, collection CRUD/version/apply, and immutable share preview/publish/resolver/revoke/reissue.
- Resolving `OPS-008` for the Production Supabase region before real rider data is accepted.
- Hosted RLS/provider/browser/Preview tests and all Production tests. The full local fresh-migration, RLS/RPC, and concurrency suites are GREEN.
- A new reviewed `develop` Preview deployment and, only after a new `OPS-008` interview, a `main`-origin Production deployment. Runtime alignment, Preview variable isolation, and Preview-only deployment protection are configured and still require deployment-level smoke verification.

## Deprecated decisions

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
