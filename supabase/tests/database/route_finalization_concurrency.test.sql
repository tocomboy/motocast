\set ON_ERROR_STOP on

create extension if not exists dblink with schema extensions;

drop trigger if exists delay_test_finalize on public.trips;
drop function if exists public.delay_test_finalize();
drop function if exists public.test_finalize_route(uuid, uuid);
delete from auth.users where id = '75000000-0000-0000-0000-000000000001';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '75000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'route-concurrency@motocast.test', '',
  now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"경로 경합"}'
);
insert into public.memberships(user_id, role)
values ('75000000-0000-0000-0000-000000000001', 'rider');

create or replace function pg_temp.test_point(
  point_id text, point_label text, point_lon numeric, point_lat numeric,
  point_kind text, dwell integer, stop_role text default null
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', point_id, 'label', point_label, 'kakaoPlaceId', point_id,
    'verificationToken', repeat('a', 43), 'name', point_label,
    'address', '테스트 주소', 'roadAddress', null,
    'longitude', point_lon, 'latitude', point_lat,
    'kind', point_kind, 'dwellMinutes', dwell, 'selected', true,
    'winding', false, 'stopRole', stop_role
  );
$$;

create or replace function pg_temp.test_route(profile text, middle_lon numeric)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'candidate', jsonb_build_object(
      'id', profile, 'label', profile, 'estimatedWinding', false
    ),
    'safety', jsonb_build_object('vehicle', 'motorcycle', 'motorwayExcluded', true, 'fallbackUsed', false),
    'totalDistanceMeters', 10000,
    'totalDurationSeconds', 600,
    'returnAt', '2026-08-31T00:10:00.000Z',
    'legs', jsonb_build_array(jsonb_build_object(
      'from', pg_temp.test_point('origin', '출발', 127, 37, 'pass-through', 0),
      'to', pg_temp.test_point('destination', '복귀', 127.2, 37.2, 'pass-through', 0),
      'via', '[]'::jsonb,
      'departureAt', '2026-08-31T00:00:00.000Z',
      'arrivalAt', '2026-08-31T00:10:00.000Z',
      'dwellMinutes', 0,
      'distanceMeters', 10000,
      'durationSeconds', 600,
      'forecastTraffic', false,
      'sections', jsonb_build_array(jsonb_build_object(
        'distance', 10000, 'duration', 600,
        'roads', jsonb_build_array(jsonb_build_object(
          'name', '테스트 도로', 'distance', 10000, 'duration', 600,
          'vertexes', jsonb_build_array(127, 37, middle_lon, 37.1, 127.2, 37.2)
        ))
      ))
    ))
  );
$$;

create temp table route_fixture on commit preserve rows as
select
  jsonb_build_object(
    'title', '경합 계획',
    'serviceDate', '2026-08-31',
    'departureAt', '2026-08-31T00:00:00.000Z',
    'desiredReturnAt', '2026-08-31T08:00:00.000Z',
    'hardReturnAt', '2026-08-31T09:00:00.000Z',
    'origin', pg_temp.test_point('origin', '출발', 127, 37, 'pass-through', 0),
    'destination', pg_temp.test_point('destination', '복귀', 127.2, 37.2, 'pass-through', 0),
    'lunchStop', pg_temp.test_point('lunch', '점심', 127.1, 37.1, 'stop', 60, 'lunch'),
    'dinnerStop', null,
    'waypoints', jsonb_build_array(pg_temp.test_point('lunch', '점심', 127.1, 37.1, 'stop', 60, 'lunch')),
    'selectedProfile', 'balanced'
  ) as plan,
  jsonb_build_array(
    pg_temp.test_route('balanced', 127.05),
    pg_temp.test_route('winding', 127.1),
    pg_temp.test_route('short', 127.15)
  ) as routes;

select public.stage_route_candidate_internal(
  '75000000-0000-0000-0000-000000000001',
  '76000000-0000-4000-8000-000000000001',
  (select plan from route_fixture), route
)
from jsonb_array_elements((select routes from route_fixture)) as staged(route);

create or replace function public.test_finalize_route(target_planning_id uuid, target_trip_id uuid default null)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
begin
  return public.finalize_trip_plan(target_planning_id, target_trip_id)::text;
exception when others then
  return sqlerrm;
end;
$$;
grant execute on function public.test_finalize_route(uuid, uuid) to authenticated;

