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

create or replace function pg_temp.recommended_leg(
  from_point jsonb, to_point jsonb, departure_at text, arrival_at text,
  dwell integer, distance integer default 10000
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'from', from_point, 'to', to_point, 'via', '[]'::jsonb,
    'departureAt', departure_at, 'arrivalAt', arrival_at,
    'dwellMinutes', dwell, 'distanceMeters', distance, 'durationSeconds', 600,
    'forecastTraffic', false,
    'sections', jsonb_build_array(jsonb_build_object(
      'distance', distance, 'duration', 600,
      'roads', jsonb_build_array(jsonb_build_object(
        'name', '테스트 도로', 'distance', distance, 'duration', 600,
        'vertexes', jsonb_build_array(
          from_point -> 'longitude', from_point -> 'latitude',
          ((from_point ->> 'longitude')::numeric + (to_point ->> 'longitude')::numeric) / 2,
          ((from_point ->> 'latitude')::numeric + (to_point ->> 'latitude')::numeric) / 2,
          to_point -> 'longitude', to_point -> 'latitude'
        )
      ))
    ))
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
    'totalDistanceMeters', 30000,
    'totalDurationSeconds', 5400,
    'returnAt', '2026-08-31T01:30:00.000Z',
    'legs', jsonb_build_array(
      pg_temp.recommended_leg(
        pg_temp.recommended_point('origin', '출발', 127, 37, 'pass-through', 0, false),
        pg_temp.recommended_point('winding', '커스텀 와인딩', 127.05, 37.05, 'pass-through', 0, true),
        '2026-08-31T00:00:00.000Z', '2026-08-31T00:10:00.000Z', 0
      ),
      pg_temp.recommended_leg(
        pg_temp.recommended_point('winding', '커스텀 와인딩', 127.05, 37.05, 'pass-through', 0, true),
        pg_temp.recommended_point('lunch', '점심', 127.1, 37.1, 'stop', 60, false, 'lunch'),
        '2026-08-31T00:10:00.000Z', '2026-08-31T00:20:00.000Z', 60
      ),
      pg_temp.recommended_leg(
        pg_temp.recommended_point('lunch', '점심', 127.1, 37.1, 'stop', 60, false, 'lunch'),
        pg_temp.recommended_point('destination', '복귀', 127.2, 37.2, 'pass-through', 0, false),
        '2026-08-31T01:20:00.000Z', '2026-08-31T01:30:00.000Z', 0
      )
    )
  ) as route;

select public.stage_route_candidate_internal(
  '75100000-0000-0000-0000-000000000001',
  '76100000-0000-4000-8000-000000000001',
  (select plan from recommended_fixture),
  (select route from recommended_fixture)
);

create temp table recommended_validation_results(
  omitted_rejected boolean,
  reordered_rejected boolean,
  dwell_rejected boolean,
  missing_point_id_rejected boolean,
  missing_dwell_rejected boolean,
  missing_total_rejected boolean,
  expired_route_change_rejected boolean,
  twenty_four_hour_rejected boolean,
  reused_rejected boolean,
  exact_retry_accepted boolean
);
do $$
declare
  omitted_rejected boolean := false;
  reordered_rejected boolean := false;
  dwell_rejected boolean := false;
  missing_point_id_rejected boolean := false;
  missing_dwell_rejected boolean := false;
  missing_total_rejected boolean := false;
  expired_route_change_rejected boolean := false;
  twenty_four_hour_rejected boolean := false;
  reused_rejected boolean := false;
  exact_retry_accepted boolean := false;
  fixture_plan jsonb := (select plan from recommended_fixture);
  fixture_route jsonb := (select route from recommended_fixture);
  twenty_four_hour_route jsonb;
