\set ON_ERROR_STOP on

begin;

create temp table tap_results(ok boolean not null, description text not null) on commit drop;
grant insert, select on tap_results to authenticated, service_role;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '75200000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'optional-meal@motocast.test', '',
  now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"선택 식사"}'
);
insert into public.memberships(user_id, role)
values ('75200000-0000-0000-0000-000000000001', 'rider');

create or replace function pg_temp.optional_point(
  point_id text, point_label text, point_lon numeric, point_lat numeric,
  point_kind text, dwell integer, stop_role text default null
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', point_id, 'label', point_label, 'kakaoPlaceId', point_id,
    'name', point_label, 'address', '테스트 주소', 'roadAddress', null,
    'longitude', point_lon, 'latitude', point_lat,
    'kind', point_kind, 'dwellMinutes', dwell, 'selected', true,
    'winding', false
  ) || case when stop_role is null then '{}'::jsonb
    else jsonb_build_object('stopRole', stop_role) end;
$$;

create or replace function pg_temp.optional_meal_fixture(rest_count integer)
returns table(plan jsonb, route jsonb)
language plpgsql
as $$
declare
  origin jsonb := pg_temp.optional_point('origin', '출발', 127, 37, 'pass-through', 0);
  destination jsonb := pg_temp.optional_point('destination', '복귀', 127.2, 37.2, 'pass-through', 0);
  waypoints jsonb := '[]'::jsonb;
  points jsonb := jsonb_build_array(origin);
  legs jsonb := '[]'::jsonb;
  from_point jsonb;
  to_point jsonb;
  cursor_time timestamptz := '2026-08-31T00:00:00.000Z';
  arrival_time timestamptz;
  dwell integer;
  total_distance integer := 0;
  total_duration integer := 0;
begin
  for position in 1..rest_count loop
    to_point := pg_temp.optional_point(
      'rest-' || position, '휴식 ' || position,
      127 + position * 0.02, 37 + position * 0.02,
      'optional', 30, 'rest'
    );
    waypoints := waypoints || jsonb_build_array(to_point);
    points := points || jsonb_build_array(to_point);
  end loop;
  points := points || jsonb_build_array(destination);

  for position in 0..jsonb_array_length(points) - 2 loop
    from_point := points -> position;
    to_point := points -> (position + 1);
    arrival_time := cursor_time + interval '10 minutes';
    dwell := (to_point ->> 'dwellMinutes')::integer;
    legs := legs || jsonb_build_array(jsonb_build_object(
      'from', from_point, 'to', to_point, 'via', '[]'::jsonb,
      'departureAt', cursor_time, 'arrivalAt', arrival_time,
      'dwellMinutes', dwell, 'distanceMeters', 10000, 'durationSeconds', 600,
      'forecastTraffic', false,
      'sections', jsonb_build_array(jsonb_build_object(
        'distance', 10000, 'duration', 600,
        'roads', jsonb_build_array(jsonb_build_object(
          'name', '테스트 도로', 'distance', 10000, 'duration', 600,
          'vertexes', jsonb_build_array(
            from_point -> 'longitude', from_point -> 'latitude',
            ((from_point ->> 'longitude')::numeric + (to_point ->> 'longitude')::numeric) / 2,
            ((from_point ->> 'latitude')::numeric + (to_point ->> 'latitude')::numeric) / 2,
            to_point -> 'longitude', to_point -> 'latitude'
          )
        ))
      ))
    ));
    total_distance := total_distance + 10000;
    total_duration := total_duration + 600 + dwell * 60;
    cursor_time := arrival_time + make_interval(mins => dwell);
  end loop;

  plan := jsonb_build_object(
    'title', '선택 식사 테스트', 'serviceDate', '2026-08-31',
    'departureAt', '2026-08-31T00:00:00.000Z',
    'desiredReturnAt', '2026-08-31T08:00:00.000Z',
    'hardReturnAt', '2026-08-31T09:00:00.000Z',
    'tripId', null, 'targetUpdatedAt', null,
    'origin', origin, 'destination', destination,
    'lunchStop', null, 'dinnerStop', null,
    'waypoints', waypoints, 'selectedProfile', 'recommended'
  );
  route := jsonb_build_object(
    'candidate', jsonb_build_object('id', 'recommended', 'label', '추천 경로', 'estimatedWinding', false),
    'safety', jsonb_build_object('vehicle', 'motorcycle', 'motorwayExcluded', true, 'fallbackUsed', false),
    'totalDistanceMeters', total_distance, 'totalDurationSeconds', total_duration,
    'returnAt', cursor_time, 'legs', legs
  );
  return next;
end;
$$;

