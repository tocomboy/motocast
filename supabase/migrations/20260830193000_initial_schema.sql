create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;

do $$
begin
  create type public.member_role as enum ('admin', 'rider');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.waypoint_kind as enum ('pass_through', 'stop', 'optional');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 80),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.member_role not null default 'rider',
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_by uuid references auth.users(id) on delete set null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at),
  constraint invitations_consumption_consistent
    check (consumed_by is null or consumed_at is not null)
);

create table if not exists public.riding_collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_versions (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.riding_collections(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  points jsonb not null check (jsonb_typeof(points) = 'array'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (collection_id, version_number)
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_version_id uuid references public.collection_versions(id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  service_date date not null,
  departure_at timestamptz not null,
  desired_return_at timestamptz not null,
  hard_return_at timestamptz not null,
  origin jsonb not null,
  destination jsonb not null,
  lunch_stop jsonb not null,
  dinner_stop jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (departure_at < desired_return_at),
  check (desired_return_at <= hard_return_at)
);

create table if not exists public.trip_waypoints (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  position integer not null check (position >= 0),
  kind public.waypoint_kind not null,
  label text not null check (char_length(label) between 1 and 160),
  point extensions.geography(point, 4326) not null,
  dwell_minutes integer not null default 0 check (dwell_minutes between 0 and 1440),
  is_selected boolean not null default true,
  is_winding boolean not null default false,
  unique (trip_id, position)
);

-- Provider route geometry is an expiring cache. Durable collections retain user-authored points instead.
create table if not exists public.route_cache (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  provider text not null check (provider = 'kakao'),
  profile text not null check (profile in ('balanced', 'winding', 'short')),
  summary jsonb not null,
  route_line extensions.geography(linestring, 4326),
  computed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > computed_at)
);

create table if not exists public.weather_snapshots (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  source text not null check (source = 'kma'),
  issued_at timestamptz not null,
  valid_until timestamptz not null,
  segments jsonb not null check (jsonb_typeof(segments) = 'array'),
  created_at timestamptz not null default now(),
  check (valid_until > issued_at)
);

create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  published_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.api_usage_daily (
  provider text not null,
  operation text not null,
  usage_date date not null default (timezone('Asia/Seoul', now()))::date,
  calls integer not null default 0 check (calls >= 0),
  hard_limit integer not null check (hard_limit > 0),
  updated_at timestamptz not null default now(),
  primary key (provider, operation, usage_date)
);

create index if not exists trip_waypoints_point_gix on public.trip_waypoints using gist(point);
create index if not exists route_cache_line_gix on public.route_cache using gist(route_line);
create index if not exists trips_user_date_idx on public.trips(user_id, service_date desc);
create index if not exists collections_owner_idx on public.riding_collections(owner_id, updated_at desc);

create or replace function public.is_active_member(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships
    where user_id = check_user_id and revoked_at is null
  );
$$;

create or replace function public.is_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships
    where user_id = check_user_id and role = 'admin' and revoked_at is null
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles(id, nickname, avatar_url)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), nullif(new.raw_user_meta_data ->> 'user_name', ''), '라이더'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.claim_invite(invite_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  invitation public.invitations%rowtype;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if invite_token is null or char_length(invite_token) < 32 then
    raise exception 'INVALID_INVITE';
  end if;

  select * into invitation
  from public.invitations
  where token_hash = encode(extensions.digest(invite_token, 'sha256'), 'hex')
  for update;

  if not found or invitation.revoked_at is not null or invitation.expires_at <= now() then
    raise exception 'INVALID_INVITE';
  end if;
  if invitation.consumed_by is not null and invitation.consumed_by <> current_user_id then
    raise exception 'INVITE_ALREADY_USED';
  end if;

  update public.invitations
  set consumed_by = current_user_id, consumed_at = coalesce(consumed_at, now())
  where id = invitation.id;

  insert into public.memberships(user_id, role, invited_by)
  values (current_user_id, 'rider', invitation.created_by)
  on conflict (user_id) do update
    set revoked_at = null, invited_by = excluded.invited_by;
end;
$$;

create or replace function public.create_invite(valid_for interval default interval '7 days')
returns table(invite_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  raw_token text;
  expiry timestamptz;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if valid_for <= interval '0 seconds' or valid_for > interval '30 days' then
    raise exception 'INVALID_EXPIRY';
  end if;

  raw_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  expiry := now() + valid_for;
  insert into public.invitations(token_hash, created_by, expires_at)
  values (encode(extensions.digest(raw_token, 'sha256'), 'hex'), auth.uid(), expiry);
  return query select raw_token, expiry;
end;
$$;

create or replace function public.consume_daily_api_budget(
  api_provider text,
  api_operation text,
  configured_limit integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  used_calls integer;
  today_seoul date := (timezone('Asia/Seoul', now()))::date;
begin
  if not public.is_active_member() then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;
  if configured_limit is null or configured_limit <= 0 then
    raise exception 'API_BUDGET_NOT_CONFIGURED';
  end if;

  insert into public.api_usage_daily(provider, operation, usage_date, calls, hard_limit)
  values (api_provider, api_operation, today_seoul, 1, configured_limit)
  on conflict (provider, operation, usage_date) do update
  set calls = public.api_usage_daily.calls + 1,
      hard_limit = least(public.api_usage_daily.hard_limit, excluded.hard_limit),
      updated_at = now()
  where public.api_usage_daily.calls < least(public.api_usage_daily.hard_limit, excluded.hard_limit)
  returning calls into used_calls;

  if used_calls is null then
    raise exception 'API_DAILY_BUDGET_EXHAUSTED';
  end if;
  return used_calls;
end;
$$;

alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.riding_collections enable row level security;
alter table public.collection_versions enable row level security;
alter table public.trips enable row level security;
alter table public.trip_waypoints enable row level security;
alter table public.route_cache enable row level security;
alter table public.weather_snapshots enable row level security;
alter table public.share_links enable row level security;
alter table public.api_usage_daily enable row level security;

create policy "profiles_read_own" on public.profiles for select using (id = auth.uid() and public.is_active_member());
create policy "profiles_update_own" on public.profiles for update using (id = auth.uid() and public.is_active_member()) with check (id = auth.uid());
create policy "memberships_read_own_or_admin" on public.memberships for select using (user_id = auth.uid() or public.is_admin());
create policy "memberships_admin_update" on public.memberships for update using (public.is_admin()) with check (public.is_admin());
create policy "invitations_admin_read" on public.invitations for select using (public.is_admin());
create policy "invitations_admin_update" on public.invitations for update using (public.is_admin()) with check (public.is_admin());

create policy "collections_owner_all" on public.riding_collections for all
  using (owner_id = auth.uid() and public.is_active_member())
  with check (owner_id = auth.uid() and public.is_active_member());
create policy "versions_owner_all" on public.collection_versions for all
  using (exists (select 1 from public.riding_collections c where c.id = collection_id and c.owner_id = auth.uid()) and public.is_active_member())
  with check (exists (select 1 from public.riding_collections c where c.id = collection_id and c.owner_id = auth.uid()) and created_by = auth.uid() and public.is_active_member());
create policy "trips_owner_all" on public.trips for all
  using (user_id = auth.uid() and public.is_active_member())
  with check (user_id = auth.uid() and public.is_active_member());
create policy "waypoints_trip_owner_all" on public.trip_waypoints for all
  using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()) and public.is_active_member())
  with check (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()) and public.is_active_member());
create policy "route_cache_trip_owner_all" on public.route_cache for all
  using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()) and public.is_active_member())
  with check (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()) and public.is_active_member());
create policy "weather_trip_owner_all" on public.weather_snapshots for all
  using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()) and public.is_active_member())
  with check (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()) and public.is_active_member());
create policy "share_links_owner_all" on public.share_links for all
  using (owner_id = auth.uid() and public.is_active_member())
  with check (owner_id = auth.uid() and public.is_active_member());

revoke all on function public.claim_invite(text) from public;
revoke all on function public.create_invite(interval) from public;
revoke all on function public.consume_daily_api_budget(text, text, integer) from public;
grant execute on function public.claim_invite(text) to authenticated;
grant execute on function public.create_invite(interval) to authenticated;
grant execute on function public.consume_daily_api_budget(text, text, integer) to authenticated;
