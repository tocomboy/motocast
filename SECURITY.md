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
- Keep Playwright authentication state outside the repository in a WSL/Linux owner-only directory and file; native Windows authenticated runs fail closed because this workflow does not prove an owner-only NTFS ACL. Never upload authenticated traces, screenshots, videos, cookies, or share URLs.
- Run authenticated mutation automation only against the exact allowlisted develop Preview origin and Preview Supabase project. Production is a separate user-approved gate.
