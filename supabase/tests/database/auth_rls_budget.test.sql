\set ON_ERROR_STOP on

begin;

create temp table tap_results(ok boolean not null, description text not null) on commit drop;
grant insert, select on tap_results to anon, authenticated;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"관리자"}'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'rider-a@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"라이더 A"}'),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'rider-b@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"라이더 B"}'),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'revoked@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"회수 라이더"}'),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'invite-c@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"초대 C"}'),
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
  (has_function_privilege('authenticated', 'public.claim_invite(text)', 'EXECUTE'), 'authenticated can execute claim_invite'),
  (has_function_privilege('authenticated', 'public.create_invite(interval)', 'EXECUTE'), 'authenticated can execute create_invite'),
  (has_function_privilege('authenticated', 'public.consume_daily_api_budget(text,text,integer)', 'EXECUTE'), 'authenticated can execute budget RPC');

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

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
insert into tap_results values ((select count(*) from public.memberships) = 4, 'admin reads all memberships');

create temp table new_invite on commit drop as
select * from public.create_invite(interval '1 day');
grant select on new_invite to authenticated;
insert into tap_results values ((select char_length(invite_token) from new_invite) = 43, 'invite token is 32-byte base64url');

select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000005', true);
select public.claim_invite((select invite_token from new_invite));
insert into tap_results values
  ((select count(*) from public.memberships where user_id = '50000000-0000-0000-0000-000000000005') = 1, 'first invited user claims successfully'),
  ((select consumed_at is not null from public.invitations where consumed_by = '50000000-0000-0000-0000-000000000005'), 'claim stores the consumed tombstone');

reset role;
create temp table invite_audit on commit drop as
select id, consumed_at from public.invitations
where consumed_by = '50000000-0000-0000-0000-000000000005';
grant select on invite_audit to authenticated;
delete from auth.users where id = '50000000-0000-0000-0000-000000000005';
insert into tap_results values (
  (select consumed_by is null and consumed_at is not null from public.invitations where id = (select id from invite_audit)),
  'deleting Auth user keeps a consumed tombstone'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000006', true);
do $$
declare
  rejected boolean := false;
begin
  begin
    perform public.claim_invite((select invite_token from new_invite));
  exception when sqlstate 'P0001' then
    rejected := sqlerrm = 'INVITE_ALREADY_USED';
  end;
  insert into tap_results values (rejected, 'a deleted consumer does not make the invite reusable');
end;
$$;
insert into tap_results values (
  (select invitation.consumed_at = audit.consumed_at
   from public.invitations invitation cross join invite_audit audit
   where invitation.id = audit.id),
  'failed second claim preserves the first consumed_at'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
insert into tap_results values
  (public.consume_daily_api_budget('tap_test', 'boundary', 2) = 1, 'first budget call is consumed'),
  (public.consume_daily_api_budget('tap_test', 'boundary', 2) = 2, 'second budget call reaches the hard limit');
do $$
declare
  rejected boolean := false;
begin
  begin
    perform public.consume_daily_api_budget('tap_test', 'boundary', 2);
  exception when sqlstate 'P0001' then
    rejected := sqlerrm = 'API_DAILY_BUDGET_EXHAUSTED';
  end;
  insert into tap_results values (rejected, 'third budget call fails closed');
end;
$$;
insert into tap_results values (
  (select calls = 2 from public.api_usage_daily where provider = 'tap_test' and operation = 'boundary'),
  'failed budget call does not exceed the ledger limit'
);

reset role;
select
  (case when ok then 'ok ' else 'not ok ' end) ||
  row_number() over () || ' - ' || description
from tap_results;
select '1..' || count(*) from tap_results;

rollback;
