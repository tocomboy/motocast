\set ON_ERROR_STOP on
begin;
create temp table tap_results(ok boolean not null, description text not null) on commit drop;
grant select,insert on tap_results to authenticated,anon,service_role;
create function pg_temp.saved_place_test(id text, address text default '경기도 양평군 테스트') returns jsonb language sql immutable as $$
select jsonb_build_object('kakaoPlaceId',id,'verificationToken',repeat('a',43),'name','원본 '||id,'address',address,'roadAddress',null,'longitude',127,'latitude',37)
$$;
create function pg_temp.expect_saved_error(statement text, expected_message text, description text, expected_state text default 'P0001') returns void language plpgsql as $$
begin
  execute statement;
  insert into tap_results values(false,description);
exception when others then
  insert into tap_results values(sqlstate=expected_state and sqlerrm=expected_message,description);
end $$;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000',('98000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','saved-'||n||'@motocast.test','',now(),now(),now(),'{}','{}'
from generate_series(1,5) n;
insert into public.memberships(user_id,role,revoked_at) values
('98000000-0000-0000-0000-000000000001','rider',null),('98000000-0000-0000-0000-000000000002','rider',null),
('98000000-0000-0000-0000-000000000003','rider',now()),('98000000-0000-0000-0000-000000000005','admin',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000001',true);
select public.save_place(pg_temp.saved_place_test('first'),'우리 집결지','restaurant',true);
insert into tap_results values ((select count(*)=1 and bool_and(alias='우리 집결지' and kind='restaurant' and province='경기' and star_slot=1 and revision=1 and place=pg_temp.saved_place_test('first')) from public.saved_places),'save preserves original and stores metadata with atomic star');
select public.save_place(jsonb_set(pg_temp.saved_place_test('first'),'{name}','"다른 원본"'),'덮어쓰려는 별칭','riding_spot',false);
insert into tap_results values ((select count(*)=1 and bool_and(alias='우리 집결지' and kind='restaurant' and star_slot=1 and revision=1 and place=pg_temp.saved_place_test('first')) from public.saved_places),'duplicate save returns existing original metadata and star unchanged');
select public.save_place(pg_temp.saved_place_test('map:37.0000000:127.0000000','강원특별자치도 춘천시 테스트'),null,'riding_spot',false);
insert into tap_results values ((select place=pg_temp.saved_place_test('map:37.0000000:127.0000000','강원특별자치도 춘천시 테스트') and province='강원' and star_slot is null from public.saved_places where place->>'kakaoPlaceId' like 'map:%'),'verified coordinate place is preserved without snapping');

select pg_temp.expect_saved_error('select public.save_place(''42''::jsonb)','INVALID_SAVED_PLACE','scalar place rejected');
select pg_temp.expect_saved_error('select public.save_place(pg_temp.saved_place_test(''bad'')||''{"extra":true}''::jsonb)','INVALID_SAVED_PLACE','extra original fields rejected');
select pg_temp.expect_saved_error('select public.save_place(pg_temp.saved_place_test(''bad'')-''roadAddress'')','INVALID_SAVED_PLACE','missing required nullable field rejected');
select pg_temp.expect_saved_error('select public.save_place(jsonb_set(pg_temp.saved_place_test(''bad''),''{longitude}'',''"127"''))','INVALID_SAVED_PLACE','numeric strings rejected');
select pg_temp.expect_saved_error('select public.save_place(jsonb_set(pg_temp.saved_place_test(''bad''),''{longitude}'',''1e400''))','INVALID_SAVED_PLACE','huge number returns safe validation failure');
select pg_temp.expect_saved_error('select public.save_place(jsonb_set(pg_temp.saved_place_test(''bad''),''{latitude}'',''39''))','INVALID_SAVED_PLACE','outside Korea rejected');
select pg_temp.expect_saved_error('select public.save_place(jsonb_set(pg_temp.saved_place_test(''bad''),''{verificationToken}'',''"invalid"''))','INVALID_SAVED_PLACE','malformed token rejected');
select pg_temp.expect_saved_error('select public.save_place(jsonb_set(pg_temp.saved_place_test(''bad''),''{name}'',to_jsonb(E''unsafe\nname''::text)))','INVALID_SAVED_PLACE','control characters in original rejected');
select pg_temp.expect_saved_error('select public.save_place(pg_temp.saved_place_test(''bad''),'' alias '')','INVALID_SAVED_PLACE_METADATA','untrimmed alias rejected');
select pg_temp.expect_saved_error('select public.save_place(pg_temp.saved_place_test(''bad''),repeat(''a'',81))','INVALID_SAVED_PLACE_METADATA','overlong alias rejected');
select pg_temp.expect_saved_error('select public.save_place(pg_temp.saved_place_test(''bad''),E''alias\n'')','INVALID_SAVED_PLACE_METADATA','control characters in alias rejected');
select pg_temp.expect_saved_error('select public.save_place(pg_temp.saved_place_test(''bad''),null,null)','INVALID_SAVED_PLACE_METADATA','explicit null kind rejected');
select pg_temp.expect_saved_error('select public.save_place(pg_temp.saved_place_test(''bad''),null,''other'')','INVALID_SAVED_PLACE_METADATA','unknown kind rejected');
select pg_temp.expect_saved_error('select public.save_place(pg_temp.saved_place_test(''bad''),null,''restaurant'',null)','INVALID_SAVED_PLACE','explicit null star rejected');
select public.save_place(pg_temp.saved_place_test('unknown','알 수 없는 주소'));
insert into tap_results values ((select province is null from public.saved_places where place->>'kakaoPlaceId'='unknown'),'unknown region is explicit null');

select public.save_place(pg_temp.saved_place_test('star-'||n),null,'riding_spot',true) from generate_series(2,5) n;
insert into tap_results values ((select count(*)=5 and min(star_slot)=1 and max(star_slot)=5 from public.saved_places where star_slot is not null),'five independent star slots fill exactly');
insert into tap_results values ((select count(*)=3 and max(slot)=3 from public.place_favorites),'old clients see only compatible first three slots');
select pg_temp.expect_saved_error('select public.save_place(pg_temp.saved_place_test(''sixth''),null,''restaurant'',true)','SAVED_PLACE_STAR_LIMIT','sixth atomic star rejected');
insert into tap_results values ((select count(*)=0 from public.saved_places where place->>'kakaoPlaceId'='sixth'),'failed initial star creates no partial saved record');
select public.save_place(pg_temp.saved_place_test('sixth'));
select pg_temp.expect_saved_error('select public.set_saved_place_star((select id from public.saved_places where place->>''kakaoPlaceId''=''sixth''),1,true)','SAVED_PLACE_STAR_LIMIT','sixth later star rejected');
select public.set_saved_place_star(id,revision,false) from public.saved_places where place->>'kakaoPlaceId'='first';
insert into tap_results values ((select star_slot is null and revision=2 and place=pg_temp.saved_place_test('first') from public.saved_places where place->>'kakaoPlaceId'='first'),'unstar retains saved original and increments revision');
select public.set_saved_place_star(id,revision,false) from public.saved_places where place->>'kakaoPlaceId'='first';
insert into tap_results values ((select revision=2 from public.saved_places where place->>'kakaoPlaceId'='first'),'no-op star preserves current revision');
select pg_temp.expect_saved_error('select public.set_saved_place_star((select id from public.saved_places where place->>''kakaoPlaceId''=''first''),1,true)','SAVED_PLACE_STALE','stale star cannot change record');
select public.update_saved_place(id,revision,'수정한 별칭','riding_spot') from public.saved_places where place->>'kakaoPlaceId'='first';
insert into tap_results values ((select alias='수정한 별칭' and kind='riding_spot' and revision=3 and province='경기' and place=pg_temp.saved_place_test('first') from public.saved_places where place->>'kakaoPlaceId'='first'),'metadata edit preserves original and derived province');
select pg_temp.expect_saved_error('select public.update_saved_place((select id from public.saved_places where place->>''kakaoPlaceId''=''first''),2,''stale'',''restaurant'')','SAVED_PLACE_STALE','stale edit denied');
select pg_temp.expect_saved_error('select public.delete_saved_place((select id from public.saved_places where place->>''kakaoPlaceId''=''first''),2)','SAVED_PLACE_STALE','stale delete denied');
select public.add_place_favorite(pg_temp.saved_place_test('first'));
insert into tap_results values ((select star_slot=1 and alias='수정한 별칭' and kind='riding_spot' and revision=4 from public.saved_places where place->>'kakaoPlaceId'='first'),'legacy re-star reuses canonical record and metadata');
select public.remove_place_favorite(1::smallint,'first');
insert into tap_results values ((select star_slot is null and revision=5 from public.saved_places where place->>'kakaoPlaceId'='first'),'legacy remove unstars without deleting saved record');
select public.add_place_favorite(pg_temp.saved_place_test('legacy-new'));
select pg_temp.expect_saved_error('select public.remove_place_favorite(1::smallint,''first'')','FAVORITE_NOT_FOUND','stale legacy exact-place request preserves replacement');
select pg_temp.expect_saved_error('select public.add_place_favorite(pg_temp.saved_place_test(''legacy-overflow''))','FAVORITE_LIMIT','legacy add keeps its three-slot cap');
select pg_temp.expect_saved_error('select public.add_place_favorite(pg_temp.saved_place_test(''star-5''))','FAVORITE_LIMIT','legacy retry of hidden slot does not expose invalid slot');
select public.delete_saved_place(id,revision) from public.saved_places where place->>'kakaoPlaceId'='legacy-new';
insert into tap_results values ((select count(*)=0 from public.saved_places where place->>'kakaoPlaceId'='legacy-new'),'exact canonical delete removes selected saved record and star');

create temp table owner_target as select id,revision from public.saved_places where place->>'kakaoPlaceId'='first';
select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000002',true);
insert into tap_results values ((select count(*)=0 from public.saved_places),'another rider cannot read canonical places'),((select count(*)=0 from public.place_favorites),'compatibility view preserves cross-user RLS');
select pg_temp.expect_saved_error('select public.update_saved_place((select id from owner_target),(select revision from owner_target),''foreign'',''restaurant'')','SAVED_PLACE_NOT_FOUND','cross-user edit denied');
select pg_temp.expect_saved_error('select public.set_saved_place_star((select id from owner_target),(select revision from owner_target),true)','SAVED_PLACE_NOT_FOUND','cross-user star denied');
select pg_temp.expect_saved_error('select public.delete_saved_place((select id from owner_target),(select revision from owner_target))','SAVED_PLACE_NOT_FOUND','cross-user delete denied');
select public.save_place(pg_temp.saved_place_test('first'));
insert into tap_results values ((select count(*)=1 from public.saved_places),'same provider ID remains isolated per owner');

-- Fill only the second account through its public RPC, including exact boundary.
do $$ declare n integer; begin
  for n in 2..1000 loop perform public.save_place(pg_temp.saved_place_test('limit-'||n)); end loop;
end $$;
insert into tap_results values ((select count(*)=1000 from public.saved_places),'account accepts exactly one thousand saved places');
select public.save_place(pg_temp.saved_place_test('first'),'ignored retry','restaurant',true);
insert into tap_results values ((select count(*)=1000 and bool_and(revision=1) from public.saved_places),'duplicate retry succeeds unchanged at saved-place limit');
select pg_temp.expect_saved_error('select public.save_place(pg_temp.saved_place_test(''limit-overflow''))','SAVED_PLACE_LIMIT','one thousand and first place rejected');
select pg_temp.expect_saved_error('select public.add_place_favorite(pg_temp.saved_place_test(''legacy-limit-overflow''))','SAVED_PLACE_LIMIT','legacy add cannot bypass canonical saved-place limit');
select public.set_saved_place_star(id,revision,true) from public.saved_places where place->>'kakaoPlaceId'='first';
insert into tap_results values ((select star_slot=1 from public.saved_places where place->>'kakaoPlaceId'='first'),'star existing saved place remains available at storage limit');

select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000003',true);
insert into tap_results values ((select count(*)=0 from public.saved_places),'revoked member has no saved-place reads');
select pg_temp.expect_saved_error('select public.save_place(pg_temp.saved_place_test(''revoked''))','MEMBERSHIP_REQUIRED','revoked member save denied');
select pg_temp.expect_saved_error('select public.update_saved_place((select id from owner_target),1,null,''restaurant'')','MEMBERSHIP_REQUIRED','revoked member edit denied');
select pg_temp.expect_saved_error('select public.set_saved_place_star((select id from owner_target),1,true)','MEMBERSHIP_REQUIRED','revoked member star denied');
select pg_temp.expect_saved_error('select public.delete_saved_place((select id from owner_target),1)','MEMBERSHIP_REQUIRED','revoked member delete denied');
select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000004',true);
insert into tap_results values ((select count(*)=0 from public.saved_places),'non-member has no saved-place reads');
select pg_temp.expect_saved_error('select public.save_place(pg_temp.saved_place_test(''nonmember''))','MEMBERSHIP_REQUIRED','authenticated non-member save denied');
select pg_temp.expect_saved_error('select public.update_saved_place((select id from owner_target),1,null,''restaurant'')','MEMBERSHIP_REQUIRED','authenticated non-member edit denied');
select pg_temp.expect_saved_error('select public.set_saved_place_star((select id from owner_target),1,true)','MEMBERSHIP_REQUIRED','authenticated non-member star denied');
select pg_temp.expect_saved_error('select public.delete_saved_place((select id from owner_target),1)','MEMBERSHIP_REQUIRED','authenticated non-member delete denied');
select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000005',true);
insert into tap_results values ((select count(*)=0 from public.saved_places),'administrator cannot read another account places');
select public.save_place(pg_temp.saved_place_test('admin'));
insert into tap_results values ((select count(*)=1 from public.saved_places),'administrator may manage own places');
select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000001',true);
select pg_temp.expect_saved_error('insert into public.saved_places(owner_id,place) values(auth.uid(),pg_temp.saved_place_test(''direct''))','permission denied for table saved_places','authenticated direct insert denied','42501');
select pg_temp.expect_saved_error('update public.saved_places set alias=''direct''','permission denied for table saved_places','authenticated direct update denied','42501');
select pg_temp.expect_saved_error('delete from public.saved_places','permission denied for table saved_places','authenticated direct delete denied','42501');
select pg_temp.expect_saved_error('delete from public.place_favorites','permission denied for view place_favorites','authenticated compatibility direct write denied','42501');
reset role;

set local role anon;
select pg_temp.expect_saved_error('select * from public.saved_places','permission denied for table saved_places','anonymous read denied','42501');
select pg_temp.expect_saved_error('select public.save_place(pg_temp.saved_place_test(''anon''))','permission denied for function save_place','anonymous save RPC denied','42501');
select pg_temp.expect_saved_error('select public.update_saved_place(''98000000-0000-0000-0000-000000000001'',1,null,''restaurant'')','permission denied for function update_saved_place','anonymous edit RPC denied','42501');
select pg_temp.expect_saved_error('select public.set_saved_place_star(''98000000-0000-0000-0000-000000000001'',1,true)','permission denied for function set_saved_place_star','anonymous star RPC denied','42501');
select pg_temp.expect_saved_error('select public.delete_saved_place(''98000000-0000-0000-0000-000000000001'',1)','permission denied for function delete_saved_place','anonymous delete RPC denied','42501');
reset role;
set local role service_role;
select pg_temp.expect_saved_error('select * from public.saved_places','permission denied for table saved_places','service-role read denied even with RLS bypass','42501');
select pg_temp.expect_saved_error('insert into public.saved_places(owner_id,place) values(''98000000-0000-0000-0000-000000000001'',pg_temp.saved_place_test(''service''))','permission denied for table saved_places','service-role insert denied','42501');
select pg_temp.expect_saved_error('update public.saved_places set alias=''service''','permission denied for table saved_places','service-role update denied','42501');
select pg_temp.expect_saved_error('delete from public.saved_places','permission denied for table saved_places','service-role delete denied','42501');
select pg_temp.expect_saved_error('select public.save_place(pg_temp.saved_place_test(''service''))','permission denied for function save_place','service-role save RPC denied','42501');
select pg_temp.expect_saved_error('select public.update_saved_place(''98000000-0000-0000-0000-000000000001'',1,null,''restaurant'')','permission denied for function update_saved_place','service-role edit RPC denied','42501');
select pg_temp.expect_saved_error('select public.set_saved_place_star(''98000000-0000-0000-0000-000000000001'',1,true)','permission denied for function set_saved_place_star','service-role star RPC denied','42501');
select pg_temp.expect_saved_error('select public.delete_saved_place(''98000000-0000-0000-0000-000000000001'',1)','permission denied for function delete_saved_place','service-role delete RPC denied','42501');
reset role;
insert into tap_results values
((select relrowsecurity from pg_class where oid='public.saved_places'::regclass),'canonical table RLS remains enabled'),
((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.place_favorites'::regclass),'legacy view preserves invoker RLS');
with provinces(full_name,short_name) as (values
('서울특별시','서울'),('부산광역시','부산'),('대구광역시','대구'),('인천광역시','인천'),('광주광역시','광주'),
('대전광역시','대전'),('울산광역시','울산'),('세종특별자치시','세종'),('경기도','경기'),('강원특별자치도','강원'),
('충청북도','충북'),('충청남도','충남'),('전북특별자치도','전북'),('전라남도','전남'),('경상북도','경북'),('경상남도','경남'),('제주특별자치도','제주'))
insert into tap_results select bool_and(public.saved_place_province(full_name||' 테스트')=short_name and public.saved_place_province(short_name||' 테스트')=short_name),'all seventeen full and short province names normalize consistently' from provinces;
select (case when ok then 'ok ' else 'not ok ' end)||row_number() over()||' - '||description from tap_results;
select '1..'||count(*) from tap_results;
do $$ begin if exists(select 1 from tap_results where not ok) then raise exception 'SAVED_PLACES_TEST_FAILED'; end if; end $$;
rollback;
