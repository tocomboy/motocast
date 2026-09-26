# Node.js 24 runtime migration

## Contract and scope

- User request: investigate and resolve the Node.js warning seen in Vercel.
- Decision: OPS-004; replace the Node.js 20 baseline with supported 24.x.
- Cause: Vercel project and package/CI consistently use 20, but the dashboard warns that it is end of life and new builds are disabled on 2026-10-01. This is a deprecation warning, not evidence of an existing failed deployment.
- Source: https://vercel.com/changelog/node-js-20-is-being-deprecated
- Base: origin/develop `6826174c7ecf30192d631fa6714842744f5ea573`, current deployed web 0.4.2.
- Isolated worktree: `node24-runtime`; CI-only branch `review-node24-runtime`. Preserve the original dirty checkout and pending Play-membership PR #75 and journey-weather PR #74.
- Included: package engine, lockfile root engine, local version file, CI version selection, build version output, current runtime documentation and Vercel Node setting.
- Excluded: product dependency updates, signup UI, Android artifacts, database/Edge mutations and Production release. Infrastructure-only change keeps product version 0.4.2.

## Plan

1. DONE: inspect warning, live setting, repository pins and official deprecation notice.
2. DONE: migrate to 24.x and run dependency installation, lint, types, Deno, unit tests, Chromium and production build.
3. IN_PROGRESS: publish exact-SHA CI-only PR and verify no premature deployment.
4. PENDING: align Vercel setting, promote verified SHA to Preview and read back build version and HTTP/auth boundary.

## Acceptance and recovery

- Package engine and root lockfile engine must match 24.x; CI reads `.nvmrc` = 24. Build output prints the actual runtime.
- No dependency resolution changes; no new test skips or assertion changes.
- Preserve fixed tester-origin protection exception and all application access checks.
- No secret values, cookies, real share URLs or user locations in evidence.
- Rollback, if required, targets the previous web deployment (already-built Node 20 deployment remains available); no database/schema changes are involved. Do not treat a future Node 20 rebuild as viable after 2026-10-01. Production retains its existing deployment.
- Local/CI checks do not establish full connected provider, user-account, Android or Production acceptance.

## Evidence

- Initial readback: Vercel setting 20.x with EOL warning; latest Preview and Production deployments remain the 2026-09-21 releases.
- Available local runtime: Node v24.12.0 / npm 11.6.2, existing system installation. No new global runtime installation.
- Local validation: `npm ci` PASS (401 packages, zero reported vulnerabilities); lint/typecheck PASS; Deno five existing entrypoints PASS; Vitest 648 PASS / 0 FAIL / 0 SKIP; production-mode Chromium 49 PASS / 2 existing connected-only SKIP / 0 FAIL; separate `npm run build` PASS with actual v24.12.0 output. No application assertion or dependency version changed.
- npm reports an existing ESLint 9 deprecation; that independent dependency upgrade is outside the Node runtime fix and does not fail these checks.
- Existing Node 24.12.0, npm 11.6.2, Deno and Chromium installations reused. No new system runtime installed.
- Owned temporary resource: this managed worktree's dependencies/build outputs and `node24-*.log`, created 2026-09-26 for runtime verification. Free C: space was about 98 GiB after dependency installation; expected worktree growth under 2 GiB. Preserve evidence through deployment; regenerable successful outputs may be reviewed for cleanup after 48 hours, never while this checkout is in use.
- Connected account/provider mutation checks and Production redeployment: NOT_RUN; this slice changes no app, SQL or Edge logic. Android validation is unaffected.
- Vercel/CI outcome and deployment readback: pending exact-SHA verification.
