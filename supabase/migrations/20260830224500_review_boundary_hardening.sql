-- Review hardening: provider results are staged only by trusted Edge Functions,
-- immutable aggregates are mutated only through narrow RPCs, and publication
-- requires a short-lived single-use preview capability.

create table if not exists public.route_plan_drafts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  planning_id uuid not null,
  candidate_profile text not null check (candidate_profile in ('balanced', 'winding', 'short')),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  route jsonb not null check (jsonb_typeof(route) = 'object'),
  created_at timestamptz not null default now(),
  primary key (owner_id, planning_id, candidate_profile)
);

create index if not exists route_plan_drafts_created_idx
  on public.route_plan_drafts(created_at);

create table if not exists public.share_preview_grants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  snapshot_hash text not null check (char_length(snapshot_hash) = 64),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists share_preview_grants_expiry_idx
  on public.share_preview_grants(expires_at);

alter table public.route_plan_drafts enable row level security;
alter table public.share_preview_grants enable row level security;

create or replace function public.is_valid_plan_place(place jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_typeof(place) = 'object'
    and coalesce(place ->> 'id', '') <> ''
    and char_length(place ->> 'id') between 1 and 100
    and coalesce(place ->> 'label', '') <> ''
    and char_length(place ->> 'label') between 1 and 160
    and jsonb_typeof(place -> 'longitude') = 'number'
    and jsonb_typeof(place -> 'latitude') = 'number'
    and (place ->> 'longitude')::double precision between 124 and 132
    and (place ->> 'latitude')::double precision between 32 and 39.5
    and coalesce(place ->> 'kind', '') in ('pass-through', 'stop', 'optional')
    and jsonb_typeof(place -> 'dwellMinutes') = 'number'
    and (place ->> 'dwellMinutes')::numeric = trunc((place ->> 'dwellMinutes')::numeric)
    and (place ->> 'dwellMinutes')::integer between 0 and 1440
    and jsonb_typeof(place -> 'selected') = 'boolean',
    false
  );
$$;

create or replace function public.is_valid_collection_points(points jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_typeof(points) = 'array'
    and jsonb_array_length(points) between 1 and 30
    and not exists (
      select 1
      from jsonb_array_elements(points) as item
      where public.is_valid_plan_place(item) is not true
        or jsonb_typeof(item -> 'winding') is distinct from 'boolean'
        or (
          item ? 'stopRole'
          and item -> 'stopRole' <> 'null'::jsonb
          and coalesce(item ->> 'stopRole', '') not in ('lunch', 'dinner', 'rest')
        )
    ),
    false
  );
$$;

