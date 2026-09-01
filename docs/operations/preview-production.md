# MOTOCAST Preview and Production operations

This runbook implements `OPS-002`, `OPS-004`, `OPS-005`, and `OPS-007` from `docs/product/MOTOCAST_SOT.md`. It records project references and secret ownership, never secret values.

## Environment boundary

| Environment | Supabase project | Region | Vercel deployment | Access boundary |
| --- | --- | --- | --- | --- |
| Preview | `lehjmbgfpoemqcwxowbx` (`MOTOCAST_Preview`) | Seoul `ap-northeast-2` | `develop` Preview | Vercel Authentication plus MOTOCAST test invitation |
| Production | `obodvbyzptxeehgpcpkd` (`motocast`) | Tokyo `ap-northeast-1` pending `OPS-008` | `main` Production | MOTOCAST invitation and Kakao login only |

Never copy Auth users, memberships, trips, collections, shares, provider secrets, budget ledgers, or production backups between these projects. Migrations and Edge Function source are the only shared artifacts.

## Vercel project

Project: `tocomboys-projects/motocast`.

- Production Branch: `main`.
- Node.js: `20.x`.
- Vercel Authentication: `preview` only.
- Production variables point to the final Production Supabase project.
- Preview variables point to `lehjmbgfpoemqcwxowbx`.
- Each scope keeps only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_KAKAO_MAP_JS_KEY`.
- Do not keep service-role, Kakao REST, KMA, allowed-origin, or budget values in Vercel.

Read back project settings without printing environment values. When environment entries are audited, print names, targets, and IDs only.

Verified Preview configuration on 2026-08-31: the three public names above exist as `Preview (develop)` Config entries. A deployment-level pull exposed seven older server-only names that had been mistakenly targeted to both Preview and Production; after user confirmation they were Preview credentials rather than created Production credentials, all seven were removed from Vercel. No server-only/provider/budget name now remains in either Vercel environment. Production credentials are not yet created and remain deferred until the post-Preview `OPS-008` interview.

## Kakao Map and Local activation

The JavaScript key and allowed web origin are necessary but do not activate the Kakao Map product. For each environment, use the matching Kakao app and complete this check without exposing a key:

1. In Kakao Developers, open the environment app and go to **Kakao Map > Usage settings**.
2. Before changing **State** to ON, confirm the dashboard identifies the app as eligible for the Kakao Map free quota and does not require a Biz Wallet, paid API, or automatic billing. Under `COST-001`, stop and interview the user if any paid setup is required.
3. Under the app's JavaScript key, register the exact JavaScript SDK domain. Preview uses `https://motocast-git-develop-tocomboys-projects.vercel.app`; do not use a comment URL or a deployment path.
4. Confirm that the Vercel Preview Config name `NEXT_PUBLIC_KAKAO_MAP_JS_KEY` contains that app's JavaScript key, not its REST API key. Never print the value.
5. Redeploy or refresh the fixed Preview alias and verify that the SDK request returns JavaScript successfully. A `403 NotAuthorizedError` saying the app disabled `OPEN_MAP_AND_LOCAL` means activation is still incomplete; it is not an application success and must not fall back to demo data.

On 2026-08-31 the fixed Preview alias initially returned that exact 403 because `MOTOCAST Preview` had Map/Local disabled. After the user confirmed the free-only activation, a key-preserving request from the fixed Preview origin returned `200 text/javascript` and the authenticated browser rendered the Kakao map. The client-side error boundary retains its ten-second timeout and safe configuration error. The first real place search then exposed a separate response-contract defect: Kakao officially returns `http://place.map.kakao.com/...`, while the browser accepts only the HTTPS Kakao host. The server correction validates that exact host and upgrades the URL to HTTPS; do not weaken the browser host check or accept arbitrary provider URLs.

Before an actual route response exists, the connected map may show selected markers but must not connect them with a synthetic straight line. After calculation, the only route polyline source is the ordered Kakao Mobility road `vertexes` returned and validated by `plan-route`. Origin, destination, lunch, dinner, selected rest, custom winding, and other waypoint markers use distinct lettered images and a non-color legend; their roles come from the accepted route occurrence and must not change when the rider edits the next calculation's form. Preview smoke must confirm those roles and complete bounds at mobile and desktop widths. Exact-coordinate roles use one composite marker so neither letter is hidden by pin stacking. Every new recommended route must traverse all selected custom winding points. An immutable share created under the deprecated candidate-specific policy can still contain a winding-only point absent from its balanced or shortest geometry; that legacy point carries a `×` marker symbol and remains labelled `선택 경로 미통과` in an always-visible notice outside the fixed-height map. The compatibility notice remains readable when the SDK is loading or failed and must contain all supported omission rows without covering the map summary or clipping at 320, 390, 820, or 1440 pixel widths. Regression evidence must exercise the actual shared snapshot renderer or public share route and measure overflow before any scripted scroll.

