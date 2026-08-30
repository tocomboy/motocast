-- Email-free Kakao OIDC uses a short-lived encrypted handoff between the
-- Supabase-owned OAuth callback and the Vercel application. Only a hash of the
-- browser bearer is stored, and consumption is atomic.

create table if not exists public.kakao_oidc_handoffs (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  encrypted_payload text not null check (char_length(encrypted_payload) between 1 and 16384),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists kakao_oidc_handoffs_expiry_idx
  on public.kakao_oidc_handoffs(expires_at);

alter table public.kakao_oidc_handoffs enable row level security;

create or replace function public.create_kakao_oidc_handoff_internal(
  handoff_hash text,
  handoff_payload text,
  handoff_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if handoff_hash is null
     or handoff_hash !~ '^[0-9a-f]{64}$'
     or handoff_payload is null
     or char_length(handoff_payload) not between 1 and 16384
     or handoff_expires_at is null
     or handoff_expires_at <= now()
     or handoff_expires_at > now() + interval '5 minutes' then
    raise exception 'OIDC_HANDOFF_INVALID';
  end if;

  delete from public.kakao_oidc_handoffs
  where expires_at < now() - interval '10 minutes'
     or consumed_at < now() - interval '10 minutes';

  insert into public.kakao_oidc_handoffs(token_hash, encrypted_payload, expires_at)
  values (handoff_hash, handoff_payload, handoff_expires_at);
exception
  when unique_violation then raise exception 'OIDC_HANDOFF_INVALID';
end;
$$;

create or replace function public.consume_kakao_oidc_handoff_internal(
  handoff_hash text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payload text;
begin
  if handoff_hash is null or handoff_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'OIDC_HANDOFF_INVALID';
  end if;

  update public.kakao_oidc_handoffs
  set consumed_at = now()
  where token_hash = handoff_hash
    and consumed_at is null
    and expires_at > now()
  returning encrypted_payload into payload;

  if payload is null then
    raise exception 'OIDC_HANDOFF_INVALID';
  end if;
  return payload;
end;
$$;

revoke all on table public.kakao_oidc_handoffs
  from public, anon, authenticated, service_role;
revoke all on function public.create_kakao_oidc_handoff_internal(text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.consume_kakao_oidc_handoff_internal(text)
  from public, anon, authenticated;
grant execute on function public.create_kakao_oidc_handoff_internal(text, text, timestamptz)
  to service_role;
grant execute on function public.consume_kakao_oidc_handoff_internal(text)
  to service_role;