create or replace function public.consume_daily_api_budget_internal(
  api_provider text,
  api_operation text,
  configured_limit integer,
  member_id uuid
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
  if member_id is null or not exists (
    select 1 from public.memberships where user_id = member_id and revoked_at is null
  ) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;
  if api_provider not in ('kakao', 'kma')
     or api_operation not in (
       'local_keyword_search', 'directions', 'future_directions',
       'ultra_forecast', 'short_forecast'
     )
     or configured_limit is null or configured_limit <= 0 then
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

create or replace function public.stage_route_candidate_internal(
  member_id uuid,
  target_planning_id uuid,
  staged_plan jsonb,
  staged_route jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  profile text := staged_route -> 'candidate' ->> 'id';
begin
  if member_id is null or not exists (
    select 1 from public.memberships where user_id = member_id and revoked_at is null
  ) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;
  if target_planning_id is null
     or jsonb_typeof(staged_plan) <> 'object'
     or not public.is_valid_plan_place(staged_plan -> 'origin')
     or not public.is_valid_plan_place(staged_plan -> 'destination')
     or not public.is_valid_plan_place(staged_plan -> 'lunchStop')
     or not public.is_valid_collection_points(staged_plan -> 'waypoints')
     or profile not in ('balanced', 'winding', 'short')
     or staged_route -> 'safety' ->> 'vehicle' <> 'motorcycle'
     or staged_route -> 'safety' ->> 'motorwayExcluded' <> 'true'
     or staged_route -> 'safety' ->> 'fallbackUsed' <> 'false'
     or jsonb_typeof(staged_route -> 'legs') <> 'array'
     or jsonb_array_length(staged_route -> 'legs') < 1 then
    raise exception 'INVALID_STAGED_ROUTE';
  end if;

  delete from public.route_plan_drafts where created_at < now() - interval '1 hour';
  insert into public.route_plan_drafts(owner_id, planning_id, candidate_profile, plan, route)
  values (member_id, target_planning_id, profile, staged_plan, staged_route)
  on conflict (owner_id, planning_id, candidate_profile) do update
  set plan = excluded.plan, route = excluded.route, created_at = now();
end;
$$;

create or replace function public.finalize_trip_plan(
  target_planning_id uuid,
  target_trip_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  staged_plan jsonb;
  staged_routes jsonb;
  draft_count integer;
  plan_count integer;
  saved_trip_id uuid;
begin
  if current_user_id is null or not public.is_active_member(current_user_id) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;

  perform 1 from public.route_plan_drafts
  where owner_id = current_user_id and planning_id = target_planning_id
  for update;

  select count(*), count(distinct plan::text), min(plan::text)::jsonb
  into draft_count, plan_count, staged_plan
  from public.route_plan_drafts
  where owner_id = current_user_id
    and planning_id = target_planning_id
    and created_at >= now() - interval '10 minutes';

  if draft_count <> 3 or plan_count <> 1 then
    raise exception 'ROUTE_PLAN_NOT_READY';
  end if;

  select jsonb_agg(route order by case candidate_profile
    when 'balanced' then 1 when 'winding' then 2 else 3 end)
  into staged_routes
  from public.route_plan_drafts
  where owner_id = current_user_id and planning_id = target_planning_id;

  staged_plan := case
    when target_trip_id is null then staged_plan - 'tripId'
    else jsonb_set(staged_plan, '{tripId}', to_jsonb(target_trip_id), true)
  end;
  saved_trip_id := public.save_trip_plan(staged_plan, staged_routes);

  delete from public.route_plan_drafts
  where owner_id = current_user_id and planning_id = target_planning_id;
  return saved_trip_id;
end;
$$;

create or replace function public.select_trip_candidate(target_trip_id uuid, target_profile text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  changed integer;
begin
  if current_user_id is null or not public.is_active_member(current_user_id) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;
  if target_profile not in ('balanced', 'winding', 'short') then
    raise exception 'INVALID_ROUTE_PROFILE';
  end if;
  update public.trips
  set selected_profile = target_profile, updated_at = now()
  where id = target_trip_id and user_id = current_user_id
    and exists (
      select 1 from public.route_cache r
      where r.trip_id = target_trip_id and r.profile = target_profile
    );
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'TRIP_NOT_FOUND'; end if;
end;
$$;

create or replace function public.delete_riding_collection(target_collection_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  changed integer;
begin
  if current_user_id is null or not public.is_active_member(current_user_id) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;
  delete from public.riding_collections
  where id = target_collection_id and owner_id = current_user_id;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'COLLECTION_NOT_FOUND'; end if;
end;
$$;

create or replace function public.share_place(place jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', place ->> 'id',
    'label', place ->> 'label',
    'longitude', place -> 'longitude',
    'latitude', place -> 'latitude'
  );
$$;

create or replace function public.share_route_point(point jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', point ->> 'id',
    'label', point ->> 'label',
    'longitude', point -> 'longitude',
    'latitude', point -> 'latitude',
    'kind', point ->> 'kind',
    'dwellMinutes', point -> 'dwellMinutes',
    'selected', point -> 'selected',
    'winding', coalesce(point -> 'winding', 'false'::jsonb)
  );
$$;

create or replace function public.share_route(route jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'candidate', jsonb_build_object(
      'id', route -> 'candidate' ->> 'id',
      'label', route -> 'candidate' ->> 'label',
      'estimatedWinding', route -> 'candidate' -> 'estimatedWinding'
    ),
    'safety', jsonb_build_object(
      'vehicle', route -> 'safety' ->> 'vehicle',
      'motorwayExcluded', route -> 'safety' -> 'motorwayExcluded',
      'fallbackUsed', route -> 'safety' -> 'fallbackUsed'
    ),
    'totalDistanceMeters', route -> 'totalDistanceMeters',
    'totalDurationSeconds', route -> 'totalDurationSeconds',
    'returnAt', route ->> 'returnAt',
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'from', public.share_route_point(leg -> 'from'),
        'to', public.share_route_point(leg -> 'to'),
        'via', coalesce((
          select jsonb_agg(public.share_route_point(via_point) order by position)
          from jsonb_array_elements(leg -> 'via') with ordinality as via(via_point, position)
        ), '[]'::jsonb),
        'departureAt', leg ->> 'departureAt',
        'arrivalAt', leg ->> 'arrivalAt',
        'dwellMinutes', leg -> 'dwellMinutes',
        'distanceMeters', leg -> 'distanceMeters',
        'durationSeconds', leg -> 'durationSeconds',
        'sections', coalesce((
          select jsonb_agg(jsonb_build_object(
            'distance', section -> 'distance',
            'duration', section -> 'duration',
            'roads', coalesce((
              select jsonb_agg(jsonb_build_object(
                'name', road ->> 'name',
                'distance', road -> 'distance',
                'duration', road -> 'duration',
                'vertexes', road -> 'vertexes'
              ) order by road_position)
              from jsonb_array_elements(section -> 'roads') with ordinality as roads(road, road_position)
            ), '[]'::jsonb)
          ) order by section_position)
          from jsonb_array_elements(leg -> 'sections') with ordinality as sections(section, section_position)
        ), '[]'::jsonb),
        'forecastTraffic', leg -> 'forecastTraffic'
      ) order by leg_position)
      from jsonb_array_elements(route -> 'legs') with ordinality as legs(leg, leg_position)
    ), '[]'::jsonb)
  );
$$;

create or replace function public.share_weather_segments(segments jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', segment ->> 'id',
    'label', segment ->> 'label',
    'longitude', segment -> 'longitude',
    'latitude', segment -> 'latitude',
    'eta', segment ->> 'eta',
    'status', segment ->> 'status',
    'reason', segment ->> 'reason',
    'model', segment ->> 'model',
    'issuedAt', segment ->> 'issuedAt',
    'condition', segment ->> 'condition',
    'temperatureC', segment -> 'temperatureC',
    'precipitationProbability', segment -> 'precipitationProbability',
    'windSpeedMps', segment -> 'windSpeedMps'
  )) order by position), '[]'::jsonb)
  from jsonb_array_elements(segments) with ordinality as items(segment, position);
