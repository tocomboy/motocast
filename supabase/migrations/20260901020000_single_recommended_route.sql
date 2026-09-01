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
  fingerprint := public.route_geometry_fingerprint(staged_route);
  if fingerprint is null or char_length(fingerprint) <> 64 then raise exception 'INVALID_STAGED_ROUTE'; end if;

  delete from public.route_plan_drafts where created_at < now() - interval '1 hour';
  insert into public.route_plan_drafts(owner_id, planning_id, candidate_profile, plan, route, geometry_fingerprint)
  values (member_id, target_planning_id, profile, staged_plan, staged_route, fingerprint)
  on conflict (owner_id, planning_id, candidate_profile) do update
  set plan = excluded.plan, route = excluded.route,
      geometry_fingerprint = excluded.geometry_fingerprint, created_at = now();
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
  saved_trip_id uuid;
begin
  if current_user_id is null or not public.is_active_member(current_user_id) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;

  lock table public.route_plan_drafts in row exclusive mode;
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
  saved_trip_id := public.save_trip_plan(staged_plan, staged_routes);
  delete from public.route_plan_drafts
  where owner_id = current_user_id and planning_id = target_planning_id;
  return saved_trip_id;
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
        'segments', public.share_weather_segments(w.segments)
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
revoke all on function public.stage_route_candidate_internal(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.stage_route_candidate_internal(uuid, uuid, jsonb, jsonb) to service_role;
revoke all on function public.finalize_trip_plan(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.finalize_trip_plan(uuid, uuid) to authenticated;
revoke all on function public.insert_weather_snapshot_internal(uuid, uuid, text, timestamptz, timestamptz, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.insert_weather_snapshot_internal(uuid, uuid, text, timestamptz, timestamptz, jsonb, text, timestamptz) to service_role;
revoke all on function public.build_trip_share_snapshot(uuid, uuid) from public, anon, authenticated, service_role;

commit;
