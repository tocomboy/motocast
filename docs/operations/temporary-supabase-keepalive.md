# Temporary Supabase Free keepalive — external operations repository

The user approved daily **04:00 Asia/Seoul** read-only activity on 2026-09-15 and subsequently selected a dedicated **private** repository so GitHub's public-repository 60-day inactivity rule does not disable the scheduler.

## Canonical owner

- Repository: [tocomboy/motocast-operations](https://github.com/tocomboy/motocast-operations)
- [Implementation, schedule and current run history](https://github.com/tocomboy/motocast-operations/actions/workflows/temporary-supabase-keepalive.yml)
- [Canonical lifecycle, configuration inventory and retirement procedure](https://github.com/tocomboy/motocast-operations/blob/main/docs/temporary-supabase-keepalive.md)

That private repository owns the checker, tests, CI, scheduled workflow, three enable variables and two dedicated publishable-key copies. This public product repository retains only this pointer and the OPS-006 decision amendment. No runnable keepalive workflow, key copy or test dependency is added here.

## Operating boundary

Each day the standalone job sends three anonymous read-only database RPC requests to Preview `lehjmbgfpoemqcwxowbx` and Production `obodvbyzptxeehgpcpkd`. The existing STABLE `is_active_member` function must return HTTP 200 / Boolean false without a user session. No user rows, authentication sessions, schema, Kakao/KMA budget or Vercel runtime setting is changed.

UTC 19:00 corresponds to next-day 04:00 KST. GitHub may delay or drop runs; Supabase does not publish a guaranteed minimum activity threshold. This mitigation neither guarantees uptime nor automatically resumes a paused project. A successful manual check does not prove that a future scheduled run happened.

## Mandatory removal on plan/environment changes

When an affected Supabase project moves to a plan without inactivity pauses, is replaced/deleted/moved, or changes the anonymous RPC contract, its operator must retire that target through the canonical procedure. The job has no billing-management permission and cannot detect such changes automatically. Retire the entire feature once neither target needs it.

The private repository provides global and per-target stop switches. Full retirement disables the workflow, checks active runs, removes only its code and named Actions variables/key copies, preserves the underlying app keys and all user data, and records RETIRED with the reason and final run/deletion PR. Keep this pointer, mark it retired, and update Notion. No database rollback or product deployment is needed to switch the job off.

## Evidence boundary

Prepared local candidate `258d721` contained the initial same-repository prototype. Its six safety tests, 528 product tests, lint/typecheck/Deno5/build passed; deterministic Chromium was 20 PASS / 2 connected-only SKIP. The approved private-repository implementation supersedes that prototype. Current private-repository CI, activation and run evidence live in the canonical record linked above; earlier preparation does not establish scheduler activation or remaining rider/new-invite/revoked-user product gates.
