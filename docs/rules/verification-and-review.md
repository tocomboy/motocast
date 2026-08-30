# MOTOCAST verification and review rules

This document extends, and never weakens, the global `/home/tocomboy/.codex/AGENTS.md` verification and review baseline. It is the single source of truth for MOTOCAST writer verification, independent review, finding closure, and deployment gates.

## 1. Evidence and result taxonomy

Never claim completion or GREEN without executed evidence on the exact changed set or fixed commit SHA. Record each command and scenario as one of:

- `PASS`
- `FAIL`
- `ERROR`
- `SKIP`
- `DESELECTED`
- `XFAIL`
- `SETUP_OR_IMPORT_FAILURE`
- `NOT_RUN`

A focused, mocked, docs-only, local, or shared-baseline result cannot be generalized to a broader gate. Do not weaken assertions or add skips/xfails to hide a failure.

## 2. Decision-to-change traceability

For each logical slice, record:

1. Applicable Decision IDs from `docs/product/MOTOCAST_SOT.md`.
2. Owned and changed files, schema objects, and external settings.
3. Expected normal, error, boundary, and state-transition behavior.
4. Commands and live scenarios executed.
5. Exact result counts and anything not run.

Any `NEEDS_INTERVIEW` decision blocks completion of its affected slice. It does not block independent safe work.

## 3. Writer verification

After each logical implementation unit:

1. Search the impact surface before editing and re-read changed files afterward.
2. Confirm the changed set contains no unrelated or user-owned changes.
3. Run `git diff --check`.
4. Run the narrow unit/integration tests appropriate to the slice.
5. Run the repository baseline before committing:

```bash
npm ci
npm run lint
npm run typecheck
npx --yes deno check supabase/functions/search-places/index.ts supabase/functions/plan-route/index.ts supabase/functions/weather-timeline/index.ts supabase/functions/save-collection/index.ts supabase/functions/kakao-oidc/index.ts
npm test
npm run build
git diff --check
```

Connected Supabase checks use explicit files so a restricted linked test role is not mistaken for a full fixture-capable environment:

```bash
npx --yes supabase@2.116.0 test db --linked supabase/tests/database/live_acl_readback.test.sql
```

`auth_rls_budget.test.sql` creates rollback-only `auth.users` fixtures and must run against a local disposable Supabase database or another explicitly disposable fixture-capable database. A linked role that cannot write `auth.users` is `SETUP/IMPORT FAILURE`, not a product assertion failure and not broad RLS GREEN.

The full local database boundary uses the repository `supabase/config.toml` and explicit suites:

```bash
npx --yes supabase@2.116.0 start --exclude gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
npx --yes supabase@2.116.0 test db --local supabase/tests/database/auth_rls_budget.test.sql supabase/tests/database/live_acl_readback.test.sql supabase/tests/database/plan_collection_share.test.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/database/collection_version_concurrency.test.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/database/invite_budget_concurrency.test.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/database/route_finalization_concurrency.test.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/database/kakao_oidc_handoff.test.sql
```

Before a fresh migration proof, confirm that the target is exactly the disposable local database at `127.0.0.1:54322` and obtain explicit approval for its reset. A reset of either hosted project is prohibited by this workflow.

The two-connection collection, invitation/budget, route-finalization, and OIDC-handoff suites require the disposable local `supabase_admin` role because PostgreSQL restricts `dblink` credential forwarding for non-superusers. The tests install `dblink` only in the `extensions` schema so it cannot pollute the public service-role function allowlist. They must never target a hosted project. Record them separately from the rollback-only RLS/RPC suite.

6. Scan staged and tracked changes for secrets, invitation/share tokens, real rider locations, and schedules without printing secret values.
7. Record `NOT_RUN` checks and the exact blocker.

Additional required suites by boundary:

- Auth/RLS: administrator, Rider A, Rider B, revoked member, authenticated non-member, anonymous; service-role direct DML denial on every application table, exact seven-function service-role allowlist, and migration-role future-table/function default-ACL probes. Kakao OIDC additionally proves no `account_email` scope, exact allowlisted return target, signed state, hashed nonce, app-origin HttpOnly browser binding, encrypted single-use handoff, replay/concurrency and foreign-browser denial before session/invitation mutation, advancing-clock expiry, both RPCs' complete role matrix, handoff-table RLS, nonce/access-token propagation, full-attribute binding-cookie cleanup, and one non-aborted completion request across React Strict Mode effect replay. Every verified provider/configuration/exchange/persistence failure returns to the HMAC-authenticated initiating origin, including when it is not the first allowed origin and when provider credentials disappear after start; state-secret/allowlist recovery is independent of provider credentials. An unauthenticated return origin is never guessed. Execute the injected production callback handler for provider denial, missing provider credentials, exchange failure, persistence failure, and unauthenticated failure. Render the actual callback component under Strict Mode and prove completion fetch `1`, abort `0`, and late redirect `0` after navigation or unmount. A delayed client must not claim server cancellation after mutation starts, and a late response cannot redirect or update a callback screen after it detaches.
- Invitations: create, invalid, expiry, revoke, same-origin JSON acceptance, cross-site/non-JSON denial without cookie, same-user idempotency, distinct-user concurrency.
- Sharing: preview, publish, immutable source edit, revoke, reissue, unknown/revoked token, cross-user management denial, and previously emitted schemaVersion 1 fixture compatibility.
- Budget: missing, zero, below limit, exact limit, exhausted, concurrent calls, Seoul date rollover, provider failure decision.
- Routes: provider request interception on current/future/split calls, documented no-route result classification versus malformed/unknown provider responses, winding-only zero-dwell pass-through validation, required-stop preservation, waypoint boundaries, hard-return filtering, distinct candidate identity, no passenger-car fallback.
- Weather: six-hour and five-day exact boundaries, grid conversion, cache deduplication and exact cache response shape, structured provider/budget/configuration/persistence/request failure kinds, malformed provider JSON, complete-or-empty stale DB metadata, snapshot success/failure/stale/no-snapshot, independently advancing multi-day age and simultaneous failure/expiry display.
- Browser/PWA: mobile and desktop, keyboard/focus/labels, loading/error/stale/live, manifest/service worker update.

