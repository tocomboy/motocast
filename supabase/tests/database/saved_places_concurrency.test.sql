\set ON_ERROR_STOP on
-- Two real connections; only the isolated Issue99 local database is allowed.
do $$ begin
  if current_database() not like 'motocast_saved_places_%' then raise exception 'DISPOSABLE_SAVED_PLACES_DATABASE_REQUIRED'; end if;
  if exists(select 1 from auth.users where id between '99000000-0000-0000-0000-000000000001' and '99000000-0000-0000-0000-000000000005') then raise exception 'SAVED_PLACE_RACE_FIXTURE_ALREADY_EXISTS'; end if;
end $$;
create extension if not exists dblink with schema extensions;
create temp table tap_results(ok boolean not null, description text not null);
create temp table race_results(connection text, result text);
create function pg_temp.race_place(id text) returns jsonb language sql immutable as $$
  select jsonb_build_object('kakaoPlaceId',id,'verificationToken',repeat('a',43),'name','원본 '||id,'address','경기도 양평군 테스트','roadAddress',null,'longitude',127,'latitude',37)
$$;
create function public.test_saved_place_race(statement text) returns text language plpgsql set search_path = '' as $$
begin execute statement; return 'OK'; exception when others then return sqlerrm; end $$;
revoke all on function public.test_saved_place_race(text) from public,anon,authenticated,service_role;
grant execute on function public.test_saved_place_race(text) to authenticated;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000',('99000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','saved-race-'||n||'@motocast.test','',now(),now(),now(),'{}','{}'
from generate_series(1,5) n;
insert into public.memberships(user_id,role)
select ('99000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'rider' from generate_series(1,5) n;

-- Seed only test-owned canonical rows. Public RPC boundaries are exercised by
-- both competing authenticated connections, not by privileged direct writers.
insert into public.saved_places(owner_id,place,province)
select '99000000-0000-0000-0000-000000000001',pg_temp.race_place('seed-'||n),'경기' from generate_series(1,999) n;
insert into public.saved_places(owner_id,place,province,star_slot)
select '99000000-0000-0000-0000-000000000002',pg_temp.race_place('star-seed-'||n),'경기',n from generate_series(1,4) n;
insert into public.saved_places(owner_id,place,province) values
('99000000-0000-0000-0000-000000000002',pg_temp.race_place('existing'),'경기'),
('99000000-0000-0000-0000-000000000004',pg_temp.race_place('revision'),'경기');
insert into public.saved_places(owner_id,place,province,star_slot)
select '99000000-0000-0000-0000-000000000005',pg_temp.race_place('legacy-seed-'||n),'경기',n from generate_series(1,2) n;
select extensions.dblink_connect('saved_c1',format('host=127.0.0.1 port=5432 dbname=%I user=supabase_admin password=postgres application_name=saved-place-race-c1',current_database()));
select extensions.dblink_connect('saved_c2',format('host=127.0.0.1 port=5432 dbname=%I user=supabase_admin password=postgres application_name=saved-place-race-c2',current_database()));
select extensions.dblink_exec('saved_c1','set role authenticated');
select extensions.dblink_exec('saved_c2','set role authenticated');
select extensions.dblink_exec('saved_c1','set "request.jwt.claim.sub"=''99000000-0000-0000-0000-000000000001''');
select extensions.dblink_exec('saved_c2','set "request.jwt.claim.sub"=''99000000-0000-0000-0000-000000000001''');
select extensions.dblink_send_query('saved_c1',format('select public.test_saved_place_race(%L)',format('select public.save_place(%L::jsonb)',pg_temp.race_place('cap-a')::text)));
select extensions.dblink_send_query('saved_c2',format('select public.test_saved_place_race(%L)',format('select public.save_place(%L::jsonb)',pg_temp.race_place('cap-b')::text)));
insert into race_results select 'c1',result from extensions.dblink_get_result('saved_c1') as t(result text);
insert into race_results select 'c2',result from extensions.dblink_get_result('saved_c2') as t(result text);
select result from extensions.dblink_get_result('saved_c1') as t(result text);
select result from extensions.dblink_get_result('saved_c2') as t(result text);
insert into tap_results values
((select count(*)=1000 from public.saved_places where owner_id='99000000-0000-0000-0000-000000000001'),'concurrent final saved slot never exceeds one thousand'),
((select array_agg(result order by result)=array['OK','SAVED_PLACE_LIMIT'] from race_results),'exactly one concurrent overflow fails with limit error');
delete from race_results where connection in ('c1','c2');

select extensions.dblink_exec('saved_c1','set "request.jwt.claim.sub"=''99000000-0000-0000-0000-000000000002''');
select extensions.dblink_exec('saved_c2','set "request.jwt.claim.sub"=''99000000-0000-0000-0000-000000000002''');
select extensions.dblink_send_query('saved_c1',format('select public.test_saved_place_race(%L)',format('select public.save_place(%L::jsonb,null,''restaurant'',true)',pg_temp.race_place('new-star')::text)));
select extensions.dblink_send_query('saved_c2',format('select public.test_saved_place_race(%L)',format('select public.set_saved_place_star(%L::uuid,1,true)',(select id from public.saved_places where owner_id='99000000-0000-0000-0000-000000000002' and place->>'kakaoPlaceId'='existing'))));
insert into race_results select 'c1',result from extensions.dblink_get_result('saved_c1') as t(result text);
insert into race_results select 'c2',result from extensions.dblink_get_result('saved_c2') as t(result text);
select result from extensions.dblink_get_result('saved_c1') as t(result text);
select result from extensions.dblink_get_result('saved_c2') as t(result text);
insert into tap_results values
((select count(*)=5 and count(distinct star_slot)=5 from public.saved_places where owner_id='99000000-0000-0000-0000-000000000002' and star_slot is not null),'concurrent initial star and later star share the five-slot limit'),
((select array_agg(result order by result)=array['OK','SAVED_PLACE_STAR_LIMIT'] from race_results),'only one competing star succeeds'),
((exists(select 1 from public.saved_places where owner_id='99000000-0000-0000-0000-000000000002' and place->>'kakaoPlaceId'='new-star'))=(select result='OK' from race_results where connection='c1'),'failed atomic initial star creates no partial record');
delete from race_results where connection in ('c1','c2');

select extensions.dblink_exec('saved_c1','set "request.jwt.claim.sub"=''99000000-0000-0000-0000-000000000003''');
select extensions.dblink_exec('saved_c2','set "request.jwt.claim.sub"=''99000000-0000-0000-0000-000000000003''');
select extensions.dblink_send_query('saved_c1',format('select public.test_saved_place_race(%L)',format('select public.save_place(%L::jsonb,''first alias'',''restaurant'',true)',pg_temp.race_place('duplicate')::text)));
select extensions.dblink_send_query('saved_c2',format('select public.test_saved_place_race(%L)',format('select public.save_place(%L::jsonb,''second alias'',''riding_spot'',false)',pg_temp.race_place('duplicate')::text)));
insert into race_results select 'c1',result from extensions.dblink_get_result('saved_c1') as t(result text);
insert into race_results select 'c2',result from extensions.dblink_get_result('saved_c2') as t(result text);
select result from extensions.dblink_get_result('saved_c1') as t(result text);
select result from extensions.dblink_get_result('saved_c2') as t(result text);
insert into tap_results values
((select count(*)=1 and bool_and(revision=1 and place=pg_temp.race_place('duplicate')) from public.saved_places where owner_id='99000000-0000-0000-0000-000000000003'),'concurrent duplicate keeps one immutable canonical record'),
((select count(*)=2 and bool_and(result='OK') from race_results),'both exact duplicate saves receive successful existing record'),
((select (alias='first alias' and kind='restaurant' and star_slot=1) or (alias='second alias' and kind='riding_spot' and star_slot is null) from public.saved_places where owner_id='99000000-0000-0000-0000-000000000003'),'duplicate race preserves one complete initial metadata and star choice');
delete from race_results where connection in ('c1','c2');

select extensions.dblink_exec('saved_c1','set "request.jwt.claim.sub"=''99000000-0000-0000-0000-000000000004''');
select extensions.dblink_exec('saved_c2','set "request.jwt.claim.sub"=''99000000-0000-0000-0000-000000000004''');
select extensions.dblink_send_query('saved_c1',format('select public.test_saved_place_race(%L)',format('select public.update_saved_place(%L::uuid,1,''edit a'',''restaurant'')',(select id from public.saved_places where owner_id='99000000-0000-0000-0000-000000000004'))));
select extensions.dblink_send_query('saved_c2',format('select public.test_saved_place_race(%L)',format('select public.update_saved_place(%L::uuid,1,''edit b'',''riding_spot'')',(select id from public.saved_places where owner_id='99000000-0000-0000-0000-000000000004'))));
insert into race_results select 'c1',result from extensions.dblink_get_result('saved_c1') as t(result text);
insert into race_results select 'c2',result from extensions.dblink_get_result('saved_c2') as t(result text);
select result from extensions.dblink_get_result('saved_c1') as t(result text);
select result from extensions.dblink_get_result('saved_c2') as t(result text);
insert into tap_results values
((select array_agg(result order by result)=array['OK','SAVED_PLACE_STALE'] from race_results),'same-revision competing edits reject one stale writer'),
((select revision=2 and place=pg_temp.race_place('revision') from public.saved_places where owner_id='99000000-0000-0000-0000-000000000004'),'concurrent edit advances revision once and preserves original');
delete from race_results where connection in ('c1','c2');

select extensions.dblink_send_query('saved_c1',format('select public.test_saved_place_race(%L)',format('select public.delete_saved_place(%L::uuid,2)',(select id from public.saved_places where owner_id='99000000-0000-0000-0000-000000000004'))));
select extensions.dblink_send_query('saved_c2',format('select public.test_saved_place_race(%L)',format('select public.update_saved_place(%L::uuid,2,''newer edit'',''restaurant'')',(select id from public.saved_places where owner_id='99000000-0000-0000-0000-000000000004'))));
insert into race_results select 'c1',result from extensions.dblink_get_result('saved_c1') as t(result text);
insert into race_results select 'c2',result from extensions.dblink_get_result('saved_c2') as t(result text);
select result from extensions.dblink_get_result('saved_c1') as t(result text);
select result from extensions.dblink_get_result('saved_c2') as t(result text);
insert into tap_results values
((select count(*) filter(where result='OK')=1 and count(*) filter(where result in ('SAVED_PLACE_STALE','SAVED_PLACE_NOT_FOUND'))=1 from race_results),'delete and edit using same revision cannot both succeed'),
((select count(*)=0 or (count(*)=1 and bool_and(revision=3 and alias='newer edit')) from public.saved_places where owner_id='99000000-0000-0000-0000-000000000004'),'delete/edit race preserves the complete winning state');
delete from race_results where connection in ('c1','c2');

-- Force a legacy writer to hold its transaction lock. The new writer must
-- actually wait on that same lock, then observe the newly occupied third slot.
select extensions.dblink_exec('saved_c1','set "request.jwt.claim.sub"=''99000000-0000-0000-0000-000000000005''');
select extensions.dblink_exec('saved_c2','set "request.jwt.claim.sub"=''99000000-0000-0000-0000-000000000005''');
select extensions.dblink_exec('saved_c1','begin');
select extensions.dblink_send_query('saved_c1',format('select public.test_saved_place_race(%L)',format('select public.add_place_favorite(%L::jsonb)',pg_temp.race_place('legacy-third')::text)));
insert into race_results select 'c1',result from extensions.dblink_get_result('saved_c1') as t(result text);
select result from extensions.dblink_get_result('saved_c1') as t(result text);
select extensions.dblink_send_query('saved_c2',format('select public.test_saved_place_race(%L)',format('select public.save_place(%L::jsonb,null,''restaurant'',true)',pg_temp.race_place('canonical-fourth')::text)));
do $$ declare attempt integer; begin
  for attempt in 1..100 loop
    if exists(select 1 from pg_stat_activity where application_name='saved-place-race-c2' and datname=current_database() and wait_event='advisory') then
      insert into tap_results values(true,'new canonical writer waits on legacy owner lock'); return;
    end if;
    perform pg_sleep(0.01);
  end loop;
  insert into tap_results values(false,'new canonical writer waits on legacy owner lock');
end $$;
select extensions.dblink_exec('saved_c1','commit');
insert into race_results select 'c2',result from extensions.dblink_get_result('saved_c2') as t(result text);
select result from extensions.dblink_get_result('saved_c2') as t(result text);
insert into tap_results values
((select count(*)=2 and bool_and(result='OK') from race_results),'legacy and canonical writes both complete after serialization'),
((select star_slot=4 from public.saved_places where owner_id='99000000-0000-0000-0000-000000000005' and place->>'kakaoPlaceId'='canonical-fourth'),'canonical writer observes legacy occupied slot and selects fourth'),
((select count(*)=3 and max(slot)=3 from public.place_favorites where owner_id='99000000-0000-0000-0000-000000000005'),'legacy projection stays compatible after concurrent fourth star');

select extensions.dblink_disconnect('saved_c1'); select extensions.dblink_disconnect('saved_c2');
drop function public.test_saved_place_race(text);
-- Exact synthetic users owned by this test; no original or migration rows.
delete from auth.users where id in ('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000002','99000000-0000-0000-0000-000000000003','99000000-0000-0000-0000-000000000004','99000000-0000-0000-0000-000000000005');
insert into tap_results values ((not exists(select 1 from auth.users where id between '99000000-0000-0000-0000-000000000001' and '99000000-0000-0000-0000-000000000005')),'exact test-owned race fixtures are cleaned');
select (case when ok then 'ok ' else 'not ok ' end)||row_number() over()||' - '||description from tap_results;
select '1..'||count(*) from tap_results;
do $$ begin if exists(select 1 from tap_results where not ok) then raise exception 'SAVED_PLACES_CONCURRENCY_FAILED'; end if; end $$;
