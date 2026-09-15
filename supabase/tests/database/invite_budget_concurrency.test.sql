\set ON_ERROR_STOP on

create extension if not exists dblink with schema extensions;

delete from auth.users where id in (
  '74000000-0000-0000-0000-000000000001',
  '74000000-0000-0000-0000-000000000002',
  '74000000-0000-0000-0000-000000000003'
);
delete from public.api_usage_daily
where provider = 'kakao' and operation = 'future_directions'
  and usage_date = (timezone('Asia/Seoul', now()))::date;
drop trigger if exists delay_test_budget on public.api_usage_daily;
drop function if exists public.delay_test_budget();
drop function if exists public.test_claim_invite(text);
drop function if exists public.test_consume_budget();
drop function if exists public.test_publish_share(uuid, text);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
values
  ('00000000-0000-0000-0000-000000000000', '74000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'concurrency-admin@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"동시성 관리자"}'),
  ('00000000-0000-0000-0000-000000000000', '74000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'concurrency-a@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"동시성 A"}'),
  ('00000000-0000-0000-0000-000000000000', '74000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'concurrency-b@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"동시성 B"}');
insert into public.memberships(user_id, role)
values ('74000000-0000-0000-0000-000000000001', 'admin');

set role authenticated;
select set_config('request.jwt.claim.sub', '74000000-0000-0000-0000-000000000001', false);
create temp table invite_fixture on commit preserve rows as
select invite_token from public.create_invite(interval '1 day');
reset role;

create function public.test_claim_invite(raw_token text)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform public.claim_invite(raw_token);
  return 'OK';
exception when others then
  return sqlerrm;
end;
$$;
grant execute on function public.test_claim_invite(text) to authenticated;

select dblink_connect('invite_c1', 'host=127.0.0.1 port=5432 dbname=postgres user=supabase_admin password=postgres');
select dblink_connect('invite_c2', 'host=127.0.0.1 port=5432 dbname=postgres user=supabase_admin password=postgres');
select dblink_exec('invite_c1', 'set role authenticated');
select dblink_exec('invite_c2', 'set role authenticated');
select dblink_exec('invite_c1', 'set "request.jwt.claim.sub" = ''74000000-0000-0000-0000-000000000002''');
select dblink_exec('invite_c2', 'set "request.jwt.claim.sub" = ''74000000-0000-0000-0000-000000000003''');
select dblink_send_query('invite_c1', format('select public.test_claim_invite(%L)', invite_token)) from invite_fixture;
select dblink_send_query('invite_c2', format('select public.test_claim_invite(%L)', invite_token)) from invite_fixture;

create temp table invite_results(result text);
insert into invite_results select result from dblink_get_result('invite_c1') as response(result text);
insert into invite_results select result from dblink_get_result('invite_c2') as response(result text);
select result from dblink_get_result('invite_c1') as response(result text);
select result from dblink_get_result('invite_c2') as response(result text);

create function public.delay_test_budget()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.provider = 'kakao' and new.operation = 'future_directions' then
    perform pg_sleep(0.5);
  end if;
  return new;
end;
$$;
create trigger delay_test_budget
  before insert on public.api_usage_daily
  for each row execute function public.delay_test_budget();

create function public.test_consume_budget()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.consume_daily_api_budget_internal(
    'kakao', 'future_directions', 1,
    '74000000-0000-0000-0000-000000000001'
  )::text;
exception when others then
  return sqlerrm;
end;
$$;
revoke all on function public.test_consume_budget() from public, anon, authenticated;
grant execute on function public.test_consume_budget() to service_role;

select dblink_connect('budget_c1', 'host=127.0.0.1 port=5432 dbname=postgres user=supabase_admin password=postgres');
select dblink_connect('budget_c2', 'host=127.0.0.1 port=5432 dbname=postgres user=supabase_admin password=postgres');
select dblink_exec('budget_c1', 'set role service_role');
select dblink_exec('budget_c2', 'set role service_role');
select dblink_send_query('budget_c1', 'select public.test_consume_budget()');
select dblink_send_query('budget_c2', 'select public.test_consume_budget()');

create temp table budget_results(result text);
insert into budget_results select result from dblink_get_result('budget_c1') as response(result text);
insert into budget_results select result from dblink_get_result('budget_c2') as response(result text);

insert into public.trips(
  id, user_id, title, service_date, departure_at, desired_return_at, hard_return_at,
  origin, destination, lunch_stop, selected_profile
) values (
  '74000000-0000-4000-8000-000000000011',
  '74000000-0000-0000-0000-000000000001',
  '공유 동시성 계획', '2026-08-31',
  '2026-08-31T00:00:00Z', '2026-08-31T08:00:00Z', '2026-08-31T09:00:00Z',
  '{"id":"origin","label":"출발","longitude":127,"latitude":37}'::jsonb,
  '{"id":"destination","label":"복귀","longitude":127.2,"latitude":37.2}'::jsonb,
  '{"id":"lunch","label":"점심","longitude":127.1,"latitude":37.1}'::jsonb,
  'balanced'
);
insert into public.route_cache(trip_id, provider, profile, summary, expires_at)
select
  '74000000-0000-4000-8000-000000000011', 'kakao', profile,
  jsonb_build_object(
    'candidate', jsonb_build_object('id', profile, 'label', profile, 'estimatedWinding', profile = 'winding'),
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
          'vertexes', jsonb_build_array(127, 37, middle_longitude, 37.1, 127.2, 37.2)
        ))
      ))
    ))
  ),
  now() + interval '1 hour'
