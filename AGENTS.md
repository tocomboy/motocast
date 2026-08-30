# MOTOCAST repository guidance

Follow the global `/home/tocomboy/.codex/AGENTS.md` rules.

- Product, security, cost, and operations decisions: `docs/product/MOTOCAST_SOT.md`
- Verification, independent review, findings, and deployment gates: `docs/rules/verification-and-review.md`
- When implementation or live service state conflicts with a confirmed decision, record the conflict and interview the user before changing the affected slice.
- Work on `develop`; promote to `main` only through a same-repository `develop -> main` pull request.
- Never read `CLAUDE.md` or `.claude/` unless the user explicitly requests a Claude configuration audit or migration.
