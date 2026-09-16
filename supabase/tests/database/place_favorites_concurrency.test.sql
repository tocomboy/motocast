\set ON_ERROR_STOP on

create extension if not exists dblink with schema extensions;
delete from auth.users where id='77000000-0000-0000-0000-000000000001';
drop function if exists public.test_add_favorite(jsonb);
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
values('00000000-0000-0000-0000-000000000000','77000000-0000-0000-0000-000000000001','authenticated','authenticated','favorite-race@motocast.test','',now(),now(),now(),'{}','{}');
insert into public.memberships(user_id,role) values('77000000-0000-0000-0000-000000000001','rider');
create function public.test_add_favorite(payload jsonb) returns text language plpgsql set search_path=public,pg_temp as $$ begin perform public.add_place_favorite(payload); return 'OK'; exception when others then return sqlerrm; end $$;
grant execute on function public.test_add_favorite(jsonb) to authenticated;
set role authenticated; select set_config('request.jwt.claim.sub','77000000-0000-0000-0000-000000000001',false);
select public.add_place_favorite(jsonb_build_object('kakaoPlaceId','seed1','verificationToken',repeat('a',43),'name','seed1','address','주소','roadAddress',null,'longitude',127,'latitude',37));
select public.add_place_favorite(jsonb_build_object('kakaoPlaceId','seed2','verificationToken',repeat('b',43),'name','seed2','address','주소','roadAddress',null,'longitude',127,'latitude',37));
reset role;
select dblink_connect('favorite_c1',format('host=127.0.0.1 port=5432 dbname=%I user=supabase_admin password=postgres',current_database()));
select dblink_connect('favorite_c2',format('host=127.0.0.1 port=5432 dbname=%I user=supabase_admin password=postgres',current_database()));
select dblink_exec('favorite_c1','set role authenticated'); select dblink_exec('favorite_c2','set role authenticated');
select dblink_exec('favorite_c1','set "request.jwt.claim.sub"=''77000000-0000-0000-0000-000000000001'''); select dblink_exec('favorite_c2','set "request.jwt.claim.sub"=''77000000-0000-0000-0000-000000000001''');
select dblink_send_query('favorite_c1',format('select public.test_add_favorite(%L::jsonb)',jsonb_build_object('kakaoPlaceId','race1','verificationToken',repeat('c',43),'name','race1','address','주소','roadAddress',null,'longitude',127,'latitude',37)::text));
select dblink_send_query('favorite_c2',format('select public.test_add_favorite(%L::jsonb)',jsonb_build_object('kakaoPlaceId','race2','verificationToken',repeat('d',43),'name','race2','address','주소','roadAddress',null,'longitude',127,'latitude',37)::text));
create temp table race_results(result text); insert into race_results select result from dblink_get_result('favorite_c1') as t(result text); insert into race_results select result from dblink_get_result('favorite_c2') as t(result text);
select result from dblink_get_result('favorite_c1') as t(result text); select result from dblink_get_result('favorite_c2') as t(result text);
create temp table tap_results(ok boolean, description text);
insert into tap_results values ((select count(*)=3 from public.place_favorites where owner_id='77000000-0000-0000-0000-000000000001') and (select array_agg(result order by result)=array['FAVORITE_LIMIT','OK'] from race_results),'concurrent additions preserve the three slot limit');
delete from public.place_favorites where owner_id='77000000-0000-0000-0000-000000000001' and slot=3;
select dblink_send_query('favorite_c1',format('select public.test_add_favorite(%L::jsonb)',jsonb_build_object('kakaoPlaceId','same','verificationToken',repeat('e',43),'name','same','address','주소','roadAddress',null,'longitude',127,'latitude',37)::text));
select dblink_send_query('favorite_c2',format('select public.test_add_favorite(%L::jsonb)',jsonb_build_object('kakaoPlaceId','same','verificationToken',repeat('e',43),'name','same','address','주소','roadAddress',null,'longitude',127,'latitude',37)::text));
create temp table duplicate_results(result text); insert into duplicate_results select result from dblink_get_result('favorite_c1') as t(result text); insert into duplicate_results select result from dblink_get_result('favorite_c2') as t(result text);
select result from dblink_get_result('favorite_c1') as t(result text); select result from dblink_get_result('favorite_c2') as t(result text);
insert into tap_results values ((select count(*)=3 from public.place_favorites where owner_id='77000000-0000-0000-0000-000000000001') and (select count(*)=2 and bool_and(result='OK') from duplicate_results) and (select count(*)=1 from public.place_favorites where owner_id='77000000-0000-0000-0000-000000000001' and place->>'kakaoPlaceId'='same'),'concurrent duplicate additions are idempotent');
select (case when ok then 'ok ' else 'not ok ' end)||row_number() over()||' - '||description from tap_results; select '1..'||count(*) from tap_results;
do $$ begin if exists(select 1 from tap_results where not ok) then raise exception 'PLACE_FAVORITES_CONCURRENCY_FAILED'; end if; end $$;
select dblink_disconnect('favorite_c1'); select dblink_disconnect('favorite_c2'); drop function public.test_add_favorite(jsonb);
delete from auth.users where id='77000000-0000-0000-0000-000000000001';
