-- Preview decision: new collection versions own a complete reusable course.
-- Existing waypoint-only versions remain stored but are not treated as complete
-- courses by the application. No destructive data rewrite is performed.

alter table public.collection_versions
  add column if not exists origin jsonb,
  add column if not exists destination jsonb;

-- Preview data is disposable, so the current writer may represent a ride with
-- no meal stop directly instead of manufacturing a compatibility placeholder.
alter table public.trips alter column lunch_stop drop not null;

create or replace function public.is_valid_collection_points(points jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_typeof(points) = 'array'
    and jsonb_array_length(points) between 0 and 30
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

create or replace function public.is_valid_verified_collection_points(points jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    public.is_valid_collection_points(points)
    and not exists (
      select 1 from jsonb_array_elements(points) as item
      where coalesce(item ->> 'kakaoPlaceId', '') = ''
        or char_length(item ->> 'kakaoPlaceId') not between 1 and 80
        or coalesce(item ->> 'name', '') = ''
        or char_length(item ->> 'name') not between 1 and 160
        or coalesce(item ->> 'address', '') = ''
        or char_length(item ->> 'address') not between 1 and 300
        or not (item ? 'roadAddress')
        or (item -> 'roadAddress' <> 'null'::jsonb and jsonb_typeof(item -> 'roadAddress') is distinct from 'string')
        or (item -> 'roadAddress' <> 'null'::jsonb and char_length(item ->> 'roadAddress') > 300)
        or coalesce(item ->> 'verificationToken', '') !~ '^[A-Za-z0-9_-]{43}$'
    ),
    false
  );
$$;

create or replace function public.is_valid_verified_collection_place(place jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_typeof(place) = 'object'
    and coalesce(place ->> 'kakaoPlaceId', '') <> ''
    and char_length(place ->> 'kakaoPlaceId') between 1 and 80
    and coalesce(place ->> 'name', '') <> ''
    and char_length(place ->> 'name') between 1 and 160
    and coalesce(place ->> 'address', '') <> ''
    and char_length(place ->> 'address') between 1 and 300
    and place ? 'roadAddress'
    and (place -> 'roadAddress' = 'null'::jsonb or jsonb_typeof(place -> 'roadAddress') = 'string')
    and (place -> 'roadAddress' = 'null'::jsonb or char_length(place ->> 'roadAddress') <= 300)
    and jsonb_typeof(place -> 'longitude') = 'number'
    and jsonb_typeof(place -> 'latitude') = 'number'
    and (place ->> 'longitude')::double precision between 124.5 and 132
    and (place ->> 'latitude')::double precision between 32.8 and 38.7
    and coalesce(place ->> 'verificationToken', '') ~ '^[A-Za-z0-9_-]{43}$',
    false
  );
$$;

create or replace function public.is_valid_verified_collection_course(course jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_typeof(course) = 'object'
    and public.is_valid_verified_collection_place(course -> 'origin')
    and public.is_valid_verified_collection_place(course -> 'destination')
    and public.is_valid_verified_collection_points(course -> 'points')
    and not exists (
      select 1 from jsonb_array_elements(course -> 'points') item
      where (item ->> 'selected')::boolean is distinct from true
    )
    and (
      select count(*) = count(distinct (item ->> 'id'))
      from jsonb_array_elements(course -> 'points') item
    )
    and not exists (
      select 1 from jsonb_array_elements(course -> 'points') item
      where coalesce((item ->> 'winding')::boolean, false)
        and (
          item ->> 'kind' <> 'pass-through'
          or (item ->> 'dwellMinutes')::integer <> 0
          or (item ? 'stopRole' and item -> 'stopRole' <> 'null'::jsonb)
        )
    )
    and (
      select count(*) <= 1
      from jsonb_array_elements(course -> 'points') item
      where item ->> 'stopRole' = 'lunch' and item ->> 'kind' = 'stop'
    )
    and not exists (
      select 1 from jsonb_array_elements(course -> 'points') item
      where item ->> 'stopRole' = 'lunch' and item ->> 'kind' <> 'stop'
    )
    and (
      select count(*) <= 1
      from jsonb_array_elements(course -> 'points') item
      where item ->> 'stopRole' = 'dinner'
    )
    and not exists (
      select 1 from jsonb_array_elements(course -> 'points') item
      where item ->> 'stopRole' = 'dinner' and item ->> 'kind' <> 'stop'
    )
    and (
      select count(*) <= 5
      from jsonb_array_elements(course -> 'points') item
      where item ->> 'stopRole' = 'rest'
    )
    and not exists (
      select 1 from jsonb_array_elements(course -> 'points') item
      where item ->> 'stopRole' = 'rest' and item ->> 'kind' <> 'optional'
    )
    and (
      select count(*) <= 20
      from jsonb_array_elements(course -> 'points') item
      where coalesce((item ->> 'winding')::boolean, false)
    ),
    false
  );
$$;

create or replace function public.is_valid_current_plan_stops(plan jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  with stop_counts as (
    select
      count(*) filter (where item ->> 'stopRole' = 'lunch') as lunches,
      count(*) filter (
        where item ->> 'stopRole' = 'lunch'
          and item ->> 'id' = plan -> 'lunchStop' ->> 'id'
          and item -> 'longitude' = plan -> 'lunchStop' -> 'longitude'
          and item -> 'latitude' = plan -> 'lunchStop' -> 'latitude'
      ) as matching_lunches,
      count(*) filter (where item ->> 'stopRole' = 'dinner') as dinners,
      count(*) filter (
        where item ->> 'stopRole' = 'dinner'
          and item ->> 'id' = plan -> 'dinnerStop' ->> 'id'
          and item -> 'longitude' = plan -> 'dinnerStop' -> 'longitude'
          and item -> 'latitude' = plan -> 'dinnerStop' -> 'latitude'
      ) as matching_dinners,
      count(*) filter (where item ->> 'stopRole' = 'rest') as rests,
      count(*) filter (where coalesce((item ->> 'winding')::boolean, false)) as winding_points,
      count(*) as point_count,
      count(distinct item ->> 'id') as distinct_ids
    from jsonb_array_elements(plan -> 'waypoints') item
  )
  select coalesce(
    jsonb_typeof(plan) = 'object'
    and plan ? 'lunchStop'
    and (plan -> 'lunchStop' = 'null'::jsonb or public.is_valid_plan_place(plan -> 'lunchStop'))
    and plan ? 'dinnerStop'
    and (plan -> 'dinnerStop' = 'null'::jsonb or public.is_valid_plan_place(plan -> 'dinnerStop'))
    and public.is_valid_collection_points(plan -> 'waypoints')
    and not exists (
      select 1 from jsonb_array_elements(plan -> 'waypoints') item
      where (item ->> 'selected')::boolean is distinct from true
        or (
          coalesce((item ->> 'winding')::boolean, false)
          and (
            item ->> 'kind' <> 'pass-through'
            or (item ->> 'dwellMinutes')::integer <> 0
            or (item ? 'stopRole' and item -> 'stopRole' <> 'null'::jsonb)
          )
        )
        or (item ->> 'stopRole' in ('lunch', 'dinner') and (
          item ->> 'kind' <> 'stop' or (item ->> 'dwellMinutes')::integer <= 0
        ))
        or (item ->> 'stopRole' = 'rest' and (
          item ->> 'kind' <> 'optional' or (item ->> 'dwellMinutes')::integer <= 0
        ))
        or (item ->> 'kind' <> 'pass-through' and coalesce(item ->> 'stopRole', '') = '')
    )
    and (select point_count = distinct_ids from stop_counts)
    and (select lunches <= 1 and dinners <= 1 and rests <= 5 and winding_points <= 20 from stop_counts)
    and (
      (plan -> 'lunchStop' = 'null'::jsonb and (select lunches = 0 from stop_counts))
      or (plan -> 'lunchStop' <> 'null'::jsonb and (select lunches = 1 and matching_lunches = 1 from stop_counts))
    )
    and (
      (plan -> 'dinnerStop' = 'null'::jsonb and (select dinners = 0 from stop_counts))
      or (plan -> 'dinnerStop' <> 'null'::jsonb and (select dinners = 1 and matching_dinners = 1 from stop_counts))
    ),
    false
  );
$$;

do $rename_required_point_matcher$
begin
  if to_regprocedure('public.recommended_route_matches_plan_with_required_point(jsonb,jsonb)') is null then
    alter function public.recommended_route_matches_plan(jsonb, jsonb)
      rename to recommended_route_matches_plan_with_required_point;
  end if;
end;
$rename_required_point_matcher$;

create or replace function public.recommended_route_matches_plan(plan jsonb, route jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  leg jsonb;
  departure_time timestamptz;
  arrival_time timestamptz;
  duration_seconds integer;
  distance_meters integer;
begin
  if jsonb_typeof(plan -> 'waypoints') is distinct from 'array' then return false; end if;
  if jsonb_array_length(plan -> 'waypoints') > 0 then
    return public.recommended_route_matches_plan_with_required_point(plan, route);
  end if;
  if public.is_valid_current_plan_stops(plan) is not true
     or plan -> 'lunchStop' <> 'null'::jsonb
     or plan -> 'dinnerStop' <> 'null'::jsonb
     or plan ->> 'selectedProfile' is distinct from 'recommended'
     or route -> 'candidate' ->> 'id' is distinct from 'recommended'
     or route -> 'safety' ->> 'vehicle' is distinct from 'motorcycle'
     or route -> 'safety' ->> 'motorwayExcluded' is distinct from 'true'
     or route -> 'safety' ->> 'fallbackUsed' is distinct from 'false'
     or jsonb_typeof(route -> 'legs') is distinct from 'array'
     or jsonb_array_length(route -> 'legs') <> 1
     or not (plan ? 'tripId') or not (plan ? 'targetUpdatedAt')
     or jsonb_typeof(plan -> 'tripId') not in ('null', 'string')
     or jsonb_typeof(plan -> 'targetUpdatedAt') not in ('null', 'string')
     or ((plan -> 'tripId' = 'null'::jsonb) is distinct from (plan -> 'targetUpdatedAt' = 'null'::jsonb)) then
    return false;
  end if;

  leg := route -> 'legs' -> 0;
  departure_time := (plan ->> 'departureAt')::timestamptz;
  arrival_time := (leg ->> 'arrivalAt')::timestamptz;
  duration_seconds := (leg ->> 'durationSeconds')::integer;
  distance_meters := (leg ->> 'distanceMeters')::integer;
  return coalesce(
    leg -> 'from' ->> 'id' is not distinct from plan -> 'origin' ->> 'id'
    and leg -> 'from' -> 'longitude' is not distinct from plan -> 'origin' -> 'longitude'
    and leg -> 'from' -> 'latitude' is not distinct from plan -> 'origin' -> 'latitude'
    and leg -> 'from' ->> 'kind' is not distinct from plan -> 'origin' ->> 'kind'
    and leg -> 'from' ->> 'dwellMinutes' is not distinct from plan -> 'origin' ->> 'dwellMinutes'
    and leg -> 'from' ->> 'selected' is not distinct from plan -> 'origin' ->> 'selected'
    and leg -> 'from' ->> 'stopRole' is not distinct from plan -> 'origin' ->> 'stopRole'
    and coalesce((leg -> 'from' ->> 'winding')::boolean, false)
      is not distinct from coalesce((plan -> 'origin' ->> 'winding')::boolean, false)
    and leg -> 'to' ->> 'id' is not distinct from plan -> 'destination' ->> 'id'
    and leg -> 'to' -> 'longitude' is not distinct from plan -> 'destination' -> 'longitude'
    and leg -> 'to' -> 'latitude' is not distinct from plan -> 'destination' -> 'latitude'
    and leg -> 'to' ->> 'kind' is not distinct from plan -> 'destination' ->> 'kind'
    and leg -> 'to' ->> 'dwellMinutes' is not distinct from plan -> 'destination' ->> 'dwellMinutes'
    and leg -> 'to' ->> 'selected' is not distinct from plan -> 'destination' ->> 'selected'
    and leg -> 'to' ->> 'stopRole' is not distinct from plan -> 'destination' ->> 'stopRole'
    and coalesce((leg -> 'to' ->> 'winding')::boolean, false)
      is not distinct from coalesce((plan -> 'destination' ->> 'winding')::boolean, false)
    and jsonb_typeof(leg -> 'via') = 'array' and jsonb_array_length(leg -> 'via') = 0
    and (leg ->> 'departureAt')::timestamptz = departure_time
    and duration_seconds > 0 and distance_meters > 0
    and arrival_time = departure_time + make_interval(secs => duration_seconds)
    and (leg ->> 'dwellMinutes')::integer = 0
    and public.recommended_route_sections_match(
      leg -> 'sections', plan -> 'origin', plan -> 'destination', distance_meters, duration_seconds
    ) is true
    and (route ->> 'totalDistanceMeters')::bigint = distance_meters
    and (route ->> 'totalDurationSeconds')::bigint = duration_seconds
    and (route ->> 'returnAt')::timestamptz = arrival_time
    and arrival_time - departure_time < interval '24 hours',
    false
  );
exception when others then
  return false;
end;
$$;

do $rename_required_lunch_saver$
begin
  if to_regprocedure('public.save_trip_plan_with_required_lunch(jsonb,jsonb)') is null then
    alter function public.save_trip_plan(jsonb, jsonb)
      rename to save_trip_plan_with_required_lunch;
  end if;
end;
$rename_required_lunch_saver$;

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
  expected_updated_at timestamptz;
  point_item jsonb;
  route_item jsonb;
begin
  if plan ->> 'selectedProfile' is distinct from 'recommended' then
    return public.save_trip_plan_with_required_lunch(plan, routes);
  end if;
  if current_user_id is null or not public.is_active_member(current_user_id) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;
  if jsonb_typeof(plan) <> 'object'
     or jsonb_typeof(routes) <> 'array' or jsonb_array_length(routes) <> 1
     or coalesce(plan ->> 'title', '') = '' or char_length(plan ->> 'title') > 120
     or not public.is_valid_plan_place(plan -> 'origin')
     or not public.is_valid_plan_place(plan -> 'destination')
     or public.is_valid_current_plan_stops(plan) is not true then
    raise exception 'INVALID_PLAN';
  end if;
  if routes -> 0 -> 'candidate' ->> 'id' is distinct from 'recommended'
     or public.recommended_route_matches_plan(plan, routes -> 0) is not true then
    raise exception 'UNSAFE_ROUTE_RESPONSE';
  end if;

  begin
    service_day := (plan ->> 'serviceDate')::date;
    departure_time := (plan ->> 'departureAt')::timestamptz;
    desired_return_time := (plan ->> 'desiredReturnAt')::timestamptz;
    hard_return_time := (plan ->> 'hardReturnAt')::timestamptz;
    target_trip_id := nullif(plan ->> 'tripId', '')::uuid;
    expected_updated_at := (plan ->> 'targetUpdatedAt')::timestamptz;
  exception when others then
    raise exception 'INVALID_PLAN';
  end;

  if (target_trip_id is null) is distinct from (expected_updated_at is null) then
    raise exception 'INVALID_PLAN';
  end if;
  if departure_time >= desired_return_time
     or desired_return_time > hard_return_time
     or hard_return_time - departure_time >= interval '24 hours'
     or (departure_time at time zone 'Asia/Seoul')::date <> service_day
     or (hard_return_time at time zone 'Asia/Seoul')::date <> service_day then
    raise exception 'INVALID_PLAN_TIME';
  end if;

  if target_trip_id is null then
    insert into public.trips(
      user_id, title, service_date, departure_at, desired_return_at, hard_return_at,
      origin, destination, lunch_stop, dinner_stop, selected_profile
    ) values (
      current_user_id, btrim(plan ->> 'title'), service_day, departure_time,
      desired_return_time, hard_return_time, plan -> 'origin', plan -> 'destination',
      nullif(plan -> 'lunchStop', 'null'::jsonb),
      nullif(plan -> 'dinnerStop', 'null'::jsonb), 'recommended'
    ) returning id into target_trip_id;
  else
    perform 1 from public.trips
    where id = target_trip_id and user_id = current_user_id and updated_at = expected_updated_at
    for update;
    if not found then raise exception 'TRIP_VERSION_CONFLICT'; end if;

    update public.trips
    set title = btrim(plan ->> 'title'), service_date = service_day,
        departure_at = departure_time, desired_return_at = desired_return_time,
        hard_return_at = hard_return_time, origin = plan -> 'origin',
        destination = plan -> 'destination',
        lunch_stop = nullif(plan -> 'lunchStop', 'null'::jsonb),
        dinner_stop = nullif(plan -> 'dinnerStop', 'null'::jsonb),
        selected_profile = 'recommended', updated_at = now()
    where id = target_trip_id;
    if not found then raise exception 'TRIP_WRITE_DROPPED'; end if;

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

  route_item := routes -> 0;
  insert into public.route_cache(trip_id, provider, profile, summary, computed_at, expires_at)
  values (target_trip_id, 'kakao', 'recommended', route_item, now(), now() + interval '24 hours');
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
set search_path = public, extensions, pg_temp
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
     or public.is_valid_current_plan_stops(staged_plan) is not true
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
  ) on conflict (owner_id, planning_id) do nothing;

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

create or replace function public.share_place(place jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when place is null or place = 'null'::jsonb then null else jsonb_build_object(
    'id', place ->> 'id',
    'label', place ->> 'label',
    'longitude', place -> 'longitude',
    'latitude', place -> 'latitude'
  ) end;
$$;

create or replace function public.save_collection_version_internal(
  member_id uuid,
  target_collection_id uuid,
  collection_title text,
  collection_description text,
  collection_points jsonb
)
returns table(collection_id uuid, version_id uuid, version_number integer)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  owned_collection public.riding_collections%rowtype;
  next_version integer;
  created_version_id uuid;
begin
  if member_id is null or not exists (
    select 1 from public.memberships where user_id = member_id and revoked_at is null
  ) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;
  if collection_title is null or char_length(btrim(collection_title)) not between 1 and 120
     or collection_description is null or char_length(collection_description) > 2000
     or not public.is_valid_verified_collection_course(collection_points) then
    raise exception 'INVALID_COLLECTION';
  end if;

  if target_collection_id is null then
    insert into public.riding_collections(owner_id, title, description)
    values (member_id, btrim(collection_title), collection_description)
    returning * into owned_collection;
  else
    select * into owned_collection
    from public.riding_collections
    where id = target_collection_id and owner_id = member_id
    for update;
    if not found then raise exception 'COLLECTION_NOT_FOUND'; end if;
    update public.riding_collections
    set title = btrim(collection_title), description = collection_description, updated_at = now()
    where id = owned_collection.id;
    if not found then raise exception 'COLLECTION_WRITE_DROPPED'; end if;
  end if;

  select coalesce(max(cv.version_number), 0) + 1 into next_version
  from public.collection_versions cv
  where cv.collection_id = owned_collection.id;

  insert into public.collection_versions(
    collection_id, version_number, title, description, origin, destination, points, created_by
  ) values (
    owned_collection.id, next_version, btrim(collection_title), collection_description,
    collection_points -> 'origin', collection_points -> 'destination', collection_points -> 'points', member_id
  ) returning id into created_version_id;

  if created_version_id is null then raise exception 'COLLECTION_WRITE_DROPPED'; end if;
  return query select owned_collection.id, created_version_id, next_version;
exception
  when raise_exception then raise;
  when others then raise exception 'INVALID_COLLECTION';
end;
$$;

revoke all on function public.is_valid_verified_collection_place(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.is_valid_verified_collection_course(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.is_valid_current_plan_stops(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.recommended_route_matches_plan_with_required_point(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.recommended_route_matches_plan(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.save_trip_plan_with_required_lunch(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.save_trip_plan(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.save_collection_version_internal(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_collection_version_internal(uuid, uuid, text, text, jsonb) to service_role;
