\set ON_ERROR_STOP on
-- Issue #123 rollback-only suite: new/legacy star RPC transitions, region alias rule,
-- old-client compatibility and the role matrix. Run on an isolated local database
-- after 20261007093000_frequent_places_ten.sql. Deferred I1/I2 checks are flushed at
-- checkpoints with SET CONSTRAINTS ALL IMMEDIATE because this suite never commits.
begin;
create temp table tap_results(ok boolean not null, description text not null) on commit drop;
create temp table rev_snapshot(k text primary key, revision bigint not null) on commit drop;
create temp table saved_ids(k text primary key, id uuid not null) on commit drop;
grant select,insert,delete on tap_results, rev_snapshot, saved_ids to authenticated,anon,service_role;

create function pg_temp.place(k text, address text default '경기도 양평군 테스트') returns jsonb language sql immutable as $$
select jsonb_build_object('kakaoPlaceId',k,'verificationToken',repeat('a',43),'name','원본 '||k,'address',address,'roadAddress',null,'longitude',127,'latitude',37)
$$;
create function pg_temp.expect_error(statement text, expected_message text, description text, expected_state text default 'P0001') returns void language plpgsql as $$
begin
  execute statement;
  insert into tap_results values(false,description);
exception when others then
  insert into tap_results values(sqlstate=expected_state and sqlerrm=expected_message,description);
end $$;
create function pg_temp.expect_state(statement text, expected_state text, description text) returns void language plpgsql as $$
begin
  execute statement;
  insert into tap_results values(false,description);
exception when others then
  insert into tap_results values(sqlstate=expected_state,description);
end $$;
-- Rider A helpers. They run under whichever role is active; RLS limits them to A.
create function pg_temp.sid(k text) returns uuid language sql stable as $$
  select id from public.saved_places where owner_id='97000000-0000-0000-0000-000000000001' and place->>'kakaoPlaceId'=k
$$;
create function pg_temp.rev(k text) returns bigint language sql stable as $$
  select revision from public.saved_places where owner_id='97000000-0000-0000-0000-000000000001' and place->>'kakaoPlaceId'=k
$$;
create function pg_temp.stars() returns text language sql stable as $$
  select coalesce(string_agg(star.slot||':'||(saved.place->>'kakaoPlaceId'),',' order by star.slot),'')
  from public.place_stars star join public.saved_places saved on saved.id=star.saved_place_id
  where star.owner_id='97000000-0000-0000-0000-000000000001'
$$;
create function pg_temp.mirror() returns text language sql stable as $$
  select coalesce(string_agg(star_slot||':'||(place->>'kakaoPlaceId'),',' order by star_slot),'')
  from public.saved_places where owner_id='97000000-0000-0000-0000-000000000001' and star_slot is not null
$$;
create function pg_temp.snap() returns void language sql as $$
  delete from rev_snapshot;
  insert into rev_snapshot select place->>'kakaoPlaceId', revision from public.saved_places where owner_id='97000000-0000-0000-0000-000000000001';
$$;
create function pg_temp.delta(k text) returns bigint language sql stable as $$
  select saved.revision-snap.revision from public.saved_places saved join rev_snapshot snap on snap.k=saved.place->>'kakaoPlaceId'
  where saved.owner_id='97000000-0000-0000-0000-000000000001' and snap.k=$1
$$;
-- Privileged fixture writer: replaces A's stars; the sync trigger maintains the mirror.
create function pg_temp.set_stars(spec text) returns void language plpgsql as $$
declare item text;
begin
  delete from public.place_stars where owner_id='97000000-0000-0000-0000-000000000001';
  foreach item in array string_to_array(spec,',') loop
    insert into public.place_stars(owner_id,slot,saved_place_id)
    values ('97000000-0000-0000-0000-000000000001',split_part(item,':',1)::smallint,pg_temp.sid(split_part(item,':',2)));
  end loop;
end $$;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000',('97000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','frequent-'||n||'@motocast.test','',now(),now(),now(),'{}','{}'
from generate_series(1,5) n;
insert into public.memberships(user_id,role,revoked_at) values
('97000000-0000-0000-0000-000000000001','rider',null),('97000000-0000-0000-0000-000000000002','rider',null),
('97000000-0000-0000-0000-000000000003','rider',now()),('97000000-0000-0000-0000-000000000005','admin',null);
insert into public.saved_places(owner_id,place,province)
select '97000000-0000-0000-0000-000000000001',pg_temp.place('a'||n),'경기' from generate_series(1,12) n;
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',true);

-- New RPC: set_place_star.
select pg_temp.set_stars('1:a1,3:a3');
set local role authenticated; select pg_temp.snap();
insert into tap_results select count(*)=1 and coalesce(bool_and(star_position=2 and star_slot=2 and revision=2),false), 'new star takes the lowest free 1..10 position and returns the view row'
  from public.set_place_star(pg_temp.sid('a2'),pg_temp.rev('a2'),true);
