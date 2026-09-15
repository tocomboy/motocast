\set ON_ERROR_STOP on

create extension if not exists dblink with schema extensions;

delete from public.kakao_oidc_handoffs;
drop function if exists public.test_consume_kakao_oidc_handoff(text, text);

create function public.test_consume_kakao_oidc_handoff(target_hash text, target_binding_hash text)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
begin
  return public.consume_kakao_oidc_handoff_internal(target_hash, target_binding_hash);
exception when others then
  return sqlerrm;
end;
$$;
revoke all on function public.test_consume_kakao_oidc_handoff(text, text) from public, anon, authenticated;
grant execute on function public.test_consume_kakao_oidc_handoff(text, text) to service_role;

create temp table handoff_fixture as
select
  repeat('A', 43) as raw_token,
  encode(extensions.digest(repeat('A', 43), 'sha256'), 'hex') as token_hash,
  encode(extensions.digest(repeat('browser-a', 8), 'sha256'), 'hex') as binding_hash,
  'encrypted-payload-one'::text as encrypted_payload;
grant select on handoff_fixture to service_role;

set role service_role;
select public.create_kakao_oidc_handoff_internal(
  (select token_hash from handoff_fixture),
  (select binding_hash from handoff_fixture),
  (select encrypted_payload from handoff_fixture),
  now() + interval '2 minutes'
);
reset role;

select dblink_connect('oidc_c1', 'host=127.0.0.1 port=5432 dbname=postgres user=supabase_admin password=postgres');
select dblink_connect('oidc_c2', 'host=127.0.0.1 port=5432 dbname=postgres user=supabase_admin password=postgres');
select dblink_exec('oidc_c1', 'set role service_role');
select dblink_exec('oidc_c2', 'set role service_role');
select dblink_send_query('oidc_c1', format(
  'select public.test_consume_kakao_oidc_handoff(%L, %L)', token_hash, binding_hash
)) from handoff_fixture;
select dblink_send_query('oidc_c2', format(
  'select public.test_consume_kakao_oidc_handoff(%L, %L)', token_hash, binding_hash
)) from handoff_fixture;

create temp table consume_results(result text);
insert into consume_results select result from dblink_get_result('oidc_c1') as response(result text);
insert into consume_results select result from dblink_get_result('oidc_c2') as response(result text);
select result from dblink_get_result('oidc_c1') as response(result text);
select result from dblink_get_result('oidc_c2') as response(result text);

insert into public.kakao_oidc_handoffs(token_hash, browser_binding_hash, encrypted_payload, created_at, expires_at)
values (
  encode(extensions.digest(repeat('B', 43), 'sha256'), 'hex'),
  encode(extensions.digest(repeat('browser-b', 8), 'sha256'), 'hex'),
  'expired-encrypted-payload',
  now() - interval '2 minutes',
  now() - interval '1 minute'
);

set role service_role;
create temp table expired_result as
select public.test_consume_kakao_oidc_handoff(
  encode(extensions.digest(repeat('B', 43), 'sha256'), 'hex'),
  encode(extensions.digest(repeat('browser-b', 8), 'sha256'), 'hex')
) as result;
reset role;

begin;
set local role service_role;
select public.create_kakao_oidc_handoff_internal(
  encode(extensions.digest(repeat('C', 43), 'sha256'), 'hex'),
  encode(extensions.digest(repeat('browser-c', 8), 'sha256'), 'hex'),
  'advancing-clock-payload',
  clock_timestamp() + interval '200 milliseconds'
);
select pg_sleep(0.3);
create temp table advancing_clock_result as
select public.test_consume_kakao_oidc_handoff(
  encode(extensions.digest(repeat('C', 43), 'sha256'), 'hex'),
  encode(extensions.digest(repeat('browser-c', 8), 'sha256'), 'hex')
) as result;
reset role;
commit;

set role service_role;
select public.create_kakao_oidc_handoff_internal(
  encode(extensions.digest(repeat('D', 43), 'sha256'), 'hex'),
  encode(extensions.digest(repeat('browser-d', 8), 'sha256'), 'hex'),
  'browser-bound-payload',
  clock_timestamp() + interval '2 minutes'
);
create temp table mismatched_binding_result as
select public.test_consume_kakao_oidc_handoff(
  encode(extensions.digest(repeat('D', 43), 'sha256'), 'hex'),
  encode(extensions.digest('different-browser', 'sha256'), 'hex')
) as result;
reset role;

create temp table tap_results(ok boolean not null, description text not null);
insert into tap_results values
  (
    (select count(*) filter (where result = 'encrypted-payload-one') = 1
      and count(*) filter (where result = 'OIDC_HANDOFF_INVALID') = 1 from consume_results),
    'concurrent handoff consumption succeeds exactly once'
  ),
  (
    (select consumed_at is not null from public.kakao_oidc_handoffs where token_hash = (select token_hash from handoff_fixture)),
    'successful handoff consumption records its terminal state'
  ),
  (
    not exists (
      select 1
      from public.kakao_oidc_handoffs as stored
      cross join handoff_fixture as fixture
      where stored.token_hash = fixture.raw_token
         or stored.encrypted_payload like '%' || fixture.raw_token || '%'
    ),
    'database stores neither the plaintext handoff bearer nor a payload containing it'
  ),
  (
    (select result = 'OIDC_HANDOFF_INVALID' from expired_result),
    'expired handoff cannot be consumed'
  ),
  (
    (select result = 'OIDC_HANDOFF_INVALID' from advancing_clock_result),
    'handoff that expires after transaction start cannot be consumed'
  ),
  (
    (select result = 'OIDC_HANDOFF_INVALID' from mismatched_binding_result),
    'handoff cannot be consumed from a different initiating browser'
  ),
  (
    not has_table_privilege('anon', 'public.kakao_oidc_handoffs', 'SELECT,INSERT,UPDATE,DELETE'),
    'anonymous role has no OIDC handoff table access'
  ),
  (
    not has_table_privilege('authenticated', 'public.kakao_oidc_handoffs', 'SELECT,INSERT,UPDATE,DELETE'),
    'authenticated role has no OIDC handoff table access'
  ),
  (
    not has_table_privilege('service_role', 'public.kakao_oidc_handoffs', 'SELECT,INSERT,UPDATE,DELETE'),
    'service role uses only reviewed handoff RPCs'
  ),
  (
    not has_function_privilege('anon', 'public.create_kakao_oidc_handoff_internal(text,text,text,timestamptz)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.create_kakao_oidc_handoff_internal(text,text,text,timestamptz)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.create_kakao_oidc_handoff_internal(text,text,text,timestamptz)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.consume_kakao_oidc_handoff_internal(text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.consume_kakao_oidc_handoff_internal(text,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.consume_kakao_oidc_handoff_internal(text,text)', 'EXECUTE'),
    'both handoff RPCs are service-role only'
  ),
  (
    (select relrowsecurity from pg_class where oid = 'public.kakao_oidc_handoffs'::regclass),
    'OIDC handoff table has RLS enabled'
  );

select dblink_disconnect('oidc_c1');
select dblink_disconnect('oidc_c2');
drop function public.test_consume_kakao_oidc_handoff(text, text);
delete from public.kakao_oidc_handoffs;

select
  (case when ok then 'ok ' else 'not ok ' end) ||
  row_number() over () || ' - ' || description
from tap_results;
select '1..' || count(*) from tap_results;

do $$
begin
  if exists (select 1 from tap_results where not ok) then
    raise exception 'kakao OIDC handoff test failed';
  end if;
end;
$$;
