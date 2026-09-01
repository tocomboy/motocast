begin;

-- Add the new single-route identity without rewriting or deleting legacy rows.
alter table public.trips drop constraint if exists trips_selected_profile_check;
alter table public.trips add constraint trips_selected_profile_check
  check (selected_profile in ('recommended', 'balanced', 'winding', 'short'));

alter table public.route_cache drop constraint if exists route_cache_profile_check;
alter table public.route_cache add constraint route_cache_profile_check
  check (profile in ('recommended', 'balanced', 'winding', 'short'));

alter table public.route_plan_drafts drop constraint if exists route_plan_drafts_candidate_profile_check;
alter table public.route_plan_drafts add constraint route_plan_drafts_candidate_profile_check
  check (candidate_profile in ('recommended', 'balanced', 'winding', 'short'));

alter table public.weather_snapshots drop constraint if exists weather_snapshots_candidate_profile_check;
alter table public.weather_snapshots add constraint weather_snapshots_candidate_profile_check
  check (candidate_profile is null or candidate_profile in ('recommended', 'balanced', 'winding', 'short'));

-- A planning id is a single-use capability. Keeping its lifecycle separately
-- from the short-lived route draft prevents a late provider retry from
-- resurrecting a plan after finalization has consumed the draft.
create table if not exists public.route_plan_runs (
  owner_id uuid not null references auth.users(id) on delete cascade,
  planning_id uuid not null,
  plan_hash text not null check (char_length(plan_hash) = 64),
  route_hash text,
  status text not null default 'staging' check (status in ('staging', 'consumed')),
  -- Keep the consumed target id as an audit tombstone even if the rider later
  -- deletes the trip aggregate. It is intentionally not a foreign key.
  saved_trip_id uuid,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  primary key (owner_id, planning_id),
  check (
    (status = 'staging' and saved_trip_id is null and consumed_at is null) or
    (status = 'consumed' and saved_trip_id is not null and consumed_at is not null)
  )
);

alter table public.route_plan_runs add column if not exists route_hash text;
alter table public.route_plan_runs drop constraint if exists route_plan_runs_route_hash_check;
alter table public.route_plan_runs add constraint route_plan_runs_route_hash_check
  check (route_hash is null or char_length(route_hash) = 64);

alter table public.route_plan_runs enable row level security;
revoke all on public.route_plan_runs from public, anon, authenticated, service_role;

-- Preserve any in-flight legacy drafts if this migration is applied while a
-- Preview request is between provider staging and browser finalization.
insert into public.route_plan_runs(owner_id, planning_id, plan_hash, route_hash, created_at)
select owner_id, planning_id,
  encode(extensions.digest(min(plan::text), 'sha256'), 'hex'),
  case when count(*) = 1 and min(candidate_profile) = 'recommended'
    then encode(extensions.digest(min(route::text), 'sha256'), 'hex')
    else null
  end,
  min(created_at)
from public.route_plan_drafts
group by owner_id, planning_id
on conflict (owner_id, planning_id) do nothing;

create or replace function public.recommended_route_sections_match(
  sections jsonb, expected_from jsonb, expected_to jsonb,
  expected_distance integer, expected_duration integer
)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  section_item jsonb;
  road_item jsonb;
  vertex_item jsonb;
  vertex_position integer;
  vertex_count integer;
  section_distance_numeric numeric;
  section_duration_numeric numeric;
  road_distance_numeric numeric;
  road_duration_numeric numeric;
  section_distance bigint;
  section_duration bigint;
  road_distance bigint;
  road_duration bigint;
  road_distance_total bigint;
  road_duration_total bigint;
  section_distance_total bigint := 0;
  section_duration_total bigint := 0;
  coordinate double precision;
  endpoint_snap_tolerance constant double precision := 0.005;
  road_continuity_tolerance constant double precision := 0.0002;
  road_start_lon double precision;
  road_start_lat double precision;
  road_end_lon double precision;
  road_end_lat double precision;
  previous_end_lon double precision := null;
  previous_end_lat double precision := null;