begin
  begin
    perform public.stage_route_candidate_internal(
      '75100000-0000-0000-0000-000000000001',
      '76100000-0000-4000-8000-000000000010', fixture_plan,
      jsonb_set(fixture_route, '{legs}', (fixture_route -> 'legs') - 0)
    );
  exception when sqlstate 'P0001' then omitted_rejected := sqlerrm = 'INVALID_STAGED_ROUTE'; end;
  begin
    perform public.stage_route_candidate_internal(
      '75100000-0000-0000-0000-000000000001',
      '76100000-0000-4000-8000-000000000011', fixture_plan,
      jsonb_set(fixture_route, '{legs}', jsonb_build_array(
        fixture_route -> 'legs' -> 1, fixture_route -> 'legs' -> 0, fixture_route -> 'legs' -> 2
      ))
    );
  exception when sqlstate 'P0001' then reordered_rejected := sqlerrm = 'INVALID_STAGED_ROUTE'; end;
  begin
    perform public.stage_route_candidate_internal(
      '75100000-0000-0000-0000-000000000001',
      '76100000-0000-4000-8000-000000000012', fixture_plan,
      jsonb_set(fixture_route, '{legs,1,dwellMinutes}', '0'::jsonb)
    );
  exception when sqlstate 'P0001' then dwell_rejected := sqlerrm = 'INVALID_STAGED_ROUTE'; end;
  begin
    perform public.stage_route_candidate_internal(
      '75100000-0000-0000-0000-000000000001',
      '76100000-0000-4000-8000-000000000014', fixture_plan,
      fixture_route #- '{legs,1,to,id}'
    );
  exception when sqlstate 'P0001' then missing_point_id_rejected := sqlerrm = 'INVALID_STAGED_ROUTE'; end;
  begin
    perform public.stage_route_candidate_internal(
      '75100000-0000-0000-0000-000000000001',
      '76100000-0000-4000-8000-000000000015', fixture_plan,
      fixture_route #- '{legs,1,dwellMinutes}'
    );
  exception when sqlstate 'P0001' then missing_dwell_rejected := sqlerrm = 'INVALID_STAGED_ROUTE'; end;
  begin
    perform public.stage_route_candidate_internal(
      '75100000-0000-0000-0000-000000000001',
      '76100000-0000-4000-8000-000000000016', fixture_plan,
      fixture_route - 'totalDurationSeconds'
    );
  exception when sqlstate 'P0001' then missing_total_rejected := sqlerrm = 'INVALID_STAGED_ROUTE'; end;
  perform public.stage_route_candidate_internal(
    '75100000-0000-0000-0000-000000000001',
    '76100000-0000-4000-8000-000000000017', fixture_plan, fixture_route
  );
  update public.route_plan_drafts
  set created_at = now() - interval '2 hours'
  where owner_id = '75100000-0000-0000-0000-000000000001'
    and planning_id = '76100000-0000-4000-8000-000000000017';
  perform public.stage_route_candidate_internal(
    '75100000-0000-0000-0000-000000000001',
    '76100000-0000-4000-8000-000000000018', fixture_plan, fixture_route
  );
  begin
    perform public.stage_route_candidate_internal(
      '75100000-0000-0000-0000-000000000001',
      '76100000-0000-4000-8000-000000000017', fixture_plan,
      jsonb_set(fixture_route, '{legs,0,sections,0,roads,0,vertexes,2}', '127.03'::jsonb)
    );
  exception when sqlstate 'P0001' then
    expired_route_change_rejected := sqlerrm = 'PLANNING_ID_REUSED';
  end;
  twenty_four_hour_route := jsonb_set(fixture_route, '{legs,2,durationSeconds}', '81600'::jsonb);
  twenty_four_hour_route := jsonb_set(twenty_four_hour_route, '{legs,2,arrivalAt}', '"2026-09-01T00:00:00.000Z"'::jsonb);
  twenty_four_hour_route := jsonb_set(twenty_four_hour_route, '{legs,2,sections,0,duration}', '81600'::jsonb);
  twenty_four_hour_route := jsonb_set(twenty_four_hour_route, '{legs,2,sections,0,roads,0,duration}', '81600'::jsonb);
  twenty_four_hour_route := jsonb_set(twenty_four_hour_route, '{totalDurationSeconds}', '86400'::jsonb);
  twenty_four_hour_route := jsonb_set(twenty_four_hour_route, '{returnAt}', '"2026-09-01T00:00:00.000Z"'::jsonb);
  begin
    perform public.stage_route_candidate_internal(
      '75100000-0000-0000-0000-000000000001',
      '76100000-0000-4000-8000-000000000013', fixture_plan,
      twenty_four_hour_route
    );
  exception when sqlstate 'P0001' then twenty_four_hour_rejected := sqlerrm = 'INVALID_STAGED_ROUTE'; end;
  begin
    perform public.stage_route_candidate_internal(
      '75100000-0000-0000-0000-000000000001',
      '76100000-0000-4000-8000-000000000001',
      jsonb_set(fixture_plan, '{title}', '"재사용 변조"'::jsonb), fixture_route
    );
  exception when sqlstate 'P0001' then reused_rejected := sqlerrm = 'PLANNING_ID_REUSED'; end;
  begin
    perform public.stage_route_candidate_internal(
      '75100000-0000-0000-0000-000000000001',
      '76100000-0000-4000-8000-000000000001', fixture_plan, fixture_route
    );
    exact_retry_accepted := true;
  exception when others then exact_retry_accepted := false; end;
  insert into recommended_validation_results values (
    omitted_rejected, reordered_rejected, dwell_rejected,
    missing_point_id_rejected, missing_dwell_rejected, missing_total_rejected,
    expired_route_change_rejected,
    twenty_four_hour_rejected,
    reused_rejected, exact_retry_accepted
  );
end;
$$;

create or replace function public.test_finalize_recommended_route(target_planning_id uuid)
returns text language plpgsql set search_path = public, pg_temp as $$
begin
  return public.finalize_trip_plan(target_planning_id, null)::text;
exception when others then return sqlerrm;
end;
$$;
grant execute on function public.test_finalize_recommended_route(uuid) to authenticated;

create or replace function public.test_stage_recommended_route(target_planning_id uuid, staged_plan jsonb, staged_route jsonb)
returns text language plpgsql set search_path = public, pg_temp as $$
begin
  perform public.stage_route_candidate_internal(
    '75100000-0000-0000-0000-000000000001', target_planning_id, staged_plan, staged_route
  );
  return 'STAGED';
