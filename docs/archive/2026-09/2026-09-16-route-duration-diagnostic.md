# Route duration mismatch investigation — 2026-09-16

## Status and plan

### 0.2.3 correction follow-up

The user authorized investigation, correction, original-route verification and deployment after the completed 0.2.2 diagnostic release. The 0.2.2 Production commit is `cefb0857e9f1bdc875039fb98492ce67bd50045b`; its [release record](https://github.com/tocomboy/motocast/releases/tag/v0.2.2) contains deployed identifiers and verification. Both environments observed `SUMMARY_GT_SECTIONS_OVER_60S`; this proves the rejection predicate and direction/range, not the provider's forecasting model.

Plan for the compatible patch release `0.2.3`:

1. Reproduce the real provider-adapter/orchestration failure using a synthetic two-section response, preserving exact public failure and budget accounting; complete (characterization PASS, product failure remains).
2. Resolve the timing-source decision below, then implement a narrowly scoped correction with normal/error/boundary regression coverage; complete.
3. Verify the complete candidate, geometry/ETA/weather/persistence boundaries and original route on Preview; local verification complete, hosted verification pending.
4. Promote the verified candidate through normal develop-to-main gates, verify Production, and publish its exact matching tag/Release; pending.

History review found the exact summary/section time equality check introduced in `95e71136a387e1853a224c3fec79d4d9e282f9ec` with broad response-validation hardening. The current official future API documentation defines all duration fields in seconds, but does not promise equality or explain different forecasting semantics for the fields. A successful provider result does not alone prove all geometry/point checks, which remain mandatory. The application currently calculates each arrival, subsequent chunk departure, weather time and final return from section durations. Its browser and database validators require the internally published road/section/leg timing aggregates to agree; these internal consistency checks are separate from equality of independent upstream summary fields.

Timing decision: `CONFIRMED` by the user's “권장대로 진행하자”. Preserve the provider summary as each requested chunk's total and explicitly present proportionally allocated section arrivals as estimates. Allocate whole seconds by largest remainder with stable input-order ties, then allocate each section total among its original road-duration weights. Exact matching responses keep their timings. Noninteger/unsafe numeric inputs or sums and allocations leaving a zero-duration section are invalid; never inflate the provider total. Raw section/road consistency, distances, point order, road geometry and motorcycle policy stay validated. Published internal road/section/leg sums remain exact for browser and DB validation. Subsequent chunks, dwell, weather times and return use the same allocated timings. This is an approved application estimate, not a newly discovered guarantee about Kakao's per-section forecasts. The alternative of discarding summary time was not selected. Remove obsolete mismatch-only instrumentation as part of the correction. No schema/data rewrite is needed; no 0.2.3 hosted mutation has occurred yet.

The sole executor added `supabase/functions/_shared/route-duration-reproduction.test.ts` with synthetic A/B/C points, continuous roads, section times 300+420 seconds and summary 840 seconds. The actual adapter and orchestrator reject this with the observed public error and bounded context; provider, fetch and budget are each called once. In the secret-free WSL copy `/tmp/motocast-route-duration-repro-174e688`, `npm exec -- vitest run supabase/functions/_shared/route-duration-reproduction.test.ts` passed 1 file / 1 test, 0 skipped. This PASS confirms reproducibility of the existing defect, not successful route planning. Source and tested-copy SHA-256 matched `7506255bdea201ad51dfe60c14d89caf422f4c63dab72ff2095044d16cffdc3f`. Lead read the complete test and confirmed it reaches the production parsing/orchestration seam. Product source/version are unchanged; no commit/push/deploy has occurred for this follow-up.

Local DB baseline verification for the correction: Docker `supabase_db_motocast`, container `40265102dfb2e71ef2077886e9f50489527d8917450f9186503041d32c1395da`, image PostgreSQL `17.6.1.166`, repository workdir label and port `54322` verified. There were no other client sessions or colliding fixture users. Schema has eleven migrations through `20260902123000`; only the unrelated release-announcement migration is absent. No reset or schema change was performed. Existing `optional_meal_route.test.sql` passed 13 and `recommended_route_concurrency.test.sql` passed 49, with zero failed assertions/errors; fixture-user and helper readback both returned zero. The former rolls back, and the latter completes its exact test-owned cleanup. Evidence is in the operator temporary directory as `motocast023-optional-meal-db.log` and `motocast023-recommended-db.log`. The exact normalized candidate output still requires its own DB-validator check. One preliminary read-only inspection had a shell-quoting SQL syntax error before execution; the corrected stdin-based inspection passed, and no test was counted for that failed inspection.

### Final 0.2.3 local candidate

The actual adapter/orchestrator acceptance test first failed against the unchanged baseline (1 FAIL, `INVALID_ROUTE_PROVIDER_RESPONSE`), then passed with the approved correction. In `/tmp/motocast-route-allocation-023-174e688`, Node 20.20.0 / npm 10.8.2, the candidate passed npm ci (407 packages, zero reported vulnerabilities), lint, typecheck, Deno five entrypoints, full Vitest (66 files / 566 PASS), build, and deterministic Playwright (32 PASS / 2 existing connected-only SKIP). No dependency version changed. The two skipped connected scenarios are not live acceptance.

The real handler test reaches the actual adapter, normalizer and orchestrator; the synthetic summary 840 versus sections 300+420 stages legs 350+490 and returns HTTP 200. A malformed raw road total follows that same path and still returns 502 without staging. Allocation tests cover stable whole-second ties, zero road weights, unsafe values/sums, zero-section rejection, immutable inputs, and preserved exact timings; orchestration covers dwell and following-request departure. Rendered browser assertions cover the demo notice boundary and current/legacy shared estimate notice. Lead review resolved the original mocked-handler and source-string UI test gaps; no open correctness, security, data integrity or route-safety findings remain in this changed set.

The exact synthetic normalized response exported from the candidate has SHA-256 `d8e1e5a81b0f624500aaaeb2f61fd48004ecfa5baff35d569d2508ccc48758f9`. Read-only Preview database validation returned `is_valid_current_plan_stops=true` and `recommended_route_matches_plan=true`; changing only its total duration to 841 returned false. This proves the existing database accepts the allocated aggregate and retains its internal consistency guard. Together with the 62 existing local DB assertions above, this verifies the affected storage boundary without migration or user-data mutation. Live provider, weather and original-route success remain pending until Preview/Production execution. Broader unrelated full-product gates remain separate NOT_RUN.

### Earlier 0.2.2 diagnostic history

The following sections are historical diagnostic-release evidence; their unresolved status was the reason for the correction above.

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
