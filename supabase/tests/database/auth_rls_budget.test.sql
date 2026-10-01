\set ON_ERROR_STOP on

begin;

create temp table tap_results(ok boolean not null, description text not null) on commit drop;
grant insert, select on tap_results to anon, authenticated, service_role;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"관리자"}'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'rider-a@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"라이더 A"}'),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'rider-b@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"라이더 B"}'),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'revoked@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"회수 라이더"}'),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'invite-c@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"초대 C","picture":"https://example.invalid/kakao-picture.png"}'),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'invite-d@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"초대 D"}');

insert into public.memberships(user_id, role, revoked_at)
values
  ('10000000-0000-0000-0000-000000000001', 'admin', null),
  ('20000000-0000-0000-0000-000000000002', 'rider', null),
  ('30000000-0000-0000-0000-000000000003', 'rider', null),
  ('40000000-0000-0000-0000-000000000004', 'rider', now());

insert into public.trips (
  user_id, title, service_date, departure_at, desired_return_at, hard_return_at,
  origin, destination, lunch_stop
)
values
  ('20000000-0000-0000-0000-000000000002', 'A 계획', '2026-08-31', '2026-08-31 07:00+09', '2026-08-31 17:00+09', '2026-08-31 18:00+09', '{}', '{}', '{}'),
  ('30000000-0000-0000-0000-000000000003', 'B 계획', '2026-08-31', '2026-08-31 07:00+09', '2026-08-31 17:00+09', '2026-08-31 18:00+09', '{}', '{}', '{}'),
  ('40000000-0000-0000-0000-000000000004', '회수 계획', '2026-08-31', '2026-08-31 07:00+09', '2026-08-31 17:00+09', '2026-08-31 18:00+09', '{}', '{}', '{}');

insert into tap_results values
  (not has_function_privilege('anon', 'public.claim_invite(text)', 'EXECUTE'), 'anon cannot execute claim_invite'),
  (not has_function_privilege('anon', 'public.create_invite(interval)', 'EXECUTE'), 'anon cannot execute create_invite'),
  (not has_function_privilege('anon', 'public.consume_daily_api_budget(text,text,integer)', 'EXECUTE'), 'anon cannot execute budget RPC'),
  (not has_function_privilege('anon', 'public.delete_owned_trip(uuid)', 'EXECUTE'), 'anon cannot execute owned trip deletion'),
  (not has_function_privilege('authenticated', 'public.claim_invite(text)', 'EXECUTE'), 'authenticated cannot claim retired invitations'),
  (not has_function_privilege('authenticated', 'public.create_invite(interval)', 'EXECUTE'), 'authenticated cannot create retired invitations'),
  (not has_function_privilege('authenticated', 'public.consume_daily_api_budget(text,text,integer)', 'EXECUTE'), 'authenticated cannot supply a budget limit directly'),
  (has_function_privilege('authenticated', 'public.delete_owned_trip(uuid)', 'EXECUTE'), 'authenticated can request exact-owner trip deletion'),
  (has_function_privilege('service_role', 'public.consume_daily_api_budget_internal(text,text,integer,uuid)', 'EXECUTE'), 'trusted Edge role can execute the fixed-input budget RPC');

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
insert into tap_results values
  (public.is_active_member('20000000-0000-0000-0000-000000000002'), 'member helper accepts the current user'),
  (not public.is_active_member('30000000-0000-0000-0000-000000000003'), 'member helper cannot enumerate another user'),
  ((select count(*) from public.trips) = 1, 'rider A reads only own trip');

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', true);
insert into tap_results values ((select count(*) from public.trips) = 1, 'rider B reads only own trip');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
insert into tap_results values ((select count(*) from public.trips) = 0, 'anonymous reads no trips');

