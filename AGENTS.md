# MOTOCAST repository guidance

Follow the active Codex home's global `AGENTS.md` and its personal routing source.

- Product, security, cost, and operations decisions: `docs/product/MOTOCAST_SOT.md`
- Verification, lead-owned review, findings, and deployment gates: `docs/rules/verification-and-review.md`
- When implementation or live service state conflicts with a confirmed decision, record the conflict and interview the user before changing the affected slice.
- Work on `develop`; promote to `main` only through a same-repository `develop -> main` pull request.
- Never read `CLAUDE.md` or `.claude/` unless the user explicitly requests a Claude configuration audit or migration.

## Version and release management

- For each product release, choose and record the next `MAJOR.MINOR.PATCH` version before final candidate verification: patch for compatible fixes, minor for compatible features, and major for breaking changes. Do not bump the product version for every commit or for documentation-only changes.
- Use `package.json` as the current-version source of truth. Update its version, the root package versions in `package-lock.json`, and the matching entry in `lib/releases.ts` together. Preserve published release history and write concise, user-facing Korean update notes.
- Before promotion, verify that the package version, latest release note, footer version, `/updates`, and per-account/per-version announcement agree. Apply the verification and deployment gates in `docs/rules/verification-and-review.md` to the fixed release candidate.
- After verifying the Production deployment of the approved `develop -> main` promotion, publish the matching `vMAJOR.MINOR.PATCH` Git tag and GitHub Release against the exact deployed `main` commit. Never move or reuse a published version tag.
- Record the version, PR, verified commit, CI result, Preview and Production deployment identifiers, and remaining verification limits in the release evidence. These rules do not independently authorize publication or deployment; use the current user authorization and repository gates.