insert into tap_results values ((pg_temp.stars()='1:a1,2:a2,3:a3' and pg_temp.mirror()='1:a1,2:a2,3:a3' and pg_temp.delta('a2')=1),'new star writes place_stars once and mirrors 1..5');
insert into tap_results select count(*)=1 and coalesce(bool_and(star_position=2 and revision=2),false), 'starring a starred place is a no-op'
  from public.set_place_star(pg_temp.sid('a2'),pg_temp.rev('a2'),true);
insert into tap_results select count(*)=1 and coalesce(bool_and(star_position is null and star_slot is null and revision=3),false), 'unstar removes the star and advances revision once'
  from public.set_place_star(pg_temp.sid('a2'),pg_temp.rev('a2'),false);
insert into tap_results select count(*)=1 and coalesce(bool_and(star_position is null and revision=3),false), 'unstarring an unstarred place is a no-op'
  from public.set_place_star(pg_temp.sid('a2'),pg_temp.rev('a2'),false);
reset role; select pg_temp.set_stars('1:a1,2:a2,3:a3,4:a4,5:a5');
set local role authenticated;
insert into tap_results select count(*)=1 and coalesce(bool_and(star_position=6 and star_slot is null),false), 'sixth star is stored without a legacy mirror'
  from public.set_place_star(pg_temp.sid('a6'),pg_temp.rev('a6'),true);
reset role; select pg_temp.set_stars('1:a1,2:a2,3:a3,4:a4,5:a5,6:a6,7:a7,8:a8,9:a9,10:a10');
set local role authenticated; select pg_temp.snap();
select pg_temp.expect_error($q$select public.set_place_star(pg_temp.sid('a11'),pg_temp.rev('a11'),true)$q$,'SAVED_PLACE_STAR_LIMIT','eleventh star is rejected');
select pg_temp.expect_error($q$select public.save_place_v2(pg_temp.place('n-limit'),null,'riding_spot',true)$q$,'SAVED_PLACE_STAR_LIMIT','eleventh atomic star on save is rejected');
insert into tap_results values ((pg_temp.delta('a11')=0 and pg_temp.sid('n-limit') is null and pg_temp.stars()='1:a1,2:a2,3:a3,4:a4,5:a5,6:a6,7:a7,8:a8,9:a9,10:a10'),'rejected eleventh star changes nothing');
select pg_temp.expect_error($q$select public.set_place_star(pg_temp.sid('a11'),pg_temp.rev('a11')+1,true)$q$,'SAVED_PLACE_STALE','stale star change is rejected');
select pg_temp.expect_error($q$select public.set_place_star(gen_random_uuid(),1,true)$q$,'SAVED_PLACE_NOT_FOUND','unknown place is not found');
select pg_temp.expect_error($q$select public.set_place_star(pg_temp.sid('a11'),pg_temp.rev('a11'),null)$q$,'INVALID_SAVED_PLACE','null star request is rejected');

-- New RPC: save_place_v2.
reset role; select pg_temp.set_stars('1:a1,2:a2,3:a3,4:a4,5:a5,6:a6,8:a8');
set local role authenticated;
insert into tap_results select count(*)=1 and coalesce(bool_and(star_position=7 and star_slot is null and alias='새 별명' and kind='restaurant' and revision=1 and province='경기' and place=pg_temp.place('n1')),false), 'save_place_v2 stores metadata and an initial star in 1..10'
  from public.save_place_v2(pg_temp.place('n1'),'새 별명','restaurant',true);
insert into tap_results select count(*)=1 and coalesce(bool_and(star_position=7 and alias='새 별명' and kind='restaurant' and revision=1 and place=pg_temp.place('n1')),false), 'save_place_v2 duplicate returns the existing row unchanged'
  from public.save_place_v2(jsonb_set(pg_temp.place('n1'),'{name}','"다른 원본"'),'다른 별명','riding_spot',false);
reset role; select pg_temp.set_stars('2:a2');
set local role authenticated;
insert into tap_results select count(*)=1 and coalesce(bool_and(star_position=1 and star_slot=1),false), 'save_place_v2 fills the lowest free position'
  from public.save_place_v2(pg_temp.place('n2'),null,'riding_spot',true);
insert into tap_results select count(*)=1 and coalesce(bool_and(star_position is null),false), 'save_place_v2 without a star stores none'
  from public.save_place_v2(pg_temp.place('n3'));
select pg_temp.expect_error($q$select public.save_place_v2('42'::jsonb)$q$,'INVALID_SAVED_PLACE','save_place_v2 rejects a malformed place');
select pg_temp.expect_error($q$select public.save_place_v2(pg_temp.place('bad')||'{"extra":true}'::jsonb)$q$,'INVALID_SAVED_PLACE','save_place_v2 rejects extra fields');
select pg_temp.expect_error($q$select public.save_place_v2(pg_temp.place('bad'),' alias ')$q$,'INVALID_SAVED_PLACE_METADATA','save_place_v2 rejects an untrimmed alias');
select pg_temp.expect_error($q$select public.save_place_v2(pg_temp.place('bad'),null,'other')$q$,'INVALID_SAVED_PLACE_METADATA','save_place_v2 rejects an unknown kind');
select pg_temp.expect_error($q$select public.save_place_v2(pg_temp.place('bad'),null,'riding_spot',null)$q$,'INVALID_SAVED_PLACE','save_place_v2 rejects a null star');