$$;

create or replace function public.build_trip_share_snapshot(target_trip_id uuid, target_owner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  trip_record public.trips%rowtype;
  snapshot jsonb;
begin
  select * into trip_record from public.trips
  where id = target_trip_id and user_id = target_owner_id;
  if not found then raise exception 'TRIP_NOT_FOUND'; end if;

  select jsonb_build_object(
    'schemaVersion', 1,
    'trip', jsonb_build_object(
      'title', trip_record.title,
      'serviceDate', trip_record.service_date,
      'departureAt', trip_record.departure_at,
      'desiredReturnAt', trip_record.desired_return_at,
      'hardReturnAt', trip_record.hard_return_at,
      'origin', public.share_place(trip_record.origin),
      'destination', public.share_place(trip_record.destination),
      'lunchStop', public.share_place(trip_record.lunch_stop),
      'dinnerStop', case when trip_record.dinner_stop is null then null else public.share_place(trip_record.dinner_stop) end,
      'selectedProfile', trip_record.selected_profile
    ),
    'waypoints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id,
        'position', w.position,
        'kind', replace(w.kind::text, '_', '-'),
        'label', w.label,
        'longitude', extensions.st_x(w.point::extensions.geometry),
        'latitude', extensions.st_y(w.point::extensions.geometry),
        'dwellMinutes', w.dwell_minutes,
        'selected', w.is_selected,
        'winding', w.is_winding
      ) order by w.position)
      from public.trip_waypoints w where w.trip_id = trip_record.id
    ), '[]'::jsonb),
    'routes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile', r.profile,
        'route', public.share_route(r.summary)
      ) order by case r.profile when 'balanced' then 1 when 'winding' then 2 else 3 end)
      from public.route_cache r where r.trip_id = trip_record.id
    ), '[]'::jsonb),
    'weather', (
      select jsonb_build_object(
        'source', w.source,
        'issuedAt', w.issued_at,
        'retrievedAt', w.created_at,
        'validUntil', w.valid_until,
        'candidateProfile', w.candidate_profile,
        'segments', public.share_weather_segments(w.segments)
      )
      from public.weather_snapshots w
      join public.route_cache r on r.trip_id = w.trip_id and r.profile = w.candidate_profile
      where w.trip_id = trip_record.id
        and w.candidate_profile = trip_record.selected_profile
        and (
          select jsonb_agg(jsonb_build_object(
            'id', r.profile || '-' || (position - 1)::text,
            'longitude', leg -> 'to' -> 'longitude',
            'latitude', leg -> 'to' -> 'latitude',
            'eta', leg ->> 'arrivalAt'
          ) order by position)
          from jsonb_array_elements(r.summary -> 'legs') with ordinality as route_leg(leg, position)
        ) = (
          select jsonb_agg(jsonb_build_object(
            'id', segment ->> 'id',
            'longitude', segment -> 'longitude',
            'latitude', segment -> 'latitude',
            'eta', segment ->> 'eta'
          ) order by position)
          from jsonb_array_elements(w.segments) with ordinality as weather_segment(segment, position)
        )
      order by w.created_at desc limit 1
    )
  ) into snapshot;
  return snapshot;
