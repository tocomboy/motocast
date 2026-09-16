# Route duration mismatch investigation — 2026-09-16

## Status and plan

1. Identify the failing Production validation branch and compare deployed code: complete.
2. Prepare bounded diagnostics without changing response acceptance: complete locally.
3. Review and validate the local candidate: complete. The user explicitly authorized PR and deployment after reviewing the diagnostic scope; prepare the final 0.2.2 release candidate and verify it before publication.
4. Observe the actual signed difference and reproduce the original provider behavior before choosing a correction: pending.

The reported route-planning failure remains unresolved. This candidate is diagnostic instrumentation, not a route correctness fix. No new Goal is created.

## Authorized diagnostic release

The user subsequently supplied the original requested departure time privately and explicitly requested deployment. Release version `0.2.2` is selected before final-candidate verification. The release adds bounded server diagnostics and honest Korean update notes; it does not claim route acceptance has been fixed. Existing fail-closed behavior is an acknowledged condition of this diagnostic deployment. The full-product route incident and unrelated remaining live gates are not converted to passes.

Delivery order: fixed candidate review and exact-head CI-only PR → zero-deployment readback → Preview plan-route deployment → same-SHA develop Web release and Preview smoke → develop-to-main PR → Production plan-route/Web verification → matching tag and GitHub Release. No DB migration or data rewrite is required. For recovery, retain the previous plan-route source artifact in memory; if rollback becomes necessary, review and restore that exact previously verified JWT-enabled function without changing stored data. Source and diagnostic readback must establish environment and function identity on each target.

## Current evidence

- Repository: `https://github.com/tocomboy/motocast`; clean `develop` baseline `a7d5ef0a1507a99d4c466ff36446bb53a857eb6e`, refreshed from origin.
- Production Web GitHub Deployment `6474403889`: `success`, main `5b4dd9248921f234a50e5f42b302215075379453`. Direct Vercel details were not verified by its connector (team listing returned no teams).
- Production Supabase project `obodvbyzptxeehgpcpkd` is `ACTIVE_HEALTHY`; `plan-route` v9 is `ACTIVE`, JWT verification enabled, artifact `ee0f0c346f1fd3905f78176943e6a9369df9ea4ff243a0316f1eaf0789389712`.
- The deployed `plan-route/index.ts`, `kakao-provider.ts`, `kakao-route.ts`, and `route-orchestration.ts` match the baseline after newline/trailing-newline normalization.
- Authenticated dashboard readback showed two failures at 17:42:10 and 17:42:22 KST: `plan-route failed ROUTE_RESPONSE_INVALID ROUTE_DURATION_TOTAL FUTURE_P0_P2_DESTINATION`.
- This branch proves that the parsed summary duration differs from the sum of normalized section durations. Earlier parsing and section-total checks have passed. Later requested-point and cross-section geometry checks have not necessarily run; the log does not prove the complete route is safe.
- The raw provider response and exact difference were not captured. The user supplied the requested departure time in the conversation; the place sequence and private schedule are deliberately not copied to this record.
- Existing focused tests: `npx vitest run supabase/functions/_shared/kakao-route.test.ts supabase/functions/_shared/kakao-provider.test.ts supabase/functions/_shared/route-orchestration.test.ts lib/planner/route-failure.test.ts` — 4 files / 87 PASS. These exercise existing contracts and rejection classification; they do not reproduce the original live payload or establish a fix.

## Hypotheses and source boundary

Possible causes to distinguish are small integer rounding differences, different future-route aggregation semantics when waypoints are present, and an inconsistent provider response. None is established by the current log.