begin
  if jsonb_typeof(sections) is distinct from 'array'
     or coalesce(jsonb_array_length(sections), 0) < 1
     or jsonb_typeof(expected_from -> 'longitude') is distinct from 'number'
     or jsonb_typeof(expected_from -> 'latitude') is distinct from 'number'
     or jsonb_typeof(expected_to -> 'longitude') is distinct from 'number'
     or jsonb_typeof(expected_to -> 'latitude') is distinct from 'number'
     or expected_distance is null or expected_distance <= 0
     or expected_duration is null or expected_duration <= 0 then
    return false;
  end if;

  for section_item in select value from jsonb_array_elements(sections) loop
    if jsonb_typeof(section_item) is distinct from 'object'
       or jsonb_typeof(section_item -> 'distance') is distinct from 'number'
       or jsonb_typeof(section_item -> 'duration') is distinct from 'number'
       or jsonb_typeof(section_item -> 'roads') is distinct from 'array'
       or coalesce(jsonb_array_length(section_item -> 'roads'), 0) < 1 then
      return false;
    end if;
    section_distance_numeric := (section_item ->> 'distance')::numeric;
    section_duration_numeric := (section_item ->> 'duration')::numeric;
    if section_distance_numeric <= 0 or section_distance_numeric <> trunc(section_distance_numeric)
       or section_duration_numeric <= 0 or section_duration_numeric <> trunc(section_duration_numeric)
       or section_distance_numeric > 9223372036854775807
       or section_duration_numeric > 9223372036854775807 then
      return false;
    end if;
    section_distance := section_distance_numeric::bigint;
    section_duration := section_duration_numeric::bigint;
    road_distance_total := 0;
    road_duration_total := 0;

    for road_item in select value from jsonb_array_elements(section_item -> 'roads') loop
      if jsonb_typeof(road_item) is distinct from 'object'
         or jsonb_typeof(road_item -> 'distance') is distinct from 'number'
         or jsonb_typeof(road_item -> 'duration') is distinct from 'number'
         or jsonb_typeof(road_item -> 'vertexes') is distinct from 'array' then
        return false;
      end if;
      road_distance_numeric := (road_item ->> 'distance')::numeric;
      road_duration_numeric := (road_item ->> 'duration')::numeric;
      if road_distance_numeric < 0 or road_distance_numeric <> trunc(road_distance_numeric)
         or road_duration_numeric < 0 or road_duration_numeric <> trunc(road_duration_numeric)
         or road_distance_numeric > 9223372036854775807
         or road_duration_numeric > 9223372036854775807 then
        return false;
      end if;
      road_distance := road_distance_numeric::bigint;
      road_duration := road_duration_numeric::bigint;
      vertex_count := jsonb_array_length(road_item -> 'vertexes');
      if vertex_count < 4 or vertex_count % 2 <> 0 then return false; end if;

      for vertex_item, vertex_position in
        select value, ordinality::integer
        from jsonb_array_elements(road_item -> 'vertexes') with ordinality
      loop
        if jsonb_typeof(vertex_item) is distinct from 'number' then return false; end if;
        coordinate := (vertex_item #>> '{}')::double precision;
        if (vertex_position % 2 = 1 and (coordinate < 124.5 or coordinate > 132))
           or (vertex_position % 2 = 0 and (coordinate < 32.8 or coordinate > 38.7)) then
          return false;
        end if;
      end loop;

      road_start_lon := (road_item -> 'vertexes' ->> 0)::double precision;
      road_start_lat := (road_item -> 'vertexes' ->> 1)::double precision;
      road_end_lon := (road_item -> 'vertexes' ->> (vertex_count - 2))::double precision;
      road_end_lat := (road_item -> 'vertexes' ->> (vertex_count - 1))::double precision;
      if previous_end_lon is null then
        if abs(road_start_lon - (expected_from ->> 'longitude')::double precision) > endpoint_snap_tolerance
           or abs(road_start_lat - (expected_from ->> 'latitude')::double precision) > endpoint_snap_tolerance then
          return false;
        end if;
      elsif abs(road_start_lon - previous_end_lon) > road_continuity_tolerance
         or abs(road_start_lat - previous_end_lat) > road_continuity_tolerance then
        return false;
      end if;
      previous_end_lon := road_end_lon;
      previous_end_lat := road_end_lat;
      road_distance_total := road_distance_total + road_distance;
      road_duration_total := road_duration_total + road_duration;
    end loop;

    if road_distance_total <> section_distance or road_duration_total <> section_duration then
      return false;
    end if;
    section_distance_total := section_distance_total + section_distance;
    section_duration_total := section_duration_total + section_duration;
  end loop;

  return coalesce(
    section_distance_total = expected_distance
    and section_duration_total = expected_duration
    and abs(previous_end_lon - (expected_to ->> 'longitude')::double precision) <= endpoint_snap_tolerance
    and abs(previous_end_lat - (expected_to ->> 'latitude')::double precision) <= endpoint_snap_tolerance,
    false
  );
exception when others then
  return false;
end;
$$;

create or replace function public.recommended_route_matches_plan(plan jsonb, route jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  expected_points jsonb;
  expected_count integer;
  leg_count integer;
  leg_item jsonb;
  expected_from jsonb;
  expected_to jsonb;
  leg_position integer;
  departure_time timestamptz;
  cursor_time timestamptz;
  arrival_time timestamptz;
  return_time timestamptz;
  duration_seconds integer;
  dwell_minutes integer;
  distance_meters integer;
  total_distance bigint := 0;
  total_duration bigint := 0;
begin
  if jsonb_typeof(plan) is distinct from 'object'
     or jsonb_typeof(route) is distinct from 'object'
     or jsonb_typeof(plan -> 'origin') is distinct from 'object'
     or jsonb_typeof(plan -> 'destination') is distinct from 'object'
     or jsonb_typeof(plan -> 'waypoints') is distinct from 'array'
     or plan ->> 'selectedProfile' is distinct from 'recommended'
     or route -> 'candidate' ->> 'id' is distinct from 'recommended'
     or route -> 'safety' ->> 'vehicle' is distinct from 'motorcycle'
     or route -> 'safety' ->> 'motorwayExcluded' is distinct from 'true'
     or route -> 'safety' ->> 'fallbackUsed' is distinct from 'false'
     or jsonb_typeof(route -> 'legs') is distinct from 'array'
     or exists (
       select 1 from jsonb_array_elements(plan -> 'waypoints') point
       where point ->> 'selected' is distinct from 'true'
     ) then
    return false;
  end if;

  expected_points := jsonb_build_array(plan -> 'origin') ||
    coalesce((select jsonb_agg(point order by position)
      from jsonb_array_elements(plan -> 'waypoints') with ordinality as points(point, position)), '[]'::jsonb) ||
    jsonb_build_array(plan -> 'destination');
  expected_count := jsonb_array_length(expected_points);
  leg_count := jsonb_array_length(route -> 'legs');
  if expected_count < 3 or leg_count <> expected_count - 1 then return false; end if;

  departure_time := (plan ->> 'departureAt')::timestamptz;
  cursor_time := departure_time;

  for leg_item, leg_position in
    select leg, position::integer
    from jsonb_array_elements(route -> 'legs') with ordinality as legs(leg, position)
  loop
    expected_from := expected_points -> (leg_position - 1);
    expected_to := expected_points -> leg_position;
    duration_seconds := (leg_item ->> 'durationSeconds')::integer;
    dwell_minutes := (leg_item ->> 'dwellMinutes')::integer;
    distance_meters := (leg_item ->> 'distanceMeters')::integer;
    arrival_time := (leg_item ->> 'arrivalAt')::timestamptz;

    if leg_item -> 'from' ->> 'id' is distinct from expected_from ->> 'id'
       or leg_item -> 'from' -> 'longitude' is distinct from expected_from -> 'longitude'
       or leg_item -> 'from' -> 'latitude' is distinct from expected_from -> 'latitude'
       or leg_item -> 'from' ->> 'kind' is distinct from expected_from ->> 'kind'
       or leg_item -> 'from' ->> 'dwellMinutes' is distinct from expected_from ->> 'dwellMinutes'
       or leg_item -> 'from' ->> 'selected' is distinct from expected_from ->> 'selected'
       or leg_item -> 'from' ->> 'stopRole' is distinct from expected_from ->> 'stopRole'
       or coalesce((leg_item -> 'from' ->> 'winding')::boolean, false)
          is distinct from coalesce((expected_from ->> 'winding')::boolean, false)
       or leg_item -> 'to' ->> 'id' is distinct from expected_to ->> 'id'
       or leg_item -> 'to' -> 'longitude' is distinct from expected_to -> 'longitude'
       or leg_item -> 'to' -> 'latitude' is distinct from expected_to -> 'latitude'
       or leg_item -> 'to' ->> 'kind' is distinct from expected_to ->> 'kind'
       or leg_item -> 'to' ->> 'dwellMinutes' is distinct from expected_to ->> 'dwellMinutes'
       or leg_item -> 'to' ->> 'selected' is distinct from expected_to ->> 'selected'
       or leg_item -> 'to' ->> 'stopRole' is distinct from expected_to ->> 'stopRole'
       or coalesce((leg_item -> 'to' ->> 'winding')::boolean, false)
          is distinct from coalesce((expected_to ->> 'winding')::boolean, false)
       or dwell_minutes is distinct from (expected_to ->> 'dwellMinutes')::integer
       or duration_seconds is null or duration_seconds <= 0
       or distance_meters is null or distance_meters <= 0
       or (leg_item ->> 'departureAt')::timestamptz is distinct from cursor_time
       or arrival_time is distinct from cursor_time + make_interval(secs => duration_seconds)
       or jsonb_typeof(leg_item -> 'via') is distinct from 'array'
       or jsonb_array_length(leg_item -> 'via') is distinct from 0
       or public.recommended_route_sections_match(
         leg_item -> 'sections', expected_from, expected_to,
         distance_meters, duration_seconds
       ) is not true then
      return false;
    end if;

    total_distance := total_distance + distance_meters;
    total_duration := total_duration + duration_seconds + dwell_minutes * 60;
    cursor_time := arrival_time + make_interval(mins => dwell_minutes);
  end loop;

  return_time := (route ->> 'returnAt')::timestamptz;
  return coalesce(total_distance = (route ->> 'totalDistanceMeters')::bigint
    and total_duration = (route ->> 'totalDurationSeconds')::bigint
    and return_time = cursor_time
    and return_time - departure_time < interval '24 hours', false);
exception when others then
  return false;
end;
$$;

create or replace function public.save_trip_plan(plan jsonb, routes jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  target_trip_id uuid;
  departure_time timestamptz;
  desired_return_time timestamptz;
  hard_return_time timestamptz;
  service_day date;
  point_item jsonb;
  route_item jsonb;
  route_count integer;
  valid_route_count integer;
  distinct_profiles integer;
  lunch_count integer;
  matching_lunch_count integer;
  dinner_count integer;
  matching_dinner_count integer;
  rest_count integer;
  winding_count integer;
begin
  if current_user_id is null or not public.is_active_member(current_user_id) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;
  if jsonb_typeof(plan) <> 'object'
     or jsonb_typeof(routes) <> 'array'
     or jsonb_array_length(routes) not in (1, 3)
     or coalesce(plan ->> 'title', '') = ''
     or char_length(plan ->> 'title') > 120
     or not public.is_valid_plan_place(plan -> 'origin')
     or not public.is_valid_plan_place(plan -> 'destination')
     or not public.is_valid_plan_place(plan -> 'lunchStop')
     or not (plan ? 'dinnerStop')
     or (plan -> 'dinnerStop' <> 'null'::jsonb and not public.is_valid_plan_place(plan -> 'dinnerStop'))
     or not public.is_valid_collection_points(plan -> 'waypoints')
     or coalesce(plan ->> 'selectedProfile', '') not in ('recommended', 'balanced', 'winding', 'short') then
    raise exception 'INVALID_PLAN';
  end if;

  begin
    service_day := (plan ->> 'serviceDate')::date;
    departure_time := (plan ->> 'departureAt')::timestamptz;
    desired_return_time := (plan ->> 'desiredReturnAt')::timestamptz;
    hard_return_time := (plan ->> 'hardReturnAt')::timestamptz;
    target_trip_id := nullif(plan ->> 'tripId', '')::uuid;
  exception when others then
    raise exception 'INVALID_PLAN';
  end;

  if departure_time >= desired_return_time
     or desired_return_time > hard_return_time
     or hard_return_time - departure_time >= interval '24 hours'
     or (departure_time at time zone 'Asia/Seoul')::date <> service_day
     or (hard_return_time at time zone 'Asia/Seoul')::date <> service_day then
    raise exception 'INVALID_PLAN_TIME';
  end if;

  select
    count(*) filter (where point ->> 'stopRole' = 'lunch'),
    count(*) filter (
      where point ->> 'stopRole' = 'lunch'
        and point ->> 'id' = plan -> 'lunchStop' ->> 'id'
        and point -> 'longitude' = plan -> 'lunchStop' -> 'longitude'
        and point -> 'latitude' = plan -> 'lunchStop' -> 'latitude'
    ),
    count(*) filter (where point ->> 'stopRole' = 'dinner'),
    count(*) filter (
      where point ->> 'stopRole' = 'dinner'
        and point ->> 'id' = plan -> 'dinnerStop' ->> 'id'
        and point -> 'longitude' = plan -> 'dinnerStop' -> 'longitude'
        and point -> 'latitude' = plan -> 'dinnerStop' -> 'latitude'
    ),
    count(*) filter (where point ->> 'stopRole' = 'rest'),
    count(*) filter (where (point ->> 'winding')::boolean)
  into lunch_count, matching_lunch_count, dinner_count, matching_dinner_count,
       rest_count, winding_count
  from jsonb_array_elements(plan -> 'waypoints') as point;

  if lunch_count <> 1 or matching_lunch_count <> 1
     or rest_count > 1 or winding_count > 20
     or (plan -> 'dinnerStop' = 'null'::jsonb and dinner_count <> 0)
     or (plan -> 'dinnerStop' <> 'null'::jsonb and (dinner_count <> 1 or matching_dinner_count <> 1)) then
    raise exception 'INVALID_PLAN_STOPS';
  end if;

  select count(*), count(distinct route -> 'candidate' ->> 'id'), count(*) filter (
    where route -> 'candidate' ->> 'id' in ('recommended', 'balanced', 'winding', 'short')
      and route -> 'safety' ->> 'vehicle' = 'motorcycle'
      and route -> 'safety' ->> 'motorwayExcluded' = 'true'
      and route -> 'safety' ->> 'fallbackUsed' = 'false'
      and jsonb_typeof(route -> 'legs') = 'array'
      and jsonb_array_length(route -> 'legs') > 0
  )
  into route_count, distinct_profiles, valid_route_count
  from jsonb_array_elements(routes) as route;

  if not (
    plan ->> 'selectedProfile' = 'recommended'
    and route_count = 1 and distinct_profiles = 1 and valid_route_count = 1
    and routes -> 0 -> 'candidate' ->> 'id' = 'recommended'
    and public.recommended_route_matches_plan(plan, routes -> 0) is true
  ) and not (
    plan ->> 'selectedProfile' in ('balanced', 'winding', 'short')
    and route_count = 3 and distinct_profiles = 3 and valid_route_count = 3
    and not exists (
      select 1 from jsonb_array_elements(routes) route
      where route -> 'candidate' ->> 'id' not in ('balanced', 'winding', 'short')
    )
  ) then
    raise exception 'UNSAFE_ROUTE_RESPONSE';
  end if;

  if target_trip_id is null then
    insert into public.trips(
      user_id, title, service_date, departure_at, desired_return_at, hard_return_at,
      origin, destination, lunch_stop, dinner_stop, selected_profile
    ) values (
      current_user_id, btrim(plan ->> 'title'), service_day, departure_time,
      desired_return_time, hard_return_time, plan -> 'origin', plan -> 'destination',
      plan -> 'lunchStop', nullif(plan -> 'dinnerStop', 'null'::jsonb), plan ->> 'selectedProfile'
    ) returning id into target_trip_id;
  else
    perform 1 from public.trips
    where id = target_trip_id and user_id = current_user_id
    for update;
    if not found then raise exception 'TRIP_NOT_FOUND'; end if;

    update public.trips
    set title = btrim(plan ->> 'title'), service_date = service_day,
        departure_at = departure_time, desired_return_at = desired_return_time,
        hard_return_at = hard_return_time, origin = plan -> 'origin',
        destination = plan -> 'destination', lunch_stop = plan -> 'lunchStop',
        dinner_stop = nullif(plan -> 'dinnerStop', 'null'::jsonb),
        selected_profile = plan ->> 'selectedProfile', updated_at = now()
    where id = target_trip_id;

    delete from public.trip_waypoints where trip_id = target_trip_id;
    delete from public.route_cache where trip_id = target_trip_id;
  end if;

  for point_item in select value from jsonb_array_elements(plan -> 'waypoints') loop
    insert into public.trip_waypoints(
      trip_id, position, kind, label, point, dwell_minutes, is_selected, is_winding
    ) values (
      target_trip_id,
      (select coalesce(max(position), -1) + 1 from public.trip_waypoints where trip_id = target_trip_id),
      replace(point_item ->> 'kind', '-', '_')::public.waypoint_kind,
      point_item ->> 'label',
      extensions.st_setsrid(extensions.st_makepoint(
        (point_item ->> 'longitude')::double precision,
        (point_item ->> 'latitude')::double precision
      ), 4326)::extensions.geography,
      (point_item ->> 'dwellMinutes')::integer,
      (point_item ->> 'selected')::boolean,
      coalesce((point_item ->> 'winding')::boolean, false)
    );
  end loop;

  for route_item in select value from jsonb_array_elements(routes) loop
    insert into public.route_cache(trip_id, provider, profile, summary, computed_at, expires_at)
    values (
      target_trip_id, 'kakao', route_item -> 'candidate' ->> 'id', route_item,
      now(), now() + interval '24 hours'
    );
  end loop;

  return target_trip_id;
exception
  when raise_exception then raise;
  when others then raise exception 'INVALID_PLAN';
end;
$$;

create or replace function public.stage_route_candidate_internal(
  member_id uuid, target_planning_id uuid, staged_plan jsonb, staged_route jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  profile text := staged_route -> 'candidate' ->> 'id';
  fingerprint text;
  plan_hash text;
  route_hash text;
  run_status text;
  stored_plan_hash text;
  stored_route_hash text;
  existing_plan jsonb;
  existing_route jsonb;
begin
  if member_id is null or not exists (
    select 1 from public.memberships where user_id = member_id and revoked_at is null
  ) then raise exception 'MEMBERSHIP_REQUIRED'; end if;
  if target_planning_id is null
     or jsonb_typeof(staged_plan) <> 'object'
     or not public.is_valid_plan_place(staged_plan -> 'origin')
     or not public.is_valid_plan_place(staged_plan -> 'destination')
     or not public.is_valid_plan_place(staged_plan -> 'lunchStop')
     or not public.is_valid_collection_points(staged_plan -> 'waypoints')
     or profile not in ('recommended', 'balanced', 'winding', 'short')
     or staged_route -> 'safety' ->> 'vehicle' <> 'motorcycle'
     or staged_route -> 'safety' ->> 'motorwayExcluded' <> 'true'
     or staged_route -> 'safety' ->> 'fallbackUsed' <> 'false'
     or jsonb_typeof(staged_route -> 'legs') <> 'array'
     or jsonb_array_length(staged_route -> 'legs') < 1 then
    raise exception 'INVALID_STAGED_ROUTE';
  end if;
  if profile = 'recommended' and public.recommended_route_matches_plan(staged_plan, staged_route) is not true then
    raise exception 'INVALID_STAGED_ROUTE';
  end if;
  fingerprint := public.route_geometry_fingerprint(staged_route);
  if fingerprint is null or char_length(fingerprint) <> 64 then raise exception 'INVALID_STAGED_ROUTE'; end if;

  plan_hash := encode(extensions.digest(staged_plan::text, 'sha256'), 'hex');
  route_hash := encode(extensions.digest(staged_route::text, 'sha256'), 'hex');
  insert into public.route_plan_runs(owner_id, planning_id, plan_hash, route_hash)
  values (
    member_id, target_planning_id, plan_hash,
    case when profile = 'recommended' then route_hash else null end
  )
  on conflict (owner_id, planning_id) do nothing;

  select status, route_plan_runs.plan_hash, route_plan_runs.route_hash
  into run_status, stored_plan_hash, stored_route_hash
  from public.route_plan_runs
  where owner_id = member_id and planning_id = target_planning_id
  for update;
  if run_status is distinct from 'staging' then raise exception 'ROUTE_PLAN_ALREADY_CONSUMED'; end if;
  if stored_plan_hash is distinct from plan_hash
     or (profile = 'recommended' and stored_route_hash is distinct from route_hash) then
    raise exception 'PLANNING_ID_REUSED';
  end if;

  select plan, route into existing_plan, existing_route
  from public.route_plan_drafts
  where owner_id = member_id and planning_id = target_planning_id
    and candidate_profile = profile;
  if found then
    if existing_plan is distinct from staged_plan or existing_route is distinct from staged_route then
      raise exception 'PLANNING_ID_REUSED';
    end if;
    update public.route_plan_drafts set created_at = now()
    where owner_id = member_id and planning_id = target_planning_id
      and candidate_profile = profile;
    return;
  end if;

  delete from public.route_plan_drafts where created_at < now() - interval '1 hour';
  insert into public.route_plan_drafts(owner_id, planning_id, candidate_profile, plan, route, geometry_fingerprint)
  values (member_id, target_planning_id, profile, staged_plan, staged_route, fingerprint);
end;
$$;

create or replace function public.finalize_trip_plan(
  target_planning_id uuid, target_trip_id uuid default null
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
  profile_count integer;
  fingerprint_count integer;
  result_trip_id uuid;
  run_status text;
begin
  if current_user_id is null or not public.is_active_member(current_user_id) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;

  -- Migration-role fixtures and an in-flight pre-migration draft may not yet
  -- have a lifecycle row. Browser and service roles cannot insert drafts
  -- directly, so this compatibility backfill does not create a public replay
  -- path and never replaces an existing consumed tombstone.
  insert into public.route_plan_runs(owner_id, planning_id, plan_hash, route_hash, created_at)
  select owner_id, planning_id,
    encode(extensions.digest(min(plan::text), 'sha256'), 'hex'),
    case when count(*) = 1 and min(candidate_profile) = 'recommended'
      then encode(extensions.digest(min(route::text), 'sha256'), 'hex')
      else null
    end,
    min(created_at)
  from public.route_plan_drafts
  where owner_id = current_user_id and planning_id = target_planning_id
  group by owner_id, planning_id
  on conflict (owner_id, planning_id) do nothing;

  select status into run_status
  from public.route_plan_runs
  where owner_id = current_user_id and planning_id = target_planning_id
  for update;
  if not found or run_status <> 'staging' then raise exception 'ROUTE_PLAN_NOT_READY'; end if;

  with locked_drafts as materialized (
    select candidate_profile, plan, route
    from public.route_plan_drafts
    where owner_id = current_user_id and planning_id = target_planning_id
      and created_at >= now() - interval '10 minutes'
    order by case candidate_profile
      when 'recommended' then 0 when 'balanced' then 1 when 'winding' then 2 else 3 end
    for update
  )
  select count(*), count(distinct plan::text), count(distinct candidate_profile),
    count(distinct public.route_geometry_fingerprint(route)), min(plan::text)::jsonb,
    jsonb_agg(route order by case candidate_profile
      when 'recommended' then 0 when 'balanced' then 1 when 'winding' then 2 else 3 end)
  into draft_count, plan_count, profile_count, fingerprint_count, staged_plan, staged_routes
  from locked_drafts;

  if not (
    draft_count = 1 and plan_count = 1 and profile_count = 1 and fingerprint_count = 1
    and staged_plan ->> 'selectedProfile' = 'recommended'
    and staged_routes -> 0 -> 'candidate' ->> 'id' = 'recommended'
  ) and not (
    draft_count = 3 and plan_count = 1 and profile_count = 3 and fingerprint_count = 3
    and staged_plan ->> 'selectedProfile' in ('balanced', 'winding', 'short')
    and not exists (
      select 1 from jsonb_array_elements(staged_routes) route
      where route -> 'candidate' ->> 'id' not in ('balanced', 'winding', 'short')
    )
  ) then
    raise exception 'ROUTE_PLAN_NOT_READY';
  end if;

  staged_plan := case
    when target_trip_id is null then staged_plan - 'tripId'
    else jsonb_set(staged_plan, '{tripId}', to_jsonb(target_trip_id), true)
  end;
  result_trip_id := public.save_trip_plan(staged_plan, staged_routes);
  update public.route_plan_runs
  set status = 'consumed', saved_trip_id = result_trip_id, consumed_at = now()
  where owner_id = current_user_id and planning_id = target_planning_id
    and status = 'staging';
  if not found then raise exception 'ROUTE_PLAN_NOT_READY'; end if;
  delete from public.route_plan_drafts
  where owner_id = current_user_id and planning_id = target_planning_id;
  return result_trip_id;
end;
$$;

create or replace function public.insert_weather_snapshot_internal(
  member_id uuid, target_trip_id uuid, target_candidate_profile text,
  target_issued_at timestamptz, target_valid_until timestamptz,
  target_segments jsonb, target_request_hash text, target_created_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  route_summary jsonb;
  expected_points jsonb;
  received_points jsonb;
  created_snapshot_id uuid;
begin
  if member_id is null or not exists (
    select 1 from public.memberships where user_id = member_id and revoked_at is null
  ) then raise exception 'MEMBERSHIP_REQUIRED'; end if;
  if target_candidate_profile not in ('recommended', 'balanced', 'winding', 'short')
     or target_request_hash is null or target_request_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(target_segments) <> 'array'
     or jsonb_array_length(target_segments) not between 1 and 40
     or target_issued_at is null or target_valid_until <= target_issued_at
     or target_created_at is null then raise exception 'INVALID_WEATHER_SNAPSHOT'; end if;

  select r.summary into route_summary
  from public.route_cache r join public.trips t on t.id = r.trip_id
  where r.trip_id = target_trip_id and r.profile = target_candidate_profile
    and t.user_id = member_id
  for update of r;
  if not found then raise exception 'TRIP_NOT_FOUND'; end if;

  select jsonb_agg(jsonb_build_object(
    'id', target_candidate_profile || '-' || (position - 1)::text,
    'longitude', leg -> 'to' -> 'longitude', 'latitude', leg -> 'to' -> 'latitude',
    'eta', leg ->> 'arrivalAt') order by position)
  into expected_points
  from jsonb_array_elements(route_summary -> 'legs') with ordinality as route_leg(leg, position);

  select jsonb_agg(jsonb_build_object(
    'id', segment ->> 'id', 'longitude', segment -> 'longitude',
    'latitude', segment -> 'latitude', 'eta', segment ->> 'eta') order by position)
  into received_points
  from jsonb_array_elements(target_segments) with ordinality as weather_segment(segment, position);

  if expected_points is null or received_points is distinct from expected_points then
    raise exception 'INVALID_WEATHER_ROUTE';
  end if;

  insert into public.weather_snapshots(
    trip_id, source, issued_at, valid_until, segments, request_hash,
    candidate_profile, created_at, stale_observed_at, stale_reason, stale_failure_kind
  ) values (
    target_trip_id, 'kma', target_issued_at, target_valid_until, target_segments,
    target_request_hash, target_candidate_profile, target_created_at, null, null, null
  ) returning id into created_snapshot_id;
  return created_snapshot_id;
end;
$$;

-- Every newly issued share is schemaVersion 3 with one representative route.
-- Existing published snapshots are immutable rows and are never rewritten.
create or replace function public.build_trip_share_snapshot(target_trip_id uuid, target_owner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  trip_record public.trips%rowtype;
  representative_profile text;
  representative_route jsonb;
  snapshot jsonb;
begin
  select * into trip_record from public.trips
  where id = target_trip_id and user_id = target_owner_id;
  if not found then raise exception 'TRIP_NOT_FOUND'; end if;

  select r.profile, r.summary into representative_profile, representative_route
  from public.route_cache r
  where r.trip_id = trip_record.id and r.profile in ('recommended', 'balanced')
  order by case r.profile when 'recommended' then 0 else 1 end
  limit 1;
  if not found then raise exception 'ROUTE_NOT_FOUND'; end if;
  representative_route := jsonb_set(
    jsonb_set(
      jsonb_set(representative_route, '{candidate,id}', '"recommended"'::jsonb, false),
      '{candidate,label}', '"추천 경로"'::jsonb, false
    ),
    '{candidate,estimatedWinding}', 'false'::jsonb, false
  );

  select jsonb_build_object(
    'schemaVersion', 3,
    'trip', jsonb_build_object(
      'title', trip_record.title,
      'serviceDate', trip_record.service_date,
      'departureAt', trip_record.departure_at,
      'origin', public.share_place(trip_record.origin),
      'destination', public.share_place(trip_record.destination),
      'lunchStop', public.share_place(trip_record.lunch_stop),
      'dinnerStop', case when trip_record.dinner_stop is null then null else public.share_place(trip_record.dinner_stop) end
    ),
    'waypoints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', 'waypoint-' || w.position::text, 'position', w.position,
        'kind', replace(w.kind::text, '_', '-'), 'label', w.label,
        'longitude', extensions.st_x(w.point::extensions.geometry),
        'latitude', extensions.st_y(w.point::extensions.geometry),
        'dwellMinutes', w.dwell_minutes, 'selected', w.is_selected, 'winding', w.is_winding
      ) order by w.position)
      from public.trip_waypoints w where w.trip_id = trip_record.id
    ), '[]'::jsonb),
    'route', public.share_route(representative_route),
    'weather', (
      select jsonb_build_object(
        'source', w.source, 'issuedAt', w.issued_at, 'retrievedAt', w.created_at,
        'validUntil', w.valid_until, 'stale', w.stale_observed_at is not null,
        'staleObservedAt', w.stale_observed_at, 'staleReason', w.stale_reason,
        'failureKind', w.stale_failure_kind,
        'segments', public.share_weather_segments(case
          when representative_profile = 'recommended' then w.segments
          else (select jsonb_agg(
            jsonb_set(segment, '{id}', to_jsonb('recommended-' || (position - 1)::text), true)
            order by position)
            from jsonb_array_elements(w.segments) with ordinality as segments(segment, position))
          end)
      )
      from public.weather_snapshots w
      where w.trip_id = trip_record.id and w.candidate_profile = representative_profile
        and (
          select jsonb_agg(jsonb_build_object(
            'id', representative_profile || '-' || (position - 1)::text,
            'longitude', leg -> 'to' -> 'longitude', 'latitude', leg -> 'to' -> 'latitude',
            'eta', leg ->> 'arrivalAt') order by position)
          from jsonb_array_elements(representative_route -> 'legs') with ordinality as route_leg(leg, position)
        ) = (
          select jsonb_agg(jsonb_build_object(
            'id', segment ->> 'id', 'longitude', segment -> 'longitude',
            'latitude', segment -> 'latitude', 'eta', segment ->> 'eta') order by position)
          from jsonb_array_elements(w.segments) with ordinality as weather_segment(segment, position)
        )
      order by w.created_at desc limit 1
    )
  ) into snapshot;
  return snapshot;
end;
$$;

-- Keep the previously reviewed ACL boundary explicit after replacements.
revoke all on function public.save_trip_plan(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.recommended_route_matches_plan(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.recommended_route_sections_match(jsonb, jsonb, jsonb, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.stage_route_candidate_internal(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.stage_route_candidate_internal(uuid, uuid, jsonb, jsonb) to service_role;
revoke all on function public.finalize_trip_plan(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.finalize_trip_plan(uuid, uuid) to authenticated;
revoke all on function public.insert_weather_snapshot_internal(uuid, uuid, text, timestamptz, timestamptz, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.insert_weather_snapshot_internal(uuid, uuid, text, timestamptz, timestamptz, jsonb, text, timestamptz) to service_role;
revoke all on function public.build_trip_share_snapshot(uuid, uuid) from public, anon, authenticated, service_role;

commit;
