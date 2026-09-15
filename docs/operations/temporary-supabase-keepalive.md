# Temporary Supabase Free keepalive

## Purpose and lifecycle

- Owner: MOTOCAST maintainer.
- User decision: 2026-09-15, run daily at **04:00 Asia/Seoul** and remove when a plan upgrade or environment change makes it unnecessary.
- Lifecycle: **PREPARED**; activation and exact run evidence are recorded below and in the linked release PR/Notion operations record.
- This is removable operations infrastructure, not part of route, weather, login, or collection features.
- It reduces inactivity-pause risk; it does not guarantee uptime or automatically resume a paused project. Supabase does not publish a guaranteed minimum activity threshold.

## Design and scope

GitHub Actions runs `.github/workflows/temporary-supabase-keepalive.yml` from its repository's default branch. UTC 19:00 is next-day 04:00 in Korea. GitHub can delay or drop scheduled runs under load; this is a target time, not a precise execution SLA. No local PC or Codex session must remain running.

Live discovery: `tocomboy/motocast` is **public**, and GitHub automatically disables public-repository scheduled workflows after 60 days without repository activity. The user is choosing between a dedicated private `tocomboy/motocast-operations` scheduler repository (recommended for prolonged inactivity) and accepting that limitation in the existing public repository. Scheduler activation is pending that choice; do not assume a public repository provides indefinite scheduled execution.

| Target | Fixed Supabase project | Daily work |
| --- | --- | --- |
| Preview | `lehjmbgfpoemqcwxowbx` | 3 read-only database RPC requests |
| Production | `obodvbyzptxeehgpcpkd` | 3 read-only database RPC requests |

The checker calls existing `POST /rest/v1/rpc/is_active_member` with `{}` and that project's publishable key. POST invokes the existing STABLE SQL function; it does not write a row. Without a user session the expected result is HTTP 200 with JSON `false`. This proves an anonymous request reached database execution while retaining anonymous membership denial. It does not establish authenticated user access, a full database health check, or that Supabase's unpublished inactivity classifier must count the call.

Only these two fixed HTTPS targets are supported. Requests reject redirects, use a 15-second timeout and bounded response reads, and require the exact Boolean result. A target failure stops further calls to it, records a safe error, still checks the other enabled target, and fails the run. Three successful calls are the daily activity batch, not failure retries.

No new Supabase schema, credentials, sessions, users, application data, provider requests, Vercel API route, Vercel cron, or local Codex automation is required. The daily task does not change Kakao/KMA budgets. Vercel functions normally restart on requests and do not need a separate keepalive. Existing Vercel server-secret ownership rules remain intact.

## Isolated configuration inventory

Repository **Actions variables** (literal `true` / `false`):

- `MOTOCAST_TEMP_KEEPALIVE_ENABLED`: global run switch. Missing or non-true prevents the job from running.
- `MOTOCAST_TEMP_KEEPALIVE_PREVIEW_ENABLED`: Preview target switch.
- `MOTOCAST_TEMP_KEEPALIVE_PRODUCTION_ENABLED`: Production target switch.

Repository **Actions secrets**:

- `MOTOCAST_TEMP_KEEPALIVE_PREVIEW_PUBLISHABLE_KEY`
- `MOTOCAST_TEMP_KEEPALIVE_PRODUCTION_PUBLISHABLE_KEY`

These are copies of the existing public client keys, stored as Actions secrets for log hygiene. Never substitute a management token, service-role key, secret API key, provider credential, or rider session. Missing/invalid keys or target-switch values fail the enabled job. A target deliberately set to `false` records `SKIP disabled` and sends no request. Global disable is an intentional workflow skip, not a health PASS.

Code and verification dependencies:

- `.github/workflows/temporary-supabase-keepalive.yml`
- `scripts/temporary_keepalive/check.py`
- `scripts/temporary_keepalive/test_check.py`
- One named temporary-keepalive unit-test step in `.github/workflows/ci.yml`
- This runbook and its links from `MOTOCAST_SOT.md` / `preview-production.md`

## Activation and verification plan

