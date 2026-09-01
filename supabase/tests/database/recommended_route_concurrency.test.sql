\set ON_ERROR_STOP on

create extension if not exists dblink with schema extensions;

drop trigger if exists delay_test_recommended_finalize on public.trips;
drop function if exists public.delay_test_recommended_finalize();
drop function if exists public.test_finalize_recommended_route(uuid);
delete from auth.users where id = '75100000-0000-0000-0000-000000000001';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '75100000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'recommended-concurrency@motocast.test', '',
  now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"추천 경로 경합"}'
);
insert into public.memberships(user_id, role)
values ('75100000-0000-0000-0000-000000000001', 'rider');

create or replace function pg_temp.recommended_point(
  point_id text, point_label text, point_lon numeric, point_lat numeric,
  point_kind text, dwell integer, winding boolean, stop_role text default null
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', point_id, 'label', point_label, 'kakaoPlaceId', point_id,
    'verificationToken', repeat('a', 43), 'name', point_label,
    'address', '테스트 주소', 'roadAddress', null,
    'longitude', point_lon, 'latitude', point_lat,
    'kind', point_kind, 'dwellMinutes', dwell, 'selected', true,
    'winding', winding, 'stopRole', stop_role
  );
$$;

create temp table recommended_fixture on commit preserve rows as
select
  jsonb_build_object(
    'title', '추천 경로 경합 계획',
    'serviceDate', '2026-08-31',
    'departureAt', '2026-08-31T00:00:00.000Z',
    'desiredReturnAt', '2026-08-31T08:00:00.000Z',
    'hardReturnAt', '2026-08-31T09:00:00.000Z',
    'origin', pg_temp.recommended_point('origin', '출발', 127, 37, 'pass-through', 0, false),
    'destination', pg_temp.recommended_point('destination', '복귀', 127.2, 37.2, 'pass-through', 0, false),
    'lunchStop', pg_temp.recommended_point('lunch', '점심', 127.1, 37.1, 'stop', 60, false, 'lunch'),
    'dinnerStop', null,
    'waypoints', jsonb_build_array(
      pg_temp.recommended_point('winding', '커스텀 와인딩', 127.05, 37.05, 'pass-through', 0, true),
      pg_temp.recommended_point('lunch', '점심', 127.1, 37.1, 'stop', 60, false, 'lunch')
    ),
    'selectedProfile', 'recommended'
  ) as plan,
  jsonb_build_object(
    'candidate', jsonb_build_object('id', 'recommended', 'label', '추천 경로', 'estimatedWinding', false),
    'safety', jsonb_build_object('vehicle', 'motorcycle', 'motorwayExcluded', true, 'fallbackUsed', false),
    'totalDistanceMeters', 10000,
    'totalDurationSeconds', 600,
    'returnAt', '2026-08-31T00:10:00.000Z',
    'legs', jsonb_build_array(jsonb_build_object(
      'from', pg_temp.recommended_point('origin', '출발', 127, 37, 'pass-through', 0, false),
      'to', pg_temp.recommended_point('destination', '복귀', 127.2, 37.2, 'pass-through', 0, false),
      'via', '[]'::jsonb,
      'departureAt', '2026-08-31T00:00:00.000Z',
      'arrivalAt', '2026-08-31T00:10:00.000Z',
      'dwellMinutes', 0, 'distanceMeters', 10000, 'durationSeconds', 600,
      'forecastTraffic', false,
      'sections', jsonb_build_array(jsonb_build_object(
        'distance', 10000, 'duration', 600,
        'roads', jsonb_build_array(jsonb_build_object(
          'name', '테스트 도로', 'distance', 10000, 'duration', 600,
          'vertexes', jsonb_build_array(127, 37, 127.1, 37.1, 127.2, 37.2)
        ))
      ))
    ))
  ) as route;

