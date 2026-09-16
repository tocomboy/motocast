# Shared ride summary and owned course copy

## Scope and authorization

The user authorized implementation, PR merge and deployment after confirming that a received share opens the riding summary and can be saved as the recipient's own course. Support starts with newly issued links after this update. On 2026-09-17 the user explicitly confirmed deletion of **all users' existing shared links, saved courses and riding records**, after backup. Accounts and membership permissions remain unchanged. Deletion has not yet run; the operator must pin the old-record set, verify its backup and recovery, and avoid deleting records created after that cutoff.

The user subsequently explicitly requested “화면 개편을 앱으로 옮겨” on 2026-09-17. Scope now includes the full approved mobile/desktop Figma redesign in addition to shared-course copy. Existing account/membership data and unrelated work are preserved. Hosted retirement and deployment remain pending until the expanded candidate passes verification.

## Plan and current status

1. Inspect current product and Figma: COMPLETE. SharedRideSnapshotView already renders the public route/weather summary directly. Recipient save is absent. Published public snapshots omit verification proofs and cannot safely be submitted as verified collections.
2. Update mobile and desktop Figma: COMPLETE. Existing received-share frame IDs render the summary with direct save and new-schedule actions. Ten stored-reaction state checks passed across both layouts: summary destination, original date/time display, save-popup destination, date-free course save and fresh-schedule reset. Cancel now returns to the actual preceding screen. This is prototype verification, not hosted app evidence.
3. Implement and validate the fixed design: COMPLETE for the reviewed local candidate. Final results: Vitest 590 PASS, Chromium 33 PASS / 2 hosted-only SKIP, frozen database 447 PASS, operator unit 8 and real-SQL 9 PASS. Lead review BLOCKER/HIGH/MEDIUM/LOW all zero; exact evidence and source hashes are in the app-redesign record. Hosted gates remain separate.
4. Publish CI-only review PR, verify exact-head CI and zero deployments, apply additive Preview migration/function changes, release exact develop SHA and verify Preview: NOT_RUN.
5. Apply compatible Production backend changes, merge develop-to-main PR, verify Production deployment and publish matching tag/release: NOT_RUN.
6. Back up and delete the confirmed all-user old-history scope while preserving accounts/memberships: AUTHORIZED, NOT_RUN.

Expanded UI plan: extract current Figma contexts and map existing functional components (COMPLETE); implement home, route editor, riding summary, saved-course views plus search/favorites/schedule/waypoint/share/save dialogs through the sole executor (IN_PROGRESS); validate mobile/tablet/1440px navigation, overflow, keyboard focus, stale requests and existing security/provider contracts (IN_PROGRESS, intermediate visual review only); then resume the same CI-only / Preview / Production release gates. Raw Figma reference exports are temporary working artifacts, not production source. Current UI findings and evidence are tracked in `2026-09-17-figma-app-redesign.md`.

## READY implementation contract

Release version: **0.3.0**, compatible feature, before final-candidate verification.

Decisions: DATA-001/002/003, PLAN-001/002, SHARE-001/002/003, SCOPE-002 and existing operations/verification gates. Capture a private reusable course from trusted staged plan input; retain its existing place verification, endpoints and ordered occurrences. Attach that complete course to newly published immutable shares in the same transaction as publication. Public resolution continues to expose only the existing allowlisted snapshot, never verification proofs or source records.

An authenticated, active-member-only copy RPC reads a valid nonrevoked share and invokes the existing internal immutable collection save for auth.uid(). It accepts no recipient owner ID or browser-supplied course. Existing operation-ID retry semantics remain. No date, departure time, route result or weather is copied into collections. Recipients choose a new schedule when applying the saved course. Copies are independent of the original owner's later changes.

Old plans without a reusable verified course require recalculation before new publication. No fake verification token, synthetic Kakao place identity, proof weakening, source-table disclosure, automatic publication or destructive backfill is allowed. Existing private RPC and source function ACLs remain denied to API roles; the service-role function allowlist is not expanded.

