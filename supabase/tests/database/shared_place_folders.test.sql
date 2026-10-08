\set ON_ERROR_STOP on
-- Issue #124 rollback-only suite: folders, members, invites, shared places, shared
-- stars, avoided places, preferences and the recommendation read. Role matrix, limit
-- boundaries, cleanup rules, revisions, existence hiding and ACLs. Run on an isolated
-- local database after 20261009120000_shared_place_folders.sql. Deferred checks are
-- flushed at checkpoints with SET CONSTRAINTS ALL IMMEDIATE because nothing commits.
begin;
create temp table tap_results(ok boolean not null, description text not null) on commit drop;
create temp table res(k text primary key, j jsonb) on commit drop;
grant select,insert,delete,update on tap_results, res to authenticated,anon,service_role;

create function pg_temp.u(n integer) returns uuid language sql immutable as $$ select ('94000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.place(k text, lat numeric default 37, lng numeric default 127, address text default '경기도 양평군 테스트') returns jsonb language sql immutable as $$
select jsonb_build_object('kakaoPlaceId',k,'verificationToken',repeat('a',43),'name','원본 '||k,'address',address,'roadAddress',null,'longitude',lng,'latitude',lat)
$$;
create function pg_temp.sub(n integer) returns void language sql as $$ select set_config('request.jwt.claim.sub',pg_temp.u(n)::text,true) $$;
create function pg_temp.r(key text) returns jsonb language sql stable as $$ select j from res where k=key $$;
create function pg_temp.fid(key text) returns uuid language sql stable as $$ select (j->'folder'->>'id')::uuid from res where k=key $$;
create function pg_temp.expect_error(statement text, expected_message text, description text, expected_state text default 'P0001') returns void language plpgsql as $$
begin
  execute statement;
  insert into tap_results values(false,description||' (no error)');
exception when others then
  insert into tap_results values(sqlstate=expected_state and sqlerrm=expected_message,description||case when sqlerrm=expected_message then '' else ' (got '||sqlerrm||')' end);
end $$;
-- Privileged lookups (definer = the superuser running the suite) that ignore RLS.
create function pg_temp.saved(n integer, k text) returns uuid language sql stable security definer as $$
  select id from public.saved_places where owner_id=pg_temp.u(n) and place->>'kakaoPlaceId'=k
$$;
create function pg_temp.shared(folder uuid, k text) returns uuid language sql stable security definer as $$
  select id from public.shared_places where folder_id=folder and place->>'kakaoPlaceId'=k
$$;
create function pg_temp.shared_rev(id uuid) returns bigint language sql stable security definer as $$ select revision from public.shared_places where shared_places.id=$1 $$;
create function pg_temp.member_rev(folder uuid, n integer) returns bigint language sql stable security definer as $$
  select revision from public.place_folder_members where folder_id=folder and member_id=pg_temp.u(n)
$$;
create function pg_temp.place_total(folder uuid) returns bigint language sql stable security definer as $$ select count(*) from public.shared_places where folder_id=folder $$;
create function pg_temp.folder_rev(folder uuid) returns bigint language sql stable security definer as $$ select revision from public.place_folders where id=folder $$;
create function pg_temp.star_total(n integer) returns bigint language sql stable security definer as $$
  select (select count(*) from public.place_stars where owner_id=pg_temp.u(n))+(select count(*) from public.shared_place_stars where owner_id=pg_temp.u(n))
$$;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000',pg_temp.u(n),'authenticated','authenticated','folders-'||n||'@motocast.test','',now(),now(),now(),'{}','{}'
from generate_series(1,45) n;
-- 1 owner A, 2 editor B, 3 viewer C, 4 active non-member D, 5 member later revoked,
-- 6 administrator, 7 twenty-folder rider, 8 no membership row, 10..44 fillers.
insert into public.memberships(user_id,role) select pg_temp.u(n),(case when n=6 then 'admin' else 'rider' end)::public.member_role from generate_series(1,45) n where n<>8;
insert into public.profiles(id,nickname) select pg_temp.u(n),'카카오닉네임'||n from generate_series(1,6) n on conflict do nothing;
insert into public.saved_places(owner_id,place,alias,kind,province)
select pg_temp.u(1),pg_temp.place('s'||n),case when n=1 then '첫 별명' end,case when n%2=0 then 'restaurant' else 'riding_spot' end,'경기' from generate_series(1,12) n;
insert into public.saved_places(owner_id,place,alias,kind,province) values
(pg_temp.u(1),pg_temp.place('map:37.1000000:127.1000000:region'),'산 중턱','riding_spot',null),
(pg_temp.u(2),pg_temp.place('b1'),null,'restaurant','경기');

-- 1. Creating a folder copies the chosen own places unchanged.
select pg_temp.sub(1); set local role authenticated;
insert into res select 'F1', public.create_place_folder('우리 폴더','Ace',array[pg_temp.saved(1,'s1'),pg_temp.saved(1,'s2'),pg_temp.saved(1,'map:37.1000000:127.1000000:region')],gen_random_uuid());
insert into tap_results values
((pg_temp.r('F1')->'folder'->>'name')='우리 폴더' and (pg_temp.r('F1')->'folder'->>'revision')='1' and (pg_temp.r('F1')->'folder'->>'owner_id')=pg_temp.u(1)::text,'create returns the folder'),
((pg_temp.r('F1')->'member')=jsonb_build_object('folder_id',pg_temp.fid('F1'),'member_id',pg_temp.u(1),'role','owner','display_name','Ace','joined_at',pg_temp.r('F1')->'member'->'joined_at','revision',1),'create returns exactly the six member fields with role owner'),
((pg_temp.r('F1')->'preference'->>'enabled')='true','a new folder starts enabled'),
((select count(*)=3 from public.shared_places where folder_id=pg_temp.fid('F1')),'three chosen places are copied');
insert into tap_results select count(*)=3 and bool_and(shared.place=saved.place and shared.alias is not distinct from saved.alias and shared.kind=saved.kind
  and shared.province is not distinct from saved.province and shared.created_by=pg_temp.u(1) and shared.updated_by=pg_temp.u(1) and shared.revision=1),
  'copies keep the original place with its signature, alias, kind and province'
  from public.shared_places shared join public.saved_places saved on saved.owner_id=pg_temp.u(1) and saved.place->>'kakaoPlaceId'=shared.place->>'kakaoPlaceId'
  where shared.folder_id=pg_temp.fid('F1');
-- 1b. One request id makes one folder: a replay returns the stored result, another input is refused.
insert into res select 'RQ1', public.create_place_folder('요청 폴더','Ace',array[pg_temp.saved(1,'s4')],'95000000-0000-0000-0000-000000000001');
insert into res select 'RQ1b', public.create_place_folder('요청 폴더','Ace',array[pg_temp.saved(1,'s4')],'95000000-0000-0000-0000-000000000001');
insert into tap_results values
(pg_temp.r('RQ1b')=pg_temp.r('RQ1'),'a replay of the same request returns the stored result unchanged'),
((select count(*)=1 from public.place_folders where owner_id=pg_temp.u(1) and name='요청 폴더'),'a replayed request creates one folder'),
((select count(*)=1 from public.shared_places where folder_id=pg_temp.fid('RQ1')),'a replayed request copies the places once'),
((pg_temp.r('RQ1')->'folder'->>'create_request_id')='95000000-0000-0000-0000-000000000001','the folder carries its create request id'),
((select create_request_id from public.place_folders where id=pg_temp.fid('RQ1'))='95000000-0000-0000-0000-000000000001'::uuid,'the owner reads the create request id back from the folder list');
select pg_temp.expect_error($q$select public.create_place_folder('다른 이름','Ace',array[pg_temp.saved(1,'s4')],'95000000-0000-0000-0000-000000000001')$q$,'PLACE_FOLDER_REQUEST_MISMATCH','another name under the same request id is refused');
select pg_temp.expect_error($q$select public.create_place_folder('요청 폴더','Ace','{}','95000000-0000-0000-0000-000000000001')$q$,'PLACE_FOLDER_REQUEST_MISMATCH','other places under the same request id are refused');
select pg_temp.expect_error($q$select public.create_place_folder('요청 폴더','Ace','{}',null)$q$,'INVALID_PLACE_FOLDER','a missing request id is rejected');
select pg_temp.expect_error($q$select public.create_place_folder('요청 폴더','Ace2',array[pg_temp.saved(1,'s4')],'95000000-0000-0000-0000-000000000001')$q$,'PLACE_FOLDER_REQUEST_MISMATCH','another folder-only name under the same request id is refused');
insert into res select 'RQ3', public.create_place_folder('순서 폴더','Ace',array[pg_temp.saved(1,'s5'),pg_temp.saved(1,'s7')],'95000000-0000-0000-0000-000000000003');
insert into tap_results values
(public.create_place_folder('순서 폴더','Ace',array[pg_temp.saved(1,'s7'),pg_temp.saved(1,'s5')],'95000000-0000-0000-0000-000000000003')=pg_temp.r('RQ3'),'the same places in another order are the same request'),
((select count(*)=1 from public.place_folders where owner_id=pg_temp.u(1) and name='순서 폴더'),'reordered ids make no second folder');
select pg_temp.expect_error($q$select * from public.place_folder_create_requests$q$,'permission denied for table place_folder_create_requests','request records are not readable by riders','42501');
reset role;
select pg_temp.sub(2); set local role authenticated;
insert into res select 'RQ2', public.create_place_folder('요청 폴더','Bee','{}','95000000-0000-0000-0000-000000000001');
insert into tap_results values
(pg_temp.fid('RQ2')<>pg_temp.fid('RQ1'),'another rider''s same request id is independent');
reset role;
-- The request folders are not part of the scenarios below.
delete from public.place_folders where id in (pg_temp.fid('RQ1'),pg_temp.fid('RQ2'),pg_temp.fid('RQ3'));
-- A replay after the folder was deleted returns the stored result and does not recreate it.
select pg_temp.sub(1); set local role authenticated;
insert into tap_results values
(public.create_place_folder('요청 폴더','Ace',array[pg_temp.saved(1,'s4')],'95000000-0000-0000-0000-000000000001')=pg_temp.r('RQ1'),'a replay after the folder was deleted returns the stored result'),
((select count(*)=0 from public.place_folders where owner_id=pg_temp.u(1) and name='요청 폴더'),'a replay after deletion does not recreate the folder');
reset role;
select pg_temp.sub(1); set local role authenticated;
insert into res select 'F2', public.create_place_folder(repeat('가',40),repeat('나',20),'{}',gen_random_uuid());
insert into tap_results values
((select count(*)=0 from public.shared_places where folder_id=pg_temp.fid('F2')),'an empty folder is allowed, with 40-character name and 20-character display name');
select pg_temp.expect_error($q$select public.create_place_folder('x','Ace',array[pg_temp.saved(2,'b1')],gen_random_uuid())$q$,'SAVED_PLACE_NOT_FOUND','another rider''s place cannot be copied');
select pg_temp.expect_error($q$select public.create_place_folder('x','Ace',array[gen_random_uuid()],gen_random_uuid())$q$,'SAVED_PLACE_NOT_FOUND','an unknown place cannot be copied');
select pg_temp.expect_error($q$select public.create_place_folder('x','Ace',array[pg_temp.saved(1,'s3'),pg_temp.saved(1,'s3')],gen_random_uuid())$q$,'INVALID_PLACE_FOLDER','duplicate ids reject the whole folder');
select pg_temp.expect_error($q$select public.create_place_folder('x','Ace',null,gen_random_uuid())$q$,'INVALID_PLACE_FOLDER','a null id list is rejected');
select pg_temp.expect_error($q$select public.create_place_folder('x','Ace',array[null::uuid],gen_random_uuid())$q$,'INVALID_PLACE_FOLDER','a null id is rejected');
select pg_temp.expect_error($q$select public.create_place_folder('x','Ace',(select array_agg(gen_random_uuid()) from generate_series(1,1001)),gen_random_uuid())$q$,'PLACE_FOLDER_PLACE_LIMIT','more than 1,000 places is rejected');
select pg_temp.expect_error($q$select public.create_place_folder(repeat('가',41),'Ace','{}',gen_random_uuid())$q$,'INVALID_PLACE_FOLDER','a 41-character name is rejected');
select pg_temp.expect_error($q$select public.create_place_folder('',  'Ace','{}',gen_random_uuid())$q$,'INVALID_PLACE_FOLDER','an empty name is rejected');
select pg_temp.expect_error($q$select public.create_place_folder(' 폴더','Ace','{}',gen_random_uuid())$q$,'INVALID_PLACE_FOLDER','an untrimmed name is rejected');
select pg_temp.expect_error($q$select public.create_place_folder(E'폴\n더','Ace','{}',gen_random_uuid())$q$,'INVALID_PLACE_FOLDER','a control character in the name is rejected');
select pg_temp.expect_error($q$select public.create_place_folder('폴더',repeat('나',21),'{}',gen_random_uuid())$q$,'INVALID_FOLDER_DISPLAY_NAME','a 21-character display name is rejected');
select pg_temp.expect_error($q$select public.create_place_folder('폴더','Ace ','{}',gen_random_uuid())$q$,'INVALID_FOLDER_DISPLAY_NAME','an untrimmed display name is rejected');
insert into tap_results values ((select count(*)=2 from public.place_folders),'rejected creations leave no folder');
reset role;

-- 2. Invites: hash-only storage, preview, accept order and idempotency.
select pg_temp.sub(1); set local role authenticated;
insert into res select 'I1', public.create_place_folder_invite(pg_temp.fid('F1'));
reset role;
insert into tap_results values
((pg_temp.r('I1')->>'token') ~ '^[A-Za-z0-9_-]{43}$','the raw token is 43 base64url characters (32 random bytes)'),
((select token_hash=encode(extensions.digest(pg_temp.r('I1')->>'token','sha256'),'hex') and expires_at=created_at+interval '7 days' and revoked_at is null
  from public.place_folder_invites where id=(pg_temp.r('I1')->>'id')::uuid),'only the SHA-256 hex hash is stored and the link expires after seven days'),
((select (pg_temp.r('I1')->>'expires_at')::timestamptz=expires_at from public.place_folder_invites where id=(pg_temp.r('I1')->>'id')::uuid),'the response carries the stored expiry'),
((select count(*)=0 from public.place_folder_invites invite where row_to_json(invite)::text like '%'||(pg_temp.r('I1')->>'token')||'%'),'no stored invite column contains the raw token'),
((select array_agg(jsonb_object_keys order by jsonb_object_keys)=array['expires_at','id','token'] from jsonb_object_keys(pg_temp.r('I1'))),'create invite returns exactly id, token and expires_at');
select pg_temp.sub(2); set local role authenticated;
insert into res select 'P1', public.preview_place_folder_invite(pg_temp.r('I1')->>'token');
insert into tap_results values
(pg_temp.r('P1')=jsonb_build_object('status','joinable','folder_name','우리 폴더','owner_display_name','Ace','member_count',1,'place_count',pg_temp.place_total(pg_temp.fid('F1'))) and (pg_temp.r('P1')->>'place_count')::int>0,'a non-member preview shows the folder name, the owner folder name and the member and place counts only');
insert into res select 'A1', public.accept_place_folder_invite(pg_temp.r('I1')->>'token','Bee');
insert into tap_results values
((pg_temp.r('A1')->>'status')='joined' and (pg_temp.r('A1')->'member'->>'role')='editor' and (pg_temp.r('A1')->'member'->>'display_name')='Bee'
  and (pg_temp.r('A1')->'preference'->>'enabled')='true' and (pg_temp.r('A1')->'folder'->>'id')=pg_temp.fid('F1')::text,'accept adds an editor with an enabled preference');
insert into res select 'A1b', public.accept_place_folder_invite(pg_temp.r('I1')->>'token','Other');
insert into tap_results values
((pg_temp.r('A1b')->>'status')='already_member' and (pg_temp.r('A1b')->'member'->>'display_name')='Bee' and (pg_temp.r('A1b')->'member'->>'revision')='1','a repeated accept succeeds unchanged without renaming');
insert into res select 'P2', public.preview_place_folder_invite(pg_temp.r('I1')->>'token');
insert into tap_results values
(pg_temp.r('P2')=jsonb_build_object('status','already_member','folder_id',pg_temp.fid('F1'),'folder_name','우리 폴더','owner_display_name','Ace','member_count',2,'place_count',pg_temp.place_total(pg_temp.fid('F1'))),'a member preview says already_member and gives the folder id');
reset role;
select pg_temp.sub(3); set local role authenticated;
select pg_temp.expect_error($q$select public.accept_place_folder_invite(pg_temp.r('I1')->>'token','ACE')$q$,'FOLDER_DISPLAY_NAME_TAKEN','a display name taken case-insensitively is rejected');
select pg_temp.expect_error($q$select public.accept_place_folder_invite(pg_temp.r('I1')->>'token','')$q$,'INVALID_FOLDER_DISPLAY_NAME','an empty display name is rejected');
select pg_temp.expect_error($q$select public.accept_place_folder_invite('short','Cee')$q$,'PLACE_FOLDER_INVITE_INVALID','a malformed token is invalid');
select pg_temp.expect_error($q$select public.accept_place_folder_invite(repeat('A',43),'Cee')$q$,'PLACE_FOLDER_INVITE_INVALID','an unknown token is invalid');
select pg_temp.expect_error($q$select public.preview_place_folder_invite(repeat('A',43))$q$,'PLACE_FOLDER_INVITE_INVALID','an unknown token preview is invalid');
insert into res select 'A3', public.accept_place_folder_invite(pg_temp.r('I1')->>'token','Cee');
reset role;
select pg_temp.sub(5); set local role authenticated;
insert into res select 'A5', public.accept_place_folder_invite(pg_temp.r('I1')->>'token','Eee');
reset role;
insert into tap_results values ((select count(*)=4 from public.place_folder_members where folder_id=pg_temp.fid('F1')),'the reused link admits several members');

-- Seven-day boundary (expires_at > clock_timestamp() is the only valid state).
insert into public.place_folder_invites(folder_id,token_hash,created_by,created_at,expires_at)
select pg_temp.fid('F1'),encode(extensions.digest(t,'sha256'),'hex'),pg_temp.u(1),c,c+interval '7 days'
from (values (repeat('B',43),clock_timestamp()-interval '7 days'+interval '30 seconds'),(repeat('C',43),clock_timestamp()-interval '7 days'-interval '1 millisecond')) v(t,c);
select pg_temp.sub(4); set local role authenticated;
insert into tap_results select (public.preview_place_folder_invite(repeat('B',43))->>'status')='joinable','a link 30 s before its expiry is still joinable';
select pg_temp.expect_error($q$select public.preview_place_folder_invite(repeat('C',43))$q$,'PLACE_FOLDER_INVITE_INVALID','an expired link preview is invalid');
select pg_temp.expect_error($q$select public.accept_place_folder_invite(repeat('C',43),'Dee')$q$,'PLACE_FOLDER_INVITE_INVALID','an expired link cannot be accepted');
reset role;

-- Revoke, list and the ten-active-link limit.
select pg_temp.sub(1); set local role authenticated;
insert into res select 'R1', to_jsonb(r) from public.revoke_place_folder_invite((pg_temp.r('I1')->>'id')::uuid) r;
insert into res select 'R1b', to_jsonb(r) from public.revoke_place_folder_invite((pg_temp.r('I1')->>'id')::uuid) r;
insert into tap_results values
((pg_temp.r('R1')->>'revoked_at') is not null and pg_temp.r('R1')=pg_temp.r('R1b'),'revoking twice succeeds and keeps the first revocation'),
((select array_agg(jsonb_object_keys order by jsonb_object_keys)=array['created_at','expires_at','id','revoked_at'] from jsonb_object_keys(pg_temp.r('R1'))),'revoke returns id and times only');
insert into tap_results select count(*)=1 and bool_and(revoked_at is null),'the list shows active links only (revoked and expired hidden)'
  from public.list_place_folder_invites(pg_temp.fid('F1'));
do $$ begin for n in 1..9 loop perform public.create_place_folder_invite(pg_temp.fid('F1')); end loop; end $$;
insert into tap_results select count(*)=10,'ten active links are allowed' from public.list_place_folder_invites(pg_temp.fid('F1'));
select pg_temp.expect_error($q$select public.create_place_folder_invite(pg_temp.fid('F1'))$q$,'PLACE_FOLDER_INVITE_LIMIT','an eleventh active link is rejected');
insert into res select 'I2', public.create_place_folder_invite(pg_temp.fid('F2'));
reset role;
select pg_temp.sub(4); set local role authenticated;
select pg_temp.expect_error($q$select public.accept_place_folder_invite(pg_temp.r('I1')->>'token','Dee')$q$,'PLACE_FOLDER_INVITE_INVALID','a revoked link cannot be accepted');
select pg_temp.expect_error($q$select public.preview_place_folder_invite(pg_temp.r('I1')->>'token')$q$,'PLACE_FOLDER_INVITE_INVALID','a revoked link preview is invalid');
reset role;
select pg_temp.sub(2); set local role authenticated;
insert into tap_results select (public.accept_place_folder_invite(pg_temp.r('I1')->>'token','Bee')->>'status')='already_member','a member reopening a revoked link still gets already_member';
reset role;

-- 3. Roles, display names, removal and leaving.
select pg_temp.sub(1); set local role authenticated;
insert into res select 'ROLE', public.set_place_folder_member_role(pg_temp.fid('F1'),pg_temp.u(3),1,'viewer');
insert into tap_results values ((pg_temp.r('ROLE')->>'role')='viewer' and (pg_temp.r('ROLE')->>'revision')='2','the owner makes a member viewer and the revision advances');
insert into tap_results select (public.set_place_folder_member_role(pg_temp.fid('F1'),pg_temp.u(3),2,'viewer')->>'revision')='2','setting the same role is a no-op';
select pg_temp.expect_error($q$select public.set_place_folder_member_role(pg_temp.fid('F1'),pg_temp.u(3),1,'editor')$q$,'PLACE_FOLDER_MEMBER_STALE','a stale role change is rejected');
select pg_temp.expect_error($q$select public.set_place_folder_member_role(pg_temp.fid('F1'),pg_temp.u(1),1,'viewer')$q$,'PLACE_FOLDER_FORBIDDEN','the owner row cannot be changed');
select pg_temp.expect_error($q$select public.set_place_folder_member_role(pg_temp.fid('F1'),pg_temp.u(2),1,'owner')$q$,'INVALID_PLACE_FOLDER_ROLE','owner cannot be granted');
select pg_temp.expect_error($q$select public.set_place_folder_member_role(pg_temp.fid('F1'),pg_temp.u(4),1,'viewer')$q$,'PLACE_FOLDER_MEMBER_NOT_FOUND','an outsider cannot be given a role');
select pg_temp.expect_error($q$select public.remove_place_folder_member(pg_temp.fid('F1'),pg_temp.u(1),1)$q$,'PLACE_FOLDER_FORBIDDEN','the owner cannot be removed');
select pg_temp.expect_error($q$select public.leave_place_folder(pg_temp.fid('F1'))$q$,'PLACE_FOLDER_OWNER_CANNOT_LEAVE','the owner cannot leave');
select pg_temp.expect_error($q$select public.rename_place_folder(pg_temp.fid('F1'),2,'새 이름')$q$,'PLACE_FOLDER_STALE','a stale rename is rejected');
insert into tap_results select count(*)=1 and bool_and(name='새 이름' and revision=2),'the owner renames with the current revision' from public.rename_place_folder(pg_temp.fid('F1'),1,'새 이름');
select pg_temp.expect_error($q$select public.rename_place_folder(pg_temp.fid('F1'),2,' ')$q$,'INVALID_PLACE_FOLDER','an invalid rename is rejected');
reset role;
select pg_temp.sub(2); set local role authenticated;
select pg_temp.expect_error($q$select public.set_place_folder_member_role(pg_temp.fid('F1'),pg_temp.u(3),2,'editor')$q$,'PLACE_FOLDER_FORBIDDEN','an editor cannot change roles');
select pg_temp.expect_error($q$select public.remove_place_folder_member(pg_temp.fid('F1'),pg_temp.u(3),2)$q$,'PLACE_FOLDER_FORBIDDEN','an editor cannot remove members');
select pg_temp.expect_error($q$select public.rename_place_folder(pg_temp.fid('F1'),2,'x')$q$,'PLACE_FOLDER_FORBIDDEN','an editor cannot rename');
select pg_temp.expect_error($q$select public.delete_place_folder(pg_temp.fid('F1'),2)$q$,'PLACE_FOLDER_FORBIDDEN','an editor cannot delete the folder');
select pg_temp.expect_error($q$select public.create_place_folder_invite(pg_temp.fid('F1'))$q$,'PLACE_FOLDER_FORBIDDEN','an editor cannot create links');
select pg_temp.expect_error($q$select public.list_place_folder_invites(pg_temp.fid('F1'))$q$,'PLACE_FOLDER_FORBIDDEN','an editor cannot list links');
select pg_temp.expect_error($q$select public.revoke_place_folder_invite((pg_temp.r('I1')->>'id')::uuid)$q$,'PLACE_FOLDER_INVITE_NOT_FOUND','an editor revoking a link gets not found');
select pg_temp.expect_error($q$select public.set_place_folder_display_name(pg_temp.fid('F1'),1,'ace')$q$,'FOLDER_DISPLAY_NAME_TAKEN','another member''s display name cannot be taken');
insert into tap_results select (public.set_place_folder_display_name(pg_temp.fid('F1'),1,'BEE')->>'revision')='2','a member renames their own folder name (case change allowed)';
select pg_temp.expect_error($q$select public.set_place_folder_display_name(pg_temp.fid('F1'),1,'Bea')$q$,'PLACE_FOLDER_MEMBER_STALE','a stale display name change is rejected');
reset role;

-- Existence hiding: unknown ids and non-member ids give the same error.
select pg_temp.sub(4); set local role authenticated;
select pg_temp.expect_error($q$select public.rename_place_folder(pg_temp.fid('F1'),2,'x')$q$,'PLACE_FOLDER_NOT_FOUND','a non-member rename sees not found');
select pg_temp.expect_error($q$select public.rename_place_folder(gen_random_uuid(),1,'x')$q$,'PLACE_FOLDER_NOT_FOUND','an unknown folder rename sees not found');
select pg_temp.expect_error($q$select public.delete_place_folder(pg_temp.fid('F1'),2)$q$,'PLACE_FOLDER_NOT_FOUND','a non-member delete sees not found');
select pg_temp.expect_error($q$select public.create_place_folder_invite(pg_temp.fid('F1'))$q$,'PLACE_FOLDER_NOT_FOUND','a non-member link creation sees not found');
select pg_temp.expect_error($q$select public.list_place_folder_invites(pg_temp.fid('F1'))$q$,'PLACE_FOLDER_NOT_FOUND','a non-member link list sees not found');
select pg_temp.expect_error($q$select public.revoke_place_folder_invite((pg_temp.r('I1')->>'id')::uuid)$q$,'PLACE_FOLDER_INVITE_NOT_FOUND','a non-member revoke sees not found');
select pg_temp.expect_error($q$select public.revoke_place_folder_invite(gen_random_uuid())$q$,'PLACE_FOLDER_INVITE_NOT_FOUND','an unknown link revoke sees not found');
select pg_temp.expect_error($q$select public.leave_place_folder(pg_temp.fid('F1'))$q$,'PLACE_FOLDER_NOT_FOUND','a non-member leave sees not found');
select pg_temp.expect_error($q$select public.set_place_folder_display_name(pg_temp.fid('F1'),1,'Dee')$q$,'PLACE_FOLDER_NOT_FOUND','a non-member display name change sees not found');
select pg_temp.expect_error($q$select public.add_shared_place(pg_temp.fid('F1'),pg_temp.place('d1'))$q$,'PLACE_FOLDER_NOT_FOUND','a non-member place add sees not found');
select pg_temp.expect_error($q$select public.import_saved_places_to_folder(pg_temp.fid('F1'),'{}')$q$,'PLACE_FOLDER_NOT_FOUND','a non-member import sees not found');
select pg_temp.expect_error($q$select public.update_shared_place(pg_temp.shared(pg_temp.fid('F1'),'s1'),1,null,'restaurant')$q$,'SHARED_PLACE_NOT_FOUND','a non-member place update sees not found');
select pg_temp.expect_error($q$select public.update_shared_place(gen_random_uuid(),1,null,'restaurant')$q$,'SHARED_PLACE_NOT_FOUND','an unknown place update sees not found');
select pg_temp.expect_error($q$select public.delete_shared_place(pg_temp.shared(pg_temp.fid('F1'),'s1'),1)$q$,'SHARED_PLACE_NOT_FOUND','a non-member place delete sees not found');
select pg_temp.expect_error($q$select public.set_shared_place_star(pg_temp.shared(pg_temp.fid('F1'),'s1'),true)$q$,'SHARED_PLACE_NOT_FOUND','a non-member star sees not found');
select pg_temp.expect_error($q$select public.set_shared_place_star(gen_random_uuid(),true)$q$,'SHARED_PLACE_NOT_FOUND','an unknown place star sees not found');
select pg_temp.expect_error($q$select public.add_avoided_place(pg_temp.place('s1'),pg_temp.shared(pg_temp.fid('F1'),'s1'))$q$,'SHARED_PLACE_NOT_FOUND','avoiding with an invisible source sees not found');
select pg_temp.expect_error($q$select public.set_place_folders_enabled(jsonb_build_array(jsonb_build_object('folderId',pg_temp.fid('F1'),'enabled',false)))$q$,'PLACE_FOLDER_NOT_FOUND','a non-member preference change sees not found');
insert into tap_results values
((select count(*)=0 from public.place_folders) and (select count(*)=0 from public.place_folder_members) and (select count(*)=0 from public.shared_places)
  and (select count(*)=0 from public.shared_place_entries) and (select count(*)=0 from public.place_folder_preferences),'a non-member reads no folder, member, place or preference');
reset role;

-- 4. Shared places by role.
select pg_temp.sub(2); set local role authenticated;
insert into res select 'ADD', public.add_shared_place(pg_temp.fid('F1'),pg_temp.place('new1',37.5,127.5,'서울특별시 테스트'),'새 장소','restaurant');
insert into tap_results values
((pg_temp.r('ADD')->>'status')='added' and (pg_temp.r('ADD')->'shared_place'->>'created_by')=pg_temp.u(2)::text and (pg_temp.r('ADD')->'shared_place'->>'province')='서울'
  and (pg_temp.r('ADD')->'shared_place'->>'updated_by_display_name')='BEE' and (pg_temp.r('ADD')->'shared_place'->>'updated_by_left')='false'
  and (pg_temp.r('ADD')->'shared_place'->>'starred')='false' and (pg_temp.r('ADD')->'shared_place'->'place')=pg_temp.place('new1',37.5,127.5,'서울특별시 테스트'),'an editor adds a place and gets its entry row');
insert into res select 'ADD2', public.add_shared_place(pg_temp.fid('F1'),jsonb_set(pg_temp.place('new1',37.5,127.5,'서울특별시 테스트'),'{name}','"다른 이름"'),'다른 별명','riding_spot');
insert into tap_results values
((pg_temp.r('ADD2')->>'status')='already_exists' and (pg_temp.r('ADD2')->'shared_place')=(pg_temp.r('ADD')->'shared_place'),'adding the same place returns the existing row unchanged');
select pg_temp.expect_error($q$select public.add_shared_place(pg_temp.fid('F1'),pg_temp.place('map:37.2000000:127.2000000:region'))$q$,'INVALID_SAVED_PLACE_METADATA','a region point needs an alias');
select pg_temp.expect_error($q$select public.add_shared_place(pg_temp.fid('F1'),pg_temp.place('x')||'{"extra":1}'::jsonb)$q$,'INVALID_SAVED_PLACE','a malformed place is rejected');
select pg_temp.expect_error($q$select public.add_shared_place(pg_temp.fid('F1'),pg_temp.place('x'),' a')$q$,'INVALID_SAVED_PLACE_METADATA','an untrimmed alias is rejected');
insert into tap_results select count(*)=1 and bool_and(revision=2 and alias='고친 별명' and kind='riding_spot' and updated_by=pg_temp.u(2)),'an editor updates a place with its revision'
  from public.update_shared_place(pg_temp.shared(pg_temp.fid('F1'),'s1'),1,'고친 별명','riding_spot');
select pg_temp.expect_error($q$select public.update_shared_place(pg_temp.shared(pg_temp.fid('F1'),'s1'),1,null,'riding_spot')$q$,'SHARED_PLACE_STALE','a stale place update is rejected');
select pg_temp.expect_error($q$select public.update_shared_place(pg_temp.shared(pg_temp.fid('F1'),'map:37.1000000:127.1000000:region'),1,null,'riding_spot')$q$,'INVALID_SAVED_PLACE_METADATA','a region alias cannot be removed');
select pg_temp.expect_error($q$select public.delete_shared_place(pg_temp.shared(pg_temp.fid('F1'),'s2'),2)$q$,'SHARED_PLACE_STALE','a stale place delete is rejected');
reset role;
select pg_temp.sub(3); set local role authenticated;
select pg_temp.expect_error($q$select public.add_shared_place(pg_temp.fid('F1'),pg_temp.place('v1'))$q$,'PLACE_FOLDER_FORBIDDEN','a viewer cannot add');
select pg_temp.expect_error($q$select public.update_shared_place(pg_temp.shared(pg_temp.fid('F1'),'s1'),2,null,'riding_spot')$q$,'PLACE_FOLDER_FORBIDDEN','a viewer cannot update');
select pg_temp.expect_error($q$select public.delete_shared_place(pg_temp.shared(pg_temp.fid('F1'),'s1'),2)$q$,'PLACE_FOLDER_FORBIDDEN','a viewer cannot delete');
select pg_temp.expect_error($q$select public.import_saved_places_to_folder(pg_temp.fid('F1'),'{}')$q$,'PLACE_FOLDER_FORBIDDEN','a viewer cannot import');
insert into tap_results values
((select count(*)=4 from public.shared_place_entries where folder_id=pg_temp.fid('F1')),'a viewer reads every folder place'),
((select count(*)=4 from public.place_folder_members where folder_id=pg_temp.fid('F1')),'a viewer reads the member list');
reset role;
-- Owner import: existing places are skipped, all or nothing at the limit.
select pg_temp.sub(1); set local role authenticated;
insert into res select 'IMP', public.import_saved_places_to_folder(pg_temp.fid('F1'),array[pg_temp.saved(1,'s1'),pg_temp.saved(1,'s4'),pg_temp.saved(1,'s5')]);
insert into tap_results values (pg_temp.r('IMP')=jsonb_build_object('added',2,'skipped_existing',1),'import adds new places and skips existing ones');
select pg_temp.expect_error($q$select public.import_saved_places_to_folder(pg_temp.fid('F1'),array[pg_temp.saved(2,'b1')])$q$,'SAVED_PLACE_NOT_FOUND','import cannot copy another rider''s place');
select pg_temp.expect_error($q$select public.import_saved_places_to_folder(pg_temp.fid('F1'),array[pg_temp.saved(1,'s6'),pg_temp.saved(1,'s6')])$q$,'INVALID_PLACE_FOLDER','import rejects duplicate ids');
reset role;
insert into public.shared_places(folder_id,place,kind,province,created_by,updated_by)
select pg_temp.fid('F2'),pg_temp.place('fill'||n),'riding_spot','경기',pg_temp.u(1),pg_temp.u(1) from generate_series(1,998) n;
select pg_temp.sub(1); set local role authenticated;
select pg_temp.expect_error($q$select public.import_saved_places_to_folder(pg_temp.fid('F2'),array[pg_temp.saved(1,'s7'),pg_temp.saved(1,'s8'),pg_temp.saved(1,'s9')])$q$,'PLACE_FOLDER_PLACE_LIMIT','import over the remaining room is rejected');
insert into tap_results values ((select count(*)=998 from public.shared_places where folder_id=pg_temp.fid('F2')),'a rejected import adds nothing');
insert into tap_results select public.import_saved_places_to_folder(pg_temp.fid('F2'),array[pg_temp.saved(1,'s7'),pg_temp.saved(1,'s8')])=jsonb_build_object('added',2,'skipped_existing',0),'import up to exactly 1,000 places succeeds';
select pg_temp.expect_error($q$select public.add_shared_place(pg_temp.fid('F2'),pg_temp.place('over'))$q$,'PLACE_FOLDER_PLACE_LIMIT','the 1,001st place is rejected');
insert into tap_results select (public.add_shared_place(pg_temp.fid('F2'),pg_temp.place('fill1'))->>'status')='already_exists','an existing place still answers already_exists at the limit';
insert into tap_results select public.import_saved_places_to_folder(pg_temp.fid('F2'),array[pg_temp.saved(1,'s7')])=jsonb_build_object('added',0,'skipped_existing',1),'an import of existing places only succeeds at the limit';
reset role;
set constraints all immediate; set constraints all deferred;

-- 5. Stars: personal + shared share one limit of ten.
-- A: personal stars in slots 2..4 and 6..10 (eight); slots 1 and 5 are free so every
-- legacy writer could take a slot and only the shared stars push the total to ten.
insert into public.place_stars(owner_id,slot,saved_place_id)
select pg_temp.u(1),slot,pg_temp.saved(1,'s'||n) from (values (2,1),(3,2),(4,3),(6,4),(7,5),(8,6),(9,7),(10,8)) v(slot,n);
select pg_temp.sub(1); set local role authenticated;
insert into tap_results select count(*)=1 and bool_and(starred and revision=2),'a shared star does not change the place revision'
  from public.set_shared_place_star(pg_temp.shared(pg_temp.fid('F1'),'s1'),true);
insert into tap_results select count(*)=1 and bool_and(starred),'starring a starred shared place is a no-op' from public.set_shared_place_star(pg_temp.shared(pg_temp.fid('F1'),'s1'),true);
insert into tap_results select count(*)=1 and bool_and(starred),'the tenth star may be shared' from public.set_shared_place_star(pg_temp.shared(pg_temp.fid('F1'),'s2'),true);
insert into tap_results values (pg_temp.star_total(1)=10,'eight personal and two shared stars make ten');
select pg_temp.expect_error($q$select public.set_shared_place_star(pg_temp.shared(pg_temp.fid('F1'),'new1'),true)$q$,'SAVED_PLACE_STAR_LIMIT','an eleventh shared star is rejected');
select pg_temp.expect_error($q$select public.set_place_star(pg_temp.saved(1,'s10'),1,true)$q$,'SAVED_PLACE_STAR_LIMIT','set_place_star counts shared stars');
select pg_temp.expect_error($q$select public.save_place_v2(pg_temp.place('n-star'),null,'riding_spot',true)$q$,'SAVED_PLACE_STAR_LIMIT','save_place_v2 counts shared stars');
select pg_temp.expect_error($q$select public.set_saved_place_star(pg_temp.saved(1,'s10'),1,true)$q$,'SAVED_PLACE_STAR_LIMIT','legacy set_saved_place_star counts shared stars');
select pg_temp.expect_error($q$select public.save_place(pg_temp.place('o-star'),null,'riding_spot',true)$q$,'SAVED_PLACE_STAR_LIMIT','legacy save_place counts shared stars');
select pg_temp.expect_error($q$select public.add_place_favorite(pg_temp.place('s10'))$q$,'FAVORITE_LIMIT','legacy add_place_favorite counts shared stars with its own error');
insert into tap_results values ((pg_temp.star_total(1)=10 and pg_temp.saved(1,'n-star') is null and pg_temp.saved(1,'o-star') is null),'rejected star requests change nothing');
insert into tap_results select count(*)=1 and bool_and(star_slot=1),'legacy move of a hidden star into a free 1..5 slot is allowed at ten'
  from public.set_saved_place_star(pg_temp.saved(1,'s6'),1,true);
insert into tap_results select count(*)=10 and count(*) filter (where source='shared')=2 and count(*) filter (where source='saved')=8
  and bool_and(source='saved' or (folder_id=pg_temp.fid('F1') and star_slot is null)),'my_star_entries returns personal and shared stars together'
  from public.my_star_entries;
insert into tap_results select count(*)=1 and bool_and(not starred),'unstarring a shared place keeps the place' from public.set_shared_place_star(pg_temp.shared(pg_temp.fid('F1'),'s2'),false);
insert into tap_results select count(*)=1 and bool_and(not starred),'unstarring an unstarred shared place is a no-op' from public.set_shared_place_star(pg_temp.shared(pg_temp.fid('F1'),'s2'),false);
select pg_temp.expect_error($q$select public.set_shared_place_star(pg_temp.shared(pg_temp.fid('F1'),'s2'),null)$q$,'INVALID_SAVED_PLACE','a null star request is rejected');
reset role;
-- Viewers star too; leaving, removal and deletion clear the member's shared stars.
select pg_temp.sub(3); set local role authenticated;
insert into tap_results select count(*)=1 and bool_and(starred),'a viewer can star a folder place' from public.set_shared_place_star(pg_temp.shared(pg_temp.fid('F1'),'s1'),true);
reset role;
select pg_temp.sub(2); set local role authenticated;
select public.set_shared_place_star(pg_temp.shared(pg_temp.fid('F1'),'s1'),true);
select public.set_shared_place_star(pg_temp.shared(pg_temp.fid('F1'),'new1'),true);
insert into tap_results values ((select count(*)=2 from public.shared_place_stars),'an editor reads only their own shared stars');
reset role;
select pg_temp.sub(1); set local role authenticated;
insert into tap_results values ((select count(*)=1 from public.shared_place_stars),'the owner does not see members'' stars');
select public.delete_shared_place(pg_temp.shared(pg_temp.fid('F1'),'new1'),1);
reset role;
insert into tap_results values ((select count(*)=0 from public.shared_place_stars where owner_id=pg_temp.u(2) and shared_place_id not in (select id from public.shared_places)),'deleting a place removes every member''s star on it'),
((select count(*)=1 from public.shared_place_stars where owner_id=pg_temp.u(2)),'other stars of the member stay');
select pg_temp.sub(2); set local role authenticated;
select public.leave_place_folder(pg_temp.fid('F1'));
select pg_temp.expect_error($q$select public.leave_place_folder(pg_temp.fid('F1'))$q$,'PLACE_FOLDER_NOT_FOUND','leaving twice sees not found');
insert into tap_results values ((select count(*)=0 from public.shared_places) and (select count(*)=0 from public.place_folders),'a member who left reads nothing of the folder');
reset role;
insert into tap_results values
((select count(*)=0 from public.shared_place_stars where owner_id=pg_temp.u(2)),'leaving removes the member''s shared stars'),
((select count(*)=0 from public.place_folder_preferences where member_id=pg_temp.u(2)),'leaving removes the member''s preference'),
((select updated_by_left and updated_by_display_name is null from public.shared_place_entries where id=pg_temp.shared(pg_temp.fid('F1'),'s1')),'a place last edited by a former member shows a left editor without a name');
select pg_temp.sub(1); set local role authenticated;
select pg_temp.expect_error($q$select public.remove_place_folder_member(pg_temp.fid('F1'),pg_temp.u(3),1)$q$,'PLACE_FOLDER_MEMBER_STALE','a stale removal is rejected');
select public.remove_place_folder_member(pg_temp.fid('F1'),pg_temp.u(3),2);
select pg_temp.expect_error($q$select public.remove_place_folder_member(pg_temp.fid('F1'),pg_temp.u(3),2)$q$,'PLACE_FOLDER_MEMBER_NOT_FOUND','removing twice sees member not found');
reset role;
insert into tap_results values
((select count(*)=0 from public.shared_place_stars where owner_id=pg_temp.u(3)) and (select count(*)=0 from public.place_folder_members where member_id=pg_temp.u(3))
  and (select count(*)=0 from public.place_folder_preferences where member_id=pg_temp.u(3)),'removal clears the member, preference and shared stars');
set constraints all immediate; set constraints all deferred;

-- 6. Preferences: partial desired state, own rows only.
select pg_temp.sub(5); set local role authenticated;
insert into res select 'A5F2', public.accept_place_folder_invite(pg_temp.r('I2')->>'token','Eee');
insert into tap_results select count(*)=2 and bool_and(enabled=(folder_id<>pg_temp.fid('F1'))),'changing one folder leaves the other untouched'
  from public.set_place_folders_enabled(jsonb_build_array(jsonb_build_object('folderId',pg_temp.fid('F1'),'enabled',false)));
create temp table pref_before as select folder_id,enabled,updated_at from public.place_folder_preferences;
insert into tap_results select count(*)=2,'repeating the same desired state succeeds' from public.set_place_folders_enabled(jsonb_build_array(jsonb_build_object('folderId',upper(pg_temp.fid('F1')::text),'enabled',false)));
insert into tap_results values ((select count(*)=2 from public.place_folder_preferences p join pref_before b using (folder_id,enabled,updated_at)),'an unchanged desired state writes nothing');
select pg_temp.expect_error($q$select public.set_place_folders_enabled(jsonb_build_array(jsonb_build_object('folderId',pg_temp.fid('F2'),'enabled',false),jsonb_build_object('folderId',gen_random_uuid(),'enabled',false)))$q$,'PLACE_FOLDER_NOT_FOUND','a non-member folder rejects the whole change');
insert into tap_results values ((select bool_and(enabled) from public.place_folder_preferences where folder_id=pg_temp.fid('F2')),'a rejected change changes nothing');
select pg_temp.expect_error($q$select public.set_place_folders_enabled('[]')$q$,'INVALID_PLACE_FOLDER_PREFERENCES','an empty change list is rejected');
select pg_temp.expect_error($q$select public.set_place_folders_enabled((select jsonb_agg(jsonb_build_object('folderId',gen_random_uuid(),'enabled',true)) from generate_series(1,21)))$q$,'INVALID_PLACE_FOLDER_PREFERENCES','more than twenty changes are rejected');
select pg_temp.expect_error($q$select public.set_place_folders_enabled(jsonb_build_array(jsonb_build_object('folderId',pg_temp.fid('F1'),'enabled',true),jsonb_build_object('folderId',pg_temp.fid('F1'),'enabled',false)))$q$,'INVALID_PLACE_FOLDER_PREFERENCES','a repeated folder is rejected');
select pg_temp.expect_error($q$select public.set_place_folders_enabled(jsonb_build_array(jsonb_build_object('folderId','not-a-uuid','enabled',true)))$q$,'INVALID_PLACE_FOLDER_PREFERENCES','a malformed folder id is rejected');
select pg_temp.expect_error($q$select public.set_place_folders_enabled(jsonb_build_array(jsonb_build_object('folderId',pg_temp.fid('F1'),'enabled','yes')))$q$,'INVALID_PLACE_FOLDER_PREFERENCES','a non-boolean value is rejected');
select pg_temp.expect_error($q$select public.set_place_folders_enabled(jsonb_build_array(jsonb_build_object('folderId',pg_temp.fid('F1'),'enabled',true,'extra',1)))$q$,'INVALID_PLACE_FOLDER_PREFERENCES','an extra key is rejected');
reset role;
select pg_temp.sub(1); set local role authenticated;
insert into tap_results values ((select count(*)=2 and bool_and(member_id=pg_temp.u(1)) from public.place_folder_preferences),'the owner reads only their own preferences, never a member''s');
reset role;

-- 7. Avoided places.
select pg_temp.sub(1); set local role authenticated;
insert into res select 'AV', to_jsonb(a) from public.add_avoided_place(pg_temp.place('s1'),pg_temp.shared(pg_temp.fid('F1'),'s1')) a;
insert into tap_results values (((pg_temp.r('AV')->>'source_shared_place_id')::uuid=pg_temp.shared(pg_temp.fid('F1'),'s1')),'a visible shared place can be avoided with its source');
insert into tap_results select count(*)=1 and bool_and(id=(pg_temp.r('AV')->>'id')::uuid),'avoiding the same place again returns the existing row'
  from public.add_avoided_place(jsonb_set(pg_temp.place('s1'),'{name}','"다른 이름"'));
insert into tap_results values ((select count(*)=1 from public.shared_places where id=pg_temp.shared(pg_temp.fid('F1'),'s1')),'avoiding a shared place keeps it in the folder');
select pg_temp.expect_error($q$select public.add_avoided_place('{}'::jsonb)$q$,'INVALID_SAVED_PLACE','a malformed avoided place is rejected');
select public.remove_avoided_place((pg_temp.r('AV')->>'id')::uuid);
select pg_temp.expect_error($q$select public.remove_avoided_place((pg_temp.r('AV')->>'id')::uuid)$q$,'AVOIDED_PLACE_NOT_FOUND','removing twice sees not found');
reset role;
insert into public.avoided_places(owner_id,place) select pg_temp.u(1),pg_temp.place('avoid'||n) from generate_series(1,199) n;
select pg_temp.sub(1); set local role authenticated;
insert into tap_results select count(*)=1,'the 200th avoided place is allowed' from public.add_avoided_place(pg_temp.place('avoid200'));
select pg_temp.expect_error($q$select public.add_avoided_place(pg_temp.place('avoid201'))$q$,'AVOIDED_PLACE_LIMIT','the 201st avoided place is rejected');
insert into tap_results select count(*)=1,'an existing avoided place still succeeds at the limit' from public.add_avoided_place(pg_temp.place('avoid1'));
reset role;
select pg_temp.sub(4); set local role authenticated;
insert into tap_results values ((select count(*)=0 from public.avoided_places),'another rider cannot read avoided places');
select pg_temp.expect_error($q$select public.remove_avoided_place((select id from public.avoided_places limit 1))$q$,'AVOIDED_PLACE_NOT_FOUND','a null or foreign id is not found');
reset role;

-- 8. Recommendation read: enabled folders only, bounded rows, one JSON value.
insert into public.shared_places(folder_id,place,kind,province,created_by,updated_by)
values (pg_temp.fid('F1'),pg_temp.place('rest-in',37.2,127.2),'restaurant','경기',pg_temp.u(1),pg_temp.u(1)),
       (pg_temp.fid('F1'),pg_temp.place('rest-out',35.2,129.0),'restaurant','경기',pg_temp.u(1),pg_temp.u(1));
select pg_temp.sub(1); set local role authenticated;
insert into res select 'REC', public.recommendation_shared_restaurants(37.0,37.5,127.0,127.5);
insert into tap_results values
((select array_agg(jsonb_object_keys order by jsonb_object_keys)=array['disabledFolders','enabledTotal','rows','truncated'] from jsonb_object_keys(pg_temp.r('REC'))),'the read returns rows, truncated, enabledTotal and disabledFolders'),
((select array_agg(e->'place'->>'kakaoPlaceId' order by e->'place'->>'kakaoPlaceId') from jsonb_array_elements(pg_temp.r('REC')->'rows') e)=array['rest-in','s2','s4','s8'],'rows are enabled-folder restaurants inside the box, from every enabled folder'),
((select bool_and(array(select jsonb_object_keys(e) order by 1)=array['alias','created_at','folder_id','id','place','revision']) from jsonb_array_elements(pg_temp.r('REC')->'rows') e),'each row has exactly id, folder_id, place, alias, revision and created_at'),
((pg_temp.r('REC')->>'truncated')='false' and (pg_temp.r('REC')->>'enabledTotal')='5' and (pg_temp.r('REC')->>'disabledFolders')='0','the box does not limit enabledTotal');
select public.set_place_folders_enabled(jsonb_build_array(jsonb_build_object('folderId',pg_temp.fid('F1'),'enabled',false)));
insert into res select 'REC2', public.recommendation_shared_restaurants(37.0,37.5,127.0,127.5);
insert into tap_results values ((select array_agg(e->'place'->>'kakaoPlaceId') from jsonb_array_elements(pg_temp.r('REC2')->'rows') e)=array['s8']
  and (pg_temp.r('REC2')->>'truncated')='false' and (pg_temp.r('REC2')->>'enabledTotal')='1' and (pg_temp.r('REC2')->>'disabledFolders')='1','a disabled folder adds no candidate and is counted');
select public.set_place_folders_enabled(jsonb_build_array(jsonb_build_object('folderId',pg_temp.fid('F1'),'enabled',true)));
select pg_temp.expect_error($q$select public.recommendation_shared_restaurants(37.5,37.0,127.0,127.5)$q$,'INVALID_RECOMMENDATION_REQUEST','an inverted box is rejected');
select pg_temp.expect_error($q$select public.recommendation_shared_restaurants('NaN',37.0,127.0,127.5)$q$,'INVALID_RECOMMENDATION_REQUEST','a NaN bound is rejected');
select pg_temp.expect_error($q$select public.recommendation_shared_restaurants(null,37.0,127.0,127.5)$q$,'INVALID_RECOMMENDATION_REQUEST','a null bound is rejected');
reset role;
-- 2,000 rows exactly, then 2,001: the overflow is reported, never dropped silently.
delete from public.shared_places where folder_id=pg_temp.fid('F2');
insert into public.shared_places(folder_id,place,kind,province,created_by,updated_by,created_at)
select pg_temp.fid('F2'),pg_temp.place('bulk'||n,37.3,127.3),'restaurant','경기',pg_temp.u(1),pg_temp.u(1),now()-interval '1 hour'+n*interval '1 second' from generate_series(1,997) n;
select pg_temp.sub(1); set local role authenticated;
insert into res select 'F3', public.create_place_folder('세번째','Ace','{}',gen_random_uuid());
reset role;
insert into public.shared_places(folder_id,place,kind,province,created_by,updated_by,created_at)
select pg_temp.fid('F3'),pg_temp.place('more'||n,37.3,127.3),'restaurant','경기',pg_temp.u(1),pg_temp.u(1),now()+n*interval '1 second' from generate_series(1,1000) n;
select pg_temp.sub(1); set local role authenticated;
insert into res select 'REC3', public.recommendation_shared_restaurants(37.0,37.5,127.0,127.5);
insert into tap_results values
(jsonb_array_length(pg_temp.r('REC3')->'rows')=2000 and (pg_temp.r('REC3')->>'truncated')='false' and (pg_temp.r('REC3')->>'enabledTotal')='2001','exactly 2,000 in-box rows are returned without truncation');
reset role;
insert into public.shared_places(folder_id,place,kind,province,created_by,updated_by,created_at)
values (pg_temp.fid('F2'),pg_temp.place('late',37.3,127.3),'restaurant','경기',pg_temp.u(1),pg_temp.u(1),now()+interval '1 day');
select pg_temp.sub(1); set local role authenticated;
insert into res select 'REC4', public.recommendation_shared_restaurants(37.0,37.5,127.0,127.5);
insert into tap_results values
(jsonb_array_length(pg_temp.r('REC4')->'rows')=2000 and (pg_temp.r('REC4')->>'truncated')='true' and (pg_temp.r('REC4')->'rows'->1999->'place'->>'kakaoPlaceId')<>'late'
  and (select bool_and((a->>'created_at')::timestamptz<(b->>'created_at')::timestamptz or ((a->>'created_at')::timestamptz=(b->>'created_at')::timestamptz and (a->>'id')::uuid<(b->>'id')::uuid))
       from generate_series(0,1998) i, lateral (select pg_temp.r('REC4')->'rows'->i a, pg_temp.r('REC4')->'rows'->(i+1) b) pair),
  'the 2,001st in-box row sets truncated and rows keep (created_at, id) order');
reset role;
select pg_temp.sub(4); set local role authenticated;
insert into tap_results select public.recommendation_shared_restaurants(37.0,37.5,127.0,127.5)=jsonb_build_object('rows','[]'::jsonb,'truncated',false,'enabledTotal',0,'disabledFolders',0),'a rider without folders gets an empty result';
reset role;
set constraints all immediate; set constraints all deferred;

-- 9. Limits on folders per rider and members per folder, and the accept order.
select pg_temp.sub(7); set local role authenticated;
do $$ begin for n in 1..20 loop perform public.create_place_folder('폴더'||n,'Gee','{}',('95000000-0000-0000-0000-0000000001'||lpad(n::text,2,'0'))::uuid); end loop; end $$;
insert into tap_results values
((public.create_place_folder('폴더20','Gee','{}','95000000-0000-0000-0000-000000000120')->'folder'->>'name')='폴더20','a replay at the 20-folder limit returns the stored folder without a limit check');
select pg_temp.expect_error($q$select public.create_place_folder('스물한번째','Gee','{}',gen_random_uuid())$q$,'PLACE_FOLDER_LIMIT','a twenty-first folder is rejected');
reset role;
-- F1 already has members A, E; fill to 29 with fillers 10..36, then the 30th joins.
insert into public.place_folder_members(folder_id,member_id,role,display_name) select pg_temp.fid('F1'),pg_temp.u(n),'editor','filler'||n from generate_series(10,36) n;
insert into public.place_folder_preferences(member_id,folder_id) select pg_temp.u(n),pg_temp.fid('F1') from generate_series(10,36) n;
-- Free the ten active link slots used above (the expired link stays as it is).
update public.place_folder_invites set revoked_at=clock_timestamp() where folder_id=pg_temp.fid('F1') and revoked_at is null and expires_at>clock_timestamp();
select pg_temp.sub(1); set local role authenticated;
insert into res select 'I3', public.create_place_folder_invite(pg_temp.fid('F1'));
reset role;
select pg_temp.sub(37); set local role authenticated;
insert into tap_results select (public.accept_place_folder_invite(pg_temp.r('I3')->>'token','thirtieth')->>'status')='joined','the thirtieth member may join';
reset role;
select pg_temp.sub(7); set local role authenticated;
select pg_temp.expect_error($q$select public.accept_place_folder_invite(pg_temp.r('I3')->>'token','Ace')$q$,'PLACE_FOLDER_MEMBER_LIMIT','member limit is checked before the folder limit and the name');
reset role;
select pg_temp.sub(38); set local role authenticated;
select pg_temp.expect_error($q$select public.accept_place_folder_invite(pg_temp.r('I3')->>'token','late')$q$,'PLACE_FOLDER_MEMBER_LIMIT','a thirty-first member is rejected');
select pg_temp.expect_error($q$select public.accept_place_folder_invite(repeat('C',43),'late')$q$,'PLACE_FOLDER_INVITE_INVALID','an expired link is rejected before the member limit');
reset role;
select pg_temp.sub(7); set local role authenticated;
select pg_temp.expect_error($q$select public.accept_place_folder_invite(pg_temp.r('I2')->>'token','Ace')$q$,'PLACE_FOLDER_LIMIT','folder limit is checked before the display name');
reset role;
insert into tap_results values ((select count(*)=30 from public.place_folder_members where folder_id=pg_temp.fid('F1')),'the folder holds exactly thirty members'),
((select count(*)=20 from public.place_folder_members where member_id=pg_temp.u(7)),'the rider holds exactly twenty folders');
set constraints all immediate; set constraints all deferred;

-- 10. Revoked members, riders without membership, administrators and anonymous.
update public.memberships set revoked_at=now() where user_id=pg_temp.u(5);
select pg_temp.sub(5); set local role authenticated;
insert into tap_results values
((select count(*)=0 from public.place_folders) and (select count(*)=0 from public.place_folder_members) and (select count(*)=0 from public.shared_places)
  and (select count(*)=0 from public.place_folder_preferences) and (select count(*)=0 from public.shared_place_stars) and (select count(*)=0 from public.avoided_places)
  and (select count(*)=0 from public.shared_place_entries) and (select count(*)=0 from public.my_star_entries),'a revoked member who still has member rows reads nothing');
select pg_temp.expect_error($q$select public.create_place_folder('x','x','{}',gen_random_uuid())$q$,'MEMBERSHIP_REQUIRED','a revoked member cannot create');
select pg_temp.expect_error($q$select public.leave_place_folder(pg_temp.fid('F1'))$q$,'MEMBERSHIP_REQUIRED','a revoked member cannot leave');
select pg_temp.expect_error($q$select public.preview_place_folder_invite(pg_temp.r('I3')->>'token')$q$,'MEMBERSHIP_REQUIRED','a revoked member cannot preview');
select pg_temp.expect_error($q$select public.set_shared_place_star(pg_temp.shared(pg_temp.fid('F1'),'s1'),true)$q$,'MEMBERSHIP_REQUIRED','a revoked member cannot star');
select pg_temp.expect_error($q$select public.recommendation_shared_restaurants(37,38,127,128)$q$,'MEMBERSHIP_REQUIRED','a revoked member cannot read recommendations');
reset role;
select pg_temp.sub(8); set local role authenticated;
select pg_temp.expect_error($q$select public.accept_place_folder_invite(pg_temp.r('I3')->>'token','x')$q$,'MEMBERSHIP_REQUIRED','a rider without membership cannot accept');
select pg_temp.expect_error($q$select public.add_avoided_place(pg_temp.place('x'))$q$,'MEMBERSHIP_REQUIRED','a rider without membership cannot avoid');
select pg_temp.expect_error($q$select public.set_place_folders_enabled('[]')$q$,'MEMBERSHIP_REQUIRED','a rider without membership cannot change preferences');
reset role;
select pg_temp.sub(6); set local role authenticated;
insert into tap_results values ((select count(*)=0 from public.place_folders) and (select count(*)=0 from public.shared_places) and (select count(*)=0 from public.place_folder_members),'an administrator does not read other riders'' folders');
select pg_temp.expect_error($q$select public.delete_place_folder(pg_temp.fid('F1'),2)$q$,'PLACE_FOLDER_NOT_FOUND','an administrator cannot manage another rider''s folder');
reset role;
-- Members expose only the contract columns, never profiles.
select pg_temp.sub(1); set local role authenticated;
select pg_temp.expect_error($q$select updated_at from public.place_folder_members$q$,'permission denied for table place_folder_members','authenticated cannot read member updated_at','42501');
select pg_temp.expect_error($q$select * from public.place_folder_invites$q$,'permission denied for table place_folder_invites','authenticated cannot read invites directly','42501');
reset role;

with tbl(name) as (values ('place_folders'),('place_folder_members'),('place_folder_preferences'),('shared_places'),('place_folder_invites'),('avoided_places'),('shared_place_stars'),('place_folder_create_requests'))
insert into tap_results select
  not has_table_privilege('authenticated','public.'||name,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_table_privilege('anon','public.'||name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_table_privilege('service_role','public.'||name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and (select relrowsecurity from pg_class where oid=('public.'||name)::regclass),
  format('%s has RLS, no client DML, no anonymous or service-role access',name)
from tbl;
select pg_temp.sub(1); set local role authenticated;
select pg_temp.expect_error($q$insert into public.place_folders(owner_id,name) values (pg_temp.u(1),'direct')$q$,'permission denied for table place_folders','authenticated direct folder insert denied','42501');
select pg_temp.expect_error($q$update public.shared_places set alias='x'$q$,'permission denied for table shared_places','authenticated direct place update denied','42501');
select pg_temp.expect_error($q$delete from public.place_folder_members$q$,'permission denied for table place_folder_members','authenticated direct member delete denied','42501');
select pg_temp.expect_error($q$update public.place_folder_preferences set enabled=false$q$,'permission denied for table place_folder_preferences','authenticated direct preference update denied','42501');
select pg_temp.expect_error($q$insert into public.shared_place_stars(owner_id,shared_place_id) values (pg_temp.u(1),gen_random_uuid())$q$,'permission denied for table shared_place_stars','authenticated direct shared star insert denied','42501');
select pg_temp.expect_error($q$insert into public.avoided_places(owner_id,place) values (pg_temp.u(1),pg_temp.place('direct'))$q$,'permission denied for table avoided_places','authenticated direct avoided insert denied','42501');
reset role;
set local role anon;
select pg_temp.expect_error($q$select * from public.shared_place_entries$q$,'permission denied for view shared_place_entries','anonymous entry read denied','42501');
select pg_temp.expect_error($q$select * from public.my_star_entries$q$,'permission denied for view my_star_entries','anonymous star read denied','42501');
select pg_temp.expect_error($q$select public.preview_place_folder_invite(repeat('A',43))$q$,'permission denied for function preview_place_folder_invite','anonymous preview denied','42501');
select pg_temp.expect_error($q$select public.recommendation_shared_restaurants(37,38,127,128)$q$,'permission denied for function recommendation_shared_restaurants','anonymous recommendation read denied','42501');
reset role;
set local role service_role;
select pg_temp.expect_error($q$select * from public.shared_place_entries$q$,'permission denied for view shared_place_entries','service-role entry read denied','42501');
select pg_temp.expect_error($q$select public.create_place_folder('x','x','{}',gen_random_uuid())$q$,'permission denied for function create_place_folder','service-role create denied','42501');
select pg_temp.expect_error($q$select public.recommendation_shared_restaurants(37,38,127,128)$q$,'permission denied for function recommendation_shared_restaurants','service-role recommendation read denied','42501');
reset role;

with rpc(signature) as (values
  ('public.create_place_folder(text,text,uuid[],uuid)'),('public.rename_place_folder(uuid,bigint,text)'),('public.delete_place_folder(uuid,bigint)'),
  ('public.create_place_folder_invite(uuid)'),('public.list_place_folder_invites(uuid)'),('public.revoke_place_folder_invite(uuid)'),
  ('public.preview_place_folder_invite(text)'),('public.accept_place_folder_invite(text,text)'),
  ('public.set_place_folder_display_name(uuid,bigint,text)'),('public.set_place_folder_member_role(uuid,uuid,bigint,text)'),
  ('public.remove_place_folder_member(uuid,uuid,bigint)'),('public.leave_place_folder(uuid)'),('public.set_place_folders_enabled(jsonb)'),
  ('public.add_shared_place(uuid,jsonb,text,text)'),('public.import_saved_places_to_folder(uuid,uuid[])'),
  ('public.update_shared_place(uuid,bigint,text,text)'),('public.delete_shared_place(uuid,bigint)'),('public.set_shared_place_star(uuid,boolean)'),
  ('public.add_avoided_place(jsonb,uuid)'),('public.remove_avoided_place(uuid)'),('public.is_place_folder_member(uuid)'),
  ('public.save_place(jsonb,text,text,boolean)'),('public.save_place_v2(jsonb,text,text,boolean)'),('public.set_place_star(uuid,bigint,boolean)'),
  ('public.set_saved_place_star(uuid,bigint,boolean)'),('public.add_place_favorite(jsonb)'))
insert into tap_results select
  proc.prosecdef and proc.proconfig @> array['search_path=""'] and has_function_privilege('authenticated',proc.oid,'EXECUTE')
  and not has_function_privilege('anon',proc.oid,'EXECUTE') and not has_function_privilege('service_role',proc.oid,'EXECUTE')
  and pg_get_functiondef(proc.oid) not like '%profiles%',
  format('%s is definer, empty search_path, authenticated-only and never reads profiles',rpc.signature)
from rpc join pg_proc proc on proc.oid=rpc.signature::regprocedure;
with internal(signature) as (values
  ('public.lock_place_folder(uuid,boolean)'),('public.lock_place_user(uuid)'),('public.place_folder_role(uuid,uuid)'),('public.place_star_total(uuid)'),
  ('public.assert_place_folder_name(text)'),('public.assert_folder_display_name(text)'),('public.assert_place_id_list(uuid[])'),
  ('public.place_folder_member_json(public.place_folder_members)'),('public.place_folder_members_clear_stars()'),('public.place_star_total_consistent(uuid)'),
  ('public.place_folder_consistent(uuid)'),('public.assert_place_star_total()'),('public.assert_place_folder_consistent()'),
  ('public.place_folder_invite_hash(text)'),('public.shared_place_folder(uuid)'))
insert into tap_results select
  proc.proconfig @> array['search_path=""'] and not has_function_privilege('authenticated',proc.oid,'EXECUTE')
  and not has_function_privilege('anon',proc.oid,'EXECUTE') and not has_function_privilege('service_role',proc.oid,'EXECUTE'),
  format('%s has empty search_path and no client execute',internal.signature)
from internal join pg_proc proc on proc.oid=internal.signature::regprocedure;
insert into tap_results values
((select not prosecdef and proconfig @> array['search_path=""'] and has_function_privilege('authenticated',oid,'EXECUTE') and not has_function_privilege('anon',oid,'EXECUTE')
  and not has_function_privilege('service_role',oid,'EXECUTE') from pg_proc where oid='public.recommendation_shared_restaurants(double precision,double precision,double precision,double precision)'::regprocedure),
  'the recommendation read runs with caller rights and is authenticated-only'),
((select bool_and(reloptions @> array['security_invoker=true']) and bool_and(pg_get_viewdef(oid) not like '%profiles%') from pg_class where oid in ('public.shared_place_entries'::regclass,'public.my_star_entries'::regclass)),'both views use caller security and never read profiles'),
((select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and has_function_privilege('service_role',p.oid,'EXECUTE'))=
  (select array_agg(f order by f) from unnest(array['block_weather_transfer_internal()','begin_play_admission_internal(uuid)','claim_weather_fetch_internal(uuid,text,integer,integer,text,text,uuid)','complete_play_admission_internal(uuid,uuid,text)','consume_daily_api_budget_internal(text,text,integer,uuid)','consume_kakao_oidc_handoff_internal(text,text)','create_kakao_oidc_handoff_internal(text,text,text,timestamp with time zone)','finish_weather_fetch_internal(text,integer,integer,text,text,uuid,bigint,jsonb,integer,text)','insert_weather_snapshot_internal(uuid,uuid,text,timestamp with time zone,timestamp with time zone,jsonb,text,timestamp with time zone)','mark_weather_snapshot_stale_internal(uuid,uuid,text,text)','save_collection_version_internal(uuid,uuid,uuid,text,text,jsonb)','stage_route_candidate_internal(uuid,uuid,jsonb,jsonb)','start_weather_fetch_internal(uuid,text,integer,integer,text,text,uuid,bigint,integer)','take_play_admission_internal(uuid,uuid,text)']) f),
  'service role executes exactly the same fourteen public functions'),
((select bool_and(condeferrable and condeferred) and count(*)=7 from pg_constraint where conname in ('place_stars_z_check_star_total','shared_place_stars_z_check_star_total',
  'place_folder_members_z_check_star_total','place_folders_z_check_invariants','place_folder_members_z_check_invariants','place_folder_preferences_z_check_invariants')
  or (conname='place_stars_z_check_invariants')),'every star and folder invariant check is deferred, and the #123 check is kept'),
((select count(*)=1 from pg_policy where polrelid='public.place_folder_members'::regclass and pg_get_expr(polqual,polrelid) not like '%place_folder_members%'),'the member policy does not refer to its own table');

-- 11. Commit-time invariants also hold with immediate checks, and catch bypasses.
set constraints all immediate;
insert into tap_results values (true,'all constraint checks pass immediately after every RPC above');
set constraints all deferred;
savepoint over_ten;
-- A has eight personal and one shared star. A direct personal star (mirrored, so the
-- #123 checks pass) and a direct shared star bypass the RPC limit: total 11.
insert into public.place_stars(owner_id,slot,saved_place_id) select pg_temp.u(1),5,pg_temp.saved(1,'s11');
insert into public.shared_place_stars(owner_id,shared_place_id) values (pg_temp.u(1),pg_temp.shared(pg_temp.fid('F1'),'s2'));
select pg_temp.expect_error('set constraints all immediate','SAVED_PLACE_STAR_INVARIANT','a commit over ten stars is rejected');
rollback to savepoint over_ten;
savepoint stranger_star;
insert into public.shared_place_stars(owner_id,shared_place_id) values (pg_temp.u(4),pg_temp.shared(pg_temp.fid('F1'),'s2'));
select pg_temp.expect_error('set constraints all immediate','SAVED_PLACE_STAR_INVARIANT','a shared star by a non-member is rejected');
rollback to savepoint stranger_star;
savepoint missing_preference;
delete from public.place_folder_preferences where member_id=pg_temp.u(37) and folder_id=pg_temp.fid('F1');
select pg_temp.expect_error('set constraints all immediate','PLACE_FOLDER_INVARIANT','a member without a preference is rejected');
rollback to savepoint missing_preference;
savepoint second_owner;
select pg_temp.expect_error($q$update public.place_folder_members set role='owner' where folder_id=pg_temp.fid('F1') and member_id=pg_temp.u(37)$q$,'duplicate key value violates unique constraint "place_folder_members_one_owner_key"','a second owner row is rejected','23505');
rollback to savepoint second_owner;
savepoint orphan_folder;
insert into public.place_folders(owner_id,name) values (pg_temp.u(4),'주인 없음');
select pg_temp.expect_error('set constraints all immediate','PLACE_FOLDER_INVARIANT','a folder without its owner row is rejected');
rollback to savepoint orphan_folder;

-- 12. Folder and account deletion cleanup.
select pg_temp.sub(1); set local role authenticated;
select pg_temp.expect_error($q$select public.delete_place_folder(pg_temp.fid('F3'),2)$q$,'PLACE_FOLDER_STALE','a stale folder delete is rejected');
select public.set_shared_place_star(pg_temp.shared(pg_temp.fid('F3'),'more1'),true);
select public.create_place_folder_invite(pg_temp.fid('F3'));
select public.delete_place_folder(pg_temp.fid('F3'),1);
reset role;
insert into tap_results values
((select count(*)=0 from public.shared_places where folder_id=pg_temp.fid('F3')) and (select count(*)=0 from public.place_folder_members where folder_id=pg_temp.fid('F3'))
  and (select count(*)=0 from public.place_folder_preferences where folder_id=pg_temp.fid('F3')) and (select count(*)=0 from public.place_folder_invites where folder_id=pg_temp.fid('F3'))
  and (select count(*)=0 from public.shared_place_stars s where not exists (select 1 from public.shared_places p where p.id=s.shared_place_id)),
  'deleting a folder removes its places, members, preferences, links and stars');
select pg_temp.sub(37); set local role authenticated;
select public.set_shared_place_star(pg_temp.shared(pg_temp.fid('F1'),'s1'),true);
select public.add_avoided_place(pg_temp.place('s1'));
reset role;
delete from auth.users where id=pg_temp.u(37);
insert into tap_results values
((select count(*)=0 from public.place_folder_members where member_id=pg_temp.u(37)) and (select count(*)=0 from public.place_folder_preferences where member_id=pg_temp.u(37))
  and (select count(*)=0 from public.shared_place_stars where owner_id=pg_temp.u(37)) and (select count(*)=0 from public.avoided_places where owner_id=pg_temp.u(37))
  and (select count(*)=1 from public.place_folders where id=pg_temp.fid('F1')),'deleting a member account removes only that member''s rows');
delete from auth.users where id=pg_temp.u(1);
insert into tap_results values
((select count(*)=0 from public.place_folders where owner_id=pg_temp.u(1)) and (select count(*)=0 from public.shared_places where folder_id=pg_temp.fid('F1'))
  and (select count(*)=0 from public.place_folder_members where folder_id=pg_temp.fid('F1')),'deleting an owner account deletes the owner''s folders'),
((select count(*)=0 from public.place_folder_create_requests where owner_id=pg_temp.u(1)) and (select count(*)>0 from public.place_folder_create_requests where owner_id=pg_temp.u(2)),'deleting an account removes only that rider''s create request records'),
((select count(*)=0 from public.place_folder_members where folder_id=pg_temp.fid('F2')),'the owner''s other folders and their members are deleted too');
set constraints all immediate;
insert into tap_results values (true,'account deletion cascades pass every deferred check');

select (case when ok then 'ok ' else 'not ok ' end)||row_number() over()||' - '||description from tap_results;
select '1..'||count(*) from tap_results;
-- Fixed plan: a skipped or row-less assertion fails the suite instead of vanishing.
do $$ begin
  if (select count(*) from tap_results)<>283 then raise exception 'SHARED_PLACE_FOLDERS_PLAN_MISMATCH: % of 283', (select count(*) from tap_results); end if;
  if exists(select 1 from tap_results where not ok) then raise exception 'SHARED_PLACE_FOLDERS_TEST_FAILED'; end if;
end $$;
rollback;