-- A committed change whose response was lost is not repeated by a resend.
reset role; select pg_temp.set_stars('');
set local role authenticated; select pg_temp.snap();
create temp table lost_response as select pg_temp.rev('a5') as revision;
select public.set_place_star(pg_temp.sid('a5'),(select revision from lost_response),true);
select pg_temp.expect_error($q$select public.set_place_star(pg_temp.sid('a5'),(select revision from lost_response),true)$q$,'SAVED_PLACE_STALE','resending a lost star request with its old revision is stale');
insert into tap_results values ((pg_temp.stars()='1:a5' and pg_temp.delta('a5')=1),'re-reading after a lost response shows exactly one applied change');
reset role;
set constraints all immediate; set constraints all deferred;

-- Legacy set_saved_place_star (2.3 table).
select pg_temp.set_stars('1:a1,2:a2');
set local role authenticated; select pg_temp.snap();
insert into tap_results select count(*)=1 and coalesce(bool_and(star_slot=3),false), 'legacy star takes the lowest free 1..5 slot'
  from public.set_saved_place_star(pg_temp.sid('a3'),pg_temp.rev('a3'),true);
insert into tap_results values ((pg_temp.stars()='1:a1,2:a2,3:a3' and pg_temp.delta('a3')=1),'legacy star writes place_stars and advances revision once');
insert into tap_results select count(*)=1 and coalesce(bool_and(star_slot=2),false), 'legacy star on a visible star is a no-op'
  from public.set_saved_place_star(pg_temp.sid('a2'),pg_temp.rev('a2'),true);
insert into tap_results values (pg_temp.delta('a2')=0,'legacy no-op keeps revision');
reset role; select pg_temp.set_stars('1:a1,2:a2,3:a3,4:a4,5:a5,6:a6');
set local role authenticated; select pg_temp.snap();
select pg_temp.expect_error($q$select public.set_saved_place_star(pg_temp.sid('a7'),pg_temp.rev('a7'),true)$q$,'SAVED_PLACE_STAR_LIMIT','legacy star is limited to 1..5 even when 6..10 are free');
insert into tap_results values ((pg_temp.delta('a7')=0 and pg_temp.stars()='1:a1,2:a2,3:a3,4:a4,5:a5,6:a6'),'legacy star limit changes nothing');
reset role; select pg_temp.set_stars('1:a1,3:a3,7:a7');
set local role authenticated; select pg_temp.snap();
insert into tap_results select count(*)=1 and coalesce(bool_and(star_slot=2),false), 'legacy star on a hidden star moves it into free 1..5'
  from public.set_saved_place_star(pg_temp.sid('a7'),pg_temp.rev('a7'),true);
insert into tap_results values ((pg_temp.stars()='1:a1,2:a7,3:a3' and pg_temp.delta('a7')=1),'hidden star move is atomic and advances revision once');
reset role; select pg_temp.set_stars('1:a1,2:a2,3:a3,4:a4,5:a5,8:a8');
set local role authenticated; select pg_temp.snap();
select pg_temp.expect_error($q$select public.set_saved_place_star(pg_temp.sid('a8'),pg_temp.rev('a8'),true)$q$,'SAVED_PLACE_STAR_LIMIT','legacy move of a hidden star fails when 1..5 are full');
insert into tap_results values ((pg_temp.delta('a8')=0 and pg_temp.stars()='1:a1,2:a2,3:a3,4:a4,5:a5,8:a8'),'failed legacy move keeps the hidden star');
reset role; select pg_temp.set_stars('1:a1,4:a4,9:a9');
set local role authenticated; select pg_temp.snap();
insert into tap_results select count(*)=1 and coalesce(bool_and(star_slot is null),false), 'legacy unstar removes a visible star'
  from public.set_saved_place_star(pg_temp.sid('a4'),pg_temp.rev('a4'),false);
insert into tap_results values ((pg_temp.stars()='1:a1,9:a9' and pg_temp.delta('a4')=1),'legacy unstar advances revision once');
insert into tap_results select count(*)=1 and coalesce(bool_and(star_slot is null),false), 'legacy unstar of a hidden star is a no-op'
  from public.set_saved_place_star(pg_temp.sid('a9'),pg_temp.rev('a9'),false);
insert into tap_results select count(*)=1 and coalesce(bool_and(star_slot is null),false), 'legacy unstar of an unstarred place is a no-op'
  from public.set_saved_place_star(pg_temp.sid('a2'),pg_temp.rev('a2'),false);