## Verification and release limits

Baseline: clean develop c2abc4c2752e39273dc0435378e7747e1df6ef52, version 0.2.3, origin fetched. No open PR was reported at initial inspection.

Required affected proofs include recipient ownership, active/revoked/anonymous access, share revocation, immutable course content, schedules excluded, ordered repeated occurrences/dwell, operation retry/concurrency, public proof nonexposure, stale browser responses, same-origin API requests, mobile/desktop layout and required repository baseline. Record exact SHA and PASS/FAIL/ERROR/SKIP/NOT_RUN separately. Figma examples are not provider or hosted verification.

No implementation test, migration, deployment or deletion is reported as complete in this initial record.

## History retirement preparation

The approved scope covers old application history in both isolated MOTOCAST environments, including dependent route/weather rows, drafts, run receipts, collection save receipts and expired preview capabilities. Accounts, identities, profiles, memberships, invitations, release acknowledgements and provider budget accounting are excluded.

Read-only backups were captured outside the repository in an owner-private WSL directory on 2026-09-17. The two files were written with mode 0600 under a 0700 directory, fsynced and read back byte-for-byte. No account credentials, sessions or plaintext share bearer were exported. Private place/course records remain only in those backups and are not included in logs or this report.

| Environment | Trips | Collections / versions | Shares | Backup SHA-256 |
| --- | ---: | ---: | ---: | --- |
| Preview | 7 | 1 / 3 | 15 | `282c74b904e9e98c78b38f120d7425fe308a4c07d1916b517db6bb09ff84676e` |
| Production | 8 | 1 / 3 | 15 | `235e63500899a8399c9d1f86f6458e6fe12d741e7884176bea77dc006d47934e` |

The deletion operator must match the exact backup state under locks, delete only captured identifiers, validate expected counts and preserve excluded rows. Added or changed records abort the transaction; an elapsed time is not permission to delete new records. Deletion is NOT_RUN.

Recovery rehearsal PASS: a fresh local PostgreSQL 17.6.1.166 database received the baseline schema and release-announcement migration. For each backup, a transaction created only minimal account-ID foreign-key fixtures, restored explicit columns with `jsonb_populate_recordset` in parent-before-child order and compared every table's full `to_jsonb` contents. Preview 118 rows / 11 tables and Production 119 rows / 11 tables matched exactly. Both transactions rolled back. Private records were neither printed nor committed locally. Initial schema setup failures (existing public schema, missing PostGIS and local database owner mismatch) were corrected on the new disposable databases; they are setup errors, not product test failures or hosted mutations.

Lead preliminary review found and assigned two corrections before release: outstanding save requests must prevent rename/close/reopen overlap; mandatory new schedule edits must preserve a pending collection-share intent while invalidating prior previews. Neither is yet reported resolved.

Retirement operator real-SQL proof: five cases PASS on the isolated old-shape PostgreSQL database: successful exact-set retirement, changed-row abort, added-row abort, protected-account trigger mutation abort, and suppressed-delete rowcount abort. Expected failures were rolled back to a savepoint and the complete prior history/account snapshot compared equal; outer transactions rolled back all private fixtures. Independent final users/trips/shares/proof-function counts were zero. Initial additional-share fixture used a nonexistent column (SETUP_OR_IMPORT_FAILURE); the corrected full-schema fixture passed. Hosted deletion is still NOT_RUN.

Operator unit verification on the retained candidate: 7 PASS under WSL Python. Operator SHA-256 `db4ca15dc03e3f8b4909e1f547714ac9fde619a44c4cdef0856f399e36689ccc`; unit-test SHA-256 `6107f3313648a7ce7f896c639b0ef075438ed4b48af7638b0302bad9d16ee01e`. The actual deletion remains a single explicit apply attempt after fresh backup readback and the CI-only gate; ambiguous outcomes must be inspected rather than retried blindly.

## Candidate verification progress

