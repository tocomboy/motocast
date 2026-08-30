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

## Supabase promotion order

1. After confirming the exact target and receiving approval, reset only the disposable local PostgreSQL 17 instance at `127.0.0.1:54322`; then apply all migrations from an empty database and run the explicit database tests. Never use this reset against either hosted project.
2. Obtain fixed-SHA independent data-integrity and security approval.
3. Dry-run Preview migration application:

   ```bash
   npx --yes supabase@2.116.0 db push --project-ref lehjmbgfpoemqcwxowbx --include-all --skip-vault --dry-run
   ```

4. Apply to Preview only, then read back migration versions, RLS, function ACLs, and Edge Function versions.
5. Deploy `search-places`, `plan-route`, `weather-timeline`, and `save-collection` from the reviewed fixed SHA.
6. Register Preview-only Auth provider redirects and server secrets through the Supabase Dashboard or masked CLI input. Never put values in command arguments or shell history. This setup and its name/enabled/URL readback are complete for `MOTOCAST_Preview`; repeat the readback after any relevant configuration change or redeployment.
7. Use disposable Preview identities to execute the complete Preview gate.
8. Resolve `OPS-008`, back up the chosen empty/pre-cutover Production database, and repeat the reviewed migration/function sequence for Production.

Public share links use `/share#<token>`. The fragment is not sent in the initial HTTP request; the client validates it and sends it in the JSON body of `POST /api/shares/resolve`. Do not reintroduce a dynamic `/share/<token>` page or `/api/shares/<token>` resolver because hosting request-path logs can then contain the bearer token.

Invitation links use `/invite#<token>` for the same reason. The fixed client removes the fragment from browser history and posts it to same-origin `application/json` `POST /api/invites/accept`, which sets the short-lived HttpOnly claim cookie. The endpoint rejects missing/mismatched Origin, cross-site Fetch Metadata, and non-JSON content before parsing or setting a cookie. Do not reintroduce `/invite/<token>` or log the accept request body.

## Edge Function secret names

Each Supabase project owns separate values for these names:

- `KAKAO_REST_API_KEY`
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