insert into tap_results values ((pg_temp.stars()='1:a1,9:a9' and pg_temp.delta('a9')=0 and pg_temp.delta('a2')=0),'legacy no-op unstar keeps the hidden star and revisions');

-- Legacy save_place.
reset role; select pg_temp.set_stars('1:a1,2:a2');
set local role authenticated;
insert into tap_results select count(*)=1 and coalesce(bool_and(star_slot=3 and revision=1),false), 'legacy save with star takes 1..5'
  from public.save_place(pg_temp.place('o-new'),null,'riding_spot',true);
reset role; select pg_temp.set_stars('1:a1,2:a2,3:a3,4:a4,5:a5');
set local role authenticated;
select pg_temp.expect_error($q$select public.save_place(pg_temp.place('o-full'),null,'riding_spot',true)$q$,'SAVED_PLACE_STAR_LIMIT','legacy save star is limited to 1..5');
insert into tap_results values (pg_temp.sid('o-full') is null,'failed legacy save creates no row');
insert into tap_results select count(*)=1 and coalesce(bool_and(star_slot is null and alias is null and kind='riding_spot' and revision=1 and place=pg_temp.place('o-new')),false), 'legacy duplicate save returns the existing row unchanged'
  from public.save_place(jsonb_set(pg_temp.place('o-new'),'{name}','"다른 원본"'),'x','restaurant',true);

-- Legacy add_place_favorite / remove_place_favorite.
reset role; select pg_temp.set_stars('2:a2');
set local role authenticated; select pg_temp.snap();
insert into tap_results select count(*)=1 and coalesce(bool_and(slot=2 and place=pg_temp.place('a2')),false), 'legacy add on a 1..3 star returns the existing slot'
  from public.add_place_favorite(pg_temp.place('a2'));
insert into tap_results values (pg_temp.delta('a2')=0,'legacy add on an existing 1..3 star keeps revision');
reset role; select pg_temp.set_stars('4:a4');
set local role authenticated; select pg_temp.snap();
select pg_temp.expect_error($q$select public.add_place_favorite(pg_temp.place('a4'))$q$,'FAVORITE_LIMIT','legacy add on a 4..5 star keeps its limit error');
insert into tap_results values ((pg_temp.delta('a4')=0 and pg_temp.stars()='4:a4'),'legacy add limit on 4..5 changes nothing');
reset role; select pg_temp.set_stars('1:a1,6:a6');
set local role authenticated; select pg_temp.snap();
insert into tap_results select count(*)=1 and coalesce(bool_and(slot=2),false), 'legacy add moves a hidden star into free 1..3'
  from public.add_place_favorite(pg_temp.place('a6'));
insert into tap_results values ((pg_temp.stars()='1:a1,2:a6' and pg_temp.delta('a6')=1),'legacy add move advances revision once');
reset role; select pg_temp.set_stars('1:a1,3:a3');
set local role authenticated; select pg_temp.snap();
insert into tap_results select count(*)=1 and coalesce(bool_and(slot=2),false), 'legacy add stars an existing unstarred place in 1..3'
  from public.add_place_favorite(pg_temp.place('a5'));
insert into tap_results values ((pg_temp.stars()='1:a1,2:a5,3:a3' and pg_temp.delta('a5')=1),'legacy add on an existing place advances revision once');
reset role; select pg_temp.set_stars('1:a1,2:a2,3:a3,7:a7');
set local role authenticated; select pg_temp.snap();
select pg_temp.expect_error($q$select public.add_place_favorite(pg_temp.place('a7'))$q$,'FAVORITE_LIMIT','legacy add of a hidden star fails when 1..3 are full');
select pg_temp.expect_error($q$select public.add_place_favorite(pg_temp.place('a8'))$q$,'FAVORITE_LIMIT','legacy add of an unstarred place fails when 1..3 are full');
insert into tap_results values ((pg_temp.stars()='1:a1,2:a2,3:a3,7:a7' and pg_temp.delta('a7')=0 and pg_temp.delta('a8')=0),'legacy add limit keeps hidden star and revisions');
reset role; select pg_temp.set_stars('1:a1');
set local role authenticated;
insert into tap_results select count(*)=1 and coalesce(bool_and(slot=2),false), 'legacy add creates a new place in free 1..3'
  from public.add_place_favorite(pg_temp.place('o-fav'));
insert into tap_results select count(*)=1 and coalesce(bool_and(alias is null and revision=1 and star_position=2),false), 'legacy add new row has no alias and one star'
  from public.saved_place_entries where id=pg_temp.sid('o-fav');
