\set ON_ERROR_STOP on

begin;

create temp table tap_results(ok boolean not null, description text not null) on commit drop;
grant insert, select on tap_results to anon, authenticated, service_role;

create or replace function pg_temp.meal_point(
  point_id text, point_label text, point_lon numeric, point_lat numeric,
  point_kind text, dwell integer, stop_role text default null
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', point_id, 'label', point_label, 'kakaoPlaceId', point_id,
    'name', point_label, 'address', '테스트 주소', 'roadAddress', null,
    'longitude', point_lon, 'latitude', point_lat,
    'kind', point_kind, 'dwellMinutes', dwell, 'selected', true,
    'winding', false, 'verificationToken', repeat('a', 43)
  ) || case when stop_role is null then '{}'::jsonb
    else jsonb_build_object('stopRole', stop_role) end;
$$;

create or replace function pg_temp.meal_fixture(waypoints jsonb)
returns table(plan jsonb, route jsonb)
language plpgsql
as $$
declare
  origin jsonb := pg_temp.meal_point('origin', '출발', 127, 37, 'pass-through', 0);
  destination jsonb := pg_temp.meal_point('destination', '복귀', 127.2, 37.2, 'pass-through', 0);
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
  points := points || waypoints;
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
    'lunchStop', (select item from jsonb_array_elements(waypoints) item where item ->> 'stopRole' = 'lunch' limit 1),
    'dinnerStop', (select item from jsonb_array_elements(waypoints) item where item ->> 'stopRole' = 'dinner' limit 1),
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

create or replace function pg_temp.meal_weather_segments(route jsonb, issued_at timestamptz)
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

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '75300000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'meal-role@motocast.test', '',
  now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"식사 역할"}'
);
insert into public.memberships(user_id, role)
values ('75300000-0000-0000-0000-000000000001', 'rider');

create temp table meal_points on commit drop as
select meal_count, jsonb_agg(pg_temp.meal_point(
  'meal-' || position, '식사 ' || position, 127 + position * 0.001, 37 + position * 0.001,
  'stop', position, 'meal'
) order by position) as points
from (values (30), (31)) limits(meal_count)
cross join lateral generate_series(1, meal_count) position
group by meal_count;

create temp table meal_fixtures on commit drop as
select 'meals-' || meal_count as kind, fixture.plan, fixture.route
from meal_points cross join lateral pg_temp.meal_fixture(points) fixture
union all
select 'mixed', fixture.plan, fixture.route
from pg_temp.meal_fixture(jsonb_build_array(
  pg_temp.meal_point('meal-a', '첫 식사', 127.02, 37.02, 'stop', 17, 'meal'),
  pg_temp.meal_point('rest', '휴식', 127.04, 37.04, 'optional', 15, 'rest'),
  pg_temp.meal_point('meal-b', '두 번째 식사', 127.06, 37.06, 'stop', 93, 'meal')
)) fixture
union all
select 'legacy', fixture.plan, fixture.route
from pg_temp.meal_fixture(jsonb_build_array(
  pg_temp.meal_point('lunch', '기존 점심', 127.02, 37.02, 'stop', 47, 'lunch'),
  pg_temp.meal_point('dinner', '기존 저녁', 127.04, 37.04, 'stop', 81, 'dinner')
)) fixture;

create temp table meal_courses on commit drop as
select kind, jsonb_build_object('origin', plan -> 'origin', 'destination', plan -> 'destination', 'points', plan -> 'waypoints') as course
from meal_fixtures;
grant select on meal_fixtures, meal_courses to authenticated, service_role;

insert into tap_results values
  ((select public.is_valid_current_plan_stops(plan) from meal_fixtures where kind = 'meals-30'),
   'thirty meals have no separate role-count ceiling'),
  ((select public.is_valid_verified_collection_course(course) from meal_courses where kind = 'meals-30'),
   'collection accepts thirty meals with edited positive dwell'),
  ((select public.recommended_route_matches_plan(plan, route) from meal_fixtures where kind = 'meals-30'),
   'route binding accepts thirty interior meals plus two endpoints'),
  ((select not public.is_valid_current_plan_stops(plan) from meal_fixtures where kind = 'meals-31'),
   'plan rejects thirty-one interior meals'),
  ((select not public.is_valid_verified_collection_course(course) from meal_courses where kind = 'meals-31'),
   'collection rejects thirty-one interior meals'),
  ((select public.is_valid_current_plan_stops(plan) from meal_fixtures where kind = 'legacy'),
   'existing lunch and dinner still validate with their original dwell');