1. Review the fixed commit, run unit/security failure tests and repository baseline, and complete the non-deploying review PR's exact-head CI/zero-deployment gate.
2. Configure the two publishable key copies and target switches; keep global execution off until the reviewed workflow reaches `develop`.
3. Fast-forward `develop` to the verified commit, confirm the default-branch workflow, enable the global switch, and manually dispatch the same job. Require Preview PASS reads=3 and Production PASS reads=3, no write/provider path, and safe logs.
4. Complete normal develop-to-main promotion and deployment readback. This operations-only slice does not replace the remaining rider/new-invite/revoked-user product gates.
5. Record workflow/run URLs and current switches. The first manual success proves execution now; the first automatic 04:00 run remains unobserved until it actually occurs.

## Failure observation

Check the workflow's Actions history and its nonzero job result. GitHub's existing workflow-notification settings control notifications; this change does not add an email, messaging integration, or promise delivery to an unconfigured channel. Investigate a missing daily run or Supabase inactivity warning. Do not increase the request rate, enable paid services, bypass authorization, or automatically resume/recreate a project as a failure fallback.

## Removal triggers

Retire the affected target when its organization upgrades to a plan without inactivity pauses, the project is replaced/deleted/moved, its public API or anonymous RPC contract changes, or the user no longer needs it. Do not silently point old configuration at a new project. Retire the whole feature once neither original Free target needs it. Vercel plan changes alone do not remove Supabase Free pausing; reassess the actual two targets.

This checker intentionally has no billing-management credential and cannot detect plan changes itself. The person performing the plan/environment change must execute the following retirement steps as part of that change.

## Disable and delete

1. **Immediate global stop:** set `MOTOCAST_TEMP_KEEPALIVE_ENABLED=false`, then disable `temporary-supabase-keepalive.yml` in GitHub Actions. Inspect in-progress runs; disable prevents future starts but does not cancel a running job. Allow its bounded read-only requests to finish or cancel that exact run.
2. **Only one target retired:** set its `..._ENABLED=false`, remove only its dedicated `..._PUBLISHABLE_KEY` Actions secret, and manually verify that target is SKIP while the retained target passes. Remove its mapping/config in the normal reviewed cleanup change. Do not revoke the underlying Supabase publishable key used by the app.
3. **Full removal:** through the normal review/develop/main flow delete the standalone workflow and `scripts/temporary_keepalive/` files, remove only their named CI test step, and delete all three `MOTOCAST_TEMP_KEEPALIVE_*_ENABLED` variables plus the two dedicated Actions secret copies. Keep unrelated workflows, keys, variables and deployment settings.
4. Keep this document as a **RETIRED** record with the date/reason, deletion PR, removed configuration names, and last run ID. Update its SoT/runbook links to show retirement. No database DROP, row deletion, or schema rollback is needed because the feature added no database objects or data.
5. Read back workflow disabled/absent and configuration copies absent; verify no active keepalive run remains. Run normal application checks appropriate to the cleanup and verify normal application connectivity.

## Evidence

- 2026-09-15 preflight: both fixed project publishable keys completed the actual anonymous RPC with HTTP 200 / JSON false. No user data was fetched or changed.
- Implementation prepared separately from product runtime. Local unit safety checks: 6 PASS, including a real loopback redirect chain with zero destination requests. Existing product Vitest: 59 files / 528 PASS; dependency installation (407 packages), lint, typecheck, five Deno entrypoint checks, Next.js build, Python AST and both workflow YAML parses PASS. Deterministic Playwright: 20 PASS / 2 connected-only SKIP. These two skips do not claim connected user validation. Existing Node20.20.0, Python3.10.12 and Chromium were reused; no new tool installation.
- Harness-only errors retained: the first unittest command lost its pattern argument during shell quoting, the first npm command expanded PATH in the wrong shell before npm started, and Ruby was unavailable for a proposed YAML check. Corrected unittest/npm commands and installed js-yaml parsing passed; none was a product test failure.
- Scheduler repository decision pending: the existing public repository has the 60-day inactivity-disable constraint. No scheduler, Actions variable, key copy, repository, or paid service has been created/enabled yet. CI publication/manual scheduled-job/deployment: NOT_RUN pending the repository choice. Local prepared candidate retains the existing-repository workflow guard until that choice is made; a private-repository choice requires updating the exact repository/ref and ownership inventory before activation.

## Official references

- [Supabase Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing): low activity over seven days; a few daily database requests are typically enough, without a guaranteed threshold; paid plans are not auto-paused for inactivity.
- [GitHub scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule): UTC/default-branch scheduling and possible delay/dropped runs.
- [Vercel Functions](https://vercel.com/docs/functions): function instances scale down without traffic and run on incoming requests.
