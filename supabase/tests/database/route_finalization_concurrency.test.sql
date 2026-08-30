\set ON_ERROR_STOP on

create extension if not exists dblink with schema extensions;

drop trigger if exists delay_test_finalize on public.trips;
drop trigger if exists fail_test_route_insert on public.route_cache;
drop function if exists public.delay_test_finalize();
drop function if exists public.fail_test_route_insert();
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

-- Prove that a failure after aggregate mutation begins rolls back the old trip,
-- its routes and its draft capability as one transaction.
insert into public.route_plan_drafts(owner_id, planning_id, candidate_profile, plan, route, geometry_fingerprint)
select
  '75000000-0000-0000-0000-000000000001',
  '76000000-0000-4000-8000-000000000002',
  route -> 'candidate' ->> 'id',
  jsonb_set((select plan from route_fixture), '{title}', '"롤백 뒤 바뀌면 안 됨"'::jsonb),
  route,
  public.route_geometry_fingerprint(route)
from jsonb_array_elements((select routes from route_fixture)) as staged(route);

create or replace function public.fail_test_route_insert()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.profile = 'winding' then raise exception 'FORCED_ROUTE_WRITE_FAILURE'; end if;
  return new;
end;
$$;
create trigger fail_test_route_insert before insert on public.route_cache
for each row execute function public.fail_test_route_insert();

set role authenticated;
select set_config('request.jwt.claim.sub', '75000000-0000-0000-0000-000000000001', false);
do $$
declare
  target_trip uuid := (select id from public.trips where user_id = auth.uid());
  rejected boolean := false;
begin
  begin
    perform public.finalize_trip_plan('76000000-0000-4000-8000-000000000002', target_trip);
  exception when others then
    rejected := sqlerrm = 'FORCED_ROUTE_WRITE_FAILURE';
  end;
  insert into tap_results values (rejected, 'a forced mid-write route failure is surfaced');
end;
$$;
reset role;

drop trigger fail_test_route_insert on public.route_cache;
drop function public.fail_test_route_insert();

insert into tap_results values
  ((select title = '경합 계획' from public.trips where user_id = '75000000-0000-0000-0000-000000000001'), 'failed replacement restores the original trip row'),
  ((select count(*) = 1 from public.trip_waypoints w join public.trips t on t.id = w.trip_id where t.user_id = '75000000-0000-0000-0000-000000000001'), 'failed replacement restores original waypoints'),
  ((select count(*) = 3 from public.route_cache r join public.trips t on t.id = r.trip_id where t.user_id = '75000000-0000-0000-0000-000000000001'), 'failed replacement restores all original routes'),
  ((select count(*) = 3 from public.route_plan_drafts where owner_id = '75000000-0000-0000-0000-000000000001' and planning_id = '76000000-0000-4000-8000-000000000002'), 'failed replacement preserves the retryable route drafts');

select dblink_disconnect('route_c1');
select dblink_disconnect('route_c2');
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