reset role; select pg_temp.set_stars('1:a1,2:a2,3:a3');
set local role authenticated;
select pg_temp.expect_error($q$select public.add_place_favorite(pg_temp.place('o-fav2'))$q$,'FAVORITE_LIMIT','legacy add of a new place fails when 1..3 are full');
insert into tap_results values (pg_temp.sid('o-fav2') is null,'failed legacy add creates no row');
reset role; select pg_temp.set_stars('2:a2,7:a7');
set local role authenticated; select pg_temp.snap();
select pg_temp.expect_error($q$select public.remove_place_favorite(1::smallint,'a2')$q$,'FAVORITE_NOT_FOUND','legacy remove with the wrong slot is not found');
select pg_temp.expect_error($q$select public.remove_place_favorite(2::smallint,'a3')$q$,'FAVORITE_NOT_FOUND','legacy remove with the wrong place is not found');
select pg_temp.expect_error($q$select public.remove_place_favorite(3::smallint,'a7')$q$,'FAVORITE_NOT_FOUND','legacy remove cannot address a hidden star');
select pg_temp.expect_error($q$select public.remove_place_favorite(4::smallint,'a2')$q$,'FAVORITE_NOT_FOUND','legacy remove outside 1..3 is not found');
insert into tap_results values ((pg_temp.stars()='2:a2,7:a7' and pg_temp.delta('a2')=0 and pg_temp.delta('a7')=0),'failed legacy removes change nothing');
select public.remove_place_favorite(2::smallint,'a2');
insert into tap_results values ((pg_temp.stars()='7:a7' and pg_temp.delta('a2')=1),'legacy remove deletes the exact star and advances revision once');
reset role;
set constraints all immediate; set constraints all deferred;

-- Old-client reads with ten stars.
select pg_temp.set_stars('1:a1,2:a2,3:a3,4:a4,5:a5,6:a6,7:a7,8:a8,9:a9,10:a10');
set local role authenticated;
insert into tap_results select count(star_slot)=5 and coalesce(bool_and(star_slot between 1 and 5),true) and count(distinct star_slot)=count(star_slot),
  'legacy saved_places select still satisfies the old parser (at most five, 1..5, unique)'
  from public.saved_places;
insert into tap_results select coalesce(array_agg(slot order by slot)='{1,2,3}',false), 'three-slot compatibility view still exposes only 1..3'
  from public.place_favorites;
insert into tap_results select count(*) filter (where star_position is not null)=10
  and coalesce(bool_and(star_slot is not distinct from case when star_position<=5 then star_position end),false)
  and count(*)=(select count(*) from public.saved_places),
  'one view read returns every place with a consistent star position and mirror'
  from public.saved_place_entries;
reset role;
insert into tap_results values
((select pg_get_function_result('public.save_place(jsonb,text,text,boolean)'::regprocedure)='SETOF saved_places'),'legacy save_place keeps its return shape'),
((select pg_get_function_result('public.set_saved_place_star(uuid,bigint,boolean)'::regprocedure)='SETOF saved_places'),'legacy set_saved_place_star keeps its return shape'),
((select pg_get_function_result('public.update_saved_place(uuid,bigint,text,text)'::regprocedure)='SETOF saved_places'),'update_saved_place keeps its return shape'),
((select pg_get_function_result('public.add_place_favorite(jsonb)'::regprocedure)='TABLE(slot smallint, place jsonb, created_at timestamp with time zone)'),'legacy add_place_favorite keeps its return shape'),
((select pg_get_function_result('public.remove_place_favorite(smallint,text)'::regprocedure)='void'),'legacy remove_place_favorite keeps its return shape'),
((select pg_get_function_result('public.save_place_v2(jsonb,text,text,boolean)'::regprocedure)='SETOF saved_place_entries'),'save_place_v2 returns view rows'),
((select pg_get_function_result('public.set_place_star(uuid,bigint,boolean)'::regprocedure)='SETOF saved_place_entries'),'set_place_star returns view rows');

-- An old RPC body that waited on the migration lock writes star_slot directly; the
-- saved_places trigger reflects it into place_stars.
select pg_temp.set_stars('1:a1,7:a7');
update public.saved_places set star_slot=2 where id=pg_temp.sid('a2');
insert into tap_results values (pg_temp.stars()='1:a1,2:a2,7:a7','direct legacy star write is reflected into place_stars');
update public.saved_places set star_slot=3 where id=pg_temp.sid('a7');
insert into tap_results values (pg_temp.stars()='1:a1,2:a2,3:a7','direct legacy star on a hidden star moves it');
update public.saved_places set star_slot=null where id=pg_temp.sid('a2');
insert into tap_results values (pg_temp.stars()='1:a1,3:a7','direct legacy unstar removes only the visible star');
insert into public.saved_places(owner_id,place,province,star_slot) values ('97000000-0000-0000-0000-000000000001',pg_temp.place('direct-insert'),'경기',4);
insert into tap_results values (pg_temp.stars()='1:a1,3:a7,4:direct-insert','direct legacy insert with a star is reflected');
select pg_temp.expect_state($q$update public.saved_places set star_slot=1 where id=pg_temp.sid('a3')$q$,'23505','direct legacy write cannot take an occupied slot');
insert into tap_results values ((pg_temp.stars()=pg_temp.mirror() and pg_temp.stars()='1:a1,3:a7,4:direct-insert'),'mirror equals stars after direct legacy writes');
set constraints all immediate; set constraints all deferred;

