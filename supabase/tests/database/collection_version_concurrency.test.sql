\set ON_ERROR_STOP on

create extension if not exists dblink with schema extensions;

delete from auth.users where id = '73000000-0000-0000-0000-000000000003';
drop trigger if exists delay_test_collection_version on public.collection_versions;
drop function if exists public.delay_test_collection_version();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '73000000-0000-0000-0000-000000000003',
  'authenticated', 'authenticated', 'collection-concurrency@motocast.test', '',
  now(), now(), now(), '{"provider":"kakao","providers":["kakao"]}', '{"name":"동시성"}'
);
insert into public.memberships(user_id, role)
values ('73000000-0000-0000-0000-000000000003', 'rider');
insert into public.riding_collections(id, owner_id, title, description)
values ('73000000-0000-0000-0000-000000000013', '73000000-0000-0000-0000-000000000003', '동시 버전', '');
insert into public.collection_versions(id, collection_id, version_number, title, description, points, created_by)
values (
  '73000000-0000-0000-0000-000000000023', '73000000-0000-0000-0000-000000000013', 1,
  '동시 버전', '', '[]'::jsonb, '73000000-0000-0000-0000-000000000003'
);

create function public.delay_test_collection_version()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.collection_id = '73000000-0000-0000-0000-000000000013' then
    perform pg_sleep(0.5);
  end if;
  return new;
end;
$$;
create trigger delay_test_collection_version
  before insert on public.collection_versions
  for each row execute function public.delay_test_collection_version();

select dblink_connect('collection_c1', 'host=127.0.0.1 port=5432 dbname=postgres user=supabase_admin password=postgres');
select dblink_connect('collection_c2', 'host=127.0.0.1 port=5432 dbname=postgres user=supabase_admin password=postgres');
select dblink_exec('collection_c1', 'set role service_role');
select dblink_exec('collection_c2', 'set role service_role');

select dblink_send_query('collection_c1', $query$
  select version_number from public.save_collection_version_internal(
    '73000000-0000-0000-0000-000000000003',
    '73000000-0000-0000-0000-000000000013', '동시 버전', '',
    '{"origin":{"kakaoPlaceId":"origin","verificationToken":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","name":"출발","address":"테스트 주소","roadAddress":null,"longitude":127.0,"latitude":37.0},"destination":{"kakaoPlaceId":"destination","verificationToken":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","name":"복귀","address":"테스트 주소","roadAddress":null,"longitude":127.2,"latitude":37.2},"points":[{"id":"lunch","label":"점심","kakaoPlaceId":"lunch","verificationToken":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","name":"점심","address":"테스트 주소","roadAddress":null,"longitude":127.1,"latitude":37.1,"kind":"stop","dwellMinutes":60,"selected":true,"winding":false,"stopRole":"lunch"}]}'::jsonb
  )
$query$);
select dblink_send_query('collection_c2', $query$
  select version_number from public.save_collection_version_internal(
    '73000000-0000-0000-0000-000000000003',
    '73000000-0000-0000-0000-000000000013', '동시 버전', '',
    '{"origin":{"kakaoPlaceId":"origin","verificationToken":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","name":"출발","address":"테스트 주소","roadAddress":null,"longitude":127.0,"latitude":37.0},"destination":{"kakaoPlaceId":"destination","verificationToken":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","name":"복귀","address":"테스트 주소","roadAddress":null,"longitude":127.2,"latitude":37.2},"points":[{"id":"lunch","label":"점심","kakaoPlaceId":"lunch","verificationToken":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","name":"점심","address":"테스트 주소","roadAddress":null,"longitude":127.1,"latitude":37.1,"kind":"stop","dwellMinutes":60,"selected":true,"winding":false,"stopRole":"lunch"}]}'::jsonb
  )
$query$);

create temp table concurrent_versions(version_number integer);
insert into concurrent_versions select version_number from dblink_get_result('collection_c1') as result(version_number integer);
insert into concurrent_versions select version_number from dblink_get_result('collection_c2') as result(version_number integer);

create temp table tap_results(ok boolean not null, description text not null);
insert into tap_results values
  ((select array_agg(version_number order by version_number) = array[2, 3] from concurrent_versions), 'concurrent writers receive distinct sequential versions'),
  ((select count(*) = 3 from public.collection_versions where collection_id = '73000000-0000-0000-0000-000000000013'), 'concurrent writes preserve all immutable versions'),
  ((select count(distinct version_number) = 3 from public.collection_versions where collection_id = '73000000-0000-0000-0000-000000000013'), 'collection version numbers remain unique');

select dblink_disconnect('collection_c1');
select dblink_disconnect('collection_c2');
drop trigger delay_test_collection_version on public.collection_versions;
drop function public.delay_test_collection_version();
delete from auth.users where id = '73000000-0000-0000-0000-000000000003';
insert into tap_results values (
  (select count(*) = 0 from public.riding_collections where id = '73000000-0000-0000-0000-000000000013'),
  'owner Auth deletion cascades through collection versions without a restrictive FK deadlock'
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

-- The disposable local verification database owns dblink. Keeping an extension
-- that existed before this suite avoids deleting shared local test capability;
-- the next run removes any test trigger/function/fixture residue up front.