set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000004', true);
insert into tap_results values ((select count(*) from public.trips) = 0, 'revoked rider reads no trips');
do $$
declare rejected boolean := false;
begin
  begin
    perform public.delete_owned_trip((select id from public.trips limit 1));
  exception when sqlstate 'P0001' then rejected := sqlerrm = 'MEMBERSHIP_REQUIRED'; end;
  insert into tap_results values (rejected, 'revoked rider cannot delete a trip aggregate');
end;
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
insert into tap_results values ((select count(*) from public.memberships) = 4, 'admin reads all memberships');

do $$
declare rejected boolean := false;
begin
  begin perform public.create_invite(interval '1 day');
  exception when insufficient_privilege then rejected := true; end;
  insert into tap_results values (rejected, 'even an active administrator cannot issue invitations');
end;
$$;

select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000005', true);
do $$
declare rejected boolean := false;
begin
  begin perform public.claim_invite(repeat('a', 43));
  exception when insufficient_privilege then rejected := true; end;
  insert into tap_results values
    (rejected, 'authenticated non-member cannot enroll through a legacy invitation'),
    (not public.is_active_member(), 'non-member stays inactive');
end;
$$;

select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000004', true);
do $$
declare rejected boolean := false;
begin
  begin perform public.claim_invite(repeat('a', 43));
  exception when insufficient_privilege then rejected := true; end;
  insert into tap_results values (rejected and not public.is_active_member(), 'legacy invitation cannot restore revoked membership');
end;
$$;
reset role;
insert into tap_results values
  ((select count(*) from public.memberships where user_id in ('50000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000006')) = 0, 'denied enrollment creates no memberships'),
  ((select count(*) from public.profiles where id in ('50000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000006')) = 0, 'denied enrollment creates no public profiles'),
  ((select role = 'admin' and revoked_at is null from public.memberships where user_id = '10000000-0000-0000-0000-000000000001'), 'existing administrator role remains intact'),
  ((select role = 'rider' and revoked_at is not null from public.memberships where user_id = '40000000-0000-0000-0000-000000000004'), 'existing revocation remains intact');

set local role service_role;
insert into tap_results values
  (public.consume_daily_api_budget_internal('kma', 'ultra_forecast', 2, '20000000-0000-0000-0000-000000000002') = 1, 'first trusted budget call is consumed'),
  (public.consume_daily_api_budget_internal('kma', 'ultra_forecast', 2, '20000000-0000-0000-0000-000000000002') = 2, 'second trusted budget call reaches the hard limit');
do $$
declare
  exhausted_rejected boolean := false;
  zero_rejected boolean := false;
  missing_rejected boolean := false;
begin
  begin
    perform public.consume_daily_api_budget_internal('kma', 'ultra_forecast', 2, '20000000-0000-0000-0000-000000000002');
  exception when sqlstate 'P0001' then
    exhausted_rejected := sqlerrm = 'API_DAILY_BUDGET_EXHAUSTED';
  end;
  begin
    perform public.consume_daily_api_budget_internal('kma', 'short_forecast', 0, '20000000-0000-0000-0000-000000000002');
  exception when sqlstate 'P0001' then
    zero_rejected := sqlerrm = 'API_BUDGET_NOT_CONFIGURED';
  end;
  begin
    perform public.consume_daily_api_budget_internal('kma', 'short_forecast', null, '20000000-0000-0000-0000-000000000002');
  exception when sqlstate 'P0001' then
    missing_rejected := sqlerrm = 'API_BUDGET_NOT_CONFIGURED';
  end;
  insert into tap_results values
    (exhausted_rejected, 'third budget call fails closed'),
    (zero_rejected, 'zero budget configuration fails closed'),
    (missing_rejected, 'missing budget configuration fails closed');
end;
$$;
reset role;
insert into tap_results values (
  (select calls = 2 from public.api_usage_daily where provider = 'kma' and operation = 'ultra_forecast'),
  'failed budget call does not exceed the ledger limit'
);

select
  (case when ok then 'ok ' else 'not ok ' end) ||
  row_number() over () || ' - ' || description
from tap_results;
select '1..' || count(*) from tap_results;

rollback;