create or replace function public.delay_test_finalize()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.user_id = '75000000-0000-0000-0000-000000000001' then
    perform pg_sleep(1);
  end if;
  return new;
end;
$$;
create trigger delay_test_finalize before insert on public.trips
for each row execute function public.delay_test_finalize();

select dblink_connect('route_c1', 'host=127.0.0.1 port=5432 dbname=postgres user=supabase_admin password=postgres');
select dblink_connect('route_c2', 'host=127.0.0.1 port=5432 dbname=postgres user=supabase_admin password=postgres');
select dblink_connect('route_c3', 'host=127.0.0.1 port=5432 dbname=postgres user=supabase_admin password=postgres');
select dblink_exec('route_c1', 'set role authenticated');
select dblink_exec('route_c2', 'set role authenticated');
select dblink_exec('route_c1', 'set "request.jwt.claim.sub" = ''75000000-0000-0000-0000-000000000001''');
select dblink_exec('route_c2', 'set "request.jwt.claim.sub" = ''75000000-0000-0000-0000-000000000001''');
select dblink_send_query('route_c1', $$select public.test_finalize_route('76000000-0000-4000-8000-000000000001', null)$$);
select dblink_send_query('route_c2', $$select public.test_finalize_route('76000000-0000-4000-8000-000000000001', null)$$);

create temp table finalization_results(result text);
insert into finalization_results select result from dblink_get_result('route_c1') as response(result text);
insert into finalization_results select result from dblink_get_result('route_c2') as response(result text);
select result from dblink_get_result('route_c1') as response(result text);
select result from dblink_get_result('route_c2') as response(result text);

drop trigger delay_test_finalize on public.trips;
drop function public.delay_test_finalize();

create temp table tap_results(ok boolean not null, description text not null);
grant insert, select on tap_results to authenticated;
insert into tap_results values
  ((select count(*) = 1 from finalization_results where result ~ '^[0-9a-f-]{36}$'), 'concurrent finalizers produce exactly one saved trip'),
  ((select count(*) = 1 from finalization_results where result = 'ROUTE_PLAN_NOT_READY'), 'the losing finalizer fails closed after the draft is consumed'),
  ((select count(*) = 1 from public.trips where user_id = '75000000-0000-0000-0000-000000000001'), 'concurrent finalization never duplicates the trip aggregate'),
  ((select count(*) = 3 from public.route_cache r join public.trips t on t.id = r.trip_id where t.user_id = '75000000-0000-0000-0000-000000000001'), 'the winning finalization stores exactly three routes'),
  ((select count(*) = 0 from public.route_plan_drafts where owner_id = '75000000-0000-0000-0000-000000000001'), 'the winning finalization consumes all route drafts');

-- Legacy exact-three drafts remain readable/finalizable only as new plans. They
-- cannot target an existing trip because pre-migration staging did not bind a
-- trusted target identity or revision into the immutable plan hash.
insert into public.route_plan_drafts(owner_id, planning_id, candidate_profile, plan, route, geometry_fingerprint)
select
  '75000000-0000-0000-0000-000000000001',
  '76000000-0000-4000-8000-000000000002',
  route -> 'candidate' ->> 'id',
  jsonb_set((select plan from route_fixture), '{title}', '"롤백 뒤 바뀌면 안 됨"'::jsonb),
  route,
  public.route_geometry_fingerprint(route)
from jsonb_array_elements((select routes from route_fixture)) as staged(route);

set role authenticated;
select set_config('request.jwt.claim.sub', '75000000-0000-0000-0000-000000000001', false);
create temp table legacy_update_result as
select public.test_finalize_route(
  '76000000-0000-4000-8000-000000000002',
  (select id from public.trips where user_id = auth.uid())
) as result;
reset role;

insert into tap_results values
  ((select result = 'LEGACY_TRIP_UPDATE_UNSUPPORTED' from legacy_update_result), 'legacy finalization rejects an unbound existing-trip target'),
  ((select title = '경합 계획' from public.trips where user_id = '75000000-0000-0000-0000-000000000001'), 'rejected legacy update preserves the original trip row'),
  ((select count(*) = 1 from public.trip_waypoints w join public.trips t on t.id = w.trip_id where t.user_id = '75000000-0000-0000-0000-000000000001'), 'rejected legacy update preserves original waypoints'),
  ((select count(*) = 3 from public.route_cache r join public.trips t on t.id = r.trip_id where t.user_id = '75000000-0000-0000-0000-000000000001'), 'rejected legacy update preserves all original routes'),
  ((select count(*) = 3 from public.route_plan_drafts where owner_id = '75000000-0000-0000-0000-000000000001' and planning_id = '76000000-0000-4000-8000-000000000002'), 'rejected legacy update preserves the retryable route drafts');

