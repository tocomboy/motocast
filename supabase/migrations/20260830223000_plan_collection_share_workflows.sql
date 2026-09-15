alter table public.trips
  add column if not exists selected_profile text not null default 'balanced'
    check (selected_profile in ('balanced', 'winding', 'short'));

-- A version writer is constrained to the collection owner by RLS/RPC. The
-- original RESTRICT edge prevented the owner's Auth deletion from reaching the
-- collection -> versions cascade, leaving an undeletable account graph.
alter table public.collection_versions
  drop constraint if exists collection_versions_created_by_fkey;
alter table public.collection_versions
  add constraint collection_versions_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete cascade;

alter table public.weather_snapshots
  add column if not exists request_hash text
    check (request_hash is null or char_length(request_hash) = 64),
  add column if not exists candidate_profile text
    check (candidate_profile is null or candidate_profile in ('balanced', 'winding', 'short'));

create index if not exists weather_trip_request_idx
  on public.weather_snapshots(trip_id, candidate_profile, request_hash, created_at desc);

create or replace function public.is_valid_plan_place(place jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
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
    and jsonb_typeof(place -> 'selected') = 'boolean';
$$;

create or replace function public.is_valid_collection_points(points jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    jsonb_typeof(points) = 'array'
    and jsonb_array_length(points) between 1 and 30
    and not exists (
      select 1
      from jsonb_array_elements(points) as item
      where not public.is_valid_plan_place(item)
        or jsonb_typeof(item -> 'winding') <> 'boolean'
        or (
          item ? 'stopRole'
          and item -> 'stopRole' <> 'null'::jsonb
          and coalesce(item ->> 'stopRole', '') not in ('lunch', 'dinner', 'rest')
        )
    );
$$;

create or replace function public.save_collection_version(
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
  current_user_id uuid := auth.uid();
  owned_collection public.riding_collections%rowtype;
  next_version integer;
  created_version_id uuid;
begin
  if current_user_id is null or not public.is_active_member(current_user_id) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;
  if collection_title is null or char_length(btrim(collection_title)) not between 1 and 120
     or collection_description is null or char_length(collection_description) > 2000
     or not public.is_valid_collection_points(collection_points) then
    raise exception 'INVALID_COLLECTION';
  end if;

  if target_collection_id is null then
    insert into public.riding_collections(owner_id, title, description)
    values (current_user_id, btrim(collection_title), collection_description)
    returning * into owned_collection;
  else
    select * into owned_collection
    from public.riding_collections
    where id = target_collection_id and owner_id = current_user_id
    for update;

    if not found then
      raise exception 'COLLECTION_NOT_FOUND';
    end if;

    update public.riding_collections
    set title = btrim(collection_title),
        description = collection_description,
        updated_at = now()
    where id = owned_collection.id;
  end if;

  select coalesce(max(cv.version_number), 0) + 1 into next_version
  from public.collection_versions cv
  where cv.collection_id = owned_collection.id;

  insert into public.collection_versions(
    collection_id, version_number, title, description, points, created_by
  ) values (
    owned_collection.id, next_version, btrim(collection_title), collection_description,
    collection_points, current_user_id
  ) returning id into created_version_id;

  return query select owned_collection.id, created_version_id, next_version;
exception
  when raise_exception then raise;
  when others then
    raise exception 'INVALID_COLLECTION';
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
  route_profiles integer;
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
     or jsonb_array_length(routes) <> 3
     or coalesce(plan ->> 'title', '') = ''
     or char_length(plan ->> 'title') > 120
     or not public.is_valid_plan_place(plan -> 'origin')
     or not public.is_valid_plan_place(plan -> 'destination')
     or not public.is_valid_plan_place(plan -> 'lunchStop')
     or not (plan ? 'dinnerStop')
     or (plan -> 'dinnerStop' <> 'null'::jsonb and not public.is_valid_plan_place(plan -> 'dinnerStop'))
     or not public.is_valid_collection_points(plan -> 'waypoints')
     or coalesce(plan ->> 'selectedProfile', '') not in ('balanced', 'winding', 'short') then
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

  select count(distinct route -> 'candidate' ->> 'id') into route_profiles
  from jsonb_array_elements(routes) as route
  where route -> 'candidate' ->> 'id' in ('balanced', 'winding', 'short')
    and route -> 'safety' ->> 'vehicle' = 'motorcycle'
    and route -> 'safety' ->> 'motorwayExcluded' = 'true'
    and route -> 'safety' ->> 'fallbackUsed' = 'false'
    and jsonb_typeof(route -> 'legs') = 'array'
    and jsonb_array_length(route -> 'legs') > 0;
  if route_profiles <> 3 then
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
    if not found then
      raise exception 'TRIP_NOT_FOUND';
    end if;

    update public.trips
    set title = btrim(plan ->> 'title'),
        service_date = service_day,
        departure_at = departure_time,
        desired_return_at = desired_return_time,
        hard_return_at = hard_return_time,
        origin = plan -> 'origin',
        destination = plan -> 'destination',
        lunch_stop = plan -> 'lunchStop',
        dinner_stop = nullif(plan -> 'dinnerStop', 'null'::jsonb),
        selected_profile = plan ->> 'selectedProfile',
        updated_at = now()
    where id = target_trip_id;

    delete from public.trip_waypoints where trip_id = target_trip_id;
    delete from public.route_cache where trip_id = target_trip_id;
  end if;

  for point_item in select value from jsonb_array_elements(plan -> 'waypoints')
  loop
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

  for route_item in select value from jsonb_array_elements(routes)
  loop
    insert into public.route_cache(trip_id, provider, profile, summary, computed_at, expires_at)
    values (
      target_trip_id, 'kakao', route_item -> 'candidate' ->> 'id', route_item,
      now(), now() + interval '24 hours'
    );
  end loop;

  return target_trip_id;
exception
  when raise_exception then raise;
  when others then
    raise exception 'INVALID_PLAN';
end;
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
  select * into trip_record
  from public.trips
  where id = target_trip_id and user_id = target_owner_id;
  if not found then
    raise exception 'TRIP_NOT_FOUND';
  end if;

  select jsonb_build_object(
    'schemaVersion', 1,
    'trip', jsonb_build_object(
      'title', trip_record.title,
      'serviceDate', trip_record.service_date,
      'departureAt', trip_record.departure_at,
      'desiredReturnAt', trip_record.desired_return_at,
      'hardReturnAt', trip_record.hard_return_at,
      'origin', trip_record.origin - 'verificationToken',
      'destination', trip_record.destination - 'verificationToken',
      'lunchStop', trip_record.lunch_stop - 'verificationToken',
      'dinnerStop', case when trip_record.dinner_stop is null then null else trip_record.dinner_stop - 'verificationToken' end,
      'selectedProfile', trip_record.selected_profile
    ),
    'waypoints', coalesce((
      select jsonb_agg(jsonb_build_object(
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
      select jsonb_agg(jsonb_build_object('profile', r.profile, 'route', r.summary) order by
        case r.profile when 'balanced' then 1 when 'winding' then 2 else 3 end)
      from public.route_cache r where r.trip_id = trip_record.id
    ), '[]'::jsonb),
    'weather', (
      select jsonb_build_object(
        'source', w.source,
        'issuedAt', w.issued_at,
        'retrievedAt', w.created_at,
        'candidateProfile', w.candidate_profile,
        'segments', w.segments
      )
      from public.weather_snapshots w
      join public.route_cache r
        on r.trip_id = w.trip_id and r.profile = w.candidate_profile
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

create or replace function public.preview_trip_share(target_trip_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null or not public.is_active_member(current_user_id) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;
  return public.build_trip_share_snapshot(target_trip_id, current_user_id);
end;
$$;

create or replace function public.publish_trip_share(target_trip_id uuid)
returns table(share_id uuid, share_token text, published_snapshot jsonb)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  raw_token text;
  snapshot jsonb;
  created_share_id uuid;
begin
  if current_user_id is null or not public.is_active_member(current_user_id) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;
  snapshot := public.build_trip_share_snapshot(target_trip_id, current_user_id);
  raw_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  insert into public.share_links(owner_id, token_hash, published_snapshot)
  values (current_user_id, encode(extensions.digest(raw_token, 'sha256'), 'hex'), snapshot)
  returning id into created_share_id;

  return query select created_share_id, raw_token, snapshot;
end;
$$;

create or replace function public.revoke_share(target_share_id uuid)
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
  update public.share_links
  set revoked_at = now()
  where id = target_share_id and owner_id = current_user_id and revoked_at is null;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'SHARE_NOT_FOUND';
  end if;
end;
$$;

create or replace function public.resolve_share(share_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  snapshot jsonb;
begin
  if share_token is null or share_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'SHARE_NOT_FOUND';
  end if;
  select published_snapshot into snapshot
  from public.share_links
  where token_hash = encode(extensions.digest(share_token, 'sha256'), 'hex')
    and revoked_at is null;
  if snapshot is null then
    raise exception 'SHARE_NOT_FOUND';
  end if;
  return snapshot;
end;
$$;

revoke all on function public.is_valid_plan_place(jsonb) from public, anon, authenticated;
revoke all on function public.is_valid_collection_points(jsonb) from public, anon, authenticated;
revoke all on function public.save_collection_version(uuid, text, text, jsonb) from public, anon;
revoke all on function public.save_trip_plan(jsonb, jsonb) from public, anon;
revoke all on function public.build_trip_share_snapshot(uuid, uuid) from public, anon, authenticated;
revoke all on function public.preview_trip_share(uuid) from public, anon;
revoke all on function public.publish_trip_share(uuid) from public, anon;
revoke all on function public.revoke_share(uuid) from public, anon;
revoke all on function public.resolve_share(text) from public;

grant execute on function public.save_collection_version(uuid, text, text, jsonb) to authenticated;
grant execute on function public.save_trip_plan(jsonb, jsonb) to authenticated;
grant execute on function public.preview_trip_share(uuid) to authenticated;
grant execute on function public.publish_trip_share(uuid) to authenticated;
grant execute on function public.revoke_share(uuid) to authenticated;
grant execute on function public.resolve_share(text) to anon, authenticated;