create temp table invalid_meal_points on commit drop as
select label, (select plan -> 'waypoints' -> 0 from meal_fixtures where kind = 'mixed') || patch as point
from (values
  ('zero dwell', '{"dwellMinutes":0}'::jsonb),
  ('negative dwell', '{"dwellMinutes":-1}'::jsonb),
  ('fractional dwell', '{"dwellMinutes":1.5}'::jsonb),
  ('optional meal', '{"kind":"optional"}'::jsonb),
  ('pass-through meal', '{"kind":"pass-through"}'::jsonb),
  ('winding meal', '{"winding":true}'::jsonb),
  ('unselected meal', '{"selected":false}'::jsonb),
  ('null role', '{"stopRole":null}'::jsonb)
) bad(label, patch);
insert into tap_results
select not public.is_valid_current_plan_stops(jsonb_set((select plan from meal_fixtures where kind = 'mixed'), '{waypoints,0}', point)),
  'plan rejects ' || label from invalid_meal_points;
insert into tap_results
select not public.is_valid_verified_collection_course(jsonb_set((select course from meal_courses where kind = 'mixed'), '{points,0}', point)),
  'collection rejects ' || label from invalid_meal_points;

insert into tap_results
select not public.is_valid_current_plan_stops(fixture.plan), 'legacy ' || role || ' still rejects a duplicate occurrence'
from (values ('lunch'), ('dinner')) roles(role)
cross join lateral pg_temp.meal_fixture(jsonb_build_array(
  pg_temp.meal_point(role || '-a', '기존 식사', 127.02, 37.02, 'stop', 60, role),
  pg_temp.meal_point(role || '-b', '기존 식사', 127.04, 37.04, 'stop', 60, role)
)) fixture;

insert into tap_results
select not has_function_privilege(application_role, function_name, 'execute'),
  application_role || ' still cannot directly execute private meal validator/projector ' || function_name
from (values ('anon'), ('authenticated'), ('service_role')) roles(application_role)
cross join (values
  ('public.is_valid_collection_points(jsonb)'),
  ('public.is_valid_current_plan_stops(jsonb)'),
  ('public.is_valid_verified_collection_course(jsonb)'),
  ('public.share_route_point(jsonb)')
) functions(function_name);

set local role service_role;
select public.stage_route_candidate_internal(
  '75300000-0000-0000-0000-000000000001', '76300000-0000-4000-8000-000000000001',
  (select plan from meal_fixtures where kind = 'legacy'), (select route from meal_fixtures where kind = 'legacy')
);
select public.stage_route_candidate_internal(
  '75300000-0000-0000-0000-000000000001', '76300000-0000-4000-8000-000000000002',
  (select plan from meal_fixtures where kind = 'mixed'), (select route from meal_fixtures where kind = 'mixed')
);
select public.stage_route_candidate_internal(
  '75300000-0000-0000-0000-000000000001', '76300000-0000-4000-8000-000000000003',
  (select plan from meal_fixtures where kind = 'meals-30'), (select route from meal_fixtures where kind = 'meals-30')
);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.save_collection_version_internal(
      '75300000-0000-0000-0000-000000000001', '76300000-0000-4000-8000-000000000004', null, '거부 식사', '',
      jsonb_set((select course from meal_courses where kind = 'mixed'), '{points,0,dwellMinutes}', '0'::jsonb)
    );
  exception when sqlstate 'P0001' then rejected := sqlerrm = 'INVALID_COLLECTION'; end;
  insert into tap_results values (rejected, 'collection writer fails explicitly for a zero-dwell meal');
end;
$$;

create temp table saved_meal_collection on commit drop as
select * from public.save_collection_version_internal(
  '75300000-0000-0000-0000-000000000001', '76300000-0000-4000-8000-000000000005', null, '식사 30개', '',
  (select course from meal_courses where kind = 'meals-30')
);
create temp table retried_meal_collection on commit drop as
select * from public.save_collection_version_internal(
  '75300000-0000-0000-0000-000000000001', '76300000-0000-4000-8000-000000000005', null, '식사 30개', '',
  (select course from meal_courses where kind = 'meals-30')
);
reset role;
insert into tap_results values
  ((select saved = retried from saved_meal_collection saved cross join retried_meal_collection retried),
   'same meal collection operation retry returns the original version'),
  ((select cv.points = course -> 'points' from public.collection_versions cv cross join meal_courses
    where cv.id = (select version_id from saved_meal_collection) and kind = 'meals-30'),
   'immutable collection stores all thirty original roles and edited dwell unchanged');

set local role authenticated;
select set_config('request.jwt.claim.sub', '75300000-0000-0000-0000-000000000001', true);
create temp table saved_meal_trips(kind text primary key, id uuid not null) on commit drop;
insert into saved_meal_trips values
  ('legacy', public.finalize_trip_plan('76300000-0000-4000-8000-000000000001', null)),
  ('mixed', public.finalize_trip_plan('76300000-0000-4000-8000-000000000002', null)),
  ('meals-30', public.finalize_trip_plan('76300000-0000-4000-8000-000000000003', null));