-- Simulate drafts staged across a fingerprint-function deployment. The stored
-- cache can be stale or corrupt; finalization must re-hash the locked route JSON.
update public.route_plan_drafts
set geometry_fingerprint = repeat('f', 64)
where owner_id = '75000000-0000-0000-0000-000000000001'
  and planning_id = '76000000-0000-4000-8000-000000000002';
insert into tap_results values (
  (select count(distinct geometry_fingerprint) = 1 from public.route_plan_drafts
   where owner_id = '75000000-0000-0000-0000-000000000001'
     and planning_id = '76000000-0000-4000-8000-000000000002'),
  'deployment-crossing fixture stores one stale cached fingerprint'
);
set role authenticated;
select set_config('request.jwt.claim.sub', '75000000-0000-0000-0000-000000000001', false);
do $$
declare
  replacement uuid;
begin
  replacement := public.finalize_trip_plan('76000000-0000-4000-8000-000000000002', null);
  insert into tap_results values (
    replacement is not null,
    'legacy new-plan finalization accepts distinct route JSON despite stale cached fingerprints'
  );
end;
$$;
reset role;

-- The inverse must also fail closed: distinct cached strings cannot make three
-- copies of one road geometry pass the current finalization boundary.
insert into public.route_plan_drafts(owner_id, planning_id, candidate_profile, plan, route, geometry_fingerprint)
select
  '75000000-0000-0000-0000-000000000001',
  '76000000-0000-4000-8000-000000000003',
  profile,
  (select plan from route_fixture),
  pg_temp.test_route(profile, 127.05),
  repeat(md5(profile), 2)
from unnest(array['balanced', 'winding', 'short']) as profile;
set role authenticated;
select set_config('request.jwt.claim.sub', '75000000-0000-0000-0000-000000000001', false);
insert into tap_results values (
  public.test_finalize_route('76000000-0000-4000-8000-000000000003', null) = 'ROUTE_PLAN_NOT_READY',
  'finalization rejects duplicate route JSON despite distinct cached fingerprints'
);
reset role;

-- A finalizer whose statement snapshot contains only two rows must not admit a
-- third row inserted while it is waiting for an existing row lock. The former
-- multi-statement finalizer saw that phantom in its later aggregate.
insert into public.route_plan_drafts(owner_id, planning_id, candidate_profile, plan, route, geometry_fingerprint)
select
  '75000000-0000-0000-0000-000000000001',
  '76000000-0000-4000-8000-000000000004',
  route -> 'candidate' ->> 'id',
  (select plan from route_fixture),
  route,
  public.route_geometry_fingerprint(route)
from jsonb_array_elements((select routes from route_fixture)) as staged(route)
where route -> 'candidate' ->> 'id' in ('balanced', 'winding');
select dblink_exec('route_c2', 'reset role');
select dblink_exec('route_c2', 'begin');
select dblink_send_query('route_c2', $$
  select 1
  from public.route_plan_drafts
  where owner_id = '75000000-0000-0000-0000-000000000001'
    and planning_id = '76000000-0000-4000-8000-000000000004'
    and candidate_profile = 'balanced'
  for update
$$);
select locked from dblink_get_result('route_c2') as response(locked integer);
select locked from dblink_get_result('route_c2') as response(locked integer);
select dblink_send_query('route_c1', $$
  select public.test_finalize_route('76000000-0000-4000-8000-000000000004', null)
$$);
select pg_sleep(0.2);
insert into tap_results values (
  dblink_is_busy('route_c1') = 1,
  'two-row finalizer waits on the pre-existing draft lock'
);
select dblink_exec('route_c3', $$
  insert into public.route_plan_drafts(owner_id, planning_id, candidate_profile, plan, route, geometry_fingerprint)
  select owner_id, planning_id, 'short', plan,
    jsonb_set(
      jsonb_set(
        jsonb_set(route, '{candidate,id}', '"short"'::jsonb),
        '{candidate,label}', '"short"'::jsonb
      ),
      '{legs,0,sections,0,roads,0,vertexes,2}', '127.15'::jsonb
    ),
    repeat('9', 64)
  from public.route_plan_drafts
  where owner_id = '75000000-0000-0000-0000-000000000001'
    and planning_id = '76000000-0000-4000-8000-000000000004'
    and candidate_profile = 'balanced'
$$);
select dblink_exec('route_c2', 'commit');
create temp table phantom_finalize_result(result text);
insert into phantom_finalize_result
select result from dblink_get_result('route_c1') as response(result text);
select result from dblink_get_result('route_c1') as response(result text);
insert into tap_results values
  ((select result = 'ROUTE_PLAN_NOT_READY' from phantom_finalize_result), 'one locked statement snapshot rejects a late third route'),
  ((select count(*) = 3 from public.route_plan_drafts
    where owner_id = '75000000-0000-0000-0000-000000000001'
      and planning_id = '76000000-0000-4000-8000-000000000004'), 'late insert remains retryable after failed finalization');