## Single recommended route

`plan-route` sends exactly one `RECOMMEND` request per provider chunk through the rider's complete ordered point list. Every request fixes `car_type=7`, `avoid=motorway`, `roadevent=0`, `summary=false`, and detailed geometry; it never sets `alternatives` and the browser cannot submit candidate or safety policy fields. Every attempted provider request consumes budget under `COST-002`.

Edge admission and database persistence use the same `0.005` degree tolerance only for normal Kakao road snapping between a requested place and the first/last road point. Road-to-road and section-to-section continuity remains the stricter `0.0002` degree boundary. Both layers reject points outside those bounds; persistence also revalidates every road scalar, vertex, aggregate, occurrence role, and route-plan identity before atomic finalization.

A custom winding point is a rider-authored mandatory zero-dwell pass-through point, not an automatically detected route class. All provider chunks must retain its order together with meals and selected rest. If Kakao cannot return a safe route through the approved points, the request fails explicitly; never request a winding alternative, generate an arbitrary detour, draw a straight line, or use a passenger-car fallback.

The trusted request boundary rejects more than twenty selected custom winding points before consuming provider budget. Edge and database validation both use `0.005` degrees only for a requested place to snap to the provider road endpoint, while actual road-to-road continuity inside and across split legs remains `0.0002` degrees. Finalization locks the drafts, compares their canonical plan and recommended-route hashes with the durable planning tombstone, and revalidates geometry before persistence. Current schemaVersion 3 share projection preserves the accepted occurrence `stopRole`; immutable schemaVersion 1/2 rows are never rewritten and continue to use the legacy reader fallback.

## Weather provider diagnostics

The browser continues to receive only the safe generic provider error or a stale snapshot. Edge logs may record a KMA HTTP status or the documented short `resultCode` after constraining it to at most sixteen ASCII letters, digits, `_`, or `-`; all other values become `UNKNOWN`. Never log the `authKey`, request URL, response body, `resultMsg`, forecast payload, or browser authorization. A connected smoke must set a future Seoul departure before calculating the route so a past static form default cannot be misclassified as provider failure.

For the bounded KMA diagnostic and live-test-time correction following release `d187c4901ab356ad4de87ca0b46d8ce09fae03a0`, do not repeat the five-function coupled rollout below. Obtain fixed-SHA approval, push that exact SHA only to a slash-free non-deploying `review-*` branch, prove zero GitHub Deployments and zero Vercel checks, and pass a `develop` PR CI run whose `head_sha` is exact. Deploy and read back only Preview `weather-timeline`; no schema, RPC, other Edge Function, secret, or Production change is part of this correction. Re-read that `origin/develop` is still `d187c4901ab356ad4de87ca0b46d8ce09fae03a0`, then fast-forward it to the exact reviewed SHA, wait for the fixed Preview alias to become Ready, and run the authenticated connected weather/collection/share cleanup scenario. Production and `OPS-008` remain untouched.

## Return estimate and legacy storage boundary

The planner accepts a ride date and departure time only. `plan-route` derives the recommended route's `returnAt` from validated Kakao section durations plus meal and selected-rest dwell, accepts a return after Seoul midnight, and rejects a computed duration of 24 hours or more. The browser cannot supply a desired or hard return value that affects this decision.

The initial `trips` table still has non-null `desired_return_at` and `hard_return_at` columns. Until a separate data migration removes them, the trusted Edge Function supplies the Seoul departure-day end as an undisplayed compatibility value to the private persistence path. It is not a deadline, does not reject routes, and must never be exposed in current schemaVersion 3 share snapshots. Existing immutable schemaVersion 1 shares remain readable with their historical fields, and schemaVersion 2 remains readable without reintroducing removed return inputs.

## Supabase promotion order

The single-route browser and `plan-route` function are a coupled contract
change: the new browser omits `candidate`, the old function requires it, and
the new function rejects the old browser's candidate policy. Use a communicated
Preview maintenance window. Apply the database migration, deploy the reviewed
Edge Functions, then deploy the exact reviewed Vercel SHA; route calculation
stays closed until the migration head, deployed function version/JWT setting,
and Vercel SHA/Ready readbacks agree. Never describe a mixed-version interval
as available.

