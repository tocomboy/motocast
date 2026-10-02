\set ON_ERROR_STOP on

-- Run on a new isolated baseline-schema database before saved_places migration.
-- This test deliberately preserves its synthetic rows for migration readback.
do $$ begin
  if current_database() not like 'motocast_saved_places_%' then raise exception 'DISPOSABLE_SAVED_PLACES_DATABASE_REQUIRED'; end if;
  if (select relkind from pg_class where oid = 'public.place_favorites'::regclass) <> 'r' then raise exception 'LEGACY_FAVORITES_BASELINE_REQUIRED'; end if;
end $$;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000','98000000-0000-0000-0000-000000000099','authenticated','authenticated','saved-migration@motocast.test','',now(),now(),now(),'{}','{}');
insert into public.memberships(user_id,role) values ('98000000-0000-0000-0000-000000000099','rider');
insert into public.place_favorites(owner_id,slot,place,created_at)
select '98000000-0000-0000-0000-000000000099',n,
  jsonb_build_object('kakaoPlaceId','legacy-'||n,'verificationToken',repeat('a',43),'name','원본 '||n,
    'address',case n when 1 then '경기도 양평군 테스트' when 2 then '강원특별자치도 춘천시 테스트' else '지역을 알 수 없는 기존 주소' end,
    'roadAddress',null,'longitude',127,'latitude',37), '2026-09-01T01:02:03Z'::timestamptz
from generate_series(1,3) n;
create temp table migration_original as select * from public.place_favorites;

\ir ../../migrations/20261002094511_saved_places.sql

create temp table tap_results(ok boolean not null, description text not null);
insert into tap_results values
((select count(*)=3 from public.saved_places where owner_id='98000000-0000-0000-0000-000000000099'),'all legacy favorites become canonical saved places'),
((select bool_and(saved.place=original.place and saved.created_at=original.created_at and saved.star_slot=original.slot)
  from migration_original original join public.saved_places saved on saved.owner_id=original.owner_id and saved.star_slot=original.slot),'migration preserves original JSON, time and stars'),
((select bool_and(id is not null and revision=1 and alias is null and kind='riding_spot') from public.saved_places),'legacy rows receive canonical identity without inventing an alias'),
((select province='경기' from public.saved_places where place->>'kakaoPlaceId'='legacy-1'),'legacy full province name is normalized'),
((select province='강원' from public.saved_places where place->>'kakaoPlaceId'='legacy-2'),'new province name is normalized'),
((select province is null from public.saved_places where place->>'kakaoPlaceId'='legacy-3'),'unknown legacy province remains null'),
((select count(*)=3 from public.place_favorites),'legacy three-slot read shape remains available');
create temp table migration_after as select * from public.saved_places;

\ir ../../migrations/20261002094511_saved_places.sql

insert into tap_results values
((not exists ((select * from public.saved_places except select * from migration_after) union all (select * from migration_after except select * from public.saved_places))),'migration reapply preserves every row and ID'),
((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.place_favorites'::regclass),'compatibility view uses caller security'),
((select relrowsecurity from pg_class where oid='public.saved_places'::regclass),'canonical table retains RLS');
select (case when ok then 'ok ' else 'not ok ' end)||row_number() over()||' - '||description from tap_results;
select '1..'||count(*) from tap_results;
do $$ begin if exists(select 1 from tap_results where not ok) then raise exception 'SAVED_PLACES_MIGRATION_TEST_FAILED'; end if; end $$;