The writer's first candidate passed dependency installation, lint, typecheck, Deno's five entrypoints, Vitest 67 files / 572 tests and build (16 routes). Initial Windows Playwright could not bind OS-reserved port 3100 (`SETUP_OR_IMPORT_FAILURE`, no browser acceptance); WSL verification is required. The initial real DB run passed plan/collection/share 109 and collection concurrency 9 assertions, before further requested negative-path coverage. These are intermediate results, not final candidate approval.

Lead fresh-chain proof: a new disposable PostgreSQL 17.6.1.166 database, owned by `postgres`, received Auth schema prerequisites followed by all 13 repository migrations in timestamp order as the `postgres` migration role. PASS; final migration SHA-256 `1564a1265d166bf0d5c2732d9307ab96a5d39e247fe440b0fddf4dce4e21b12a`. This used a new database and did not reset an existing local or hosted database.

Supabase CLI 2.116.0 security advisors on that complete local schema returned no warnings/errors (`--type security --level warn --fail-on error`). The initial connection attempted SSL against the local container, which has no TLS; only that verified loopback target used `sslmode=disable`. Hosted transport retains certificate-pinned `verify-full` TLS. Existing CLI and runtime installations were reused.

Retirement must run before adding the new nullable columns to each hosted environment, because the exact backup guard intentionally compares the full old row shape. Apply the reviewed retirement operator only after its local failure/rollback proofs and the release's CI-only gate, then apply that environment's additive migration and Edge artifact. Any unexpected state difference stops the affected operation.

## Deployment identity and recovery preparation

Live pre-release readback confirms Vercel Production `dpl_3e7fKm3rhhTYk4bsgbZFdo7o9G2L` and Preview `dpl_HV4crrYXQh84TZmcAvMPRXyi7pPr` are READY. The project retains Node 20, `main` Production branch and Preview-only Vercel Authentication. The connector returned 403; refreshing the existing Vercel CLI login session and reading the team-scoped API succeeded without changing project settings. Existing authenticated in-app browser tabs can reach both app environments; this is access readiness, not new-feature acceptance.

Prior `plan-route` artifacts were retained in memory: Preview v30 and Production v11, both ACTIVE with JWT true and archive SHA-256 `bbb02f854590ed69c6b5f568703a98bfccd40d2138eee52727550871279984c9`. For a Web-only recovery, the old verified 0.2.3 UI remains compatible with the new additive DB/Edge backend; retain the verified course-capturing Edge function so newly planned rides can still publish. Reverting Edge alone would omit the private reusable course and deliberately block new publication, so it is not a complete functional recovery. Restoring deleted history is a separate exact-backup operation; neither Web nor Edge rollback restores records. No rollback has been performed.

Lead finding RETIRE-REV-1 (HIGH, assigned): `build_retirement_sql` embedded full user-controlled backup text inside a fixed `$retire$` PL/pgSQL delimiter. An occurrence of the delimiter in stored text can terminate the outer body even when the inner SQL string is quote-escaped. Build the body first, select a delimiter absent from its complete contents, and explicitly enable standard-conforming strings. Add quote/backslash/delimiter regression coverage and repeat real-SQL success/abort proofs against the corrected operator hash. The retained backups do not contain that delimiter; neither backup was modified and no hosted deletion occurred. Earlier operator results above apply only to the recorded old hash and are not final approval.

RETIRE-REV-1 RESOLVED on operator SHA-256 `0c9a378b3f3dc82925ffb5d014924e0f868cd9f1369db86095e9ad10c39ac47e`: writer unit tests 8/8 PASS. Lead actual PostgreSQL proof passed exact-set retirement, changed-row abort, and a title containing both delimiter candidates, a single quote and backslashes for each retained environment backup (six cases). Additional new-row, protected-account trigger mutation and suppressed-delete rowcount proofs passed (three cases). Expected failures restored the entire prior state after savepoint rollback; all outer fixture transactions rolled back. Final users/trips/shares/helper counts were zero. Original backup bytes remain unchanged; hosted deletion remains NOT_RUN.