Rollback is coupled as well. Before applying this migration to Preview or
Production, prepare and independently review an exact rollback Web artifact
based on the previous application that can read immutable schemaVersion 3
shares while retaining its previous route-writing contract. Record its fixed
SHA and build evidence in this runbook. A rollout without that artifact is
forbidden: revoking existing test links is insufficient because the migrated
database continues to create schemaVersion 3 previews. During rollback, first
deploy that reader-compatible Web artifact, then roll back the matching Edge
Functions together; do not downgrade the database writer, rewrite an issued
snapshot, or claim sharing recovery until a new share preview and an existing
schemaVersion 3 link both read back successfully. Production remains blocked
by `OPS-008` and this rollback gate.

1. After confirming the exact target and receiving approval, reset only the disposable local PostgreSQL 17 instance at `127.0.0.1:54322`; then apply all migrations from an empty database and run the explicit database tests. Never use this reset against either hosted project.
2. Obtain fixed-SHA independent data-integrity and security approval.
3. Create the reader-compatible rollback Web artifact described above from the previous deployed application, independently review it, and record its exact SHA plus schemaVersion 1/2/3 read tests. Do not apply the Preview migration before this artifact exists.

   Prepared artifact: remote branch `rollback/schema-v3-reader-20260901`, exact SHA `9f4cb83d5ccf1e327b318dc843f2a32a7bf67518`, based directly on previous deployed `84a013b2fc23743d90fb3500a42d3863590aa5c6`. It retains the legacy three-route writer while reading immutable schemaVersion 1/2 and singular schemaVersion 3 shares. Independent correctness, security, and operations reviews report `BLOCKER 0 / HIGH 0 / MEDIUM 0 / LOW 0`. Writer/reviewer evidence passes ESLint, TypeScript, focused schema 1/2/3 tests (`16/16`), full Vitest (`50 files / 288 tests`), all five Edge Function Deno checks, the 13-route production build, deterministic Chromium (`14 PASS / 2 SKIP`), exact-range diff check, and a names-only sensitive-value scan. The artifact itself remains valid, but the slash-containing branch was not non-deploying: live GitHub readback found successful Vercel Preview Deployment `6197366768` for that SHA at `2026-09-01T08:23:20Z`. `*` does not cover a slash-separated branch name in the observed Vercel glob behavior. A same-tree, new-SHA probe on slash-free branch `rollback-deploy-filter-probe-20260901` (`a641d684e9f0c8ed96467936faad4780a11ecd63`) produced zero Deployments and zero checks after webhook settlement. Never use slash-containing review or rollback branch names as evidence of deployment exclusion. During an actual rollback, route writes remain closed until this Web artifact and the matching legacy Edge bundle are both active; the database and issued shares are never downgraded or rewritten.

   After the single-route migration, this rollback writer can create a legacy three-route trip but cannot replace an existing trip: the old staging contract contains no trusted target identity or revision, so such updates fail closed with `LEGACY_TRIP_UPDATE_UNSUPPORTED`. Existing trips and immutable shares remain readable. During rollback, tell riders to create a new trip instead of recalculating an existing one.
4. Push the exact reviewed release SHA only to a slash-free branch explicitly excluded by `vercel.json` (for example `review-single-route-<short-sha>`) and open a pull request into `develop` so hosted CI can run without deploying the incompatible Web first. Confirm the exact remote branch SHA, wait for webhook settlement, and require zero GitHub Deployments and zero Vercel checks for that SHA before continuing. If any deployment appears, stop before Preview mutation. The CI workflow must check out `github.event.pull_request.head.sha`, fail if its actual `HEAD` differs, and report that exact SHA in the run metadata; a synthetic PR merge ref is not release evidence. Run hosted CI on the open PR, but do not merge it.
5. Dry-run Preview migration application:

   ```bash
   npx --yes supabase@2.116.0 db push --project-ref lehjmbgfpoemqcwxowbx --include-all --skip-vault --dry-run
   ```

