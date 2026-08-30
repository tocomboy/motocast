\set ON_ERROR_STOP on

begin;

create temp table acl_results(
  id bigint generated always as identity,
  ok boolean not null,
  description text not null
) on commit drop;

insert into acl_results(ok, description) values
  (not has_function_privilege('anon', 'public.claim_invite(text)', 'EXECUTE'), 'anon cannot execute claim_invite'),
  (not has_function_privilege('anon', 'public.create_invite(interval)', 'EXECUTE'), 'anon cannot execute create_invite'),
  (not has_function_privilege('anon', 'public.consume_daily_api_budget(text,text,integer)', 'EXECUTE'), 'anon cannot execute budget RPC'),
  (has_function_privilege('authenticated', 'public.claim_invite(text)', 'EXECUTE'), 'authenticated can execute claim_invite'),
  (has_function_privilege('authenticated', 'public.create_invite(interval)', 'EXECUTE'), 'authenticated can execute create_invite'),
  (not has_function_privilege('authenticated', 'public.consume_daily_api_budget(text,text,integer)', 'EXECUTE'), 'authenticated cannot provide a budget limit'),
  (not has_function_privilege('authenticated', 'public.save_collection_version(uuid,text,text,jsonb)', 'EXECUTE'), 'browser cannot save unverified collection JSON'),
  (not has_function_privilege('authenticated', 'public.insert_weather_snapshot_internal(uuid,uuid,text,timestamptz,timestamptz,jsonb,text,timestamptz)', 'EXECUTE'), 'browser cannot insert weather snapshots'),
  (not has_function_privilege('anon', 'public.create_kakao_oidc_handoff_internal(text,text,text,timestamptz)', 'EXECUTE'), 'anon cannot create OIDC handoffs'),
  (not has_function_privilege('authenticated', 'public.create_kakao_oidc_handoff_internal(text,text,text,timestamptz)', 'EXECUTE'), 'authenticated cannot create OIDC handoffs'),
  (not has_function_privilege('anon', 'public.consume_kakao_oidc_handoff_internal(text,text)', 'EXECUTE'), 'anon cannot consume OIDC handoffs'),
  (not has_function_privilege('authenticated', 'public.consume_kakao_oidc_handoff_internal(text,text)', 'EXECUTE'), 'authenticated cannot consume OIDC handoffs'),
  ((select relrowsecurity from pg_class where oid = 'public.kakao_oidc_handoffs'::regclass), 'OIDC handoff table has RLS enabled'),
  (not has_table_privilege('authenticated', 'public.trips', 'TRUNCATE'), 'browser cannot truncate trips'),
  (not has_table_privilege('authenticated', 'public.weather_snapshots', 'REFERENCES'), 'browser cannot create references to weather snapshots'),
  (not has_table_privilege('authenticated', 'public.share_links', 'TRIGGER'), 'browser cannot create triggers on shares'),
  (not has_table_privilege('anon', 'public.riding_collections', 'TRUNCATE'), 'anonymous role cannot truncate collections'),
  (not has_table_privilege('anon', 'public.memberships', 'REFERENCES'), 'anonymous role cannot create references to memberships');

with protected_tables(table_name) as (
  values
    ('profiles'),
    ('memberships'),
    ('invitations'),
    ('riding_collections'),
    ('collection_versions'),
    ('trips'),
    ('trip_waypoints'),
    ('route_cache'),
    ('weather_snapshots'),
    ('share_links'),
    ('api_usage_daily'),
    ('route_plan_drafts'),
    ('share_preview_grants'),
    ('kakao_oidc_handoffs')
), dml(privilege_name) as (
  values ('INSERT'), ('UPDATE'), ('DELETE')
)
insert into acl_results(ok, description)
select
  not has_table_privilege('service_role', format('public.%I', table_name), privilege_name),
  format('service role cannot use %s directly on %s', privilege_name, table_name)
from protected_tables cross join dml
order by table_name, privilege_name;

insert into acl_results(ok, description) values
  (not has_table_privilege('service_role', 'public.route_plan_drafts', 'SELECT'), 'service role cannot read staged route internals directly'),
  (not has_table_privilege('service_role', 'public.share_preview_grants', 'SELECT'), 'service role cannot read preview capability hashes'),
  (not has_table_privilege('service_role', 'public.kakao_oidc_handoffs', 'SELECT'), 'service role cannot read encrypted OIDC handoffs directly'),
  (not has_table_privilege('service_role', 'public.trips', 'TRUNCATE'), 'service role cannot truncate trip aggregates'),
  (not has_table_privilege('service_role', 'public.weather_snapshots', 'REFERENCES'), 'service role cannot create references from weather aggregates'),
  (not has_table_privilege('service_role', 'public.share_links', 'TRIGGER'), 'service role cannot attach triggers to immutable shares');

