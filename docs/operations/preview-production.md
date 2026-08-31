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

Before an actual route response exists, the connected map may show selected markers but must not connect them with a synthetic straight line. After calculation, the only route polyline source is the ordered Kakao Mobility road `vertexes` returned and validated by `plan-route`. Origin, destination, lunch, dinner, selected rest, custom winding, and other waypoint markers use distinct lettered images and a non-color legend; Preview smoke must confirm those roles and complete bounds at mobile and desktop widths. A winding-only point intentionally absent from a balanced or shortest candidate remains a labelled `선택 경로 미통과` marker in a shared snapshot, so the full approved plan remains visible without implying that the selected polyline traverses it.

## Estimated winding recovery

Kakao documents `alternatives=true` as returning one or more routes, so a distinct winding alternative is not guaranteed. For a plan without a custom winding waypoint, `plan-route` obtains a validated normal `RECOMMEND` baseline, inspects the `RECOMMEND + alternatives` pool, and consumes at most one additional `TIME + alternatives` request for a chunk whose alternatives call returns no route or no more-curved distinct geometry. Every request retains `car_type=7`, `avoid=motorway`, `roadevent=0`, and detailed geometry; every attempted request consumes budget under `COST-002`.

A multi-chunk estimated winding route is accepted only when at least one chunk is geometry-distinct and more curved than its recommended baseline. Other chunks may retain that safe baseline when the provider has no local alternative. If all chunks remain baseline geometry, the function returns the public `WINDING_ROUTE_UNAVAILABLE` code, the browser asks for a custom winding waypoint, and no partial or duplicate three-candidate plan is finalized. Never generate an arbitrary detour waypoint or relabel the balanced/shortest route as winding.

## Return estimate and legacy storage boundary

The planner accepts a ride date and departure time only. `plan-route` derives each candidate's `returnAt` from validated Kakao section durations plus meal and selected-rest dwell, accepts a return after Seoul midnight, and rejects a computed duration of 24 hours or more. The browser cannot supply a desired or hard return value that affects this decision.

The initial `trips` table still has non-null `desired_return_at` and `hard_return_at` columns. Until a separate data migration removes them, the trusted Edge Function supplies the Seoul departure-day end as an undisplayed compatibility value to the private persistence path. It is not a deadline, does not reject routes, and must never be exposed in schemaVersion 2 share snapshots. Existing immutable schemaVersion 1 shares remain readable with their historical fields.

## Supabase promotion order

1. After confirming the exact target and receiving approval, reset only the disposable local PostgreSQL 17 instance at `127.0.0.1:54322`; then apply all migrations from an empty database and run the explicit database tests. Never use this reset against either hosted project.
2. Obtain fixed-SHA independent data-integrity and security approval.
3. Dry-run Preview migration application:

   ```bash
   npx --yes supabase@2.116.0 db push --project-ref lehjmbgfpoemqcwxowbx --include-all --skip-vault --dry-run
   ```

4. Apply to Preview only, then read back migration versions, RLS, function ACLs, and Edge Function versions.
5. Deploy `search-places`, `plan-route`, `weather-timeline`, `save-collection`, and `kakao-oidc` from the reviewed fixed SHA. The first four retain JWT verification; only `kakao-oidc` is intentionally public with `verify_jwt=false` under `AUTH-004`.
6. Register Preview-only Auth provider redirects and server secrets through the Supabase Dashboard or masked input. Never put values in command arguments or shell history. Preview name-only readback confirms all ten application secret names, including `KAKAO_LOGIN_CLIENT_SECRET` and `KAKAO_OIDC_STATE_SECRET`; values are never read or printed. The authorize request must use the HTTPS callback derived from `SUPABASE_URL`, not an internal Edge `request.url`.
7. Use disposable Preview identities to execute the complete Preview gate. The first Kakao identity has been registered as the sole Preview administrator; use a separate invited identity for rider-isolation checks.
8. Resolve `OPS-008`, back up the chosen empty/pre-cutover Production database, and repeat the reviewed migration/function sequence for Production.

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
