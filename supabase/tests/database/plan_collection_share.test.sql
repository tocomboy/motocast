\set ON_ERROR_STOP on

begin;

create temp table tap_results(ok boolean not null, description text not null) on commit drop;
grant insert, select on tap_results to anon, authenticated;

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
  select jsonb_strip_nulls(jsonb_build_object(
    'id', point_id, 'label', point_label, 'kakaoPlaceId', point_id,
    'verificationToken', repeat('a', 43), 'name', point_label,
    'address', '테스트 주소', 'roadAddress', null,
    'longitude', point_lon, 'latitude', point_lat,
    'kind', point_kind, 'dwellMinutes', dwell, 'selected', true,
    'winding', winding, 'stopRole', stop_role
  ));
$$;

create or replace function pg_temp.test_route(profile text, middle_lon numeric)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'candidate', jsonb_build_object(
      'id', profile,
      'label', case profile when 'balanced' then '균형' when 'winding' then '와인딩' else '최단' end,
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
          'vertexes', jsonb_build_array(127, 37, middle_lon, 37.1, 127.2, 37.2)
        ))
      ))
    ))
  );
$$;

create temp table fixture on commit drop as
select
  jsonb_build_array(
    pg_temp.test_point('winding', '와인딩', 127.05, 37.05, 'pass-through', 0, true),
    pg_temp.test_point('lunch', '점심', 127.1, 37.1, 'stop', 60, false, 'lunch')
  ) as points,
  jsonb_build_array(
    pg_temp.test_route('balanced', 127.05),
    pg_temp.test_route('winding', 127.1),
    pg_temp.test_route('short', 127.15)
  ) as routes;
grant select on fixture to authenticated;

insert into tap_results values
  (not has_function_privilege('anon', 'public.save_collection_version(uuid,text,text,jsonb)', 'EXECUTE'), 'anon cannot save collection versions'),
  (not has_function_privilege('anon', 'public.save_trip_plan(jsonb,jsonb)', 'EXECUTE'), 'anon cannot save plans'),
  (not has_function_privilege('anon', 'public.publish_trip_share(uuid)', 'EXECUTE'), 'anon cannot publish shares'),
  (has_function_privilege('anon', 'public.resolve_share(text)', 'EXECUTE'), 'anon can resolve only a tokenized public snapshot'),
  (not has_function_privilege('authenticated', 'public.build_trip_share_snapshot(uuid,uuid)', 'EXECUTE'), 'authenticated cannot call the private snapshot builder');

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);

create temp table collection_result on commit drop as
select * from public.save_collection_version(null, '북한강', '테스트 코스', (select points from fixture));
grant select on collection_result to authenticated;
insert into tap_results values
  ((select version_number = 1 from collection_result), 'new collection starts at immutable version 1'),
  ((select count(*) = 1 from public.riding_collections), 'rider sees the owned collection only');

create temp table collection_result_2 on commit drop as
select * from public.save_collection_version(
  (select collection_id from collection_result), '북한강', '수정 설명', (select points from fixture)
);
grant select on collection_result_2 to authenticated;
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
grant select on plan_fixture to authenticated;

create temp table trip_result(id uuid) on commit drop;
insert into trip_result
select public.save_trip_plan((select plan from plan_fixture), (select routes from fixture));
grant select on trip_result to authenticated;
insert into tap_results values
  ((select count(*) = 1 from public.trips where id = (select id from trip_result)), 'plan save creates one owned trip'),
  ((select count(*) = 2 from public.trip_waypoints where trip_id = (select id from trip_result)), 'plan save preserves ordered waypoints'),
  ((select count(*) = 3 from public.route_cache where trip_id = (select id from trip_result)), 'plan save atomically stores three safe candidates');

do $$
declare rejected boolean := false;
begin
  begin
    perform public.save_trip_plan(
      jsonb_set((select plan from plan_fixture), '{waypoints}', jsonb_build_array(
        pg_temp.test_point('winding', '와인딩', 127.05, 37.05, 'pass-through', 0, true)
      )),
      (select routes from fixture)
    );
  exception when sqlstate 'P0001' then rejected := sqlerrm = 'INVALID_PLAN_STOPS'; end;
  insert into tap_results values (rejected, 'plan save rejects a waypoint list that omits the required lunch stop');