6. Apply to Preview only, then read back migration versions, RLS and function ACLs.
7. During the Preview maintenance window, deploy `search-places`, `plan-route`, `weather-timeline`, `save-collection`, and `kakao-oidc` from the reviewed fixed SHA. The first four retain JWT verification; only `kakao-oidc` is intentionally public with `verify_jwt=false` under `AUTH-004`. Read back each deployed Edge Function version and JWT setting. Re-read `origin/develop`; if it no longer equals the base SHA used by the reviewed PR, stop and create/review a new fixed SHA. Otherwise fast-forward `develop` directly to the exact reviewed release SHA, rather than creating a merge/squash/rebase SHA, so Vercel deploys the same commit that passed writer verification, independent review, and PR CI. Read back the exact Git ref, GitHub Deployment SHA, Vercel Ready state, and commit tree before reopening route calculation; then close or confirm GitHub's resulting state for the CI-only PR.
8. Register Preview-only Auth provider redirects and server secrets through the Supabase Dashboard or masked input. Never put values in command arguments or shell history. Preview name-only readback confirms all ten application secret names, including `KAKAO_LOGIN_CLIENT_SECRET` and `KAKAO_OIDC_STATE_SECRET`; values are never read or printed. The authorize request must use the HTTPS callback derived from `SUPABASE_URL`, not an internal Edge `request.url`.
9. Use disposable Preview identities to execute the complete Preview gate. The first Kakao identity has been registered as the sole Preview administrator; use a separate invited identity for rider-isolation checks.
10. Resolve `OPS-008`, back up the chosen empty/pre-cutover Production database, and repeat the reviewed migration/function sequence for Production.

Preview browser automation is fail-closed to `https://motocast-git-develop-tocomboys-projects.vercel.app` and Supabase project `lehjmbgfpoemqcwxowbx`. Run auth and authenticated Preview automation from WSL/Linux, then create the storage state through `npm run test:e2e:auth` in a dedicated owner-private directory outside the repository; the helper writes a `0600` state file and origin/project metadata. Native Windows fails before browser launch because this workflow cannot prove an owner-only NTFS ACL. `npm run test:e2e:preview` rejects missing metadata, symlinks, permissive files, another project, loopback, arbitrary HTTPS, and Production origins. Authenticated runs do not retain browser artifacts. Live mutation cleanup records its obligation before each request, captures exact nonsecret resource IDs from responses, and uses a separately timed `afterEach` hook to revoke only the test-owned active share, delete the exact collection, and call the ownership-enforcing `delete_owned_trip` boundary for the captured test trip; any unknown outcome or cleanup failure keeps the gate red.

Public share links use `/share#<token>`. The fragment is not sent in the initial HTTP request; the client copies it to component-local memory, synchronously removes it from browser history, and only then sends it in the JSON body of `POST /api/shares/resolve`. If history cleanup fails, resolution stops before any third-party map script can run. Do not reintroduce a dynamic `/share/<token>` page or `/api/shares/<token>` resolver because hosting request-path logs can then contain the bearer token.

Invitation links use `/invite#<token>` for the same reason. The fixed client removes the fragment from browser history and posts it to same-origin `application/json` `POST /api/invites/accept`, which sets the short-lived HttpOnly claim cookie. The endpoint rejects missing/mismatched Origin, cross-site Fetch Metadata, and non-JSON content before parsing or setting a cookie. Do not reintroduce `/invite/<token>` or log the accept request body.

## Edge Function secret names

Each Supabase project owns separate values for these names:

- `KAKAO_REST_API_KEY`
- `KAKAO_LOGIN_CLIENT_SECRET`
- `KAKAO_OIDC_STATE_SECRET`
- `PLACE_VERIFICATION_SECRET`
- `KMA_APIHUB_KEY`
- `ALLOWED_ORIGINS`
- `KAKAO_LOCAL_DAILY_LIMIT`
- `KAKAO_CURRENT_DAILY_LIMIT`
- `KAKAO_FUTURE_DAILY_LIMIT`
- `KMA_DAILY_LIMIT`

All limits must be positive integers. A missing, zero, negative, or exhausted limit fails closed. Failed provider attempts still consume budget under `COST-002`.

## Pre-ride and backup check

- Confirm both hosted projects are `ACTIVE_HEALTHY`; Preview inactivity is acceptable, Production unavailability before a ride is not.
- Confirm the Production deployment SHA matches the `main` merge SHA.
- Export a manual off-platform database backup before real rider data or schema promotion.
- Record the backup timestamp, source project ref, migration head, restore target, and restore readback without storing rider data in the public repository.
- Validate invite login, one minimal legal route, weather freshness, saved collection, publish/revoke, and the daily budget hard stop.
