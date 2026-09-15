\set ON_ERROR_STOP on

create extension if not exists dblink with schema extensions;

do $$
begin
  if exists (select 1 from auth.users where id = '85000000-0000-0000-0000-000000000001')
    or exists (
      select 1 from pg_trigger
      where tgname = 'delay_release_announcement_test' and not tgisinternal
    )
    or to_regprocedure('public.delay_release_announcement_test()') is not null
  then
    raise exception 'RELEASE_CONCURRENCY_FIXTURE_NOT_CLEAN';
  end if;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
values (
  '00000000-0000-0000-0000-000000000000',
  '85000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'release-concurrency@motocast.test',
  '',
  now(),
  now(),
  now(),
  '{"provider":"kakao","providers":["kakao"]}',
  '{"name":"릴리스 동시성"}'
);
insert into public.memberships(user_id, role)
values ('85000000-0000-0000-0000-000000000001', 'rider');

create function public.delay_release_announcement_test()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version = '9.9.9' then
    perform pg_catalog.pg_sleep(0.5);
  end if;
  return new;
end;
$$;
revoke all on function public.delay_release_announcement_test()
  from public, anon, authenticated, service_role;
create trigger delay_release_announcement_test
  before insert on public.release_announcements
  for each row execute function public.delay_release_announcement_test();

select dblink_connect('release_c1', 'host=127.0.0.1 port=5432 dbname=postgres user=supabase_admin password=postgres');
select dblink_connect('release_c2', 'host=127.0.0.1 port=5432 dbname=postgres user=supabase_admin password=postgres');
select dblink_exec('release_c1', 'set role authenticated');
select dblink_exec('release_c2', 'set role authenticated');
select dblink_exec('release_c1', 'set "request.jwt.claim.sub" = ''85000000-0000-0000-0000-000000000001''');
select dblink_exec('release_c2', 'set "request.jwt.claim.sub" = ''85000000-0000-0000-0000-000000000001''');

select dblink_send_query(
  'release_c1',
  $$select public.claim_release_announcement('9.9.9', '86000000-0000-4000-8000-000000000001')$$
);
select dblink_send_query(
  'release_c2',
  $$select public.claim_release_announcement('9.9.9', '86000000-0000-4000-8000-000000000002')$$
);

create temp table release_results(result boolean not null);
insert into release_results
select result from dblink_get_result('release_c1') as response(result boolean);
insert into release_results
select result from dblink_get_result('release_c2') as response(result boolean);

select case when count(*) filter (where result) = 1 and count(*) filter (where not result) = 1
  then 'ok 1 - different concurrent presentation UUIDs produce exactly one winner'
  else 'not ok 1 - different concurrent presentation UUIDs must produce exactly one winner'
end
from release_results;

select case when count(*) = 1
  and min(presentation_id::text) in (
    '86000000-0000-4000-8000-000000000001',
    '86000000-0000-4000-8000-000000000002'
  )
  then 'ok 2 - concurrency stores exactly the winning presentation'
  else 'not ok 2 - concurrency must store exactly the winning presentation'
end
from public.release_announcements
where user_id = '85000000-0000-0000-0000-000000000001'
  and version = '9.9.9';

select '1..2';

select dblink_disconnect('release_c1');
select dblink_disconnect('release_c2');
drop trigger delay_release_announcement_test on public.release_announcements;
drop function public.delay_release_announcement_test();
delete from auth.users where id = '85000000-0000-0000-0000-000000000001';