grant select on saved_meal_trips to authenticated, service_role;

set local role service_role;
select public.insert_weather_snapshot_internal(
  '75300000-0000-0000-0000-000000000001', saved.id, 'recommended', now() - interval '5 minutes', now() + interval '2 hours',
  pg_temp.meal_weather_segments(fixture.route, now() - interval '5 minutes'), repeat('a', 64), clock_timestamp()
)
from saved_meal_trips saved join meal_fixtures fixture using (kind);

set local role authenticated;
create temp table meal_previews on commit drop as
select saved.kind, preview.* from saved_meal_trips saved
cross join lateral public.preview_trip_share(saved.id) preview;
create temp table meal_publications on commit drop as
select saved.kind, publication.* from saved_meal_trips saved join meal_previews preview using (kind)
cross join lateral public.publish_trip_share(saved.id, preview.preview_token) publication;
grant select on meal_publications to authenticated, anon, service_role;

insert into tap_results values
  ((select public.get_shared_course(share_token) = course from meal_publications join meal_courses using (kind) where kind = 'mixed'),
   'authenticated reusable shared course preserves mixed meal roles and dwell'),
  ((select public.get_shared_course(share_token) = course from meal_publications join meal_courses using (kind) where kind = 'legacy'),
   'authenticated reusable legacy course preserves lunch and dinner'),
  ((select public.get_shared_course(share_token) = course from meal_publications join meal_courses using (kind) where kind = 'meals-30'),
   'shared course roundtrip preserves all thirty meals');
reset role;

insert into tap_results values
  ((select route.summary = fixture.route from public.route_cache route join saved_meal_trips saved on route.trip_id = saved.id
    join meal_fixtures fixture using (kind) where kind = 'mixed'),
   'saved route retains exact ordered meal ETA and dwell'),
  ((select trips.reusable_course = course from public.trips trips join saved_meal_trips saved on trips.id = saved.id
    join meal_courses using (kind) where kind = 'mixed'),
   'saved trip retains the exact signed reusable meal course'),
  ((select count(*) = 30 from public.trip_waypoints where trip_id = (select id from saved_meal_trips where kind = 'meals-30')),
   'finalization stores thirty interior meals'),
  ((select array_agg(dwell_minutes order by position) = array[17,15,93] from public.trip_waypoints
    where trip_id = (select id from saved_meal_trips where kind = 'mixed')),
   'finalization preserves edited mixed stop dwell in original order'),
  ((select trips.lunch_stop is null and trips.dinner_stop is null from public.trips trips join saved_meal_trips saved on trips.id = saved.id where kind = 'mixed'),
   'new meal trips do not manufacture legacy lunch or dinner placeholders'),
  ((select published_snapshot -> 'route' -> 'legs' -> 0 -> 'to' ->> 'stopRole' = 'meal'
    and published_snapshot -> 'route' -> 'legs' -> 1 -> 'from' ->> 'stopRole' = 'meal'
    and published_snapshot -> 'route' -> 'legs' -> 2 -> 'to' ->> 'stopRole' = 'meal'
    from meal_publications where kind = 'mixed'),
   'public route projection preserves every meal occurrence role'),
  ((select published_snapshot::text not like '%verificationToken%' from meal_publications where kind = 'mixed'),
   'public meal share exposes no signed place verification proof'),
  ((select published_snapshot = preview_snapshot from meal_publications join meal_previews using (kind) where kind = 'mixed'),
   'publication exactly matches the approved meal preview'),
  ((select published_snapshot -> 'route' -> 'legs' -> 0 -> 'to' ->> 'stopRole' = 'lunch'
    and published_snapshot -> 'route' -> 'legs' -> 1 -> 'to' ->> 'stopRole' = 'dinner'
    from meal_publications where kind = 'legacy'),
   'legacy share remains lunch and dinner with no role normalization');

create temp table preserved_legacy_snapshot on commit drop as
select share_id, published_snapshot from meal_publications where kind = 'legacy';
-- A later source edit must not rewrite either existing legacy or meal snapshots.
update public.trips set title = '발행 후 원본 변경'
where id in (select id from saved_meal_trips);
insert into tap_results values
  ((select link.published_snapshot = original.published_snapshot from public.share_links link
    join preserved_legacy_snapshot original on link.id = original.share_id),
   'editing source trips never rewrites a published legacy snapshot');

set local role anon;
insert into tap_results
select public.resolve_share(share_token) = published_snapshot, 'anonymous immutable ' || kind || ' share roundtrip is exact'
from meal_publications;
reset role;

select (case when ok then 'ok ' else 'not ok ' end) || row_number() over () || ' - ' || description from tap_results;
select '1..' || count(*) from tap_results;
rollback;
