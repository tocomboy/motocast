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

## Supabase promotion order

1. Run all local migrations and explicit database tests against the disposable PostgreSQL 17 instance.
2. Obtain fixed-SHA independent data-integrity and security approval.
3. Dry-run Preview migration application:

   ```bash
   npx --yes supabase@2.116.0 db push --project-ref lehjmbgfpoemqcwxowbx --include-all --skip-vault --dry-run
   ```

4. Apply to Preview only, then read back migration versions, RLS, function ACLs, and Edge Function versions.
5. Register Preview-only Auth provider redirects and server secrets through the Supabase Dashboard or masked CLI input. Never put values in command arguments or shell history.
6. Use disposable Preview identities to execute the complete Preview gate.
7. Resolve `OPS-008`, back up the chosen empty/pre-cutover Production database, and repeat the reviewed migration/function sequence for Production.

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