from (values ('balanced', 127.05), ('winding', 127.1), ('short', 127.15)) as candidates(profile, middle_longitude);

set role service_role;
select public.insert_weather_snapshot_internal(
  '74000000-0000-0000-0000-000000000001',
  '74000000-0000-4000-8000-000000000011',
  'balanced',
  now() - interval '5 minutes',
  now() + interval '2 hours',
  jsonb_build_array(jsonb_build_object(
    'id', 'balanced-0',
    'label', '복귀',
    'longitude', 127.2,
    'latitude', 37.2,
    'eta', '2026-08-31T00:10:00.000Z',
    'status', 'forecast',
    'model', 'ultra',
    'issuedAt', now() - interval '5 minutes',
    'condition', 'clear',
    'temperatureC', 22,
    'precipitationProbability', 0,
    'windSpeedMps', 1.2
  )),
  repeat('a', 64),
  clock_timestamp()
);
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '74000000-0000-0000-0000-000000000001', false);
create temp table share_fixture on commit preserve rows as
select preview_token from public.preview_trip_share('74000000-0000-4000-8000-000000000011');
reset role;

create function public.test_publish_share(target_trip_id uuid, preview_token text)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform * from public.publish_trip_share(target_trip_id, preview_token);
  return 'OK';
exception when others then
  return sqlerrm;
end;
$$;
grant execute on function public.test_publish_share(uuid, text) to authenticated;
select dblink_exec('invite_c1', 'set "request.jwt.claim.sub" = ''74000000-0000-0000-0000-000000000001''');
select dblink_exec('invite_c2', 'set "request.jwt.claim.sub" = ''74000000-0000-0000-0000-000000000001''');
select dblink_send_query('invite_c1', format(
  'select public.test_publish_share(''74000000-0000-4000-8000-000000000011'', %L)', preview_token
)) from share_fixture;
select dblink_send_query('invite_c2', format(
  'select public.test_publish_share(''74000000-0000-4000-8000-000000000011'', %L)', preview_token
)) from share_fixture;

create temp table share_results(result text);
insert into share_results select result from dblink_get_result('invite_c1') as response(result text);
insert into share_results select result from dblink_get_result('invite_c2') as response(result text);

create temp table tap_results(ok boolean not null, description text not null);
insert into tap_results values
  ((select array_agg(result order by result) = array['1', 'API_DAILY_BUDGET_EXHAUSTED'] from budget_results), 'concurrent budget calls allow exactly one provider request'),
  ((select calls = 1 and hard_limit = 1 from public.api_usage_daily where provider = 'kakao' and operation = 'future_directions'), 'concurrent budget ledger never exceeds its hard limit'),
  ((select usage_date = (timezone('Asia/Seoul', now()))::date from public.api_usage_daily where provider = 'kakao' and operation = 'future_directions'), 'budget ledger uses the Seoul calendar date'),
  ((select array_agg(result order by result) = array['INVITE_ALREADY_USED', 'OK'] from invite_results), 'two different users cannot both consume one invitation'),
  ((select count(*) = 1 from public.memberships where user_id in ('74000000-0000-0000-0000-000000000002', '74000000-0000-0000-0000-000000000003')), 'one-time invitation creates exactly one rider membership'),
  ((select array_agg(result order by result) = array['OK', 'SHARE_PREVIEW_REQUIRED'] from share_results), 'one preview capability cannot publish two shares concurrently'),
  ((select count(*) = 1 from public.share_links where owner_id = '74000000-0000-0000-0000-000000000001'), 'concurrent publication creates exactly one immutable share');

select dblink_disconnect('invite_c1');
select dblink_disconnect('invite_c2');
select dblink_disconnect('budget_c1');
select dblink_disconnect('budget_c2');
drop trigger delay_test_budget on public.api_usage_daily;
drop function public.delay_test_budget();
drop function public.test_claim_invite(text);
drop function public.test_consume_budget();
drop function public.test_publish_share(uuid, text);
delete from public.api_usage_daily
where provider = 'kakao' and operation = 'future_directions'
  and usage_date = (timezone('Asia/Seoul', now()))::date;
delete from auth.users where id in (
  '74000000-0000-0000-0000-000000000001',
  '74000000-0000-0000-0000-000000000002',
  '74000000-0000-0000-0000-000000000003'
);

select
  (case when ok then 'ok ' else 'not ok ' end) ||
  row_number() over () || ' - ' || description
from tap_results;
select '1..' || count(*) from tap_results;

do $$
begin
  if exists (select 1 from tap_results where not ok) then
    raise exception 'CONCURRENCY_TEST_FAILED';
  end if;
end;
$$;
