\set ON_ERROR_STOP on
-- Issue #123 two-connection suite on an isolated local database (committed writes,
-- real deferred checks). Only test-owned 96000000-... users are created and removed.
do $$ begin
  if current_database() not like 'motocast_saved_places_%' then raise exception 'DISPOSABLE_SAVED_PLACES_DATABASE_REQUIRED'; end if;
  if to_regclass('public.place_stars') is null then raise exception 'FREQUENT_PLACES_MIGRATION_REQUIRED'; end if;
  if exists(select 1 from auth.users where id between '96000000-0000-0000-0000-000000000001' and '96000000-0000-0000-0000-000000000009') then raise exception 'FREQUENT_PLACES_RACE_FIXTURE_ALREADY_EXISTS'; end if;
end $$;
create extension if not exists dblink with schema extensions;
create temp table tap_results(ok boolean not null, description text not null);
create temp table race_results(connection text, result text);
create function pg_temp.race_place(id text) returns jsonb language sql immutable as $$
  select jsonb_build_object('kakaoPlaceId',id,'verificationToken',repeat('a',43),'name','원본 '||id,'address','경기도 양평군 테스트','roadAddress',null,'longitude',127,'latitude',37)
$$;
create function pg_temp.owner(n integer) returns uuid language sql immutable as $$ select ('96000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.pid(n integer, k text) returns uuid language sql stable as $$
  select id from public.saved_places where owner_id=pg_temp.owner(n) and place->>'kakaoPlaceId'=k
$$;
create function pg_temp.wait_for(application text, event text) returns boolean language plpgsql as $$
declare attempt integer;
begin
  for attempt in 1..300 loop
    if exists(select 1 from pg_stat_activity where application_name=application and datname=current_database() and wait_event=event) then return true; end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end $$;
create function public.test_frequent_race(statement text) returns text language plpgsql set search_path = '' as $$
begin execute statement; return 'OK'; exception when others then return sqlerrm; end $$;
-- No SET clause: a procedure with one cannot COMMIT between toggles.
create procedure public.test_frequent_toggle(target uuid, rounds integer) language plpgsql as $$
declare current_revision bigint; starred boolean; n integer;
begin
  for n in 1..rounds loop
    select entry.revision, entry.star_position is not null into current_revision, starred from public.saved_place_entries entry where entry.id = target;
    perform public.set_place_star(target, current_revision, not starred);
    commit;
  end loop;
end $$;
revoke all on function public.test_frequent_race(text) from public,anon,authenticated,service_role;
revoke all on procedure public.test_frequent_toggle(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.test_frequent_race(text) to authenticated;
grant execute on procedure public.test_frequent_toggle(uuid,integer) to authenticated;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000',pg_temp.owner(n),'authenticated','authenticated','frequent-race-'||n||'@motocast.test','',now(),now(),now(),'{}','{}'
from generate_series(1,7) n;
insert into public.memberships(user_id,role) select pg_temp.owner(n),'rider' from generate_series(1,7) n;
-- Owners 1/2: nine stars; 3/4: four stars; 5: four stars plus the toggled place; 6/7: none.
insert into public.saved_places(owner_id,place,province)
select pg_temp.owner(o),pg_temp.race_place('p'||n),'경기' from generate_series(1,7) o cross join generate_series(1,12) n;
insert into public.place_stars(owner_id,slot,saved_place_id)
select pg_temp.owner(o),n,pg_temp.pid(o,'p'||n) from generate_series(1,2) o cross join generate_series(1,9) n;
insert into public.place_stars(owner_id,slot,saved_place_id)
select pg_temp.owner(o),n,pg_temp.pid(o,'p'||n) from generate_series(3,5) o cross join generate_series(1,4) n;

select extensions.dblink_connect('fp_c1',format('host=127.0.0.1 port=5432 dbname=%I user=supabase_admin password=postgres application_name=frequent-race-c1',current_database()));
select extensions.dblink_connect('fp_c2',format('host=127.0.0.1 port=5432 dbname=%I user=supabase_admin password=postgres application_name=frequent-race-c2',current_database()));
select extensions.dblink_connect('fp_admin',format('host=127.0.0.1 port=5432 dbname=%I user=supabase_admin password=postgres application_name=frequent-race-admin',current_database()));
select extensions.dblink_exec('fp_c1','set role authenticated');
select extensions.dblink_exec('fp_c2','set role authenticated');

-- 1. Eleventh star requested concurrently through both new RPCs.
select extensions.dblink_exec('fp_c1',format('set "request.jwt.claim.sub"=%L',pg_temp.owner(1)));
select extensions.dblink_exec('fp_c2',format('set "request.jwt.claim.sub"=%L',pg_temp.owner(1)));
select extensions.dblink_send_query('fp_c1',format('select public.test_frequent_race(%L)',format('select public.set_place_star(%L::uuid,1,true)',pg_temp.pid(1,'p10'))));
select extensions.dblink_send_query('fp_c2',format('select public.test_frequent_race(%L)',format('select public.save_place_v2(%L::jsonb,null,''riding_spot'',true)',pg_temp.race_place('race-new')::text)));
insert into race_results select 'c1',result from extensions.dblink_get_result('fp_c1') as t(result text);
insert into race_results select 'c2',result from extensions.dblink_get_result('fp_c2') as t(result text);
select result from extensions.dblink_get_result('fp_c1') as t(result text);
select result from extensions.dblink_get_result('fp_c2') as t(result text);
insert into tap_results values
((select array_agg(result order by result)=array['OK','SAVED_PLACE_STAR_LIMIT'] from race_results),'only one concurrent tenth-position request succeeds'),
((select count(*)=10 from public.place_stars where owner_id=pg_temp.owner(1)),'concurrent stars never exceed ten'),
((pg_temp.pid(1,'race-new') is not null)=(select result='OK' from race_results where connection='c2'),'a rejected atomic star save leaves no partial place'),
(public.place_stars_consistent(pg_temp.owner(1)),'committed concurrent stars keep I1 and I2');
delete from race_results;

select extensions.dblink_exec('fp_c1',format('set "request.jwt.claim.sub"=%L',pg_temp.owner(2)));
select extensions.dblink_exec('fp_c2',format('set "request.jwt.claim.sub"=%L',pg_temp.owner(2)));
select extensions.dblink_send_query('fp_c1',format('select public.test_frequent_race(%L)',format('select public.set_place_star(%L::uuid,1,true)',pg_temp.pid(2,'p10'))));
select extensions.dblink_send_query('fp_c2',format('select public.test_frequent_race(%L)',format('select public.set_place_star(%L::uuid,1,true)',pg_temp.pid(2,'p11'))));
insert into race_results select 'c1',result from extensions.dblink_get_result('fp_c1') as t(result text);
insert into race_results select 'c2',result from extensions.dblink_get_result('fp_c2') as t(result text);
select result from extensions.dblink_get_result('fp_c1') as t(result text);
select result from extensions.dblink_get_result('fp_c2') as t(result text);
insert into tap_results values
((select array_agg(result order by result)=array['OK','SAVED_PLACE_STAR_LIMIT'] from race_results),'two concurrent star changes share the last position'),
((select count(*)=10 and max(slot)=10 from public.place_stars where owner_id=pg_temp.owner(2)),'the winner takes position ten'),
(public.place_stars_consistent(pg_temp.owner(2)),'same-position race keeps I1 and I2');
delete from race_results;

-- 2. Legacy and new writers serialize on the same owner lock and keep the mirror.
select extensions.dblink_exec('fp_c1',format('set "request.jwt.claim.sub"=%L',pg_temp.owner(3)));
select extensions.dblink_exec('fp_c2',format('set "request.jwt.claim.sub"=%L',pg_temp.owner(3)));
select extensions.dblink_exec('fp_c1','begin');
insert into race_results select 'c1',result from extensions.dblink('fp_c1',format('select public.test_frequent_race(%L)',format('select public.set_saved_place_star(%L::uuid,1,true)',pg_temp.pid(3,'p10')))) as t(result text);
select extensions.dblink_send_query('fp_c2',format('select public.test_frequent_race(%L)',format('select public.set_place_star(%L::uuid,1,true)',pg_temp.pid(3,'p11'))));
insert into tap_results values (pg_temp.wait_for('frequent-race-c2','advisory'),'new writer waits on the legacy writer owner lock');
select extensions.dblink_exec('fp_c1','commit');
insert into race_results select 'c2',result from extensions.dblink_get_result('fp_c2') as t(result text);
select result from extensions.dblink_get_result('fp_c2') as t(result text);
insert into tap_results values
((select count(*)=2 and bool_and(result='OK') from race_results),'legacy then new star both succeed'),
((select star_slot=5 from public.saved_places where id=pg_temp.pid(3,'p10')) and (select slot=5 from public.place_stars where saved_place_id=pg_temp.pid(3,'p10')),'legacy writer takes the last visible slot'),
((select star_slot is null from public.saved_places where id=pg_temp.pid(3,'p11')) and (select slot=6 from public.place_stars where saved_place_id=pg_temp.pid(3,'p11')),'new writer observes it and takes hidden position six'),
(public.place_stars_consistent(pg_temp.owner(3)),'mixed legacy/new writes keep I1 and I2');
delete from race_results;

select extensions.dblink_exec('fp_c1',format('set "request.jwt.claim.sub"=%L',pg_temp.owner(4)));
select extensions.dblink_exec('fp_c2',format('set "request.jwt.claim.sub"=%L',pg_temp.owner(4)));
select extensions.dblink_exec('fp_c1','begin');
insert into race_results select 'c1',result from extensions.dblink('fp_c1',format('select public.test_frequent_race(%L)',format('select public.set_place_star(%L::uuid,1,true)',pg_temp.pid(4,'p10')))) as t(result text);
select extensions.dblink_send_query('fp_c2',format('select public.test_frequent_race(%L)',format('select public.set_saved_place_star(%L::uuid,1,true)',pg_temp.pid(4,'p11'))));
insert into tap_results values (pg_temp.wait_for('frequent-race-c2','advisory'),'legacy writer waits on the new writer owner lock');
select extensions.dblink_exec('fp_c1','commit');
insert into race_results select 'c2',result from extensions.dblink_get_result('fp_c2') as t(result text);
select result from extensions.dblink_get_result('fp_c2') as t(result text);
insert into tap_results values
((select array_agg(result order by connection)=array['OK','SAVED_PLACE_STAR_LIMIT'] from race_results),'legacy writer after the new fifth star reports its 1..5 limit'),
((select revision=1 and star_slot is null from public.saved_places where id=pg_temp.pid(4,'p11')) and not exists(select 1 from public.place_stars where saved_place_id=pg_temp.pid(4,'p11')),'failed legacy writer changes nothing'),
(public.place_stars_consistent(pg_temp.owner(4)),'new-then-legacy writes keep I1 and I2');
delete from race_results;

-- 3. Every single view read is one snapshot while another connection toggles a star.
select extensions.dblink_exec('fp_c1',format('set "request.jwt.claim.sub"=%L',pg_temp.owner(5)));
select extensions.dblink_exec('fp_c2',format('set "request.jwt.claim.sub"=%L',pg_temp.owner(5)));
create temp table snapshot_reads(starred boolean, revision bigint, consistent boolean);
select extensions.dblink_send_query('fp_c1',format('call public.test_frequent_toggle(%L::uuid,400)',pg_temp.pid(5,'p12')));
do $$
declare n integer;
begin
  for n in 1..400 loop
    insert into snapshot_reads select * from extensions.dblink('fp_c2',format($q$
      select bool_or(entry.id=%1$L::uuid and entry.star_position is not null),
        max(entry.revision) filter (where entry.id=%1$L::uuid),
        count(*) filter (where entry.star_position is not null)<=10
        and bool_and(entry.star_slot is not distinct from case when entry.star_position<=5 then entry.star_position end)
        and bool_and(entry.id<>%1$L::uuid or (entry.star_position is not null)=((entry.revision-1)%%2=1))
      from public.saved_place_entries entry$q$,pg_temp.pid(5,'p12'))) as t(starred boolean, revision bigint, consistent boolean);
  end loop;
end $$;
select result from extensions.dblink_get_result('fp_c1') as t(result text);
select result from extensions.dblink_get_result('fp_c1') as t(result text);
insert into tap_results values
((select bool_and(consistent) from snapshot_reads),'each view read shows star, mirror and revision from one point in time'),
((select count(distinct starred)=2 and count(distinct revision)>2 from snapshot_reads),'reads overlapped the concurrent star toggles'),
((select revision=401 and star_slot is null from public.saved_places where id=pg_temp.pid(5,'p12')) and not exists(select 1 from public.place_stars where saved_place_id=pg_temp.pid(5,'p12')),'four hundred committed toggles each advanced revision once'),
(public.place_stars_consistent(pg_temp.owner(5)),'toggled owner keeps I1 and I2');

-- 4. A committed failure between the star and its mirror leaves nothing behind.
create function public.test_frequent_forced_failure() returns trigger language plpgsql set search_path = '' as $$ begin raise exception 'FORCED_MIRROR_FAILURE'; end $$;
revoke all on function public.test_frequent_forced_failure() from public,anon,authenticated,service_role;
create trigger test_frequent_forced_failure before update of star_slot on public.saved_places
  for each row when (new.owner_id='96000000-0000-0000-0000-000000000006') execute function public.test_frequent_forced_failure();
select extensions.dblink_exec('fp_c1',format('set "request.jwt.claim.sub"=%L',pg_temp.owner(6)));
insert into race_results select 'c1',result from extensions.dblink('fp_c1',format('select public.test_frequent_race(%L)',format('select public.set_place_star(%L::uuid,1,true)',pg_temp.pid(6,'p1')))) as t(result text);
drop trigger test_frequent_forced_failure on public.saved_places;
drop function public.test_frequent_forced_failure();
insert into tap_results values
((select result='FORCED_MIRROR_FAILURE' from race_results where connection='c1'),'forced mirror failure is reported'),
((select revision=1 from public.saved_places where id=pg_temp.pid(6,'p1')) and not exists(select 1 from public.place_stars where owner_id=pg_temp.owner(6)),'forced mirror failure rolls back the star and revision');
delete from race_results;

-- 5. The deferred check fails a commit that skipped the mirror.
select extensions.dblink_exec('fp_admin','begin');
-- Replica mode writes the star without triggers; a no-op owner update queues the check.
select extensions.dblink_exec('fp_admin','set local session_replication_role = replica');
select extensions.dblink_exec('fp_admin',format('insert into public.place_stars(owner_id,slot,saved_place_id) values (%L,1,%L)',pg_temp.owner(7),pg_temp.pid(7,'p1')));
select extensions.dblink_exec('fp_admin','set local session_replication_role = origin');
select extensions.dblink_exec('fp_admin',format('update public.saved_places set owner_id=owner_id where id=%L',pg_temp.pid(7,'p2')));
insert into race_results values ('admin',extensions.dblink_exec('fp_admin','commit',false));
insert into tap_results values
((select result='ERROR' from race_results where connection='admin') and extensions.dblink_error_message('fp_admin') like '%SAVED_PLACE_STAR_INVARIANT%','commit without a mirror fails the deferred I2 check'),
(not exists(select 1 from public.place_stars where owner_id=pg_temp.owner(7)),'failed commit leaves no star');

select extensions.dblink_disconnect('fp_c1'); select extensions.dblink_disconnect('fp_c2'); select extensions.dblink_disconnect('fp_admin');
drop procedure public.test_frequent_toggle(uuid,integer);
drop function public.test_frequent_race(text);
-- Exact synthetic users owned by this test; their places and stars cascade.
delete from auth.users where id in (select pg_temp.owner(n) from generate_series(1,7) n);
insert into tap_results values
((not exists(select 1 from auth.users where id between '96000000-0000-0000-0000-000000000001' and '96000000-0000-0000-0000-000000000009')),'exact test-owned race fixtures are cleaned'),
((not exists(select 1 from public.place_stars where owner_id between '96000000-0000-0000-0000-000000000001' and '96000000-0000-0000-0000-000000000009')),'owner deletion cascades stars through the deferred check');
select (case when ok then 'ok ' else 'not ok ' end)||row_number() over()||' - '||description from tap_results;
select '1..'||count(*) from tap_results;
do $$ begin if exists(select 1 from tap_results where not ok) then raise exception 'FREQUENT_PLACES_CONCURRENCY_FAILED'; end if; end $$;