-- A failure between the star write and its mirror rolls back the whole call.
create function public.test_frequent_forced_failure() returns trigger language plpgsql as $$ begin raise exception 'FORCED_MIRROR_FAILURE'; end $$;
create trigger test_frequent_forced_failure before update of star_slot on public.saved_places
  for each row when (new.place->>'kakaoPlaceId'='a11') execute function public.test_frequent_forced_failure();
set local role authenticated; select pg_temp.snap();
select pg_temp.expect_error($q$select public.set_place_star(pg_temp.sid('a11'),pg_temp.rev('a11'),true)$q$,'FORCED_MIRROR_FAILURE','forced mirror failure aborts the star call');
insert into tap_results values ((pg_temp.stars()='1:a1,3:a7,4:direct-insert' and pg_temp.delta('a11')=0),'forced mirror failure leaves no star and no revision change');
reset role;
drop trigger test_frequent_forced_failure on public.saved_places;
drop function public.test_frequent_forced_failure();

-- The commit-time check rejects a star whose mirror was skipped. Replica mode writes
-- the star without triggers; a no-op owner update then queues the owner check.
savepoint skipped_mirror;
set local session_replication_role = replica;
insert into public.place_stars(owner_id,slot,saved_place_id) values ('97000000-0000-0000-0000-000000000001',5,pg_temp.sid('a12'));
set local session_replication_role = origin;
update public.saved_places set owner_id=owner_id where id=pg_temp.sid('a11');
select pg_temp.expect_error('set constraints all immediate','SAVED_PLACE_STAR_INVARIANT','deferred check rejects a missing mirror');
rollback to savepoint skipped_mirror;
insert into tap_results values ((pg_temp.stars()='1:a1,3:a7,4:direct-insert'),'skipped-mirror fixture is rolled back');

-- Region-only map points require an alias.
select pg_temp.set_stars('');
set local role authenticated; select pg_temp.snap();
select pg_temp.expect_error($q$select public.save_place_v2(pg_temp.place('map:37.0000000:127.0000000:region'),null,'riding_spot',false)$q$,'INVALID_SAVED_PLACE_METADATA','save_place_v2 rejects a region point without alias');
select pg_temp.expect_error($q$select public.save_place(pg_temp.place('map:37.0000000:127.0000000:region'))$q$,'INVALID_SAVED_PLACE_METADATA','legacy save_place rejects a region point without alias');
select pg_temp.expect_error($q$select public.add_place_favorite(pg_temp.place('map:37.0000000:127.0000000:region'))$q$,'INVALID_FAVORITE_PLACE','legacy add rejects a new region point');
insert into tap_results values (pg_temp.sid('map:37.0000000:127.0000000:region') is null,'rejected region saves create no row');
insert into tap_results select count(*)=1 and coalesce(bool_and(alias='산 중턱 쉼터' and star_position=1),false), 'region point with alias is saved'
  from public.save_place_v2(pg_temp.place('map:37.0000000:127.0000000:region'),'산 중턱 쉼터','riding_spot',true);
select pg_temp.snap();
select pg_temp.expect_error($q$select public.update_saved_place(pg_temp.sid('map:37.0000000:127.0000000:region'),pg_temp.rev('map:37.0000000:127.0000000:region'),null,'riding_spot')$q$,'INVALID_SAVED_PLACE_METADATA','update rejects removing a region alias');
insert into tap_results values (pg_temp.delta('map:37.0000000:127.0000000:region')=0,'rejected alias removal changes nothing');
select public.update_saved_place(pg_temp.sid('map:37.0000000:127.0000000:region'),pg_temp.rev('map:37.0000000:127.0000000:region'),'새 쉼터 별명','restaurant');
insert into tap_results select count(*)=1 and coalesce(bool_and(alias='새 쉼터 별명' and kind='restaurant' and place=pg_temp.place('map:37.0000000:127.0000000:region') and place->>'kakaoPlaceId' like '%:region'),false), 'region point re-read keeps its id suffix, original and alias'
  from public.saved_place_entries where id=pg_temp.sid('map:37.0000000:127.0000000:region');
insert into tap_results select count(*)=1 and coalesce(bool_and(star_position is null),false), 'address map point without alias is still accepted'
  from public.save_place_v2(pg_temp.place('map:37.1000000:127.1000000'));
select public.set_place_star(pg_temp.sid('map:37.0000000:127.0000000:region'),pg_temp.rev('map:37.0000000:127.0000000:region'),false);
insert into tap_results select count(*)=1 and coalesce(bool_and(slot=1),false), 'legacy add may star an existing aliased region point'
  from public.add_place_favorite(pg_temp.place('map:37.0000000:127.0000000:region'));
reset role;
set constraints all immediate; set constraints all deferred;

