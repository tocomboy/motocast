with tests(id, ok, description) as (
  values
    (1, not has_function_privilege('anon', 'public.claim_invite(text)', 'EXECUTE'), 'anon cannot execute claim_invite'),
    (2, not has_function_privilege('anon', 'public.create_invite(interval)', 'EXECUTE'), 'anon cannot execute create_invite'),
    (3, not has_function_privilege('anon', 'public.consume_daily_api_budget(text,text,integer)', 'EXECUTE'), 'anon cannot execute budget RPC'),
    (4, has_function_privilege('authenticated', 'public.claim_invite(text)', 'EXECUTE'), 'authenticated can execute claim_invite'),
    (5, has_function_privilege('authenticated', 'public.create_invite(interval)', 'EXECUTE'), 'authenticated can execute create_invite'),
    (6, not has_function_privilege('authenticated', 'public.consume_daily_api_budget(text,text,integer)', 'EXECUTE'), 'authenticated cannot provide a budget limit'),
    (7, has_function_privilege('service_role', 'public.consume_daily_api_budget_internal(text,text,integer,uuid)', 'EXECUTE'), 'trusted Edge role can execute internal budget RPC'),
    (8, not has_function_privilege('authenticated', 'public.save_collection_version(uuid,text,text,jsonb)', 'EXECUTE'), 'browser cannot save unverified collection JSON'),
    (9, has_function_privilege('service_role', 'public.save_collection_version_internal(uuid,uuid,text,text,jsonb)', 'EXECUTE'), 'trusted Edge role can save verified collection versions'),
    (10, not has_function_privilege('authenticated', 'public.insert_weather_snapshot_internal(uuid,uuid,text,timestamptz,timestamptz,jsonb,text,timestamptz)', 'EXECUTE'), 'browser cannot insert weather snapshots'),
    (11, has_function_privilege('service_role', 'public.insert_weather_snapshot_internal(uuid,uuid,text,timestamptz,timestamptz,jsonb,text,timestamptz)', 'EXECUTE'), 'trusted Edge role can persist route-bound weather'),
    (12, not has_table_privilege('authenticated', 'public.trips', 'TRUNCATE'), 'browser cannot truncate trips'),
    (13, not has_table_privilege('authenticated', 'public.weather_snapshots', 'REFERENCES'), 'browser cannot create references to weather snapshots'),
    (14, not has_table_privilege('authenticated', 'public.share_links', 'TRIGGER'), 'browser cannot create triggers on shares'),
    (15, not has_table_privilege('anon', 'public.riding_collections', 'TRUNCATE'), 'anonymous role cannot truncate collections'),
    (16, not has_table_privilege('anon', 'public.memberships', 'REFERENCES'), 'anonymous role cannot create references to memberships'),
    (17, not has_table_privilege('service_role', 'public.riding_collections', 'INSERT'), 'service role cannot bypass collection aggregate RPCs'),
    (18, not has_table_privilege('service_role', 'public.trips', 'UPDATE'), 'service role cannot bypass trip aggregate RPCs'),
    (19, not has_table_privilege('service_role', 'public.route_cache', 'DELETE'), 'service role cannot directly mutate provider routes'),
    (20, not has_table_privilege('service_role', 'public.weather_snapshots', 'INSERT'), 'service role cannot bypass route-bound weather RPCs'),
    (21, not has_table_privilege('service_role', 'public.share_links', 'UPDATE'), 'service role cannot bypass immutable share RPCs'),
    (22, not has_table_privilege('service_role', 'public.route_plan_drafts', 'SELECT'), 'service role cannot read staged route internals directly'),
    (23, not has_table_privilege('service_role', 'public.share_preview_grants', 'SELECT'), 'service role cannot read preview capability hashes'),
    (24, not has_table_privilege('service_role', 'public.trips', 'TRUNCATE'), 'service role cannot truncate trip aggregates')
)
select (case when ok then 'ok ' else 'not ok ' end) || id || ' - ' || description
from tests
order by id;

select '1..24';