select public.stage_route_candidate_internal(
  '75100000-0000-0000-0000-000000000001',
  '76100000-0000-4000-8000-000000000001',
  (select plan from recommended_fixture),
  (select route from recommended_fixture)
);

create or replace function public.test_finalize_recommended_route(target_planning_id uuid)
returns text language plpgsql set search_path = public, pg_temp as $$
begin
  return public.finalize_trip_plan(target_planning_id, null)::text;
exception when others then return sqlerrm;
end;
$$;
grant execute on function public.test_finalize_recommended_route(uuid) to authenticated;

create or replace function public.delay_test_recommended_finalize()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.user_id = '75100000-0000-0000-0000-000000000001' then perform pg_sleep(1); end if;
  return new;
end;
$$;
create trigger delay_test_recommended_finalize before insert on public.trips
for each row execute function public.delay_test_recommended_finalize();

select dblink_connect('recommended_c1', 'host=127.0.0.1 port=5432 dbname=postgres user=supabase_admin password=postgres');
select dblink_connect('recommended_c2', 'host=127.0.0.1 port=5432 dbname=postgres user=supabase_admin password=postgres');
select dblink_exec('recommended_c1', 'set role authenticated');
select dblink_exec('recommended_c2', 'set role authenticated');
select dblink_exec('recommended_c1', 'set "request.jwt.claim.sub" = ''75100000-0000-0000-0000-000000000001''');
select dblink_exec('recommended_c2', 'set "request.jwt.claim.sub" = ''75100000-0000-0000-0000-000000000001''');
select dblink_send_query('recommended_c1', $$select public.test_finalize_recommended_route('76100000-0000-4000-8000-000000000001')$$);
select dblink_send_query('recommended_c2', $$select public.test_finalize_recommended_route('76100000-0000-4000-8000-000000000001')$$);

create temp table recommended_results(result text);
insert into recommended_results select result from dblink_get_result('recommended_c1') as response(result text);
insert into recommended_results select result from dblink_get_result('recommended_c2') as response(result text);
select result from dblink_get_result('recommended_c1') as response(result text);
select result from dblink_get_result('recommended_c2') as response(result text);

drop trigger delay_test_recommended_finalize on public.trips;
drop function public.delay_test_recommended_finalize();

create temp table tap_results(ok boolean not null, description text not null);
insert into tap_results values
  ((select count(*) = 1 from recommended_results where result ~ '^[0-9a-f-]{36}$'), 'concurrent recommended finalizers produce one saved trip'),
  ((select count(*) = 1 from recommended_results where result = 'ROUTE_PLAN_NOT_READY'), 'the losing recommended finalizer fails closed'),
  ((select count(*) = 1 from public.trips where user_id = '75100000-0000-0000-0000-000000000001'), 'recommended finalization never duplicates the trip'),
  ((select count(*) = 1 from public.route_cache r join public.trips t on t.id = r.trip_id where t.user_id = '75100000-0000-0000-0000-000000000001'), 'recommended finalization stores exactly one route'),
  ((select count(*) = 1 from public.route_cache r join public.trips t on t.id = r.trip_id where t.user_id = '75100000-0000-0000-0000-000000000001' and r.profile = 'recommended'), 'the stored route keeps the recommended identity'),
  ((select count(*) = 0 from public.route_plan_drafts where owner_id = '75100000-0000-0000-0000-000000000001'), 'recommended finalization consumes its one draft');

select dblink_disconnect('recommended_c1');
select dblink_disconnect('recommended_c2');
drop function public.test_finalize_recommended_route(uuid);
delete from auth.users where id = '75100000-0000-0000-0000-000000000001';

select (case when ok then 'ok ' else 'not ok ' end) || row_number() over () || ' - ' || description
from tap_results;
select '1..' || count(*) from tap_results;

do $$
begin
  if exists (select 1 from tap_results where not ok) then
    raise exception 'RECOMMENDED_ROUTE_CONCURRENCY_TEST_FAILED';
  end if;
end;
$$;