end;
$$;

drop function if exists public.preview_trip_share(uuid);
create function public.preview_trip_share(target_trip_id uuid)
returns table(preview_snapshot jsonb, preview_token text)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  raw_token text;
  snapshot jsonb;
begin
  if current_user_id is null or not public.is_active_member(current_user_id) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;
  snapshot := public.build_trip_share_snapshot(target_trip_id, current_user_id);
  raw_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  delete from public.share_preview_grants where expires_at < now() or consumed_at is not null;
  insert into public.share_preview_grants(owner_id, trip_id, token_hash, snapshot_hash, expires_at)
  values (
    current_user_id,
    target_trip_id,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    encode(extensions.digest(snapshot::text, 'sha256'), 'hex'),
    now() + interval '10 minutes'
  );
  return query select snapshot, raw_token;
end;
$$;

drop function if exists public.publish_trip_share(uuid);
drop function if exists public.publish_trip_share(uuid, text);
create function public.publish_trip_share(target_trip_id uuid, approved_preview_token text)
returns table(share_id uuid, share_token text, published_snapshot jsonb)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  preview_record public.share_preview_grants%rowtype;
  raw_token text;
  snapshot jsonb;
  created_share_id uuid;
begin
  if current_user_id is null or not public.is_active_member(current_user_id) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;
  if approved_preview_token is null or approved_preview_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'SHARE_PREVIEW_REQUIRED';
  end if;

  select * into preview_record from public.share_preview_grants
  where owner_id = current_user_id
    and trip_id = target_trip_id
    and token_hash = encode(extensions.digest(approved_preview_token, 'sha256'), 'hex')
  for update;
  if not found or preview_record.consumed_at is not null or preview_record.expires_at <= now() then
    raise exception 'SHARE_PREVIEW_REQUIRED';
  end if;

  perform 1 from public.trips
  where id = target_trip_id and user_id = current_user_id
  for update;
  if not found then raise exception 'TRIP_NOT_FOUND'; end if;

  snapshot := public.build_trip_share_snapshot(target_trip_id, current_user_id);
  if encode(extensions.digest(snapshot::text, 'sha256'), 'hex') <> preview_record.snapshot_hash then
    raise exception 'SHARE_PREVIEW_STALE';
  end if;

  update public.share_preview_grants set consumed_at = now() where id = preview_record.id;
  raw_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.share_links(owner_id, token_hash, published_snapshot)
  values (current_user_id, encode(extensions.digest(raw_token, 'sha256'), 'hex'), snapshot)
  returning id into created_share_id;
  return query select created_share_id, raw_token, snapshot;
