\set ON_ERROR_STOP on
begin;
-- Local disposable fixtures only; retirement and every fixture roll back together.
create temp table invitation_checks(ok boolean, description text);
grant select, insert on invitation_checks to anon, authenticated, service_role;
insert into auth.users(id, aud, role, raw_app_meta_data, raw_user_meta_data)
values
 ('96000000-0000-4000-8000-000000000001','authenticated','authenticated','{"provider":"kakao"}','{}'),
 ('96000000-0000-4000-8000-000000000002','authenticated','authenticated','{"provider":"kakao"}','{}'),
 ('96000000-0000-4000-8000-000000000003','authenticated','authenticated','{"provider":"kakao"}','{}'),
 ('96000000-0000-4000-8000-000000000004','authenticated','authenticated','{"provider":"kakao"}','{}');
insert into public.memberships(user_id, role, revoked_at) values
 ('96000000-0000-4000-8000-000000000001','admin',null),
 ('96000000-0000-4000-8000-000000000002','rider',null),
 ('96000000-0000-4000-8000-000000000004','rider',now());
insert into public.profiles(id,nickname) values
 ('96000000-0000-4000-8000-000000000001','existing admin'),
 ('96000000-0000-4000-8000-000000000002','existing rider'),
 ('96000000-0000-4000-8000-000000000004','existing revoked rider');
insert into public.invitations(id,token_hash,created_by,created_at,expires_at,consumed_by,consumed_at,revoked_at)
select ('96000000-0000-4000-8000-00000000001'||n)::uuid, encode(extensions.digest(repeat(n::text,43),'sha256'),'hex'),
 '96000000-0000-4000-8000-000000000001', now()-interval '2 days',
 case when n=2 then now()-interval '1 day' else now()+interval '1 day' end,
 case when n=3 then '96000000-0000-4000-8000-000000000002'::uuid end,
 case when n=3 then now()-interval '1 day' end,
 case when n=4 then now()-interval '1 day' end
from generate_series(1,4) n;
create temp table retirement_before as select
 (select jsonb_agg(to_jsonb(m) order by user_id) from public.memberships m where user_id::text like '96000000-%') memberships,
 (select jsonb_agg(to_jsonb(p) order by id) from public.profiles p where id::text like '96000000-%') profiles,
 (select jsonb_agg(to_jsonb(i) order by id) from public.invitations i where id::text like '96000000-%') invitations;
\ir ../../migrations/20261001160839_retire_invitation_enrollment.sql

insert into invitation_checks
select not has_function_privilege(role_name, signature, 'EXECUTE'), role_name||' cannot execute '||signature
from (values ('anon'),('authenticated'),('service_role')) roles(role_name)
cross join (values ('public.create_invite(interval)'),('public.claim_invite(text)'),('public.revoke_invite(uuid)')) functions(signature);
insert into invitation_checks
select not has_table_privilege(role_name,'public.invitations',privilege), role_name||' has no invitation '||privilege
from (values ('anon'),('authenticated'),('service_role')) roles(role_name)
cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) privileges(privilege);
insert into invitation_checks values
 (has_function_privilege('authenticated','public.is_active_member(uuid)','EXECUTE'),'existing member lookup remains available'),
 (has_function_privilege('service_role','public.begin_play_admission_internal(uuid)','EXECUTE'),'Play challenge remains available'),
 (has_function_privilege('service_role','public.take_play_admission_internal(uuid,uuid,text)','EXECUTE'),'Play proof reservation remains available'),
 (has_function_privilege('service_role','public.complete_play_admission_internal(uuid,uuid,text)','EXECUTE'),'verified Play membership remains available');

-- The owner bypasses ACLs, so these assertions prove the retired bodies also deny writes.
do $$ begin
 begin perform public.create_invite(interval '1 day'); raise exception 'unexpected success';
 exception when sqlstate 'P0001' then insert into invitation_checks values(sqlerrm='INVITATIONS_DISABLED','privileged create is disabled'); end;
 begin perform public.claim_invite(repeat('1',43)); raise exception 'unexpected success';
 exception when sqlstate 'P0001' then insert into invitation_checks values(sqlerrm='INVITATIONS_DISABLED','privileged claim is disabled'); end;
 begin perform public.revoke_invite('96000000-0000-4000-8000-000000000011'); raise exception 'unexpected success';
 exception when sqlstate 'P0001' then insert into invitation_checks values(sqlerrm='INVITATIONS_DISABLED','privileged revoke is disabled'); end;
end $$;
set local role authenticated;
do $$ declare member_id uuid; denied boolean; begin
 foreach member_id in array array[
 '96000000-0000-4000-8000-000000000001'::uuid,'96000000-0000-4000-8000-000000000002'::uuid,
 '96000000-0000-4000-8000-000000000003'::uuid,'96000000-0000-4000-8000-000000000004'::uuid] loop
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  denied := false;
  begin perform public.claim_invite(repeat('1',43)); exception when insufficient_privilege then denied := true; end;
  insert into invitation_checks values(denied,member_id::text||' cannot claim legacy invitation');
  denied := false;
  begin perform public.create_invite(interval '7 days'); exception when insufficient_privilege then denied := true; end;
  insert into invitation_checks values(denied,member_id::text||' cannot create legacy invitation');
  denied := false;
  begin perform public.revoke_invite('96000000-0000-4000-8000-000000000011'); exception when insufficient_privilege then denied := true; end;
  insert into invitation_checks values(denied,member_id::text||' cannot revoke legacy invitation');
  insert into invitation_checks values(public.is_active_member()=(member_id in
   ('96000000-0000-4000-8000-000000000001'::uuid,'96000000-0000-4000-8000-000000000002'::uuid)),
   member_id::text||' preserves active/revoked/non-member status');
 end loop;
end $$;
reset role;
insert into invitation_checks values
 ((select memberships from retirement_before) = (select jsonb_agg(to_jsonb(m) order by user_id) from public.memberships m where user_id::text like '96000000-%'),'all membership values and revocations preserved'),
 ((select profiles from retirement_before) = (select jsonb_agg(to_jsonb(p) order by id) from public.profiles p where id::text like '96000000-%'),'all profile values preserved and non-member profile not created'),
 ((select invitations from retirement_before) = (select jsonb_agg(to_jsonb(i) order by id) from public.invitations i where id::text like '96000000-%'),'active/expired/used/revoked invitation history preserved');
select case when ok then 'PASS' else 'FAIL' end as result, description from invitation_checks;
do $$ begin if exists(select 1 from invitation_checks where not coalesce(ok,false)) then raise exception 'INVITATION_RETIREMENT_CHECK_FAILED'; end if; end $$;
select count(*) as passed from invitation_checks;
rollback;
