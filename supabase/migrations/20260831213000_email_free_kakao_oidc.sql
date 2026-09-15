-- Email-free Kakao OIDC uses a short-lived encrypted handoff between the
-- Supabase-owned OAuth callback and the Vercel application. Only a hash of the
-- browser bearer is stored, and consumption is atomic.

create table if not exists public.kakao_oidc_handoffs (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  browser_binding_hash text not null check (browser_binding_hash ~ '^[0-9a-f]{64}$'),
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
  handoff_binding_hash text,
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
     or handoff_binding_hash is null
     or handoff_binding_hash !~ '^[0-9a-f]{64}$'
     or handoff_payload is null
     or char_length(handoff_payload) not between 1 and 16384
     or handoff_expires_at is null
     or handoff_expires_at <= clock_timestamp()
     or handoff_expires_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'OIDC_HANDOFF_INVALID';
  end if;

  delete from public.kakao_oidc_handoffs
  where expires_at < clock_timestamp() - interval '10 minutes'
     or consumed_at < clock_timestamp() - interval '10 minutes';

  insert into public.kakao_oidc_handoffs(
    token_hash, browser_binding_hash, encrypted_payload, expires_at, created_at
  )
  values (
    handoff_hash, handoff_binding_hash, handoff_payload, handoff_expires_at, clock_timestamp()
  );
exception
  when unique_violation then raise exception 'OIDC_HANDOFF_INVALID';
end;
$$;

create or replace function public.consume_kakao_oidc_handoff_internal(
  handoff_hash text,
  handoff_binding_hash text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payload text;
begin
  if handoff_hash is null
     or handoff_hash !~ '^[0-9a-f]{64}$'
     or handoff_binding_hash is null
     or handoff_binding_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'OIDC_HANDOFF_INVALID';
  end if;

  update public.kakao_oidc_handoffs
  set consumed_at = clock_timestamp()
  where token_hash = handoff_hash
    and browser_binding_hash = handoff_binding_hash
    and consumed_at is null
    and expires_at > clock_timestamp()
  returning encrypted_payload into payload;

  if payload is null then
    raise exception 'OIDC_HANDOFF_INVALID';
  end if;
  return payload;
end;
$$;

revoke all on table public.kakao_oidc_handoffs
  from public, anon, authenticated, service_role;
revoke all on function public.create_kakao_oidc_handoff_internal(text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.consume_kakao_oidc_handoff_internal(text, text)
  from public, anon, authenticated;
grant execute on function public.create_kakao_oidc_handoff_internal(text, text, text, timestamptz)
  to service_role;
grant execute on function public.consume_kakao_oidc_handoff_internal(text, text)
  to service_role;

-- Kakao's direct ID-token path uses the standard OIDC `picture` metadata key,
-- while the retired hosted OAuth path used `avatar_url`. Preserve both without
-- requiring either optional profile consent.
create or replace function public.claim_invite(invite_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  invitation public.invitations%rowtype;
  current_user_id uuid := auth.uid();
  auth_metadata jsonb;
  display_name text;
  affected_rows integer;
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if invite_token is null or invite_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'INVALID_INVITE';
  end if;

  select * into invitation
  from public.invitations
  where token_hash = encode(extensions.digest(invite_token, 'sha256'), 'hex')
  for update;

  if not found then
    raise exception 'INVALID_INVITE';
  end if;
  if invitation.consumed_by = current_user_id and public.is_active_member(current_user_id) then
    return;
  end if;
  if invitation.revoked_at is not null or invitation.expires_at <= clock_timestamp() then
    raise exception 'INVALID_INVITE';
  end if;
  if public.is_active_member(current_user_id) then
    return;
  end if;
  if invitation.consumed_by is not null or invitation.consumed_at is not null then
    raise exception 'INVITE_ALREADY_USED';
  end if;

  update public.invitations
  set consumed_by = current_user_id,
      consumed_at = clock_timestamp()
  where id = invitation.id
    and consumed_by is null
    and consumed_at is null;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'INVITE_ALREADY_USED';
  end if;

  insert into public.memberships(user_id, role, invited_by)
  values (current_user_id, 'rider', invitation.created_by)
  on conflict (user_id) do update
    set role = 'rider',
        invited_by = excluded.invited_by,
        joined_at = clock_timestamp(),
        revoked_at = null;

  select raw_user_meta_data into auth_metadata
  from auth.users
  where id = current_user_id;
  if not found then
    raise exception 'AUTH_REQUIRED';
  end if;

  display_name := left(
    coalesce(
      nullif(btrim(auth_metadata ->> 'name'), ''),
      nullif(btrim(auth_metadata ->> 'user_name'), ''),
      '라이더'
    ),
    80
  );

  insert into public.profiles(id, nickname, avatar_url)
  values (
    current_user_id,
    display_name,
    nullif(left(coalesce(
      nullif(auth_metadata ->> 'avatar_url', ''),
      auth_metadata ->> 'picture'
    ), 2048), '')
  )
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.claim_invite(text) from public;
grant execute on function public.claim_invite(text) to authenticated;