exception when others then return sqlerrm;
end;
$$;
grant execute on function public.test_stage_recommended_route(uuid, jsonb, jsonb) to service_role;

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
select dblink_connect('recommended_c3', 'host=127.0.0.1 port=5432 dbname=postgres user=supabase_admin password=postgres');
select dblink_exec('recommended_c1', 'set role authenticated');
select dblink_exec('recommended_c2', 'set role authenticated');
select dblink_exec('recommended_c3', 'set role service_role');
select dblink_exec('recommended_c1', 'set "request.jwt.claim.sub" = ''75100000-0000-0000-0000-000000000001''');
select dblink_exec('recommended_c2', 'set "request.jwt.claim.sub" = ''75100000-0000-0000-0000-000000000001''');
select dblink_send_query('recommended_c1', $$select public.test_finalize_recommended_route('76100000-0000-4000-8000-000000000001')$$);
select dblink_send_query('recommended_c2', $$select public.test_finalize_recommended_route('76100000-0000-4000-8000-000000000001')$$);
select pg_sleep(0.2);
select dblink_send_query('recommended_c3', format(
  'select public.test_stage_recommended_route(%L::uuid, %L::jsonb, %L::jsonb)',
  '76100000-0000-4000-8000-000000000001',
  (select plan::text from recommended_fixture),
  (select route::text from recommended_fixture)
));

create temp table recommended_results(result text);
insert into recommended_results select result from dblink_get_result('recommended_c1') as response(result text);
insert into recommended_results select result from dblink_get_result('recommended_c2') as response(result text);
insert into recommended_results select result from dblink_get_result('recommended_c3') as response(result text);
select result from dblink_get_result('recommended_c1') as response(result text);
select result from dblink_get_result('recommended_c2') as response(result text);
select result from dblink_get_result('recommended_c3') as response(result text);

drop trigger delay_test_recommended_finalize on public.trips;
drop function public.delay_test_recommended_finalize();

create temp table tap_results(ok boolean not null, description text not null);
insert into tap_results values
  ((select count(*) = 1 from recommended_results where result ~ '^[0-9a-f-]{36}$'), 'concurrent recommended finalizers produce one saved trip'),
  ((select count(*) = 1 from recommended_results where result = 'ROUTE_PLAN_NOT_READY'), 'the losing recommended finalizer fails closed'),
  ((select count(*) = 1 from recommended_results where result = 'ROUTE_PLAN_ALREADY_CONSUMED'), 'a late stage retry cannot resurrect a consumed planning id'),
  ((select count(*) = 1 from public.trips where user_id = '75100000-0000-0000-0000-000000000001'), 'recommended finalization never duplicates the trip'),
  ((select count(*) = 1 from public.route_cache r join public.trips t on t.id = r.trip_id where t.user_id = '75100000-0000-0000-0000-000000000001'), 'recommended finalization stores exactly one route'),
  ((select count(*) = 1 from public.route_cache r join public.trips t on t.id = r.trip_id where t.user_id = '75100000-0000-0000-0000-000000000001' and r.profile = 'recommended'), 'the stored route keeps the recommended identity'),
  ((select count(*) = 0 from public.route_plan_drafts where owner_id = '75100000-0000-0000-0000-000000000001' and planning_id = '76100000-0000-4000-8000-000000000001'), 'recommended finalization consumes its one draft'),
  ((select status = 'consumed' and saved_trip_id is not null from public.route_plan_runs where owner_id = '75100000-0000-0000-0000-000000000001' and planning_id = '76100000-0000-4000-8000-000000000001'), 'planning lifecycle keeps a consumed tombstone'),
  ((select omitted_rejected from recommended_validation_results), 'staging rejects a route that omits a mandatory point'),
  ((select reordered_rejected from recommended_validation_results), 'staging rejects reordered mandatory points'),
  ((select dwell_rejected from recommended_validation_results), 'staging rejects changed dwell time'),
  ((select missing_point_id_rejected from recommended_validation_results), 'staging rejects a missing mandatory point id'),
  ((select missing_dwell_rejected from recommended_validation_results), 'staging rejects a missing dwell time'),
  ((select missing_total_rejected from recommended_validation_results), 'staging rejects a missing route total'),
  ((select expired_route_change_rejected from recommended_validation_results), 'an expired draft cannot change its durable route payload'),
  ((select twenty_four_hour_rejected from recommended_validation_results), 'staging rejects a route lasting exactly 24 hours'),
  ((select reused_rejected from recommended_validation_results), 'a planning id rejects a different payload'),
  ((select exact_retry_accepted from recommended_validation_results), 'an exact pre-finalize retry is idempotent');

select dblink_disconnect('recommended_c1');
select dblink_disconnect('recommended_c2');
select dblink_disconnect('recommended_c3');
drop function public.test_finalize_recommended_route(uuid);
drop function public.test_stage_recommended_route(uuid, jsonb, jsonb);
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
