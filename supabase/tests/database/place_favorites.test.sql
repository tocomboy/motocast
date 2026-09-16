\set ON_ERROR_STOP on

begin;
create temp table tap_results(ok boolean not null, description text not null) on commit drop;
grant select, insert on tap_results to authenticated, anon, service_role;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values
('00000000-0000-0000-0000-000000000000','76000000-0000-0000-0000-000000000001','authenticated','authenticated','favorite-a@motocast.test','',now(),now(),now(),'{}','{}'),
('00000000-0000-0000-0000-000000000000','76000000-0000-0000-0000-000000000002','authenticated','authenticated','favorite-b@motocast.test','',now(),now(),now(),'{}','{}'),
('00000000-0000-0000-0000-000000000000','76000000-0000-0000-0000-000000000003','authenticated','authenticated','favorite-revoked@motocast.test','',now(),now(),now(),'{}','{}');
insert into public.memberships(user_id,role,revoked_at) values
('76000000-0000-0000-0000-000000000001','rider',null),('76000000-0000-0000-0000-000000000002','rider',null),('76000000-0000-0000-0000-000000000003','rider',now());

create function pg_temp.favorite(id text, token text, lon numeric default 127, lat numeric default 37) returns jsonb language sql immutable as $$ select jsonb_build_object('kakaoPlaceId',id,'verificationToken',token,'name','장소 '||id,'address','테스트 주소','roadAddress',null,'longitude',lon,'latitude',lat) $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','76000000-0000-0000-0000-000000000001',true);
select public.add_place_favorite(pg_temp.favorite('a',repeat('a',43)));
select public.add_place_favorite(pg_temp.favorite('b',repeat('b',43)));
select public.add_place_favorite(pg_temp.favorite('c',repeat('c',43)));
insert into tap_results values ((select count(*)=3 and min(slot)=1 and max(slot)=3 from public.place_favorites),'three favorites fill slots 1 through 3');
select public.add_place_favorite(pg_temp.favorite('c',repeat('c',43)));
insert into tap_results values ((select count(*)=3 from public.place_favorites),'duplicate add is idempotent');
do $$ begin perform public.add_place_favorite(pg_temp.favorite('d',repeat('d',43))); insert into tap_results values(false,'fourth favorite denied'); exception when sqlstate 'P0001' then insert into tap_results values(sqlerrm='FAVORITE_LIMIT','fourth favorite denied'); end $$;
do $$ begin perform public.add_place_favorite('42'::jsonb); insert into tap_results values(false,'scalar favorite denied'); exception when sqlstate 'P0001' then insert into tap_results values(sqlerrm='INVALID_FAVORITE_PLACE','scalar favorite denied'); end $$;
do $$ begin perform public.add_place_favorite(pg_temp.favorite('bounds',repeat('e',43),140,37)); insert into tap_results values(false,'out of bounds favorite denied'); exception when sqlstate 'P0001' then insert into tap_results values(sqlerrm='INVALID_FAVORITE_PLACE','out of bounds favorite denied'); end $$;
do $$ begin perform public.remove_place_favorite(1::smallint,'changed-id'); insert into tap_results values(false,'stale delete denied'); exception when sqlstate 'P0001' then insert into tap_results values(sqlerrm='FAVORITE_NOT_FOUND','stale delete denied'); end $$;
select public.remove_place_favorite(1::smallint,'a');
select public.add_place_favorite(pg_temp.favorite('d',repeat('d',43)));
insert into tap_results values ((select slot=1 from public.place_favorites where place->>'kakaoPlaceId'='d'),'removed slot is refilled first');

select set_config('request.jwt.claim.sub','76000000-0000-0000-0000-000000000002',true);
insert into tap_results values ((select count(*)=0 from public.place_favorites),'another active member cannot read owner favorites');
select public.add_place_favorite(pg_temp.favorite('other',repeat('f',43)));
insert into tap_results values ((select count(*)=1 from public.place_favorites),'another active member has isolated favorites');
select set_config('request.jwt.claim.sub','76000000-0000-0000-0000-000000000003',true);
do $$ begin perform public.add_place_favorite(pg_temp.favorite('revoked',repeat('g',43))); insert into tap_results values(false,'revoked member denied'); exception when sqlstate 'P0001' then insert into tap_results values(sqlerrm='MEMBERSHIP_REQUIRED','revoked member denied'); end $$;
reset role;

insert into tap_results values
((select relrowsecurity from pg_class where oid='public.place_favorites'::regclass),'favorites table has RLS enabled'),
(has_table_privilege('authenticated','public.place_favorites','SELECT'),'authenticated may select favorites'),
(not has_table_privilege('authenticated','public.place_favorites','INSERT,UPDATE,DELETE'),'authenticated direct writes denied'),
(not has_table_privilege('anon','public.place_favorites','SELECT,INSERT,UPDATE,DELETE'),'anonymous table access denied'),
(not has_table_privilege('service_role','public.place_favorites','SELECT,INSERT,UPDATE,DELETE'),'service role table access denied'),
(has_function_privilege('authenticated','public.add_place_favorite(jsonb)','EXECUTE'),'authenticated may add through narrow RPC'),
(has_function_privilege('authenticated','public.remove_place_favorite(smallint,text)','EXECUTE'),'authenticated may remove through narrow RPC'),
(not has_function_privilege('anon','public.add_place_favorite(jsonb)','EXECUTE'),'anonymous add RPC denied'),
(not has_function_privilege('service_role','public.add_place_favorite(jsonb)','EXECUTE'),'service role add RPC denied');

select (case when ok then 'ok ' else 'not ok ' end)||row_number() over()||' - '||description from tap_results;
select '1..'||count(*) from tap_results;
do $$ begin if exists(select 1 from tap_results where not ok) then raise exception 'PLACE_FAVORITES_TEST_FAILED'; end if; end $$;
rollback;
