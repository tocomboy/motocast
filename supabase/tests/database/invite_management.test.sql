\set ON_ERROR_STOP on
begin;
-- Candidate function and synthetic records are rolled back together.
\ir ../../migrations/20260921155004_invite_management_revoke.sql
create temp table invitation_checks(ok boolean, description text);
grant select, insert on invitation_checks to authenticated;
insert into auth.users(id, aud, role, raw_app_meta_data, raw_user_meta_data)
values
 ('96000000-0000-4000-8000-000000000001','authenticated','authenticated','{"provider":"kakao"}','{}'),
 ('96000000-0000-4000-8000-000000000002','authenticated','authenticated','{"provider":"kakao"}','{}'),
 ('96000000-0000-4000-8000-000000000003','authenticated','authenticated','{"provider":"kakao"}','{}'),
 ('96000000-0000-4000-8000-000000000004','authenticated','authenticated','{"provider":"kakao"}','{}');
insert into public.memberships(user_id, role, revoked_at) values
 ('96000000-0000-4000-8000-000000000001','admin',null),
 ('96000000-0000-4000-8000-000000000002','rider',null),
 ('96000000-0000-4000-8000-000000000004','admin',now());

insert into invitation_checks values
 (not has_function_privilege('anon','public.revoke_invite(uuid)','EXECUTE'),'anonymous execution denied'),
 (not has_function_privilege('service_role','public.revoke_invite(uuid)','EXECUTE'),'service-role allowlist preserved'),
 (not has_table_privilege('authenticated','public.invitations','UPDATE'),'direct update remains denied');

set local role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',true);
create temp table issued_invites as select * from public.create_invite(interval '7 days');
create temp table chosen_invite as select id from public.invitations
 where token_hash=encode(extensions.digest((select invite_token from issued_invites),'sha256'),'hex');
insert into invitation_checks values
 ((select count(*)=1 from chosen_invite),'admin sees the newly issued invitation');

select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000002',true);
insert into invitation_checks values ((select count(*)=0 from public.invitations),'rider cannot list invitation records');
do $$ begin
 begin perform public.revoke_invite((select id from chosen_invite)); raise exception 'unexpected success';
 exception when sqlstate 'P0001' then
   insert into invitation_checks values(sqlerrm='ADMIN_REQUIRED','rider revoke denied');
 end;
end $$;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000004',true);
do $$ begin
 begin perform public.revoke_invite((select id from chosen_invite)); raise exception 'unexpected success';
 exception when sqlstate 'P0001' then
   insert into invitation_checks values(sqlerrm='ADMIN_REQUIRED','revoked administrator denied');
 end;
end $$;

select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',true);
insert into invitation_checks values (public.revoke_invite((select id from chosen_invite))='revoked','active invitation revoked');
create temp table first_revocation as select revoked_at from public.invitations where id=(select id from chosen_invite);
insert into invitation_checks values
 (public.revoke_invite((select id from chosen_invite))='revoked','same revoke replay succeeds'),
 ((select revoked_at=(select revoked_at from first_revocation) from public.invitations where id=(select id from chosen_invite)),'replay preserves first revocation timestamp');
do $$ begin
 begin perform public.revoke_invite(null); raise exception 'unexpected success';
 exception when sqlstate 'P0001' then insert into invitation_checks values(sqlerrm='INVALID_INVITE_ID','null target denied'); end;
 begin perform public.revoke_invite('96000000-0000-4000-8000-000000000099'); raise exception 'unexpected success';
 exception when sqlstate 'P0001' then insert into invitation_checks values(sqlerrm='INVITE_NOT_FOUND','missing target denied'); end;
end $$;

select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000003',true);
do $$ begin
 begin perform public.claim_invite((select invite_token from issued_invites)); raise exception 'unexpected success';
 exception when sqlstate 'P0001' then insert into invitation_checks values(sqlerrm='INVALID_INVITE','revoked invitation cannot be claimed'); end;
end $$;
reset role;
insert into invitation_checks values
 ((select count(*)=0 from public.memberships where user_id='96000000-0000-4000-8000-000000000003'),'revoked invitation creates no membership');

insert into public.invitations(id,token_hash,created_by,created_at,expires_at,consumed_at,consumed_by) values
 ('96000000-0000-4000-8000-000000000010',repeat('a',64),'96000000-0000-4000-8000-000000000001',now()-interval '2 days',now()-interval '1 day',null,null),
 ('96000000-0000-4000-8000-000000000011',repeat('b',64),'96000000-0000-4000-8000-000000000001',now()-interval '1 day',now()+interval '1 day',now(),'96000000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',true);
insert into invitation_checks values
 (public.revoke_invite('96000000-0000-4000-8000-000000000010')='expired','expired invitation is not rewritten'),
 (public.revoke_invite('96000000-0000-4000-8000-000000000011')='used','used invitation does not revoke member access');
reset role;
insert into invitation_checks values
 ((select bool_and(revoked_at is null) from public.invitations where id in ('96000000-0000-4000-8000-000000000010','96000000-0000-4000-8000-000000000011')),'terminal records preserved'),
 ((select revoked_at is null from public.memberships where user_id='96000000-0000-4000-8000-000000000002'),'existing member remains active');
select case when ok then 'PASS' else 'FAIL' end as result, description from invitation_checks;
do $$ begin if exists(select 1 from invitation_checks where not coalesce(ok,false)) then raise exception 'INVITATION_CHECK_FAILED'; end if; end $$;
select count(*) as passed from invitation_checks;
rollback;
