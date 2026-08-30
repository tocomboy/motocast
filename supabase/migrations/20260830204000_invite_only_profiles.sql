-- AUTH-001, AUTH-002, AUTH-003: profiles exist only after a valid invitation claim.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- The removed trigger may already have created profiles for users who never
-- claimed an invitation. AUTH-003 permits only the minimal auth.users record
-- for those denied OAuth attempts. Preserve profiles for active or revoked
-- members, and remove only profiles that have never had a membership.
do $$
declare
  removed_profiles integer;
begin
  delete from public.profiles as profile
  where not exists (
    select 1
    from public.memberships as membership
    where membership.user_id = profile.id
  );
  get diagnostics removed_profiles = row_count;
  raise notice 'AUTH003_ORPHAN_PROFILES_REMOVED=%', removed_profiles;

  if exists (
    select 1
    from public.profiles as profile
    where not exists (
      select 1
      from public.memberships as membership
      where membership.user_id = profile.id
    )
  ) then
    raise exception 'AUTH003_ORPHAN_PROFILE_CLEANUP_FAILED';
  end if;
end;
$$;

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

  -- A committed claim may be retried after the HTTP response is lost. The
  -- original user remains successful even if that already-consumed invite is
  -- later expired or revoked, provided the membership itself is still active.
  if invitation.consumed_by = current_user_id and public.is_active_member(current_user_id) then
    return;
  end if;

  if invitation.revoked_at is not null or invitation.expires_at <= now() then
    raise exception 'INVALID_INVITE';
  end if;

  -- An already-active member does not consume a link intended for a new rider.
  if public.is_active_member(current_user_id) then
    return;
  end if;

  if invitation.consumed_by is not null then
    raise exception 'INVITE_ALREADY_USED';
  end if;

  update public.invitations
  set consumed_by = current_user_id,
      consumed_at = now()
  where id = invitation.id
    and consumed_by is null;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'INVITE_ALREADY_USED';
  end if;

  insert into public.memberships(user_id, role, invited_by)
  values (current_user_id, 'rider', invitation.created_by)
  on conflict (user_id) do update
    set role = 'rider',
        invited_by = excluded.invited_by,
        joined_at = now(),
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
    nullif(left(auth_metadata ->> 'avatar_url', 2048), '')
  )
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.claim_invite(text) from public;
grant execute on function public.claim_invite(text) to authenticated;