end;
$$;

drop policy if exists "collections_owner_all" on public.riding_collections;
drop policy if exists "versions_owner_all" on public.collection_versions;
drop policy if exists "trips_owner_all" on public.trips;
drop policy if exists "waypoints_trip_owner_all" on public.trip_waypoints;
drop policy if exists "route_cache_trip_owner_all" on public.route_cache;
drop policy if exists "weather_trip_owner_all" on public.weather_snapshots;
drop policy if exists "share_links_owner_all" on public.share_links;
drop policy if exists "collections_owner_read" on public.riding_collections;
drop policy if exists "versions_owner_read" on public.collection_versions;
drop policy if exists "trips_owner_read" on public.trips;
drop policy if exists "waypoints_trip_owner_read" on public.trip_waypoints;
drop policy if exists "route_cache_trip_owner_read" on public.route_cache;
drop policy if exists "weather_trip_owner_read" on public.weather_snapshots;
drop policy if exists "share_links_owner_read" on public.share_links;

create policy "collections_owner_read" on public.riding_collections for select
  using (owner_id = auth.uid() and public.is_active_member());
create policy "versions_owner_read" on public.collection_versions for select
  using (exists (select 1 from public.riding_collections c where c.id = collection_id and c.owner_id = auth.uid()) and public.is_active_member());
create policy "trips_owner_read" on public.trips for select
  using (user_id = auth.uid() and public.is_active_member());
create policy "waypoints_trip_owner_read" on public.trip_waypoints for select
  using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()) and public.is_active_member());
create policy "route_cache_trip_owner_read" on public.route_cache for select
  using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()) and public.is_active_member());
create policy "weather_trip_owner_read" on public.weather_snapshots for select
  using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()) and public.is_active_member());
create policy "share_links_owner_read" on public.share_links for select
  using (owner_id = auth.uid() and public.is_active_member());

revoke insert, update, delete on public.riding_collections, public.collection_versions,
  public.trips, public.trip_waypoints, public.route_cache, public.weather_snapshots,
  public.share_links, public.route_plan_drafts, public.share_preview_grants
  from public, anon, authenticated;
revoke select on public.route_plan_drafts, public.share_preview_grants from public, anon, authenticated;

revoke all on function public.consume_daily_api_budget(text, text, integer) from public, anon, authenticated;
revoke all on function public.consume_daily_api_budget_internal(text, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.stage_route_candidate_internal(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.save_trip_plan(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_trip_plan(uuid, uuid) from public, anon;
revoke all on function public.select_trip_candidate(uuid, text) from public, anon;
revoke all on function public.delete_riding_collection(uuid) from public, anon;
revoke all on function public.share_place(jsonb) from public, anon, authenticated;
revoke all on function public.share_route_point(jsonb) from public, anon, authenticated;
revoke all on function public.share_route(jsonb) from public, anon, authenticated;
revoke all on function public.share_weather_segments(jsonb) from public, anon, authenticated;
revoke all on function public.preview_trip_share(uuid) from public, anon;
revoke all on function public.publish_trip_share(uuid, text) from public, anon;

grant execute on function public.consume_daily_api_budget_internal(text, text, integer, uuid) to service_role;
grant execute on function public.stage_route_candidate_internal(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.finalize_trip_plan(uuid, uuid) to authenticated;
grant execute on function public.select_trip_candidate(uuid, text) to authenticated;
grant execute on function public.delete_riding_collection(uuid) to authenticated;
grant execute on function public.preview_trip_share(uuid) to authenticated;
grant execute on function public.publish_trip_share(uuid, text) to authenticated;