-- Saved-place limit applies to save_place_v2 and its duplicate retry.
insert into public.saved_places(owner_id,place,province)
select '97000000-0000-0000-0000-000000000002',pg_temp.place('lim-'||n),'경기' from generate_series(1,1000) n;
insert into saved_ids select place->>'kakaoPlaceId', id from public.saved_places where owner_id='97000000-0000-0000-0000-000000000001' and place->>'kakaoPlaceId' in ('a1','a2');
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select pg_temp.expect_error($q$select public.save_place_v2(pg_temp.place('lim-1001'))$q$,'SAVED_PLACE_LIMIT','save_place_v2 rejects the one thousand and first place');
insert into tap_results select count(*)=1 and coalesce(bool_and(revision=1 and star_position is null),false), 'save_place_v2 duplicate succeeds unchanged at the limit'
  from public.save_place_v2(pg_temp.place('lim-1'),'retry','restaurant',true);
insert into tap_results select count(*)=1 and coalesce(bool_and(star_position=1),false), 'starring an existing place works at the saved-place limit'
  from public.set_place_star((select id from public.saved_places where place->>'kakaoPlaceId'='lim-1'),1,true);
-- Rider B cannot see or change rider A.
insert into tap_results values
((select count(*)=0 from public.place_stars where owner_id='97000000-0000-0000-0000-000000000001'),'another rider cannot read stars'),
((select count(*)=0 from public.saved_place_entries where owner_id='97000000-0000-0000-0000-000000000001'),'another rider cannot read entries');
select pg_temp.expect_error($q$select public.set_place_star((select id from saved_ids where k='a1'),1,true)$q$,'SAVED_PLACE_NOT_FOUND','cross-user star change is not found');
select pg_temp.expect_error($q$select public.set_saved_place_star((select id from saved_ids where k='a2'),1,true)$q$,'SAVED_PLACE_NOT_FOUND','cross-user legacy star change is not found');
reset role;

-- Role matrix.
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000003',true);
set local role authenticated;
insert into tap_results values ((select count(*)=0 from public.place_stars) and (select count(*)=0 from public.saved_place_entries),'revoked member reads nothing');
select pg_temp.expect_error($q$select public.save_place_v2(pg_temp.place('revoked'))$q$,'MEMBERSHIP_REQUIRED','revoked member cannot save');
select pg_temp.expect_error($q$select public.set_place_star((select id from saved_ids where k='a1'),1,true)$q$,'MEMBERSHIP_REQUIRED','revoked member cannot star');
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000004',true);
set local role authenticated;
insert into tap_results values ((select count(*)=0 from public.place_stars) and (select count(*)=0 from public.saved_place_entries),'non-member reads nothing');
select pg_temp.expect_error($q$select public.save_place_v2(pg_temp.place('nonmember'))$q$,'MEMBERSHIP_REQUIRED','non-member cannot save');
select pg_temp.expect_error($q$select public.set_place_star((select id from saved_ids where k='a1'),1,true)$q$,'MEMBERSHIP_REQUIRED','non-member cannot star');
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000005',true);
set local role authenticated;
insert into tap_results values ((select count(*)=0 from public.place_stars) and (select count(*)=0 from public.saved_place_entries),'administrator cannot read other accounts');
insert into tap_results select count(*)=1 and coalesce(bool_and(star_position=1),false), 'administrator manages own stars' from public.save_place_v2(pg_temp.place('admin'),null,'riding_spot',true);
select pg_temp.expect_error($q$insert into public.place_stars(owner_id,slot,saved_place_id) select owner_id,2,id from public.saved_places$q$,'permission denied for table place_stars','authenticated direct star insert denied','42501');
select pg_temp.expect_error($q$update public.place_stars set slot=3$q$,'permission denied for table place_stars','authenticated direct star update denied','42501');
select pg_temp.expect_error($q$delete from public.place_stars$q$,'permission denied for table place_stars','authenticated direct star delete denied','42501');
select pg_temp.expect_error($q$delete from public.saved_place_entries$q$,'cannot delete from view "saved_place_entries"','authenticated direct view write denied (join view is not updatable)','55000');
reset role;
set local role anon;
select pg_temp.expect_error($q$select * from public.place_stars$q$,'permission denied for table place_stars','anonymous star read denied','42501');
select pg_temp.expect_error($q$select * from public.saved_place_entries$q$,'permission denied for view saved_place_entries','anonymous entry read denied','42501');
select pg_temp.expect_error($q$select public.save_place_v2(pg_temp.place('anon'))$q$,'permission denied for function save_place_v2','anonymous save_place_v2 denied','42501');
select pg_temp.expect_error($q$select public.set_place_star(gen_random_uuid(),1,true)$q$,'permission denied for function set_place_star','anonymous set_place_star denied','42501');
reset role;
set local role service_role;
select pg_temp.expect_error($q$select * from public.place_stars$q$,'permission denied for table place_stars','service-role star read denied','42501');
select pg_temp.expect_error($q$insert into public.place_stars(owner_id,slot,saved_place_id) values ('97000000-0000-0000-0000-000000000001',9,gen_random_uuid())$q$,'permission denied for table place_stars','service-role star insert denied','42501');
select pg_temp.expect_error($q$update public.place_stars set slot=9$q$,'permission denied for table place_stars','service-role star update denied','42501');
select pg_temp.expect_error($q$delete from public.place_stars$q$,'permission denied for table place_stars','service-role star delete denied','42501');
select pg_temp.expect_error($q$select * from public.saved_place_entries$q$,'permission denied for view saved_place_entries','service-role entry read denied','42501');
select pg_temp.expect_error($q$select public.save_place_v2(pg_temp.place('service'))$q$,'permission denied for function save_place_v2','service-role save_place_v2 denied','42501');
select pg_temp.expect_error($q$select public.set_place_star(gen_random_uuid(),1,true)$q$,'permission denied for function set_place_star','service-role set_place_star denied','42501');
reset role;

