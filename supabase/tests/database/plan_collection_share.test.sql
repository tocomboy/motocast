\set ON_ERROR_STOP on

begin;

create temp table tap_results(ok boolean not null, description text not null) on commit drop;
grant insert, select on tap_results to anon, authenticated, service_role;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
values
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'plan-a@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"플랜 A"}'),
  ('00000000-0000-0000-0000-000000000000', '72000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'plan-b@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"플랜 B"}');

insert into public.memberships(user_id, role)
values
  ('71000000-0000-0000-0000-000000000001', 'rider'),
  ('72000000-0000-0000-0000-000000000002', 'rider');

create or replace function pg_temp.test_point(
  point_id text, point_label text, point_lon numeric, point_lat numeric,
  point_kind text, dwell integer, winding boolean, stop_role text default null
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', point_id, 'label', point_label, 'kakaoPlaceId', point_id,
    'verificationToken', repeat('a', 43), 'name', point_label,
    'address', '테스트 주소', 'roadAddress', null,
    'longitude', point_lon, 'latitude', point_lat,
    'kind', point_kind, 'dwellMinutes', dwell, 'selected', true,
    'winding', winding
  ) || case when stop_role is null then '{}'::jsonb else jsonb_build_object('stopRole', stop_role) end;
$$;

create or replace function pg_temp.test_weather_segments(
  route jsonb, profile text, issued_at timestamptz
) returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object(
    'id', profile || '-' || (position - 1)::text,
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

create or replace function pg_temp.test_route(profile text, middle_lon numeric)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'candidate', jsonb_build_object(
      'id', profile,
      'label', case profile when 'recommended' then '추천 경로' when 'balanced' then '균형' when 'winding' then '와인딩' else '최단' end,
      'estimatedWinding', false
    ),
    'safety', jsonb_build_object('vehicle', 'motorcycle', 'motorwayExcluded', true, 'fallbackUsed', false),
    'totalDistanceMeters', 10000,
    'totalDurationSeconds', 600,
    'returnAt', '2026-08-31T00:10:00.000Z',
    'legs', jsonb_build_array(jsonb_build_object(
      'from', jsonb_build_object('id', 'origin', 'label', '출발', 'longitude', 127, 'latitude', 37, 'kind', 'pass-through', 'dwellMinutes', 0, 'selected', true),
      'to', jsonb_build_object('id', 'destination', 'label', '복귀', 'longitude', 127.2, 'latitude', 37.2, 'kind', 'pass-through', 'dwellMinutes', 0, 'selected', true),
      'via', '[]'::jsonb,
      'departureAt', '2026-08-31T00:00:00.000Z',
      'arrivalAt', '2026-08-31T00:10:00.000Z',
      'dwellMinutes', 0,
      'distanceMeters', 10000,
      'durationSeconds', 600,
      'forecastTraffic', false,
      'sections', jsonb_build_array(jsonb_build_object(
        'distance', 10000,
        'duration', 600,
        'roads', jsonb_build_array(jsonb_build_object(
          'name', '테스트 도로', 'distance', 10000, 'duration', 600,
          'vertexes', jsonb_build_array(127, 37, middle_lon, 37.1, 127.2, 37.2),
          'verificationToken', 'must-never-be-public'
        ))
      ))
    ))
  );
$$;

create or replace function pg_temp.test_recommended_route()
returns jsonb language sql immutable as $$
  with points as (
    select
      pg_temp.test_point('origin', '출발', 127, 37, 'pass-through', 0, false) as origin,
      pg_temp.test_point('winding', '와인딩', 127.05, 37.05, 'pass-through', 0, true) as winding,
      pg_temp.test_point('lunch', '점심', 127.1, 37.1, 'stop', 60, false, 'lunch') as lunch,
      pg_temp.test_point('destination', '복귀', 127.2, 37.2, 'pass-through', 0, false) as destination
  ), legs as (
    select jsonb_build_array(
      jsonb_build_object(
        'from', origin, 'to', winding, 'via', '[]'::jsonb,
        'departureAt', '2026-08-31T00:00:00.000Z', 'arrivalAt', '2026-08-31T00:10:00.000Z',
        'dwellMinutes', 0, 'distanceMeters', 10000, 'durationSeconds', 600, 'forecastTraffic', false,
        'sections', jsonb_build_array(jsonb_build_object('distance', 10000, 'duration', 600,
          'roads', jsonb_build_array(jsonb_build_object('name', '도로 1', 'distance', 10000, 'duration', 600,
            'vertexes', jsonb_build_array(127, 37, 127.025, 37.025, 127.05, 37.05)))))
      ),
      jsonb_build_object(
        'from', winding, 'to', lunch, 'via', '[]'::jsonb,
        'departureAt', '2026-08-31T00:10:00.000Z', 'arrivalAt', '2026-08-31T00:20:00.000Z',
        'dwellMinutes', 60, 'distanceMeters', 10000, 'durationSeconds', 600, 'forecastTraffic', false,
        'sections', jsonb_build_array(jsonb_build_object('distance', 10000, 'duration', 600,
          'roads', jsonb_build_array(jsonb_build_object('name', '도로 2', 'distance', 10000, 'duration', 600,
            'vertexes', jsonb_build_array(127.05, 37.05, 127.075, 37.075, 127.1, 37.1)))))
      ),
      jsonb_build_object(
        'from', lunch, 'to', destination, 'via', '[]'::jsonb,
        'departureAt', '2026-08-31T01:20:00.000Z', 'arrivalAt', '2026-08-31T01:30:00.000Z',
        'dwellMinutes', 0, 'distanceMeters', 10000, 'durationSeconds', 600, 'forecastTraffic', false,
        'sections', jsonb_build_array(jsonb_build_object('distance', 10000, 'duration', 600,
          'roads', jsonb_build_array(jsonb_build_object('name', '도로 3', 'distance', 10000, 'duration', 600,
            'vertexes', jsonb_build_array(127.1, 37.1, 127.15, 37.15, 127.2, 37.2)))))
      )
    ) as value from points
  )
  select jsonb_build_object(
    'candidate', jsonb_build_object('id', 'recommended', 'label', '추천 경로', 'estimatedWinding', false),
    'safety', jsonb_build_object('vehicle', 'motorcycle', 'motorwayExcluded', true, 'fallbackUsed', false),
    'totalDistanceMeters', 30000, 'totalDurationSeconds', 5400,
    'returnAt', '2026-08-31T01:30:00.000Z', 'legs', legs.value
  ) from legs;
