\set ON_ERROR_STOP on
-- Issue #124 two-connection suite on an isolated local database (committed writes,
-- real advisory locks and deferred checks). Only test-owned 93000000-... users are
-- created and removed; their folders, places and stars cascade.
do $$ begin
  if current_database() not like 'motocast_saved_places_%' then raise exception 'DISPOSABLE_SAVED_PLACES_DATABASE_REQUIRED'; end if;
  if to_regclass('public.place_folders') is null then raise exception 'SHARED_PLACE_FOLDERS_MIGRATION_REQUIRED'; end if;
  if exists(select 1 from auth.users where id between '93000000-0000-0000-0000-000000000001' and '93000000-0000-0000-0000-000000000099') then raise exception 'SHARED_FOLDER_RACE_FIXTURE_ALREADY_EXISTS'; end if;
end $$;
create extension if not exists dblink with schema extensions;
create temp table tap_results(ok boolean not null, description text not null);
create temp table race_results(connection text, result text);
create temp table folders(k text primary key, id uuid not null default gen_random_uuid());
create function pg_temp.u(n integer) returns uuid language sql immutable as $$ select ('93000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.place(k text) returns jsonb language sql immutable as $$
  select jsonb_build_object('kakaoPlaceId',k,'verificationToken',repeat('a',43),'name','원본 '||k,'address','경기도 양평군 테스트','roadAddress',null,'longitude',127,'latitude',37)
$$;
create function pg_temp.f(key text) returns uuid language sql stable as $$ select id from folders where k=key $$;
create function pg_temp.token(c text) returns text language sql immutable as $$ select repeat(c,43) $$;
create function pg_temp.shared(key text, k text) returns uuid language sql stable as $$
  select id from public.shared_places where folder_id=pg_temp.f(key) and place->>'kakaoPlaceId'=k
$$;
create function pg_temp.wait_for(application text, event text) returns boolean language plpgsql as $$
declare attempt integer;
begin
  for attempt in 1..500 loop
    if exists(select 1 from pg_stat_activity where application_name=application and datname=current_database() and wait_event=event) then return true; end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end $$;
create function public.test_folder_race(statement text) returns text language plpgsql set search_path = '' as $$
declare result text;
begin execute statement into result; return coalesce(nullif(result,''),'OK'); exception when others then return sqlerrm; end $$;
revoke all on function public.test_folder_race(text) from public,anon,authenticated,service_role;
grant execute on function public.test_folder_race(text) to authenticated;
-- Committed fixture folder with owner row, members and preferences.
create function pg_temp.folder(key text, owner integer, members integer[] default '{}', member_role text default 'editor') returns void language plpgsql as $$
begin
  insert into folders(k) values (key);
  insert into public.place_folders(id,owner_id,name) values (pg_temp.f(key),pg_temp.u(owner),key);
  insert into public.place_folder_members(folder_id,member_id,role,display_name)
  select pg_temp.f(key),pg_temp.u(owner),'owner','owner'||owner
  union all select pg_temp.f(key),pg_temp.u(m),member_role,'m'||m from unnest(members) m;
  insert into public.place_folder_preferences(member_id,folder_id) select member_id,folder_id from public.place_folder_members where folder_id=pg_temp.f(key);
end $$;
create function pg_temp.invite(key text, c text) returns void language sql as $$
  insert into public.place_folder_invites(folder_id,token_hash,created_by,created_at,expires_at)
  values (pg_temp.f(key),encode(extensions.digest(pg_temp.token(c),'sha256'),'hex'),(select owner_id from public.place_folders where id=pg_temp.f(key)),now(),now()+interval '7 days')
$$;
create function pg_temp.call(conn text, statement text) returns void language sql as $$
  select extensions.dblink_send_query(conn,format('select public.test_folder_race(%L)',statement))
$$;
create function pg_temp.collect(conn text) returns void language plpgsql as $$
begin
  insert into race_results select conn,result from extensions.dblink_get_result(conn) as t(result text);
  perform * from extensions.dblink_get_result(conn) as t(result text);
end $$;
create function pg_temp.as_user(conn text, n integer) returns void language sql as $$
  select extensions.dblink_exec(conn,format('set "request.jwt.claim.sub"=%L',pg_temp.u(n)))
$$;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000',pg_temp.u(n),'authenticated','authenticated','folder-race-'||n||'@motocast.test','',now(),now(),now(),'{}','{}'
from generate_series(1,40) n;
insert into public.memberships(user_id,role) select pg_temp.u(n),'rider' from generate_series(1,40) n;
-- A: 29 members (owner 1 + fillers 10..37) and two different links.
select pg_temp.folder('A',1,(select array_agg(n) from generate_series(10,37) n));
select pg_temp.invite('A','a'); select pg_temp.invite('A','b');
-- B, C: open folders with links; riders 4 and 5 already belong to nineteen folders.
select pg_temp.folder('B',1); select pg_temp.invite('B','c');
select pg_temp.folder('C',1); select pg_temp.invite('C','d');
select pg_temp.folder('X'||n,4) from generate_series(1,19) n;
select pg_temp.folder('Y'||n,5) from generate_series(1,19) n;
-- D: 999 places; owner 1 owns one more saved place to import.
select pg_temp.folder('D',1);
insert into public.shared_places(folder_id,place,kind,province,created_by,updated_by)
select pg_temp.f('D'),pg_temp.place('d'||n),'riding_spot','경기',pg_temp.u(1),pg_temp.u(1) from generate_series(1,999) n;
insert into public.saved_places(owner_id,place,province) values (pg_temp.u(1),pg_temp.place('import-me'),'경기');
-- E: rider 6 has eight personal stars and one shared star (total nine).
select pg_temp.folder('E',1,array[6]);
insert into public.shared_places(folder_id,place,kind,province,created_by,updated_by)
select pg_temp.f('E'),pg_temp.place('e'||n),'riding_spot','경기',pg_temp.u(1),pg_temp.u(1) from generate_series(1,2) n;
insert into public.saved_places(owner_id,place,province) select pg_temp.u(6),pg_temp.place('p'||n),'경기' from generate_series(1,10) n;
insert into public.place_stars(owner_id,slot,saved_place_id)
select pg_temp.u(6),n,(select id from public.saved_places where owner_id=pg_temp.u(6) and place->>'kakaoPlaceId'='p'||n) from generate_series(1,8) n;
insert into public.shared_place_stars(owner_id,shared_place_id) values (pg_temp.u(6),pg_temp.shared('E','e1'));
-- F: an open link for the revoke race. G: editor 8 and viewer 9 for role races.
select pg_temp.folder('F',1); select pg_temp.invite('F','f');
select pg_temp.folder('G',1,array[8]);
-- One statement: a member row without its preference fails the commit-time check.
with member as (insert into public.place_folder_members(folder_id,member_id,role,display_name) values (pg_temp.f('G'),pg_temp.u(9),'viewer','m9') returning folder_id,member_id)
insert into public.place_folder_preferences(member_id,folder_id) select member_id,folder_id from member;
insert into public.shared_places(folder_id,place,kind,province,created_by,updated_by) values (pg_temp.f('G'),pg_temp.place('g1'),'riding_spot','경기',pg_temp.u(1),pg_temp.u(1));
-- H, I: riders 2 and 3 belong to both; J: open link for rider 2.
select pg_temp.folder('H',1,array[2,3]); select pg_temp.folder('I',1,array[2,3]);
select pg_temp.folder('J',1); select pg_temp.invite('J','j');
insert into public.shared_places(folder_id,place,kind,province,created_by,updated_by) values (pg_temp.f('H'),pg_temp.place('h1'),'riding_spot','경기',pg_temp.u(1),pg_temp.u(1));

select extensions.dblink_connect('sf_c1',format('host=127.0.0.1 port=5432 dbname=%I user=supabase_admin password=postgres application_name=folder-race-c1',current_database()));
select extensions.dblink_connect('sf_c2',format('host=127.0.0.1 port=5432 dbname=%I user=supabase_admin password=postgres application_name=folder-race-c2',current_database()));
select extensions.dblink_connect('sf_c3',format('host=127.0.0.1 port=5432 dbname=%I user=supabase_admin password=postgres application_name=folder-race-c3',current_database()));
select extensions.dblink_connect('sf_admin',format('host=127.0.0.1 port=5432 dbname=%I user=supabase_admin password=postgres application_name=folder-race-admin',current_database()));
select extensions.dblink_exec('sf_c1','set role authenticated');
select extensions.dblink_exec('sf_c2','set role authenticated');
select extensions.dblink_exec('sf_c3','set role authenticated');

-- 1. Two different links into the folder's last seat.
select pg_temp.as_user('sf_c1',2); select pg_temp.as_user('sf_c2',3);
select pg_temp.call('sf_c1',format('select public.accept_place_folder_invite(%L,%L)->>''status''',pg_temp.token('a'),'late2'));
select pg_temp.call('sf_c2',format('select public.accept_place_folder_invite(%L,%L)->>''status''',pg_temp.token('b'),'late3'));
select pg_temp.collect('sf_c1'); select pg_temp.collect('sf_c2');
insert into tap_results values
((select array_agg(result order by result collate "C")=array['PLACE_FOLDER_MEMBER_LIMIT','joined'] from race_results),'only one of two concurrent joins takes the thirtieth seat'),
((select count(*)=30 from public.place_folder_members where folder_id=pg_temp.f('A')),'the folder never exceeds thirty members'),
((select count(*)=30 from public.place_folder_preferences where folder_id=pg_temp.f('A')),'the joined member has its preference and the rejected one has none');
delete from race_results;

-- 2. One rider joins two folders at once from nineteen; then create races a join.
select pg_temp.as_user('sf_c1',4); select pg_temp.as_user('sf_c2',4);
select pg_temp.call('sf_c1',format('select public.accept_place_folder_invite(%L,%L)->>''status''',pg_temp.token('c'),'four'));
select pg_temp.call('sf_c2',format('select public.accept_place_folder_invite(%L,%L)->>''status''',pg_temp.token('d'),'four'));
select pg_temp.collect('sf_c1'); select pg_temp.collect('sf_c2');
insert into tap_results values
((select array_agg(result order by result collate "C")=array['PLACE_FOLDER_LIMIT','joined'] from race_results),'only one of two joins into different folders takes the twentieth folder'),
((select count(*)=20 from public.place_folder_members where member_id=pg_temp.u(4)),'the rider never exceeds twenty folders');
delete from race_results;
select pg_temp.as_user('sf_c1',5); select pg_temp.as_user('sf_c2',5);
select pg_temp.call('sf_c1','select public.create_place_folder(''새 폴더'',''five'',''{}'')->''member''->>''role''');
select pg_temp.call('sf_c2',format('select public.accept_place_folder_invite(%L,%L)->>''status''',pg_temp.token('c'),'five'));
select pg_temp.collect('sf_c1'); select pg_temp.collect('sf_c2');
insert into tap_results values
((select count(*)=1 from race_results where result in ('owner','joined')) and (select count(*)=1 from race_results where result='PLACE_FOLDER_LIMIT'),'creating and joining at once still stops at twenty'),
((select count(*)=20 from public.place_folder_members where member_id=pg_temp.u(5)),'the creating rider holds exactly twenty folders');
delete from race_results;

-- 3. Add and import race for the 1,000th place.
select pg_temp.as_user('sf_c1',1); select pg_temp.as_user('sf_c2',1);
select pg_temp.call('sf_c1',format('select public.add_shared_place(%L::uuid,%L::jsonb)->>''status''',pg_temp.f('D'),pg_temp.place('race-add')));
select pg_temp.call('sf_c2',format('select (public.import_saved_places_to_folder(%L::uuid,array[%L::uuid])->>''added'')',pg_temp.f('D'),
  (select id from public.saved_places where owner_id=pg_temp.u(1) and place->>'kakaoPlaceId'='import-me')));
select pg_temp.collect('sf_c1'); select pg_temp.collect('sf_c2');
insert into tap_results values
((select count(*)=1 from race_results where result in ('added','1')) and (select count(*)=1 from race_results where result='PLACE_FOLDER_PLACE_LIMIT'),'only one of a concurrent add and import takes the 1,000th place'),
((select count(*)=1000 from public.shared_places where folder_id=pg_temp.f('D')),'the folder never exceeds 1,000 places');
delete from race_results;

-- 4. Personal and shared stars race for the tenth star.
select pg_temp.as_user('sf_c1',6); select pg_temp.as_user('sf_c2',6);
select pg_temp.call('sf_c1',format('select (select starred::text from public.set_shared_place_star(%L::uuid,true))',pg_temp.shared('E','e2')));
select pg_temp.call('sf_c2',format('select (select star_position::text from public.set_place_star(%L::uuid,1,true))',
  (select id from public.saved_places where owner_id=pg_temp.u(6) and place->>'kakaoPlaceId'='p9')));
select pg_temp.collect('sf_c1'); select pg_temp.collect('sf_c2');
insert into tap_results values
((select count(*)=1 from race_results where result in ('true','9')) and (select count(*)=1 from race_results where result='SAVED_PLACE_STAR_LIMIT'),'only one of a concurrent personal and shared star takes the tenth star'),
((select (select count(*) from public.place_stars where owner_id=pg_temp.u(6))+(select count(*) from public.shared_place_stars where owner_id=pg_temp.u(6))=10),'personal plus shared stars never exceed ten'),
(public.place_star_total_consistent(pg_temp.u(6)),'committed concurrent stars keep the total invariant');
delete from race_results;

-- 5. Revoke, downgrade and removal against join, edit and star.
select pg_temp.as_user('sf_c1',1); select pg_temp.as_user('sf_c2',7);
select extensions.dblink_exec('sf_c1','begin');
insert into race_results select 'c1',result from extensions.dblink('sf_c1',format('select public.test_folder_race(%L)',
  format('select (select revoked_at is not null from public.revoke_place_folder_invite(%L::uuid))::text',
    (select id from public.place_folder_invites where folder_id=pg_temp.f('F'))))) as t(result text);
select pg_temp.call('sf_c2',format('select public.accept_place_folder_invite(%L,%L)->>''status''',pg_temp.token('f'),'seven'));
insert into tap_results values (pg_temp.wait_for('folder-race-c2','advisory'),'a join waits for an in-flight revoke');
select extensions.dblink_exec('sf_c1','commit');
select pg_temp.collect('sf_c2');
insert into tap_results values
((select array_agg(result order by connection)=array['true','PLACE_FOLDER_INVITE_INVALID'] from race_results),'a join that waited for a revoke is rejected'),
(not exists(select 1 from public.place_folder_members where member_id=pg_temp.u(7)),'the revoked link admitted nobody');
delete from race_results;

select pg_temp.as_user('sf_c1',1); select pg_temp.as_user('sf_c2',8);
select extensions.dblink_exec('sf_c1','begin');
insert into race_results select 'c1',result from extensions.dblink('sf_c1',format('select public.test_folder_race(%L)',
  format('select public.set_place_folder_member_role(%L::uuid,%L::uuid,1,''viewer'')->>''role''',pg_temp.f('G'),pg_temp.u(8)))) as t(result text);
select pg_temp.call('sf_c2',format('select public.add_shared_place(%L::uuid,%L::jsonb)->>''status''',pg_temp.f('G'),pg_temp.place('race-edit')));
insert into tap_results values (pg_temp.wait_for('folder-race-c2','advisory'),'an edit waits for an in-flight downgrade');
select extensions.dblink_exec('sf_c1','commit');
select pg_temp.collect('sf_c2');
insert into tap_results values
((select array_agg(result order by connection)=array['viewer','PLACE_FOLDER_FORBIDDEN'] from race_results),'an edit that waited for a downgrade is forbidden'),
(pg_temp.shared('G','race-edit') is null,'the downgraded member added nothing');
delete from race_results;

select pg_temp.as_user('sf_c1',1); select pg_temp.as_user('sf_c2',9);
select extensions.dblink_exec('sf_c1','begin');
insert into race_results select 'c1',result from extensions.dblink('sf_c1',format('select public.test_folder_race(%L)',
  format('select public.remove_place_folder_member(%L::uuid,%L::uuid,1)',pg_temp.f('G'),pg_temp.u(9)))) as t(result text);
select pg_temp.call('sf_c2',format('select (select starred::text from public.set_shared_place_star(%L::uuid,true))',pg_temp.shared('G','g1')));
insert into tap_results values (pg_temp.wait_for('folder-race-c2','advisory'),'a star waits for an in-flight removal');
select extensions.dblink_exec('sf_c1','commit');
select pg_temp.collect('sf_c2');
insert into tap_results values
((select array_agg(result order by connection)=array['OK','SHARED_PLACE_NOT_FOUND'] from race_results),'a star that waited for the removal sees the place as not found'),
(not exists(select 1 from public.shared_place_stars where owner_id=pg_temp.u(9)),'the removed member has no shared star');
delete from race_results;

select pg_temp.as_user('sf_c1',8); select pg_temp.as_user('sf_c2',1);
select extensions.dblink_exec('sf_c1','begin');
insert into race_results select 'c1',result from extensions.dblink('sf_c1',format('select public.test_folder_race(%L)',
  format('select (select starred::text from public.set_shared_place_star(%L::uuid,true))',pg_temp.shared('G','g1')))) as t(result text);
select pg_temp.call('sf_c2',format('select public.remove_place_folder_member(%L::uuid,%L::uuid,2)',pg_temp.f('G'),pg_temp.u(8)));
insert into tap_results values (pg_temp.wait_for('folder-race-c2','advisory'),'a removal waits for an in-flight star');
select extensions.dblink_exec('sf_c1','commit');
select pg_temp.collect('sf_c2');
insert into tap_results values
((select array_agg(result order by connection)=array['true','OK'] from race_results),'the star commits first and the removal then succeeds'),
(not exists(select 1 from public.shared_place_stars where owner_id=pg_temp.u(8)) and not exists(select 1 from public.place_folder_members where member_id=pg_temp.u(8)),'the removal clears the star committed just before it');
delete from race_results;

-- 6. Folders in opposite request order and mixed folder/user locks finish without deadlock.
select extensions.dblink_exec('sf_admin','begin');
select extensions.dblink_exec('sf_admin',format('do $do$ begin perform pg_advisory_xact_lock(hashtextextended(%L,0)); perform pg_advisory_xact_lock(hashtextextended(%L,0)); end $do$',
  'place-folder:'||pg_temp.f('H'),'place-folder:'||pg_temp.f('I')));
select pg_temp.as_user('sf_c1',2); select pg_temp.as_user('sf_c2',3);
select pg_temp.call('sf_c1',format('select count(*)::text from public.set_place_folders_enabled(%L::jsonb)',
  jsonb_build_array(jsonb_build_object('folderId',pg_temp.f('I'),'enabled',false),jsonb_build_object('folderId',pg_temp.f('H'),'enabled',false))));
select pg_temp.call('sf_c2',format('select count(*)::text from public.set_place_folders_enabled(%L::jsonb)',
  jsonb_build_array(jsonb_build_object('folderId',pg_temp.f('H'),'enabled',false),jsonb_build_object('folderId',pg_temp.f('I'),'enabled',false))));
insert into tap_results values (pg_temp.wait_for('folder-race-c1','advisory') and pg_temp.wait_for('folder-race-c2','advisory'),'both opposite-order requests wait behind the held folders');
select extensions.dblink_exec('sf_admin','commit');
select pg_temp.collect('sf_c1'); select pg_temp.collect('sf_c2');
insert into tap_results values
((select count(*)=2 and bool_and(result ~ '^[0-9]+$') from race_results),'opposite-order preference changes both complete'),
((select count(*)=4 and bool_and(not enabled) from public.place_folder_preferences where folder_id in (pg_temp.f('H'),pg_temp.f('I')) and member_id in (pg_temp.u(2),pg_temp.u(3))),'both riders end with both folders off');
delete from race_results;
-- c1 holds folder J then rider 2; c2 (rider 2) stars in H: H shared, then waits on rider 2;
-- c3 (owner) removes rider 2 from H: waits on H. Every wait points one way.
select pg_temp.as_user('sf_c1',2); select pg_temp.as_user('sf_c2',2); select pg_temp.as_user('sf_c3',1);
select extensions.dblink_exec('sf_c1','begin');
insert into race_results select 'c1',result from extensions.dblink('sf_c1',format('select public.test_folder_race(%L)',
  format('select public.accept_place_folder_invite(%L,%L)->>''status''',pg_temp.token('j'),'two'))) as t(result text);
select pg_temp.call('sf_c2',format('select (select starred::text from public.set_shared_place_star(%L::uuid,true))',pg_temp.shared('H','h1')));
insert into tap_results values (pg_temp.wait_for('folder-race-c2','advisory'),'a star waits on the rider lock held by a join');
select pg_temp.call('sf_c3',format('select public.remove_place_folder_member(%L::uuid,%L::uuid,1)',pg_temp.f('H'),pg_temp.u(2)));
insert into tap_results values (pg_temp.wait_for('folder-race-c3','advisory'),'a removal waits on the folder held by that star');
select extensions.dblink_exec('sf_c1','commit');
select pg_temp.collect('sf_c2'); select pg_temp.collect('sf_c3');
insert into tap_results values
((select array_agg(result order by connection)=array['joined','true','OK'] from race_results),'the chained join, star and removal all complete in order without deadlock'),
(not exists(select 1 from public.shared_place_stars where owner_id=pg_temp.u(2)) and exists(select 1 from public.place_folder_members where member_id=pg_temp.u(2) and folder_id=pg_temp.f('J')),
  'the removal clears the star and the join remains');

select extensions.dblink_disconnect('sf_c1'); select extensions.dblink_disconnect('sf_c2'); select extensions.dblink_disconnect('sf_c3'); select extensions.dblink_disconnect('sf_admin');
drop function public.test_folder_race(text);
insert into tap_results values
((select bool_and(public.place_folder_consistent(id)) from public.place_folders where owner_id between pg_temp.u(1) and pg_temp.u(40)),'every race fixture folder keeps its owner and preference invariant');
-- Exact synthetic users owned by this test; folders and everything in them cascade.
delete from auth.users where id between pg_temp.u(1) and pg_temp.u(40);
insert into tap_results values
((not exists(select 1 from auth.users where id between pg_temp.u(1) and pg_temp.u(99))),'exact test-owned race users are cleaned'),
((not exists(select 1 from public.place_folders where owner_id between pg_temp.u(1) and pg_temp.u(99))) and (select count(*)=0 from folders f join public.shared_places p on p.folder_id=f.id),'their folders and places cascade away');
select (case when ok then 'ok ' else 'not ok ' end)||row_number() over()||' - '||description from tap_results;
select '1..'||count(*) from tap_results;
-- Fixed plan: a skipped assertion fails the suite instead of vanishing.
do $$ begin
  if (select count(*) from tap_results)<>34 then raise exception 'SHARED_PLACE_FOLDERS_CONCURRENCY_PLAN_MISMATCH: % of 34', (select count(*) from tap_results); end if;
  if exists(select 1 from tap_results where not ok) then raise exception 'SHARED_PLACE_FOLDERS_CONCURRENCY_FAILED'; end if;
end $$;