-- Function and object properties.
with rpc(signature) as (values
  ('public.save_place(jsonb,text,text,boolean)'),('public.save_place_v2(jsonb,text,text,boolean)'),
  ('public.update_saved_place(uuid,bigint,text,text)'),('public.set_place_star(uuid,bigint,boolean)'),
  ('public.set_saved_place_star(uuid,bigint,boolean)'),('public.add_place_favorite(jsonb)'),('public.remove_place_favorite(smallint,text)'))
insert into tap_results select
  proc.prosecdef and proc.proconfig @> array['search_path=""'] and has_function_privilege('authenticated',proc.oid,'EXECUTE')
  and not has_function_privilege('anon',proc.oid,'EXECUTE') and not has_function_privilege('service_role',proc.oid,'EXECUTE'),
  format('%s is definer, empty search_path, authenticated-only',rpc.signature)
from rpc join pg_proc proc on proc.oid=rpc.signature::regprocedure;
with internal(signature) as (values
  ('public.place_stars_consistent(uuid)'),('public.place_stars_sync_mirror()'),('public.saved_places_sync_stars()'),
  ('public.assert_place_stars_consistent()'),('public.is_region_saved_place(jsonb)'))
insert into tap_results select
  proc.proconfig @> array['search_path=""'] and not has_function_privilege('authenticated',proc.oid,'EXECUTE')
  and not has_function_privilege('anon',proc.oid,'EXECUTE') and not has_function_privilege('service_role',proc.oid,'EXECUTE'),
  format('%s has empty search_path and no client execute',internal.signature)
from internal join pg_proc proc on proc.oid=internal.signature::regprocedure;
insert into tap_results values
((select bool_and(prosecdef) from pg_proc where oid in ('public.place_stars_consistent(uuid)'::regprocedure,'public.place_stars_sync_mirror()'::regprocedure,'public.saved_places_sync_stars()'::regprocedure,'public.assert_place_stars_consistent()'::regprocedure)),'star triggers do not depend on the committing role'),
((select count(*)=14 from pg_proc proc join pg_namespace ns on ns.oid=proc.pronamespace where ns.nspname='public' and has_function_privilege('service_role',proc.oid,'EXECUTE')),'service role still executes exactly fourteen public functions'),
((select relrowsecurity from pg_class where oid='public.place_stars'::regclass),'place_stars has RLS'),
((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.saved_place_entries'::regclass),'saved_place_entries uses caller security'),
((not has_table_privilege('service_role','public.place_stars','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),'service role has no place_stars privilege'),
((not has_table_privilege('authenticated','public.place_stars','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),'authenticated has only select on place_stars'),
((not has_table_privilege('anon','public.saved_place_entries','SELECT')),'anonymous has no entry select'),
((not has_table_privilege('authenticated','public.saved_place_entries','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),'authenticated has only select on saved_place_entries'),
((select condeferrable and condeferred from pg_constraint where conname='place_stars_z_check_invariants' and conrelid='public.place_stars'::regclass),'place_stars invariant check is deferred'),
((select condeferrable and condeferred from pg_constraint where conname='saved_places_z_check_star_invariants' and conrelid='public.saved_places'::regclass),'saved_places invariant check is deferred'),
((exists(select 1 from pg_constraint where conrelid='public.saved_places'::regclass and conname='saved_places_star_slot_check' and pg_get_constraintdef(oid) like '%star_slot >= 1%star_slot <= 5%')),'legacy 1..5 check is kept'),
((select indisunique from pg_index where indexrelid='public.saved_places_owner_star_slot_key'::regclass),'legacy unique star slot index is kept');

set constraints all immediate;
select (case when ok then 'ok ' else 'not ok ' end)||row_number() over()||' - '||description from tap_results;
select '1..'||count(*) from tap_results;
-- Fixed plan: a skipped or row-less assertion fails the suite instead of vanishing.
do $$ begin
  if (select count(*) from tap_results)<>146 then raise exception 'FREQUENT_PLACES_PLAN_MISMATCH: % of 146', (select count(*) from tap_results); end if;
  if exists(select 1 from tap_results where not ok) then raise exception 'FREQUENT_PLACES_TEST_FAILED'; end if;
end $$;
rollback;