$$;

create temp table fixture on commit drop as
select
  jsonb_build_array(
    pg_temp.test_point('winding', '와인딩', 127.05, 37.05, 'pass-through', 0, true),
    pg_temp.test_point('lunch', '점심', 127.1, 37.1, 'stop', 60, false, 'lunch')
  ) as points,
  jsonb_build_object(
    'origin', pg_temp.test_point('origin', '출발', 127, 37, 'pass-through', 0, false),
    'destination', pg_temp.test_point('destination', '복귀', 127.2, 37.2, 'pass-through', 0, false),
    'points', jsonb_build_array(
      pg_temp.test_point('winding', '와인딩', 127.05, 37.05, 'pass-through', 0, true),
      pg_temp.test_point('lunch', '점심', 127.1, 37.1, 'stop', 60, false, 'lunch')
    )
  ) as course,
  jsonb_build_array(
    pg_temp.test_route('balanced', 127.05),
    pg_temp.test_route('winding', 127.1),
    pg_temp.test_route('short', 127.15)
  ) as routes;
grant select on fixture to authenticated, service_role;

insert into tap_results values
  (not has_function_privilege('anon', 'public.save_collection_version(uuid,text,text,jsonb)', 'EXECUTE'), 'anon cannot save collection versions'),
  (not has_function_privilege('authenticated', 'public.save_collection_version(uuid,text,text,jsonb)', 'EXECUTE'), 'browser cannot save unverified collection JSON directly'),
  (has_function_privilege('service_role', 'public.save_collection_version_internal(uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE'), 'trusted Edge role can save verified collection versions'),
  (not has_function_privilege('authenticated', 'public.save_trip_plan(jsonb,jsonb)', 'EXECUTE'), 'browser cannot persist untrusted route JSON directly'),
  (not has_function_privilege('anon', 'public.publish_trip_share(uuid,text)', 'EXECUTE'), 'anon cannot publish shares'),
  (has_function_privilege('service_role', 'public.stage_route_candidate_internal(uuid,uuid,jsonb,jsonb)', 'EXECUTE'), 'trusted Edge role can stage provider candidates'),
  (has_function_privilege('anon', 'public.resolve_share(text)', 'EXECUTE'), 'anon can resolve only a tokenized public snapshot'),
  (not has_function_privilege('authenticated', 'public.build_trip_share_snapshot(uuid,uuid)', 'EXECUTE'), 'authenticated cannot call the private snapshot builder');

set local role service_role;

create temp table collection_result on commit drop as
select * from public.save_collection_version_internal(
  '71000000-0000-0000-0000-000000000001', '71000000-0000-4000-8000-000000001001', null,
  '북한강', '테스트 코스', (select course from fixture)
);
grant select on collection_result to authenticated, service_role;
insert into tap_results values
  ((select version_number = 1 from collection_result), 'new collection starts at immutable version 1'),
  ((select count(*) = 1 from public.riding_collections), 'rider sees the owned collection only'),
  ((select origin ->> 'kakaoPlaceId' = 'origin' and destination ->> 'kakaoPlaceId' = 'destination'
    from public.collection_versions where id = (select version_id from collection_result)),
   'immutable collection version stores the complete course endpoints');

create temp table collection_retry_result on commit drop as
select * from public.save_collection_version_internal(
  '71000000-0000-0000-0000-000000000001', '71000000-0000-4000-8000-000000001001', null,
  '북한강', '테스트 코스', (select course from fixture)
);
insert into tap_results values
  ((select row(collection_id, version_id, version_number) from collection_retry_result) =
   (select row(collection_id, version_id, version_number) from collection_result),
   'an exact save-operation retry returns the original immutable result'),
  ((select count(*) = 1 from public.collection_versions),
   'an exact save-operation retry does not append a duplicate version');

do $$
declare rejected boolean := false;
begin
  begin
    perform public.save_collection_version_internal(
      '71000000-0000-0000-0000-000000000001', '71000000-0000-4000-8000-000000001001', null,
      '북한강', '바뀐 요청', (select course from fixture)
    );
  exception when sqlstate 'P0001' then rejected := sqlerrm = 'COLLECTION_OPERATION_REUSED'; end;
  insert into tap_results values (rejected, 'a save operation id cannot be reused for a different payload');
end;
$$;

create temp table collection_result_2 on commit drop as
select * from public.save_collection_version_internal(
  '71000000-0000-0000-0000-000000000001',
  '71000000-0000-4000-8000-000000001002',
  (select collection_id from collection_result), '북한강', '수정 설명', (select course from fixture)
);
grant select on collection_result_2 to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
insert into tap_results values
  ((select version_number = 2 from collection_result_2), 'saving an existing collection appends version 2'),
  ((select count(*) = 2 from public.collection_versions), 'old collection version remains immutable');