delete from public.route_plan_drafts
where owner_id = '75000000-0000-0000-0000-000000000001'
  and planning_id = '76000000-0000-4000-8000-000000000004';

-- Once three rows are copied by the locked statement, a retry that tries to
-- replace one route with duplicate geometry must wait and affect no consumed row.
insert into public.route_plan_drafts(owner_id, planning_id, candidate_profile, plan, route, geometry_fingerprint)
select
  '75000000-0000-0000-0000-000000000001',
  '76000000-0000-4000-8000-000000000005',
  route -> 'candidate' ->> 'id',
  (select plan from route_fixture),
  route,
  public.route_geometry_fingerprint(route)
from jsonb_array_elements((select routes from route_fixture)) as staged(route);
create or replace function public.delay_test_finalize()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.user_id = '75000000-0000-0000-0000-000000000001' then
    perform pg_sleep(1);
  end if;
  return new;
end;
$$;
create trigger delay_test_finalize before insert on public.trips
for each row execute function public.delay_test_finalize();
select dblink_send_query('route_c1', $$
  select public.test_finalize_route('76000000-0000-4000-8000-000000000005', null)
$$);
select pg_sleep(0.2);
select dblink_send_query('route_c2', $$
  with balanced as (
    select route
    from public.route_plan_drafts
    where owner_id = '75000000-0000-0000-0000-000000000001'
      and planning_id = '76000000-0000-4000-8000-000000000005'
      and candidate_profile = 'balanced'
  ), updated as (
    update public.route_plan_drafts
    set route = (select route from balanced), geometry_fingerprint = repeat('8', 64)
    where owner_id = '75000000-0000-0000-0000-000000000001'
      and planning_id = '76000000-0000-4000-8000-000000000005'
      and candidate_profile = 'short'
    returning 1
  )
  select count(*)::integer from updated
$$);
select pg_sleep(0.2);
insert into tap_results values (
  dblink_is_busy('route_c2') = 1,
  'a route retry waits while the verified route set is being stored'
);
create temp table stable_finalize_result(result text);
insert into stable_finalize_result
select result from dblink_get_result('route_c1') as response(result text);
select result from dblink_get_result('route_c1') as response(result text);
create temp table blocked_update_result(affected integer);
insert into blocked_update_result
select affected from dblink_get_result('route_c2') as response(affected integer);
select affected from dblink_get_result('route_c2') as response(affected integer);
drop trigger delay_test_finalize on public.trips;
drop function public.delay_test_finalize();
insert into tap_results values
  ((select result ~ '^[0-9a-f-]{36}$' from stable_finalize_result), 'stable three-route finalization succeeds'),
  ((select affected = 0 from blocked_update_result), 'blocked retry cannot update a consumed route draft'),
  ((select count(distinct public.route_geometry_fingerprint(summary)) = 3
    from public.route_cache
    where trip_id = (
      select result::uuid from stable_finalize_result
      where result ~ '^[0-9a-f-]{36}$'
    )), 'stored routes are the same three distinct geometries that were validated');

select dblink_disconnect('route_c1');
select dblink_disconnect('route_c2');
select dblink_disconnect('route_c3');
drop function public.test_finalize_route(uuid, uuid);
delete from auth.users where id = '75000000-0000-0000-0000-000000000001';

select
  (case when ok then 'ok ' else 'not ok ' end) ||
  row_number() over () || ' - ' || description
from tap_results;
select '1..' || count(*) from tap_results;

do $$
begin
  if exists (select 1 from tap_results where not ok) then
    raise exception 'ROUTE_FINALIZATION_CONCURRENCY_TEST_FAILED';
  end if;
end;
$$;