The [official Kakao future-directions contract](https://developers.kakaomobility.com/guide/navi-api/future) describes summary, section and road duration fields in seconds. The consulted documentation supplies no tolerance that would justify accepting this particular mismatch. Do not assume a one-second difference or delete/weaken the sum guard without evidence.

## Diagnostic slice

Applicable decisions: `SCOPE-002`, `ROUTE-001`, `ROUTE-004`, `ROUTE-006`, `COST-001/002`.

Include only a closed signed-difference label on an already-rejected `ROUTE_DURATION_TOTAL` error, its propagation through chunk context, safe server logging, and regression checks. Categories distinguish summary greater/less than sections, 1–6 seconds individually, 7–60 seconds, and over 60 seconds. Unsafe numeric values and unrecognized/foreign diagnostics produce `UNKNOWN`.

Exclude changes to acceptance predicates/order, route safety, budgets/call counts, public HTTP status/body, persistence, schema, credentials, UI, version/release files and hosted configuration. Do not log full durations, coordinates, place names, departure times, provider messages, payloads or URLs. No raw captured route is stored in tracked fixtures.

Completion for this slice requires candidate tests and lead review, a precise changed set, and explicit separation from live correction. Publishing, Preview/Production deployment, and original-case success remain `NOT_RUN` until authorized and executed through repository gates. Removal of this bounded instrumentation after resolving the cause should be included in the eventual fix review.

## Local candidate verification

The sole Sol/medium executor changed six code/test files: `_shared/kakao-route.ts` and its test, `_shared/route-orchestration.ts` and its test, and `plan-route/index.ts` and its test. The lead owns this evidence document. No product version, dependency lockfile, schema, configuration or UI change is included.

WSL Node `v20.20.0` / npm `10.8.2`:

- `npm ci`: PASS, 407 packages, 0 reported vulnerabilities, unchanged lockfile. The existing Node runtime was reused; repository-local dependencies and a temporary isolated copy's dependencies were installed.
- Focused Vitest (Kakao route/provider, orchestration, HTTP, planner route-failure and plan-route handler): 6 files / 130 PASS.
- `npm run lint`, `npm run typecheck`: PASS.
- `npx --yes deno check` for search-places, plan-route, weather-timeline, save-collection and kakao-oidc: 5 entries PASS.
- `npm test`: 64 files / 571 PASS.
- `npm run build`: PASS.
- `npm run test:e2e` in keyless, repository-external `/tmp/motocast-route-duration-a7d5ef0`: 32 PASS / 2 SKIP (existing connected-only tests). These skips are not passes or connected acceptance.
- `git diff --check`: PASS; secret-value pattern matches: 0.
- Lead review of the exact runtime/test diff: no unresolved findings in diagnostic correctness, secret redaction, unchanged acceptance/budget/persistence, or contextual propagation. The future request with an intermediate waypoint is covered as `FUTURE_P0_P2_DESTINATION`.
- Independent lead readback confirms the six source/test file SHA-256 values equal the corresponding files in the tested isolated candidate (6/6 matches).

Initial environment attempts remain separate: PowerShell expanded the WSL PATH expression before bash (`ERROR`, 0 tests); Windows node_modules lacked the Linux rolldown binding (`SETUP_OR_IMPORT_FAILURE`, 0 tests); PowerShell expanded a temporary tar target variable before WSL (`ERROR`, 0 E2E tests). Corrected shell invocation and lockfile installation resolved these without changing application logic or assertions.

At the end of initial local preparation, actual provider-payload reproduction, hosted Preview/Production tests, DB suites, commit, push, PR and deployment were `NOT_RUN`. The diagnostic candidate does not itself resolve the reported Production failure or establish the magnitude/cause of the mismatch.

## Final 0.2.2 candidate

The authorized release additionally updates package.json, the two package-lock root version fields, lib/releases.ts and the existing updates browser test. Dependency versions are unchanged; published release history is preserved. README, product and operations documents link to this evidence without changing product decisions.

The final isolated candidate `/tmp/motocast-route-duration-022-a7d5ef0` passed `npm ci` (407 packages, 0 reported vulnerabilities), lint, typecheck, Deno 5 entrypoints, full Vitest (64 files / 571 PASS), production build, and deterministic Playwright (32 PASS / 2 existing connected-only SKIP). Logs are retained as `evidence-{npm-ci,lint,typecheck,deno,test,playwright-install,e2e,build}.log` in that directory. Source-to-tested-copy file hashes matched. Markdown-only evidence updates after those checks do not change the runtime candidate.

Lead review found no unresolved diagnostic-slice findings: parser acceptance and ordering, motorcycle restrictions, budget reservation and call counts, public failure responses, authentication, persistence and data ownership are preserved. The known provider-duration incident remains open and explicitly separate from release verification. No DB migration or destructive operation is in scope.
