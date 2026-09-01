# Complete-course rollback artifact

This rollback tree is based on the previous deployed application plus its reviewed schemaVersion 3 share reader. It is intended only for a database that already includes `20260901140000_complete_course_collections.sql`.

## Closed boundary

- The Web UI renders a visible rollback notice instead of mounting `CollectionManager`; it exposes no collection save, version, apply, or delete control and makes no collection read request.
- The `save-collection` Edge Function is a fail-closed maintenance handler. It never reads the request body, authenticates a member, invokes an RPC, or mutates a table; an allowed POST receives HTTP 503 with a fixed safe message.
- Do not restore the old five-argument `save_collection_version_internal` function or deploy an older collection writer. The migrated database and immutable collection rows are never downgraded or rewritten.

## Preserved boundary

- The previous route-writing contract remains available for creating a new legacy three-route trip. Updating an existing trip stays fail-closed under `LEGACY_TRIP_UPDATE_UNSUPPORTED`.
- Immutable schemaVersion 1, 2, and 3 shares remain readable. SchemaVersion 3 keeps optional lunch nullable, while historical schemaVersion 1/2 snapshots retain their required-lunch contract.
- Current complete-course collections remain stored but unavailable until the reviewed forward Web and database-compatible `save-collection` function are restored together.

## Required rollback smoke

1. Read back the exact rollback Web SHA and each deployed Edge Function version.
2. Confirm the collection closure notice is visible and that no collection mutation or apply controls exist at mobile and desktop widths.
3. Confirm a direct request to `save-collection` returns the fixed 503 maintenance response and creates no collection/version row.
4. Create a new route without targeting an existing trip, then verify route geometry and weather.
5. Resolve one existing endpoint-only schemaVersion 3 link with no lunch and one schemaVersion 1/2 fixture.
6. Restore the forward bundle atomically before reopening collection actions.
