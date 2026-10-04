# Mobile invitation controls — v0.2.1

## Scope and decisions

The user reported that invitation creation was inaccessible on mobile and authorized correction and deployment. The final header label remains `초대 관리`. The creation action inside the administrator page uses `초대 링크 생성`; its seven-day invitation contract is unchanged.

Applicable decisions: `SCOPE-001`, `AUTH-001`, `AUTH-002`, and the versioning/release-note rule. This slice changes responsive presentation, the creation label, and patch-release metadata. It does not change membership checks, invitation RPCs, token transport, migrations, provider calls, dependencies, CI, or deployment protection.

## Root cause and correction

The `max-width: 820px` rule hid every `.ghost-button`. Its two production uses are the planner's invitation navigation and the generated invitation's copy button. A Chromium probe using the actual stylesheet found both affected styles hidden at 320, 390, and 820 pixels and visible at 821 and 1440 pixels. The authenticated Preview page independently reproduced the hidden navigation at an actual 390-by-844 viewport; Preview and Production administrator pages were reachable directly.

Remove the shared button-hiding rule while retaining the compact heading rule. At 520 pixels and below, place header actions on their own wrapping row and allow administrator navigation to wrap. Render the actual invitation view in the responsive regression suite, and exercise creation and copy through the stateful manager with a synthetic RPC/clipboard boundary.

## Plan and acceptance

1. Implement the presentation correction and v0.2.1 notes; validate the required local baseline.
2. Review the fixed commit and publish a CI-only `review-* -> develop` PR. Confirm exact-SHA CI and zero deployments before promotion.
3. Promote the same candidate to develop, verify Preview at mobile and desktop widths, and merge a same-repository `develop -> main` PR after required checks.
4. Verify Production deployment identity, version, authenticated invitation navigation, creation label, release announcement, headers, and logs; publish the patch tag and release.

Acceptance requires visible, unclipped invitation navigation and creation/copy controls at 320, 390, 820, and 1440 pixels, no overlapping mobile controls, and controls at least 44 pixels high. Existing planner and update-announcement regressions remain required.

## Validation and release evidence

Final local baseline passed in the environment-file-free `/tmp/motocast-invite-validation-20260916` candidate with Node.js 20.20.0:

- `npm ci`: PASS, 408 packages and zero reported vulnerabilities.
- `npm run lint`, `npm run typecheck`, and `npm run build`: PASS.
- Deno checks of all five existing Edge entrypoints: PASS 5/5.
- `npm test`: PASS, 64 files / 547 tests.
- Chromium installation: PASS.
- `npm run test:e2e`: PASS 32 / SKIP 2 / FAIL 0. The two existing connected-only scenarios are excluded by the keyless local mode and are not counted as passes.
- `git diff --check` and candidate secret-pattern scan: PASS.

No deployment is claimed by this pre-publication record. Exact fixed SHA, PRs, deployment IDs, and hosted readback are recorded in the release PR and the existing Notion project record.

The targeted production-component browser proof passed eight scenarios across the four required widths. A Vitest subprocess renders the production components so Playwright's component-serialization JSX transform cannot replace the actual rendered controls. The temporary markup contains synthetic invitation data only and is removed by exact file/directory cleanup.

Initial Windows validation encountered stale generated Next.js type references (resolved after a successful build), and the local browser server could not bind its required port. These are retained as preparation failures; the final baseline runs in a separate, environment-file-free WSL directory with Node.js 20.20.0. Neither a no-server focused browser pass nor the preparation failures replace that baseline.

Two initial fixture lint findings and a Playwright JSON-import collection error were corrected before the final baseline. The browser test reads package metadata through Node's filesystem API, and JSX production rendering runs in Vitest instead of Playwright's serialized component transform.

Lead review covers correctness and UI/accessibility directly. Invitation state/RPC/copy callbacks retain their existing behavior; the view extraction provides an actual-component test boundary. Security, data integrity, and route safety contracts are unchanged. Operations review verifies the existing GitHub/Vercel repository binding, main-only Production branch, Preview-only Vercel authentication, and enforced main PR checks. No unresolved blocker or high-severity finding has been identified; final fixed-commit review remains required before publication.

Database implementation and suites are unchanged from v0.2.0; its recorded ownership/concurrency evidence remains applicable to those unchanged contracts. No administrative hosted DB writes, resets, or migrations are part of this correction. Visiting the new release may create the existing per-member announcement receipt through the normal application path.

The connected first-invitation signup, separate-rider, revoked-member, and broader product-acceptance gates remain separate from this UI release. A synthetic creation/copy test is not a live invitation signup result.

Recovery uses a new develop-to-main promotion of the previously verified UI if needed, while preserving user and announcement data. No database reversal is required.
