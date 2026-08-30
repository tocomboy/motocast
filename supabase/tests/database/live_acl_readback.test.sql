with tests(id, ok, description) as (
  values
    (1, not has_function_privilege('anon', 'public.claim_invite(text)', 'EXECUTE'), 'anon cannot execute claim_invite'),
    (2, not has_function_privilege('anon', 'public.create_invite(interval)', 'EXECUTE'), 'anon cannot execute create_invite'),
    (3, not has_function_privilege('anon', 'public.consume_daily_api_budget(text,text,integer)', 'EXECUTE'), 'anon cannot execute budget RPC'),
    (4, has_function_privilege('authenticated', 'public.claim_invite(text)', 'EXECUTE'), 'authenticated can execute claim_invite'),
    (5, has_function_privilege('authenticated', 'public.create_invite(interval)', 'EXECUTE'), 'authenticated can execute create_invite'),
    (6, has_function_privilege('authenticated', 'public.consume_daily_api_budget(text,text,integer)', 'EXECUTE'), 'authenticated can execute budget RPC')
)
select (case when ok then 'ok ' else 'not ok ' end) || id || ' - ' || description
from tests
order by id;

select '1..6';