end;
$$;

insert into public.weather_snapshots(
  trip_id, source, issued_at, valid_until, segments, request_hash, candidate_profile
) values (
  (select id from trip_result), 'kma', '2026-08-30T23:30:00.000Z', '2026-08-31T02:00:00.000Z',
  jsonb_build_array(jsonb_build_object(
    'id', 'balanced-0', 'label', '복귀', 'longitude', 127.2, 'latitude', 37.2,
    'eta', '2026-08-31T00:10:00.000Z', 'status', 'forecast', 'model', 'ultra',
    'issuedAt', '2026-08-30T23:30:00.000Z', 'condition', 'clear',
    'temperatureC', 22, 'precipitationProbability', 0, 'windSpeedMps', 1.2
  )),
  repeat('b', 64), 'balanced'
);

create temp table preview_result on commit drop as
select public.preview_trip_share((select id from trip_result)) as snapshot;
grant select on preview_result to authenticated;
create temp table published_result on commit drop as
select * from public.publish_trip_share((select id from trip_result));
grant select on published_result to authenticated;
insert into tap_results values
  ((select published_snapshot = snapshot from published_result cross join preview_result), 'published snapshot exactly matches the approved preview'),
  ((select snapshot -> 'weather' is not null from preview_result), 'share includes weather only when it matches the selected stored route'),
  ((select char_length(share_token) = 43 from published_result), 'share token contains 32 random base64url bytes'),
  ((select token_hash <> share_token and char_length(token_hash) = 64 from public.share_links cross join published_result), 'database stores only the share token hash'),
  ((select published_snapshot::text not like '%verificationToken%' from published_result), 'public snapshot excludes internal place verification proofs');

update public.trips set title = '원본 수정됨' where id = (select id from trip_result);
insert into tap_results values (
  (select public.resolve_share(share_token) -> 'trip' ->> 'title' = '팔당 당일 라이딩' from published_result),
  'source edits do not change an existing immutable share'
);

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

create temp table reissued_result on commit drop as
select * from public.publish_trip_share((select id from trip_result));
grant select on reissued_result to authenticated, anon;
insert into tap_results values
  ((select reissued.share_token <> original.share_token from reissued_result reissued cross join published_result original), 'reissue creates a different token'),
  ((select public.resolve_share(share_token) -> 'trip' ->> 'title' = '원본 수정됨' from reissued_result), 'reissue publishes a new current immutable snapshot');

select set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000002', true);
insert into tap_results values
  ((select count(*) = 0 from public.riding_collections), 'rider B cannot read rider A collections'),
  ((select count(*) = 0 from public.share_links), 'rider B cannot manage rider A share links');

do $$
declare collection_rejected boolean := false; preview_rejected boolean := false; revoke_rejected boolean := false;
begin
  begin
    perform public.save_collection_version((select collection_id from collection_result), '탈취', '', (select points from fixture));
  exception when sqlstate 'P0001' then collection_rejected := sqlerrm = 'COLLECTION_NOT_FOUND'; end;
  begin
    perform public.preview_trip_share((select id from trip_result));
  exception when sqlstate 'P0001' then preview_rejected := sqlerrm = 'TRIP_NOT_FOUND'; end;
  begin
    perform public.revoke_share((select share_id from reissued_result));
  exception when sqlstate 'P0001' then revoke_rejected := sqlerrm = 'SHARE_NOT_FOUND'; end;
  insert into tap_results values
    (collection_rejected, 'rider B cannot append a version to rider A collection'),
    (preview_rejected, 'rider B cannot preview rider A trip'),
    (revoke_rejected, 'rider B cannot revoke rider A share');
end;
$$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
insert into tap_results values (
  (select public.resolve_share(share_token) -> 'trip' ->> 'title' = '원본 수정됨' from reissued_result),
  'anonymous reader receives only the published snapshot through the resolver'
);

reset role;
select
  (case when ok then 'ok ' else 'not ok ' end) ||
  row_number() over () || ' - ' || description
from tap_results;
select '1..' || count(*) from tap_results;

rollback;