## 4. Commit and fixed-SHA review boundary

Independent review is performed against a fixed commit SHA, not a moving branch name. Before review:

1. Writer verification is recorded.
2. The lead reads the exact committed changed set.
3. The commit contains no user-owned `.gitignore` or unrelated changes unless explicitly included and reviewed.
4. The lead provides a compact review capsule with Decision IDs, invariants, file scope, acceptance criteria, and verification evidence.

## 5. Independent reviewer separation

Use a read-only reviewer subagent for non-trivial multi-file work and every high-risk change involving authentication, authorization, RLS, tokens, migrations, transactions, concurrency, budgets, route safety, secret boundaries, GitHub protection, or Production settings.

- Explicitly set `fork_turns="none"` by default.
- The reviewer reads repository files and the fixed SHA directly.
- The reviewer does not edit, commit, push, deploy, or mutate external settings.
- The writer never reviews their own work as the independent approval.
- The lead owns canonical decisions, conflict resolution, final verification, and user reporting.

Required review axes:

- Correctness: normal/error/boundary/state transitions, regressions, no success-masking fallback.
- Security: Auth, RLS bypass, token handling, cross-user access, XSS/SQL injection, validation, secret/error exposure.
- Data integrity: migrations, foreign keys/delete rules, transactions, concurrency, atomic budgets, rowcount/write drops, time precision.
- Route safety: `car_type=7`, `avoid=motorway`, every split/future call, no passenger-car fallback, hard-return exclusion.
- Operations: develop/Preview and main/Production lineage, environment ownership, checks, quotas, outage readability.
- UI/accessibility: responsive layout, keyboard/focus/labels, safe errors, loading/error/stale, non-color cues, demo/live distinction.

## 6. Findings and closure

Each finding contains:

- Severity: `BLOCKER`, `HIGH`, `MEDIUM`, or `LOW`.
- Exact file and location or external setting.
- Violated Decision ID or invariant.
- Reproducible failure scenario.
- User/security/data/operations impact.
- Minimum correction direction.

Unsupported style preferences are not findings.

Rules:

- Any `BLOCKER` or `HIGH` stops merge and Production deployment.
- A `MEDIUM` is fixed now or receives an explicit recorded follow-up decision.
- A `LOW` may remain but is disclosed.
- The writer fixes findings and reruns affected plus baseline verification.
- A reviewer evaluates the new fixed SHA and labels each finding `RESOLVED`, `STILL_OPEN`, or `REGRESSED`.
- If the same root cause survives two correction rounds, reconsider the design, narrow the scope, or interview the user instead of expanding tests indefinitely.

## 7. Preview gate

For the exact `develop` SHA:

- Vercel deployment is `Ready` and identified as Preview from `develop`.
- Build has no errors; HTTP/security headers are verified.
- Preview uses non-Production test identities/data and does not expose Production-only secrets.
- Test invite and Kakao redirect/callback, admin/rider/revoked access, place search, all three candidates, ETA/weather, collections, share publish/revoke, provider error, exhausted budget, stale snapshot, mobile/desktop, and runtime logs.
- Record any protected-access mechanism without exposing bypass tokens.

Preview is not GREEN merely because the Vercel build status is Ready.

## 8. Main PR gate

A same-repository `develop -> main` PR may merge only when:

- No in-scope `NEEDS_INTERVIEW` remains.
- Changed set and fixed SHA are recorded.
- Writer verification is GREEN with exact taxonomy.
- Required independent correctness and specialist reviews are complete.
- `BLOCKER=0` and `HIGH=0`.
- GitHub `verify` and `develop-only` are GREEN.
- The actual Vercel Preview context is stable and GREEN.
- Preview smoke and secret scans are GREEN.
- Product SoT, verification rules, README, schema, and operations are synchronized.

Add the exact Vercel status context to main protection only after it is observed reliably on a real main-target promotion PR. Never pre-register an absent or unstable context.

## 9. Production gate

After main merge, separately verify:

- Production deploys the main merge SHA and matches GitHub Deployment metadata.
- Vercel reports `Ready`; Production URL and security headers respond as intended.
- Vercel Deployment Protection matches `OPS-005`.
- A test invitation and Kakao login complete end-to-end.
- Admin/rider/revoked authorization, a minimal real route/weather plan, save/collection/share/revoke, and budget hard stop pass.
- Runtime logs contain no unexpected error or secret.
- Vercel and Supabase environment-name ownership matches `OPS-002`/`OPS-004`.
- GitHub protection/default branch, local/remote branches, and worktree are read back.

Local or Preview success never substitutes for a failed or untested Production gate. Rollback requires an exact target, user/data impact, recovery plan, and required approval.

## 10. Release evidence record

The final release report includes:

- Product completion status and remaining blockers.
- Decision IDs and interview outcomes, including deprecated decisions.
- Fixed SHA, PR, CI runs, Vercel deployment ID/URL, and Supabase migration/function readback.
- Writer and independent review results by axis.
- Exact counts for pass/fail/error/skip/deselected/xfail/setup-or-import-failure/not-run.
- Remaining findings and operational next actions.

The Goal is complete only after the Production gate succeeds for an invited rider and the live systems match the product SoT.
