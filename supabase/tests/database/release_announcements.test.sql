\set ON_ERROR_STOP on

begin;

create temp table tap_results(ok boolean not null, description text not null) on commit drop;
grant insert, select on tap_results to anon, authenticated, service_role;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
values
  ('00000000-0000-0000-0000-000000000000', '83000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'release-a@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"릴리스 A"}'),
  ('00000000-0000-0000-0000-000000000000', '83000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'release-b@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"릴리스 B"}'),
  ('00000000-0000-0000-0000-000000000000', '83000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'release-revoked@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"회수 회원"}'),
  ('00000000-0000-0000-0000-000000000000', '83000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'release-nonmember@motocast.test', '', now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"비회원"}');

insert into public.memberships(user_id, role, revoked_at)
values
  ('83000000-0000-0000-0000-000000000001', 'rider', null),
  ('83000000-0000-0000-0000-000000000002', 'rider', null),
  ('83000000-0000-0000-0000-000000000003', 'rider', now());

insert into tap_results values
  ((select relrowsecurity from pg_class where oid = 'public.release_announcements'::regclass), 'release announcement table has RLS enabled'),
  (not has_table_privilege('anon', 'public.release_announcements', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no direct release announcement access'),
  (not has_table_privilege('authenticated', 'public.release_announcements', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has no direct release announcement access'),
  (not has_table_privilege('service_role', 'public.release_announcements', 'SELECT,INSERT,UPDATE,DELETE'), 'service role has no direct release announcement access'),
  (not has_function_privilege('anon', 'public.claim_release_announcement(text,uuid)', 'EXECUTE'), 'anon cannot claim a release announcement'),
  (has_function_privilege('authenticated', 'public.claim_release_announcement(text,uuid)', 'EXECUTE'), 'authenticated may call the guarded claim RPC'),
  (not has_function_privilege('service_role', 'public.claim_release_announcement(text,uuid)', 'EXECUTE'), 'service role allowlist is unchanged');

set local role authenticated;
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-000000000001', true);
insert into tap_results values
  (public.claim_release_announcement('0.2.0', '84000000-0000-4000-8000-000000000001'), 'user A first presentation is reserved'),
  (public.claim_release_announcement('0.2.0', '84000000-0000-4000-8000-000000000001'), 'user A can replay the same presentation after response loss'),
  (not public.claim_release_announcement('0.2.0', '84000000-0000-4000-8000-000000000002'), 'user A cannot reserve the same version under another presentation'),
  (public.claim_release_announcement('0.3.0', '84000000-0000-4000-8000-000000000003'), 'user A can reserve a later version');

do $$
declare
  read_denied boolean := false;
  write_denied boolean := false;
begin
  begin
    perform count(*) from public.release_announcements;
  exception when insufficient_privilege then
    read_denied := true;
  end;
  begin
    insert into public.release_announcements(user_id, version, presentation_id)
    values ('83000000-0000-0000-0000-000000000002', '9.9.9', '84000000-0000-4000-8000-000000000009');
  exception when insufficient_privilege then
    write_denied := true;
  end;
  insert into tap_results values
    (read_denied, 'user A cannot directly read another user release state'),
    (write_denied, 'user A cannot directly write release state');
end;
$$;

select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-000000000002', true);
insert into tap_results values (
  public.claim_release_announcement('0.2.0', '84000000-0000-4000-8000-000000000004'),
  'user B independently reserves the current version'
);

do $$
declare
  null_version boolean := false;
  malformed_version boolean := false;
  leading_zero_version boolean := false;
  long_version boolean := false;
  null_presentation boolean := false;
  nil_presentation boolean := false;
begin
  begin perform public.claim_release_announcement(null, '84000000-0000-4000-8000-000000000005');
  exception when sqlstate 'P0001' then null_version := sqlerrm = 'INVALID_RELEASE_VERSION'; end;
  begin perform public.claim_release_announcement('v0.2.0', '84000000-0000-4000-8000-000000000005');
  exception when sqlstate 'P0001' then malformed_version := sqlerrm = 'INVALID_RELEASE_VERSION'; end;
  begin perform public.claim_release_announcement('00.2.0', '84000000-0000-4000-8000-000000000005');
  exception when sqlstate 'P0001' then leading_zero_version := sqlerrm = 'INVALID_RELEASE_VERSION'; end;
  begin perform public.claim_release_announcement(repeat('1', 65), '84000000-0000-4000-8000-000000000005');
  exception when sqlstate 'P0001' then long_version := sqlerrm = 'INVALID_RELEASE_VERSION'; end;
  begin perform public.claim_release_announcement('0.2.1', null);
  exception when sqlstate 'P0001' then null_presentation := sqlerrm = 'INVALID_PRESENTATION_ID'; end;
  begin perform public.claim_release_announcement('0.2.1', '00000000-0000-0000-0000-000000000000');
  exception when sqlstate 'P0001' then nil_presentation := sqlerrm = 'INVALID_PRESENTATION_ID'; end;
  insert into tap_results values
    (null_version, 'null version is rejected'),
    (malformed_version, 'non-SemVer version is rejected'),
    (leading_zero_version, 'leading-zero SemVer version is rejected'),
    (long_version, 'overlong version is rejected'),
    (null_presentation, 'null presentation UUID is rejected'),
    (nil_presentation, 'nil presentation UUID is rejected');
end;
$$;

select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-000000000003', true);
do $$
declare denied boolean := false;
begin
  begin perform public.claim_release_announcement('0.2.0', '84000000-0000-4000-8000-000000000006');
  exception when sqlstate 'P0001' then denied := sqlerrm = 'MEMBERSHIP_REQUIRED'; end;
  insert into tap_results values (denied, 'revoked member cannot reserve a presentation');
end;
$$;

select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-000000000004', true);
do $$
declare denied boolean := false;
begin
  begin perform public.claim_release_announcement('0.2.0', '84000000-0000-4000-8000-000000000007');
  exception when sqlstate 'P0001' then denied := sqlerrm = 'MEMBERSHIP_REQUIRED'; end;
  insert into tap_results values (denied, 'authenticated nonmember cannot reserve a presentation');
end;
$$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
declare denied boolean := false;
begin
  begin perform public.claim_release_announcement('0.2.0', '84000000-0000-4000-8000-000000000008');
  exception when insufficient_privilege then denied := true; end;
  insert into tap_results values (denied, 'anonymous caller cannot execute the claim RPC');
end;
$$;

set local role service_role;
do $$
declare
  rpc_denied boolean := false;
  table_denied boolean := false;
begin
  begin perform public.claim_release_announcement('0.2.0', '84000000-0000-4000-8000-000000000009');
  exception when insufficient_privilege then rpc_denied := true; end;
  begin perform count(*) from public.release_announcements;
  exception when insufficient_privilege then table_denied := true; end;
  insert into tap_results values
    (rpc_denied, 'service role cannot execute the user claim RPC'),
    (table_denied, 'service role cannot directly read presentation state');
end;
$$;

reset role;
insert into tap_results values
  ((select count(*) from public.release_announcements where user_id = '83000000-0000-0000-0000-000000000001') = 2, 'user A stores one row per claimed version'),
  ((select count(*) from public.release_announcements where user_id = '83000000-0000-0000-0000-000000000002') = 1, 'user B stores an independent current-version row'),
  ((select count(*) from public.release_announcements where user_id in ('83000000-0000-0000-0000-000000000003', '83000000-0000-0000-0000-000000000004')) = 0, 'denied identities store no presentation state');

select
  (case when ok then 'ok ' else 'not ok ' end) ||
  row_number() over () || ' - ' || description
from tap_results;
select '1..' || count(*) from tap_results;

rollback;