create temp table plan_fixture on commit drop as
select jsonb_build_object(
    'title', '팔당 당일 라이딩',
    'serviceDate', '2026-08-31',
    'departureAt', '2026-08-31T00:00:00.000Z',
    'desiredReturnAt', '2026-08-31T08:00:00.000Z',
    'hardReturnAt', '2026-08-31T09:00:00.000Z',
    'origin', pg_temp.test_point('origin', '출발', 127, 37, 'pass-through', 0, false),
    'destination', pg_temp.test_point('destination', '복귀', 127.2, 37.2, 'pass-through', 0, false),
    'lunchStop', pg_temp.test_point('lunch', '점심', 127.1, 37.1, 'stop', 60, false, 'lunch'),
    'dinnerStop', null,
    'waypoints', (select points from fixture),
    'selectedProfile', 'balanced'
  ) as plan;
grant select on plan_fixture to authenticated, service_role;

create temp table trip_result(id uuid) on commit drop;
set local role service_role;
select public.stage_route_candidate_internal(
  '71000000-0000-0000-0000-000000000001',
  '73000000-0000-4000-8000-000000000001',
  (select plan from plan_fixture),
  route
)
from jsonb_array_elements((select routes from fixture)) as staged(route);
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
insert into trip_result
select public.finalize_trip_plan('73000000-0000-4000-8000-000000000001', null);
grant select on trip_result to authenticated, service_role;
insert into tap_results values
  ((select count(*) = 1 from public.trips where id = (select id from trip_result)), 'trusted staged candidates finalize one owned trip'),
  ((select count(*) = 2 from public.trip_waypoints where trip_id = (select id from trip_result)), 'plan save preserves ordered waypoints'),
  ((select count(*) = 3 from public.route_cache where trip_id = (select id from trip_result)), 'plan save atomically stores three safe candidates');
reset role;
insert into tap_results values (
  public.route_geometry_fingerprint(pg_temp.test_route('balanced', 127.050001)) <>
    public.route_geometry_fingerprint(pg_temp.test_route('balanced', 127.050002)),
  'route identity preserves distinct interior vertices at six decimal places'
);
insert into tap_results values
  (public.route_geometry_fingerprint(pg_temp.test_route('balanced', 127.0500005)) =
    public.route_geometry_fingerprint(pg_temp.test_route('balanced', 127.050001)),
    'route identity rounds an exact six-place tie up to integer microdegrees'),
  (public.route_geometry_fingerprint(pg_temp.test_route('balanced', 127.05000049)) =
    public.route_geometry_fingerprint(pg_temp.test_route('balanced', 127.05)),
    'route identity rounds a below-tie coordinate down to integer microdegrees');
insert into tap_results values
  ((select count(*) = 0 from public.route_plan_drafts), 'finalize consumes trusted route drafts');

set local role service_role;
select public.stage_route_candidate_internal(
  '71000000-0000-0000-0000-000000000001',
  '73000000-0000-4000-8000-000000000003',
  (select plan from plan_fixture), route
)
from jsonb_array_elements((select routes from fixture)) as staged(route)
where route -> 'candidate' ->> 'id' <> 'short';

select public.stage_route_candidate_internal(
  '71000000-0000-0000-0000-000000000001',
  '73000000-0000-4000-8000-000000000004',
  (select plan from plan_fixture), route
)
from jsonb_array_elements((select routes from fixture)) as staged(route)
where route -> 'candidate' ->> 'id' <> 'short';
do $$
declare rejected boolean := false;
begin
  begin
    perform public.stage_route_candidate_internal(
      '71000000-0000-0000-0000-000000000001',
      '73000000-0000-4000-8000-000000000004',
      jsonb_set((select plan from plan_fixture), '{title}', '"다른 계획"'::jsonb, false),
      (select route from jsonb_array_elements((select routes from fixture)) staged(route)
       where route -> 'candidate' ->> 'id' = 'short')
    );
  exception when sqlstate 'P0001' then rejected := sqlerrm = 'PLANNING_ID_REUSED'; end;
  insert into tap_results values (rejected, 'staging rejects a second plan payload for one planning id');
end;
$$;

do $$
declare
  unselected_rejected boolean := false;
  dwell_rejected boolean := false;
  missing_role_rejected boolean := false;
  null_role_rejected boolean := false;
