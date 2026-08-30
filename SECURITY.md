# Security policy

This repository is intended to be public. Never commit real API keys, Supabase service-role keys, invitation tokens, production URLs containing secrets, or a rider's private trip data.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that exposes credentials, private locations, authentication bypasses, or share-link data. Contact the repository owner privately and include only the minimum information needed to reproduce the problem.

## Required deployment controls

- Keep `SUPABASE_SERVICE_ROLE_KEY`, `KAKAO_REST_API_KEY`, and `KMA_APIHUB_KEY` server-side.
- Restrict the Kakao JavaScript key to the exact Vercel production and preview domains in use.
- Keep paid API usage disabled in provider consoles.
- Enable Row Level Security on every rider-owned table.
- Revoke and rotate any credential that appears in Git history or logs.
- Use only synthetic locations in fixtures, screenshots, and issues.