with allowed(function_signature) as (
  values
    ('public.consume_daily_api_budget_internal(text,text,integer,uuid)'),
    ('public.save_collection_version_internal(uuid,uuid,text,text,jsonb)'),
    ('public.stage_route_candidate_internal(uuid,uuid,jsonb,jsonb)'),
    ('public.insert_weather_snapshot_internal(uuid,uuid,text,timestamptz,timestamptz,jsonb,text,timestamptz)'),
    ('public.mark_weather_snapshot_stale_internal(uuid,uuid,text,text)'),
    ('public.create_kakao_oidc_handoff_internal(text,text,text,timestamptz)'),
    ('public.consume_kakao_oidc_handoff_internal(text,text)')
)
insert into acl_results(ok, description)
select
  has_function_privilege('service_role', function_signature, 'EXECUTE'),
  format('service role can execute reviewed internal RPC %s', function_signature)
from allowed;

with denied(function_signature) as (
  values
    ('public.claim_invite(text)'),
    ('public.create_invite(interval)'),
    ('public.consume_daily_api_budget(text,text,integer)'),
    ('public.save_collection_version(uuid,text,text,jsonb)'),
    ('public.save_trip_plan(jsonb,jsonb)'),
    ('public.finalize_trip_plan(uuid,uuid)'),
    ('public.select_trip_candidate(uuid,text)'),
    ('public.delete_riding_collection(uuid)'),
    ('public.preview_trip_share(uuid)'),
    ('public.publish_trip_share(uuid,text)'),
    ('public.revoke_share(uuid)'),
    ('public.resolve_share(text)'),
    ('public.build_trip_share_snapshot(uuid,uuid)'),
    ('public.share_place(jsonb)'),
    ('public.share_route_point(jsonb)'),
    ('public.share_route(jsonb)'),
    ('public.share_weather_segments(jsonb)')
)
insert into acl_results(ok, description)
select
  not has_function_privilege('service_role', function_signature, 'EXECUTE'),
  format('service role cannot bypass ownership through RPC %s', function_signature)
from denied;

with allowed(function_oid) as (
  values
    ('public.consume_daily_api_budget_internal(text,text,integer,uuid)'::regprocedure::oid),
    ('public.save_collection_version_internal(uuid,uuid,text,text,jsonb)'::regprocedure::oid),
    ('public.stage_route_candidate_internal(uuid,uuid,jsonb,jsonb)'::regprocedure::oid),
    ('public.insert_weather_snapshot_internal(uuid,uuid,text,timestamptz,timestamptz,jsonb,text,timestamptz)'::regprocedure::oid),
    ('public.mark_weather_snapshot_stale_internal(uuid,uuid,text,text)'::regprocedure::oid),
    ('public.create_kakao_oidc_handoff_internal(text,text,text,timestamptz)'::regprocedure::oid),
    ('public.consume_kakao_oidc_handoff_internal(text,text)'::regprocedure::oid)
)
insert into acl_results(ok, description)
select
  not has_function_privilege('service_role', function.oid, 'EXECUTE'),
  format('service role cannot execute non-allowlisted public function %s', function.oid::regprocedure)
from pg_proc function
join pg_namespace namespace on namespace.oid = function.pronamespace
where namespace.nspname = 'public'
  and not exists (
    select 1 from allowed
    where allowed.function_oid = function.oid
  );

insert into acl_results(ok, description)
select
  not exists (
    select 1
    from pg_default_acl defaults
    join pg_namespace namespace on namespace.oid = defaults.defaclnamespace
    cross join lateral aclexplode(defaults.defaclacl) privilege
    left join pg_roles grantee on grantee.oid = privilege.grantee
    where namespace.nspname = 'public'
      and defaults.defaclobjtype = 'r'
      and defaults.defaclrole = 'postgres'::regrole
      and grantee.rolname = 'service_role'
      and privilege.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'public table defaults do not grant service-role direct DML';

insert into acl_results(ok, description)
select
  not exists (
    select 1
    from pg_default_acl defaults
    join pg_namespace namespace on namespace.oid = defaults.defaclnamespace
    cross join lateral aclexplode(defaults.defaclacl) privilege
    left join pg_roles grantee on grantee.oid = privilege.grantee
    where namespace.nspname = 'public'
      and defaults.defaclobjtype = 'f'
      and defaults.defaclrole = 'postgres'::regrole
      and (privilege.grantee = 0 or grantee.rolname = 'service_role')
      and privilege.privilege_type = 'EXECUTE'
  ),
  'public function defaults do not grant service-role inherited execute';

set local role postgres;
create table public.motocast_acl_future_probe(id bigint primary key);
reset role;
insert into acl_results(ok, description) values
  (
    not has_table_privilege('service_role', 'public.motocast_acl_future_probe', 'INSERT,UPDATE,DELETE'),
    'a rollback-only future public table does not grant service-role direct DML'
  );

select (case when ok then 'ok ' else 'not ok ' end) || id || ' - ' || description
from acl_results
order by id;
select '1..' || count(*) from acl_results;

do $$
begin
  if exists (select 1 from acl_results where not ok) then
    raise exception 'live ACL readback failed';
  end if;
end;
$$;

rollback;