create or replace function pg_temp.optional_weather_segments(route jsonb, issued_at timestamptz)
returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object(
    'id', 'recommended-' || (position - 1)::text,
    'label', leg -> 'to' ->> 'label',
    'longitude', leg -> 'to' -> 'longitude',
    'latitude', leg -> 'to' -> 'latitude',
    'eta', leg ->> 'arrivalAt',
    'status', 'forecast',
    'model', 'ultra',
    'issuedAt', issued_at,
    'condition', 'clear',
    'temperatureC', 22,
    'precipitationProbability', 0,
    'windSpeedMps', 1.2
  ) order by position)
  from jsonb_array_elements(route -> 'legs') with ordinality as route_leg(leg, position);
$$;

create temp table direct_fixture on commit drop as select * from pg_temp.optional_meal_fixture(0);
create temp table five_rest_fixture on commit drop as select * from pg_temp.optional_meal_fixture(5);
create temp table six_rest_fixture on commit drop as select * from pg_temp.optional_meal_fixture(6);
grant select on direct_fixture, five_rest_fixture, six_rest_fixture to authenticated, service_role;

insert into tap_results values
  ((select is_nullable = 'YES' from information_schema.columns
    where table_schema = 'public' and table_name = 'trips' and column_name = 'lunch_stop'),
   'current trip storage allows an omitted lunch'),
  (public.is_valid_verified_collection_course(jsonb_build_object(
    'origin', (select plan -> 'origin' from direct_fixture) || jsonb_build_object('verificationToken', repeat('a', 43)),
    'destination', (select plan -> 'destination' from direct_fixture) || jsonb_build_object('verificationToken', repeat('a', 43)),
    'points', '[]'::jsonb
  )), 'complete collection accepts an endpoint-only course'),
  ((select public.is_valid_current_plan_stops(plan) from five_rest_fixture),
   'current plan validation accepts five rests without lunch'),
  ((select not public.is_valid_current_plan_stops(plan) from six_rest_fixture),
   'current plan validation rejects a sixth rest without lunch');

set local role service_role;
select public.stage_route_candidate_internal(
  '75200000-0000-0000-0000-000000000001',
  '76200000-0000-4000-8000-000000000001',
  (select plan from direct_fixture), (select route from direct_fixture)
);
select public.stage_route_candidate_internal(
  '75200000-0000-0000-0000-000000000001',
  '76200000-0000-4000-8000-000000000002',
  (select plan from five_rest_fixture), (select route from five_rest_fixture)
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '75200000-0000-0000-0000-000000000001', true);
create temp table saved_trips(kind text primary key, id uuid not null) on commit drop;
insert into saved_trips values
  ('direct', public.finalize_trip_plan('76200000-0000-4000-8000-000000000001', null)),
  ('five-rest', public.finalize_trip_plan('76200000-0000-4000-8000-000000000002', null));
grant select on saved_trips to authenticated, service_role;

reset role;
set local role service_role;
select public.insert_weather_snapshot_internal(
  '75200000-0000-0000-0000-000000000001',
  (select id from saved_trips where kind = 'direct'),
  'recommended', now() - interval '5 minutes', now() + interval '2 hours',
  pg_temp.optional_weather_segments((select route from direct_fixture), now() - interval '5 minutes'),
  repeat('a', 64), clock_timestamp()
);
select public.insert_weather_snapshot_internal(
  '75200000-0000-0000-0000-000000000001',
  (select id from saved_trips where kind = 'five-rest'),
  'recommended', now() - interval '5 minutes', now() + interval '2 hours',
  pg_temp.optional_weather_segments((select route from five_rest_fixture), now() - interval '5 minutes'),
  repeat('b', 64), clock_timestamp()
);
reset role;
insert into tap_results values
  ((select lunch_stop is null from public.trips where id = (select id from saved_trips where kind = 'direct')),
   'endpoint-only finalization stores no lunch placeholder'),
  ((select count(*) = 0 from public.trip_waypoints where trip_id = (select id from saved_trips where kind = 'direct')),
   'endpoint-only finalization stores no synthetic waypoint'),
  ((select public.build_trip_share_snapshot(id, '75200000-0000-0000-0000-000000000001') -> 'trip' -> 'lunchStop' = 'null'::jsonb
    from saved_trips where kind = 'direct'),
   'current share snapshot emits a null lunch'),
  ((select count(*) = 5 from public.trip_waypoints where trip_id = (select id from saved_trips where kind = 'five-rest')),
   'five-rest finalization preserves every ordered rest'),
  ((select count(*) = 1 from public.route_cache where trip_id = (select id from saved_trips where kind = 'five-rest')),
   'five-rest finalization stores exactly one recommended route');

select
  (case when ok then 'ok ' else 'not ok ' end) ||
  row_number() over () || ' - ' || description
from tap_results;
select '1..' || count(*) from tap_results;

rollback;