begin
  begin
    perform public.save_collection_version_internal(
      '71000000-0000-0000-0000-000000000001', '71000000-0000-4000-8000-000000001007', null,
      '선택 해제', '', jsonb_set((select course from fixture), '{points,0,selected}', 'false'::jsonb, false)
    );
  exception when sqlstate 'P0001' then unselected_rejected := sqlerrm = 'INVALID_COLLECTION'; end;
  begin
    perform public.save_collection_version_internal(
      '71000000-0000-0000-0000-000000000001', '71000000-0000-4000-8000-000000001008', null,
      '통과 대기', '', jsonb_set((select course from fixture), '{points,0,dwellMinutes}', '30'::jsonb, false)
    );
  exception when sqlstate 'P0001' then dwell_rejected := sqlerrm = 'INVALID_COLLECTION'; end;
  begin
    perform public.save_collection_version_internal(
      '71000000-0000-0000-0000-000000000001', '71000000-0000-4000-8000-000000001009', null,
      '역할 누락', '', (select jsonb_set(course, '{points}', (course -> 'points') #- '{1,stopRole}') from fixture)
    );
  exception when sqlstate 'P0001' then missing_role_rejected := sqlerrm = 'INVALID_COLLECTION'; end;
  begin
    perform public.save_collection_version_internal(
      '71000000-0000-0000-0000-000000000001', '71000000-0000-4000-8000-000000001010', null,
      '명시적 null 역할', '', jsonb_set((select course from fixture), '{points,0,stopRole}', 'null'::jsonb, true)
    );
  exception when sqlstate 'P0001' then null_role_rejected := sqlerrm = 'INVALID_COLLECTION'; end;
  insert into tap_results values
    (unselected_rejected, 'complete collection rejects an unselected persisted occurrence'),
    (dwell_rejected, 'complete collection rejects dwell on a pass-through occurrence'),
    (missing_role_rejected, 'complete collection rejects a stop without a route role'),
    (null_role_rejected, 'complete collection rejects explicit null stopRole instead of storing an unreadable point');
end;
$$;

select public.stage_route_candidate_internal(
  '71000000-0000-0000-0000-000000000001',
  '73000000-0000-4000-8000-000000000005',
  (select plan from plan_fixture), route
)
from jsonb_array_elements((select routes from fixture)) as staged(route);
reset role;
update public.route_plan_drafts
set created_at = now() - interval '11 minutes'
where owner_id = '71000000-0000-0000-0000-000000000001'
  and planning_id = '73000000-0000-4000-8000-000000000005';

set local role service_role;
select public.stage_route_candidate_internal(
  '71000000-0000-0000-0000-000000000001',
  '73000000-0000-4000-8000-000000000006',
  (select plan from plan_fixture), route
)
from jsonb_array_elements((select routes from fixture)) as staged(route);

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
do $$
declare
  replay_rejected boolean := false;
  partial_rejected boolean := false;
  mismatched_rejected boolean := false;
  expired_rejected boolean := false;
begin
  begin
    perform public.finalize_trip_plan('73000000-0000-4000-8000-000000000001', null);
  exception when sqlstate 'P0001' then replay_rejected := sqlerrm = 'ROUTE_PLAN_NOT_READY'; end;
  begin
    perform public.finalize_trip_plan('73000000-0000-4000-8000-000000000003', null);
  exception when sqlstate 'P0001' then partial_rejected := sqlerrm = 'ROUTE_PLAN_NOT_READY'; end;
  begin
    perform public.finalize_trip_plan('73000000-0000-4000-8000-000000000004', null);
  exception when sqlstate 'P0001' then mismatched_rejected := sqlerrm = 'ROUTE_PLAN_NOT_READY'; end;
  begin
    perform public.finalize_trip_plan('73000000-0000-4000-8000-000000000005', null);
  exception when sqlstate 'P0001' then expired_rejected := sqlerrm = 'ROUTE_PLAN_NOT_READY'; end;
  insert into tap_results values
    (replay_rejected, 'consumed route drafts cannot be replayed'),
    (partial_rejected, 'partial route candidate sets cannot finalize'),
    (mismatched_rejected, 'candidate drafts for different plans cannot finalize together'),
    (expired_rejected, 'expired route drafts cannot finalize');
end;
$$;

set local role service_role;
select public.stage_route_candidate_internal(
  '71000000-0000-0000-0000-000000000001',
  '73000000-0000-4000-8000-000000000002',
  (select plan from plan_fixture),
  jsonb_set(pg_temp.test_route('balanced', 127.05), '{candidate,id}', to_jsonb(profile), false)
)
from (values ('balanced'), ('winding'), ('short')) as duplicate_profiles(profile);
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.finalize_trip_plan('73000000-0000-4000-8000-000000000002', null);
  exception when sqlstate 'P0001' then rejected := sqlerrm = 'ROUTE_PLAN_NOT_READY'; end;
  insert into tap_results values (rejected, 'three labels with duplicate geometry cannot finalize a route plan');
end;
$$;

reset role;
delete from public.route_plan_drafts
where owner_id = '71000000-0000-0000-0000-000000000001'
  and planning_id = '73000000-0000-4000-8000-000000000002';

set local role service_role;
do $$
declare rejected boolean := false;
begin
  begin
    perform public.save_collection_version_internal(
      '71000000-0000-0000-0000-000000000001', '71000000-0000-4000-8000-000000001003', null,
      '누락 플래그',
      '',
      (select jsonb_set(course, '{points}', (course -> 'points') #- '{0,selected}') from fixture)
    );
  exception when sqlstate 'P0001' then rejected := sqlerrm = 'INVALID_COLLECTION'; end;
  insert into tap_results values (rejected, 'collection rejects a waypoint missing the selected flag');
end;
$$;

do $$
declare
  five_rest_course jsonb := (select course from fixture);
  six_rest_course jsonb;
  duplicate_id_course jsonb;
  accepted_version integer;
  rejected_six boolean := false;
  rejected_duplicate boolean := false;
begin
  for rest_number in 1..5 loop
    five_rest_course := jsonb_set(
      five_rest_course,
      '{points}',
      five_rest_course -> 'points' || jsonb_build_array(
        jsonb_set(
          pg_temp.test_point('rest-' || rest_number, '같은 휴식지', 127.15, 37.15, 'optional', 30, false, 'rest'),
          '{kakaoPlaceId}',
          '"same-rest-place"'::jsonb,
          false
        )
      ),
      false
    );
  end loop;
  select version_number into accepted_version
  from public.save_collection_version_internal(
    '71000000-0000-0000-0000-000000000001', '71000000-0000-4000-8000-000000001004', null,
    '다섯 휴식', '', five_rest_course
  );

  six_rest_course := jsonb_set(
    five_rest_course,
    '{points}',
    five_rest_course -> 'points' || jsonb_build_array(
      pg_temp.test_point('rest-6', '여섯째 휴식', 127.16, 37.16, 'optional', 30, false, 'rest')
    ),
    false
  );
  begin
    perform public.save_collection_version_internal(
      '71000000-0000-0000-0000-000000000001', '71000000-0000-4000-8000-000000001005', null,
      '여섯 휴식', '', six_rest_course
    );
  exception when sqlstate 'P0001' then rejected_six := sqlerrm = 'INVALID_COLLECTION'; end;

  duplicate_id_course := jsonb_set(
    five_rest_course,
    '{points,2,id}',
    five_rest_course #> '{points,1,id}',
    false
  );
  begin
    perform public.save_collection_version_internal(
      '71000000-0000-0000-0000-000000000001', '71000000-0000-4000-8000-000000001006', null,
      '중복 순번', '', duplicate_id_course
    );
  exception when sqlstate 'P0001' then rejected_duplicate := sqlerrm = 'INVALID_COLLECTION'; end;

  insert into tap_results values
    (accepted_version = 1, 'complete collection accepts five ordered rest occurrences at the boundary'),
    (rejected_six, 'complete collection rejects a sixth rest occurrence'),
    (rejected_duplicate, 'complete collection rejects duplicate occurrence ids');
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.preview_trip_share((select id from trip_result));
  exception when sqlstate 'P0001' then rejected := sqlerrm = 'SHARE_WEATHER_NOT_FRESH'; end;
  insert into tap_results values (rejected, 'missing weather cannot mint a share preview capability');
end;
$$;

reset role;
set local role service_role;
create temp table weather_result(id uuid) on commit drop;
insert into weather_result
select public.insert_weather_snapshot_internal(
  '71000000-0000-0000-0000-000000000001',
  (select id from trip_result),
  'balanced',
  now() - interval '5 minutes',
  now() + interval '2 hours',
  pg_temp.test_weather_segments(
    pg_temp.test_route('balanced', 127.05),
    'balanced',
    now() - interval '5 minutes'
  ),
  repeat('b', 64),
  clock_timestamp()
);
grant select on weather_result to authenticated, service_role;
select public.mark_weather_snapshot_stale_internal(
  '71000000-0000-0000-0000-000000000001',
  (select id from weather_result),
  'KMA_REQUEST_FAILED',
  'provider'
);

do $$
declare null_kind_rejected boolean := false;
begin
  begin
    perform public.mark_weather_snapshot_stale_internal(
      '71000000-0000-0000-0000-000000000001',
      (select id from weather_result),
      'KMA_REQUEST_FAILED',
      null
    );
  exception when sqlstate 'P0001' then
    null_kind_rejected := sqlerrm = 'INVALID_WEATHER_SNAPSHOT';
  end;
  insert into tap_results values
    (null_kind_rejected, 'stale weather persistence rejects a null structured failure kind'),
    ((select stale_failure_kind = 'provider' from public.weather_snapshots where id = (select id from weather_result)), 'rejected stale metadata update preserves the complete prior state');
end;
$$;

do $$
declare rejected boolean := false; null_hash_rejected boolean := false;
begin
  begin
    perform public.insert_weather_snapshot_internal(
      '71000000-0000-0000-0000-000000000001',
      (select id from trip_result),
      'balanced',
      '2026-08-30T23:30:00.000Z',
      '2026-08-31T02:00:00.000Z',
      jsonb_build_array(jsonb_build_object(
        'id', 'balanced-0', 'label', '변조', 'longitude', 128.2, 'latitude', 37.2,
        'eta', '2026-08-31T00:10:00.000Z', 'status', 'forecast', 'model', 'ultra',
        'issuedAt', '2026-08-30T23:30:00.000Z', 'condition', 'clear',
        'temperatureC', 22, 'precipitationProbability', 0, 'windSpeedMps', 1.2
      )),
      repeat('c', 64),
      '2026-08-30T23:36:00.000Z'
    );
  exception when sqlstate 'P0001' then rejected := sqlerrm = 'INVALID_WEATHER_ROUTE'; end;
  begin
    perform public.insert_weather_snapshot_internal(
      '71000000-0000-0000-0000-000000000001',
      (select id from trip_result),
      'balanced',
      '2026-08-30T23:30:00.000Z',
      '2026-08-31T02:00:00.000Z',
      jsonb_build_array(jsonb_build_object(
        'id', 'balanced-0', 'label', '복귀', 'longitude', 127.2, 'latitude', 37.2,
        'eta', '2026-08-31T00:10:00.000Z', 'status', 'forecast', 'model', 'ultra',
        'issuedAt', '2026-08-30T23:30:00.000Z', 'condition', 'clear',
        'temperatureC', 22, 'precipitationProbability', 0, 'windSpeedMps', 1.2
      )),
      null,
      '2026-08-30T23:36:00.000Z'
    );
  exception when sqlstate 'P0001' then null_hash_rejected := sqlerrm = 'INVALID_WEATHER_SNAPSHOT'; end;
  insert into tap_results values
    (rejected, 'trusted weather persistence rejects coordinates not derived from the stored route'),
    (null_hash_rejected, 'trusted weather persistence rejects a null cache request hash');
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.preview_trip_share((select id from trip_result));
  exception when sqlstate 'P0001' then rejected := sqlerrm = 'SHARE_WEATHER_NOT_FRESH'; end;
  insert into tap_results values (rejected, 'stale weather cannot mint a share preview capability');
end;
$$;

reset role;
set local role service_role;
create temp table expiry_boundary_weather_result on commit drop as
select public.insert_weather_snapshot_internal(
  '71000000-0000-0000-0000-000000000001',
  (select id from trip_result),
  'balanced',
  now() - interval '2 hours',
  now(),
  pg_temp.test_weather_segments(
    pg_temp.test_route('balanced', 127.05),
    'balanced',
    now() - interval '2 hours'
  ),
  repeat('d', 64),
  clock_timestamp()
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.preview_trip_share((select id from trip_result));
  exception when sqlstate 'P0001' then rejected := sqlerrm = 'SHARE_WEATHER_NOT_FRESH'; end;
  insert into tap_results values (rejected, 'weather expiring exactly now cannot mint a share preview capability');
end;
$$;

reset role;
set local role service_role;
create temp table stale_after_preview_weather_result on commit drop as
select public.insert_weather_snapshot_internal(
  '71000000-0000-0000-0000-000000000001',
  (select id from trip_result),
  'balanced',
  now() - interval '5 minutes',
  now() + interval '2 hours',
  pg_temp.test_weather_segments(
    pg_temp.test_route('balanced', 127.05),
    'balanced',
    now() - interval '5 minutes'
  ),
  repeat('e', 64),
  clock_timestamp()
) as id;
grant select on stale_after_preview_weather_result to authenticated, service_role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);

create temp table stale_publish_preview on commit drop as
select * from public.preview_trip_share((select id from trip_result));
grant select on stale_publish_preview to authenticated, service_role;
reset role;
set local role service_role;
select public.mark_weather_snapshot_stale_internal(
  '71000000-0000-0000-0000-000000000001',
  (select id from stale_after_preview_weather_result),
  'KMA_REQUEST_FAILED',
  'provider'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.publish_trip_share(
      (select id from trip_result),
      (select preview_token from stale_publish_preview)
    );
  exception when sqlstate 'P0001' then rejected := sqlerrm = 'SHARE_WEATHER_NOT_FRESH'; end;
  insert into tap_results values (rejected, 'weather that becomes stale after preview cannot publish');
end;
$$;

reset role;
set local role service_role;
select public.insert_weather_snapshot_internal(
  '71000000-0000-0000-0000-000000000001',
  (select id from trip_result),
  'balanced',
  clock_timestamp() - interval '5 minutes',
  clock_timestamp() + interval '2 seconds',
  pg_temp.test_weather_segments(
    pg_temp.test_route('balanced', 127.05),
    'balanced',
    clock_timestamp() - interval '5 minutes'
  ),
  repeat('2', 64),
  clock_timestamp()
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
create temp table advancing_clock_preview on commit drop as
select * from public.preview_trip_share((select id from trip_result));
grant select on advancing_clock_preview to authenticated;
select pg_sleep(2.1);
do $$
declare
  preview_rejected boolean := false;
  publish_rejected boolean := false;
begin
  begin
    perform public.preview_trip_share((select id from trip_result));
  exception when sqlstate 'P0001' then preview_rejected := sqlerrm = 'SHARE_WEATHER_NOT_FRESH'; end;
  begin
    perform public.publish_trip_share(
      (select id from trip_result),
      (select preview_token from advancing_clock_preview)
    );
  exception when sqlstate 'P0001' then publish_rejected := sqlerrm = 'SHARE_WEATHER_NOT_FRESH'; end;
  insert into tap_results values
    (preview_rejected, 'weather expiring after transaction start cannot mint a preview'),
    (publish_rejected, 'weather expiring after preview cannot publish in the same transaction');
end;
$$;

reset role;
set local role service_role;
select public.insert_weather_snapshot_internal(
  '71000000-0000-0000-0000-000000000001',
  (select id from trip_result),
  'balanced',
  now() - interval '5 minutes',
  now() + interval '2 hours',
  pg_temp.test_weather_segments(
    pg_temp.test_route('balanced', 127.05),
    'balanced',
    now() - interval '5 minutes'
  ),
  repeat('1', 64),
  clock_timestamp()
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);

create temp table preview_result on commit drop as
select * from public.preview_trip_share((select id from trip_result));
grant select on preview_result to authenticated;
create temp table published_result on commit drop as
select * from public.publish_trip_share(
  (select id from trip_result),
  (select preview_token from preview_result)
);
grant select on published_result to authenticated;
insert into tap_results values
  ((select published_snapshot = preview_snapshot from published_result cross join preview_result), 'published snapshot exactly matches the approved preview capability'),
  ((select preview_snapshot ->> 'schemaVersion' = '3' from preview_result), 'new shares use the single recommended route schema'),
  ((select not (preview_snapshot -> 'trip' ? 'desiredReturnAt') and not (preview_snapshot -> 'trip' ? 'hardReturnAt') from preview_result), 'new shares omit removed desired and hard return inputs'),
  ((select not (preview_snapshot -> 'trip' ? 'selectedProfile') and not (preview_snapshot ? 'routes') from preview_result), 'new shares expose no legacy candidate selection'),
  ((select preview_snapshot -> 'route' ? 'returnAt' from preview_result), 'new shares retain the computed route return time'),
  ((select preview_snapshot -> 'route' -> 'candidate' ->> 'id' = 'recommended' from preview_result), 'new shares expose one recommended route identity'),
  ((select preview_snapshot -> 'weather' is not null from preview_result), 'share includes weather only when it matches the selected stored route'),
  ((select preview_snapshot -> 'weather' -> 'segments' -> 0 ->> 'id' = 'recommended-0' from preview_result), 'schema 3 normalizes legacy weather segment identity to recommended'),
  ((select preview_snapshot -> 'waypoints' -> 0 ->> 'id' = 'waypoint-0' from preview_result), 'share uses snapshot-local waypoint ids instead of owner table ids'),
  ((select preview_snapshot -> 'weather' ? 'validUntil' from preview_result), 'share exposes weather validity for freshness display'),
  ((select preview_snapshot -> 'weather' ->> 'stale' = 'false' from preview_result), 'share contains only fresh route-bound weather'),
  ((select preview_snapshot -> 'weather' -> 'staleReason' = 'null'::jsonb from preview_result), 'fresh share contains no stale reason'),
  ((select preview_snapshot -> 'weather' -> 'failureKind' = 'null'::jsonb from preview_result), 'fresh share contains no stale failure kind'),
  ((select char_length(share_token) = 43 from published_result), 'share token contains 32 random base64url bytes'),
  ((select token_hash <> share_token and char_length(token_hash) = 64 from public.share_links cross join published_result), 'database stores only the share token hash'),
  ((select published_snapshot::text not like '%verificationToken%' from published_result), 'public snapshot recursively excludes internal place verification proofs');

do $$
declare reused_rejected boolean := false; version_dml_rejected boolean := false; share_dml_rejected boolean := false;
begin
  begin
    perform public.publish_trip_share(
      (select id from trip_result),
      (select preview_token from preview_result)
    );
  exception when sqlstate 'P0001' then reused_rejected := sqlerrm = 'SHARE_PREVIEW_REQUIRED'; end;
  begin
    update public.collection_versions set title = '변조' where id = (select version_id from collection_result);
  exception when insufficient_privilege then version_dml_rejected := true; end;
  begin
    update public.share_links set revoked_at = null where id = (select share_id from published_result);
  exception when insufficient_privilege then share_dml_rejected := true; end;
  insert into tap_results values
    (reused_rejected, 'preview capability is single use'),
    (version_dml_rejected, 'browser cannot mutate immutable collection versions directly'),
    (share_dml_rejected, 'browser cannot mutate immutable share rows directly');
end;
$$;

create temp table legacy_selection_preview on commit drop as
select * from public.preview_trip_share((select id from trip_result));
grant select on legacy_selection_preview to authenticated;
select public.select_trip_candidate((select id from trip_result), 'winding');
insert into tap_results values (
  (select public.resolve_share(share_token) -> 'route' -> 'candidate' ->> 'id' = 'recommended' from published_result),
  'source edits do not change an existing immutable share'
);

create temp table legacy_selection_preview_after on commit drop as
select * from public.preview_trip_share((select id from trip_result));
grant select on legacy_selection_preview_after to authenticated;
insert into tap_results values (
  (select before.preview_snapshot = after.preview_snapshot
   from legacy_selection_preview before cross join legacy_selection_preview_after after),
  'legacy candidate selection does not change the schema 3 representative balanced route'
);

create temp table expired_preview on commit drop as
select * from public.preview_trip_share((select id from trip_result));
grant select on expired_preview to authenticated;
reset role;
update public.share_preview_grants
set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
where token_hash = encode(extensions.digest((select preview_token from expired_preview), 'sha256'), 'hex');
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.publish_trip_share(
      (select id from trip_result),
      (select preview_token from expired_preview)
    );
  exception when sqlstate 'P0001' then rejected := sqlerrm = 'SHARE_PREVIEW_REQUIRED'; end;
  insert into tap_results values (rejected, 'expired preview capabilities cannot publish a share');
end;
$$;

select public.revoke_share((select share_id from published_result));
do $$
declare rejected boolean := false;
begin
  begin
    perform public.resolve_share((select share_token from published_result));
  exception when sqlstate 'P0001' then
    rejected := sqlerrm = 'SHARE_NOT_FOUND';
  end;
  insert into tap_results values (rejected, 'revoked share token is denied');
end;
$$;

create temp table reissue_preview on commit drop as
select * from public.preview_trip_share((select id from trip_result));
grant select on reissue_preview to authenticated;
create temp table reissued_result on commit drop as
select * from public.publish_trip_share(
  (select id from trip_result),
  (select preview_token from reissue_preview)
);
grant select on reissued_result to authenticated, anon;
insert into tap_results values
  ((select reissued.share_token <> original.share_token from reissued_result reissued cross join published_result original), 'reissue creates a different token'),
  ((select public.resolve_share(share_token) -> 'route' -> 'candidate' ->> 'id' = 'recommended' from reissued_result), 'reissue publishes one representative recommended route');

select set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000002', true);
insert into tap_results values
  ((select count(*) = 0 from public.riding_collections), 'rider B cannot read rider A collections'),
  ((select count(*) = 0 from public.share_links), 'rider B cannot manage rider A share links');

do $$
declare preview_rejected boolean := false; revoke_rejected boolean := false; route_rejected boolean := false; delete_rejected boolean := false;
begin
  begin
    perform public.finalize_trip_plan('73000000-0000-4000-8000-000000000006', null);
  exception when sqlstate 'P0001' then route_rejected := sqlerrm = 'ROUTE_PLAN_NOT_READY'; end;
  begin
    perform public.preview_trip_share((select id from trip_result));
  exception when sqlstate 'P0001' then preview_rejected := sqlerrm = 'TRIP_NOT_FOUND'; end;
  begin
    perform public.revoke_share((select share_id from reissued_result));
  exception when sqlstate 'P0001' then revoke_rejected := sqlerrm = 'SHARE_NOT_FOUND'; end;
  begin
    perform public.delete_owned_trip((select id from trip_result));
  exception when sqlstate 'P0001' then delete_rejected := sqlerrm = 'TRIP_NOT_FOUND'; end;
  insert into tap_results values
    (route_rejected, 'rider B cannot finalize rider A staged routes'),
    (preview_rejected, 'rider B cannot preview rider A trip'),
    (revoke_rejected, 'rider B cannot revoke rider A share'),
    (delete_rejected, 'rider B cannot delete rider A trip');
end;
$$;

set local role service_role;
do $$
declare collection_rejected boolean := false;
begin
  begin
    perform public.save_collection_version_internal(
      '72000000-0000-0000-0000-000000000002',
      '72000000-0000-4000-8000-000000001001',
      (select collection_id from collection_result),
      '탈취', '', (select course from fixture)
    );
  exception when sqlstate 'P0001' then collection_rejected := sqlerrm = 'COLLECTION_NOT_FOUND'; end;
  insert into tap_results values (collection_rejected, 'trusted save still enforces rider B ownership of rider A collection');
end;
$$;

create temp table recommended_plan_fixture on commit drop as
select jsonb_set((select plan from plan_fixture), '{selectedProfile}', '"recommended"'::jsonb, false)
  || jsonb_build_object('tripId', null, 'targetUpdatedAt', null) as plan;
grant select on recommended_plan_fixture to authenticated, service_role;
set local role service_role;
select public.stage_route_candidate_internal(
  '71000000-0000-0000-0000-000000000001',
  '73000000-0000-4000-8000-000000000007',
  (select plan from recommended_plan_fixture),
  pg_temp.test_recommended_route()
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
create temp table recommended_trip_result on commit drop as
select public.finalize_trip_plan('73000000-0000-4000-8000-000000000007', null) as id;
grant select on recommended_trip_result to authenticated, service_role;
reset role;
set local role service_role;
select public.insert_weather_snapshot_internal(
  '71000000-0000-0000-0000-000000000001',
  (select id from recommended_trip_result),
  'recommended',
  now() - interval '5 minutes',
  now() + interval '2 hours',
  pg_temp.test_weather_segments(
    pg_temp.test_recommended_route(),
    'recommended',
    now() - interval '5 minutes'
  ),
  repeat('f', 64),
  clock_timestamp()
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
create temp table recommended_preview on commit drop as
select * from public.preview_trip_share((select id from recommended_trip_result));
grant select on recommended_preview to authenticated;
insert into tap_results values
  ((select selected_profile = 'recommended' from public.trips where id = (select id from recommended_trip_result)), 'new plan stores the recommended profile'),
  ((select count(*) = 1 from public.route_cache where trip_id = (select id from recommended_trip_result)), 'new plan atomically stores exactly one route'),
  ((select count(*) = 0 from public.route_cache where trip_id = (select id from recommended_trip_result) and profile <> 'recommended'), 'new plan stores no legacy candidate rows'),
  ((select preview_snapshot ->> 'schemaVersion' = '3' and preview_snapshot ? 'route' and not (preview_snapshot ? 'routes') from recommended_preview), 'new plan preview exposes one schema 3 route'),
  ((select preview_snapshot -> 'route' -> 'legs' -> 1 -> 'to' ->> 'stopRole' = 'lunch'
      and preview_snapshot -> 'route' -> 'legs' -> 2 -> 'from' ->> 'stopRole' = 'lunch'
    from recommended_preview), 'schema 3 share projection preserves accepted route occurrence stop roles'),
  ((select jsonb_array_length(preview_snapshot -> 'waypoints') = 2 and preview_snapshot -> 'waypoints' -> 0 ->> 'label' = '와인딩' from recommended_preview), 'new plan preserves custom winding waypoint order');

set local role service_role;
select public.stage_route_candidate_internal(
  '71000000-0000-0000-0000-000000000001',
  '73000000-0000-4000-8000-000000000008',
  (select plan from recommended_plan_fixture),
  pg_temp.test_recommended_route()
);
select public.stage_route_candidate_internal(
  '71000000-0000-0000-0000-000000000001',
  '73000000-0000-4000-8000-000000000008',
  (select plan from recommended_plan_fixture),
  pg_temp.test_route('balanced', 127.09)
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.finalize_trip_plan('73000000-0000-4000-8000-000000000008', null);
  exception when sqlstate 'P0001' then rejected := sqlerrm = 'ROUTE_PLAN_NOT_READY'; end;
  insert into tap_results values
    (rejected, 'new finalization rejects an extra candidate instead of partially saving it'),
    ((select count(*) = 2 from public.trips), 'rejected extra-candidate finalization creates no partial trip');
end;
$$;
insert into tap_results values (
  public.delete_owned_trip((select id from recommended_trip_result)),
  'owner can clean up the single-route test trip'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
insert into tap_results values (
  (select public.resolve_share(share_token) -> 'route' -> 'candidate' ->> 'id' = 'recommended' from reissued_result),
  'anonymous reader receives only the published snapshot through the resolver'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
insert into tap_results values (
  public.delete_owned_trip((select id from trip_result)),
  'owner can delete the stored trip aggregate'
);
reset role;
insert into tap_results values
  ((select count(*) = 0 from public.trips where id = (select id from trip_result)), 'owned trip deletion removes the trip'),
  ((select count(*) = 0 from public.trip_waypoints where trip_id = (select id from trip_result)), 'owned trip deletion cascades waypoints'),
  ((select count(*) = 0 from public.route_cache where trip_id = (select id from trip_result)), 'owned trip deletion cascades routes'),
  ((select count(*) = 0 from public.weather_snapshots where trip_id = (select id from trip_result)), 'owned trip deletion cascades weather'),
  ((select count(*) = 0 from public.share_preview_grants where trip_id = (select id from trip_result)), 'owned trip deletion cascades preview capabilities');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
insert into tap_results values (
  (select public.resolve_share(share_token) -> 'route' -> 'candidate' ->> 'id' = 'recommended' from reissued_result),
  'deleting the source trip does not mutate its issued share snapshot'
);

reset role;
select
  (case when ok then 'ok ' else 'not ok ' end) ||
  row_number() over () || ' - ' || description
from tap_results;
select '1..' || count(*) from tap_results;

rollback;
