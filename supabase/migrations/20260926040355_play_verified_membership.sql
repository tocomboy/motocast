-- AUTH-007. Only the Edge verifier can operate these objects. No raw Google token is stored.
create table public.play_admission_challenges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  challenge_id uuid not null unique,
  request_hash text not null check (request_hash ~ '^[A-Za-z0-9_-]{43}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  window_started_at timestamptz not null,
  issued_count integer not null check (issued_count between 1 and 5),
  proof_hash text check (proof_hash ~ '^[a-f0-9]{64}$'),
  consumed_at timestamptz,
  check (expires_at > issued_at and expires_at <= issued_at + interval '3 minutes')
);
create table public.play_admission_budget (
  singleton boolean primary key default true check (singleton),
  service_date date not null,
  used integer not null check (used between 0 and 500)
);
alter table public.play_admission_challenges enable row level security;
alter table public.play_admission_budget enable row level security;
revoke all on public.play_admission_challenges, public.play_admission_budget from public, anon, authenticated, service_role;

create function public.begin_play_admission_internal(member_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  challenge public.play_admission_challenges%rowtype;
  membership public.memberships%rowtype;
  instant timestamptz := clock_timestamp();
  new_id uuid := gen_random_uuid();
  new_hash text;
begin
  -- Serialize admission attempts for one identity, including first-time users.
  perform 1 from auth.users where id = member_id for update;
  if not found or not exists(select 1 from auth.identities where user_id = member_id and provider = 'kakao') then
    raise exception 'PLAY_AUTH_REQUIRED';
  end if;
  select * into membership from public.memberships where user_id = member_id for update;
  if found then
    if membership.revoked_at is not null then raise exception 'PLAY_MEMBERSHIP_REVOKED'; end if;
    return jsonb_build_object('status', 'active');
  end if;
  select * into challenge from public.play_admission_challenges where user_id = member_id;
  if found and challenge.window_started_at > instant - interval '1 hour' and challenge.issued_count >= 5 then
    raise exception 'PLAY_RATE_LIMITED';
  end if;
  -- Hash binds action, environment database, identity, challenge and unpredictable entropy.
  new_hash := translate(rtrim(encode(extensions.digest(
    'motocast-play-admission-v1|' || current_database() || '|' || member_id::text || '|' || new_id::text || '|' ||
    encode(extensions.gen_random_bytes(32), 'hex'), 'sha256'), 'base64'), '='), '+/', '-_');
  insert into public.play_admission_challenges(user_id, challenge_id, request_hash, issued_at, expires_at, window_started_at, issued_count)
  values(member_id, new_id, new_hash, instant, instant + interval '3 minutes', instant, 1)
  on conflict(user_id) do update set
    challenge_id = excluded.challenge_id, request_hash = excluded.request_hash,
    issued_at = instant, expires_at = excluded.expires_at, proof_hash = null, consumed_at = null,
    window_started_at = case when play_admission_challenges.window_started_at <= instant - interval '1 hour' then instant else play_admission_challenges.window_started_at end,
    issued_count = case when play_admission_challenges.window_started_at <= instant - interval '1 hour' then 1 else play_admission_challenges.issued_count + 1 end;
  return jsonb_build_object('status', 'challenge', 'challengeId', new_id, 'requestHash', new_hash);
end;
$$;

create function public.take_play_admission_internal(member_id uuid, attempt_id uuid, token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  challenge public.play_admission_challenges%rowtype;
  today date := (clock_timestamp() at time zone 'Asia/Seoul')::date;
  affected integer;
begin
  if token_hash is null or token_hash !~ '^[a-f0-9]{64}$' then raise exception 'PLAY_INVALID_PROOF'; end if;
  select * into challenge from public.play_admission_challenges where user_id = member_id for update;
  if not found or challenge.challenge_id <> attempt_id or attempt_id is null or
     challenge.expires_at <= clock_timestamp() or challenge.proof_hash is not null or challenge.consumed_at is not null then
    raise exception 'PLAY_INVALID_CHALLENGE';
  end if;
  if exists(select 1 from public.memberships where user_id = member_id and revoked_at is not null) then
    raise exception 'PLAY_MEMBERSHIP_REVOKED';
  end if;
  insert into public.play_admission_budget(singleton, service_date, used) values(true, today, 1)
  on conflict(singleton) do update set service_date = today,
    used = case when play_admission_budget.service_date <> today then 1 else play_admission_budget.used + 1 end
  where play_admission_budget.service_date <> today or play_admission_budget.used < 500;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'PLAY_RATE_LIMITED'; end if;
  update public.play_admission_challenges set proof_hash = token_hash where user_id = member_id;
  return jsonb_build_object('requestHash', challenge.request_hash,
    'issuedAt', floor(extract(epoch from challenge.issued_at) * 1000),
    'expiresAt', floor(extract(epoch from challenge.expires_at) * 1000));
end;
$$;

create function public.complete_play_admission_internal(member_id uuid, attempt_id uuid, token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  challenge public.play_admission_challenges%rowtype;
  membership public.memberships%rowtype;
  metadata jsonb;
  affected integer;
begin
  select raw_user_meta_data into metadata from auth.users where id = member_id for update;
  if not found or not exists(select 1 from auth.identities where user_id = member_id and provider = 'kakao') then
    raise exception 'PLAY_AUTH_REQUIRED';
  end if;
  select * into challenge from public.play_admission_challenges where user_id = member_id for update;
  if not found or attempt_id is null or token_hash is null or challenge.challenge_id <> attempt_id or
     challenge.proof_hash is distinct from token_hash or challenge.expires_at <= clock_timestamp() then
    raise exception 'PLAY_INVALID_CHALLENGE';
  end if;
  select * into membership from public.memberships where user_id = member_id for update;
  if found then
    if membership.revoked_at is not null then raise exception 'PLAY_MEMBERSHIP_REVOKED'; end if;
    -- Exact completed retry or a concurrent invited member: never replace their role/profile.
    update public.play_admission_challenges set consumed_at = coalesce(consumed_at, clock_timestamp()) where user_id = member_id;
    return;
  end if;
  if challenge.consumed_at is not null then raise exception 'PLAY_INVALID_CHALLENGE'; end if;
  insert into public.memberships(user_id, role) values(member_id, 'rider') on conflict(user_id) do nothing;
  -- A concurrent invitation/admin action may have inserted an existing membership.
  select * into membership from public.memberships where user_id = member_id for update;
  if not found or membership.revoked_at is not null then raise exception 'PLAY_MEMBERSHIP_REVOKED'; end if;
  insert into public.profiles(id, nickname, avatar_url)
  values(member_id, left(coalesce(nullif(btrim(metadata->>'name'), ''), nullif(btrim(metadata->>'user_name'), ''), '라이더'), 80),
    nullif(left(coalesce(nullif(metadata->>'avatar_url', ''), metadata->>'picture'), 2048), ''))
  on conflict(id) do nothing;
  update public.play_admission_challenges set consumed_at = clock_timestamp()
  where user_id = member_id and consumed_at is null;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'PLAY_INVALID_CHALLENGE'; end if;
end;
$$;

revoke all on function public.begin_play_admission_internal(uuid), public.take_play_admission_internal(uuid,uuid,text),
  public.complete_play_admission_internal(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.begin_play_admission_internal(uuid), public.take_play_admission_internal(uuid,uuid,text),
  public.complete_play_admission_internal(uuid,uuid,text) to service_role;
