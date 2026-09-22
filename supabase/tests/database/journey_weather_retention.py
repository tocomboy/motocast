"""Real local PostgreSQL retention contracts; fresh isolated DB, no provider/hosted access.
Runs the existing cache/security baseline first. Leaves evidence DB intact, no reset/drop.
"""
import concurrent.futures
import json
import runpy
import subprocess
import time
import uuid
from pathlib import Path

root = Path(__file__).resolve().parents[3]
base = runpy.run_path(str(Path(__file__).with_name('journey_weather_cache.py')))
sql, quote, rpc, claim, start = (base[n] for n in ('sql', 'quote', 'rpc', 'claim', 'start'))
DATABASE, CONTAINER, BASE = (base[n] for n in ('DATABASE', 'CONTAINER', 'BASE'))
member, peer, today = (base[n] for n in ('member', 'peer', 'base_date'))
passed = 0


def test(name, body):
    global passed
    body()
    passed += 1
    print('RETENTION PASS: ' + name, flush=True)


def rollback(body):
    return sql('begin;set local role postgres;' + body + ';rollback;').splitlines()


def cache(nx, days=0, state='failed', lease="-interval '1 hour'", retry="-interval '1 hour'", expiry='null', token=None):
    token = token or str(uuid.uuid4())
    return f"""insert into public.weather_fetch_cache(model,nx,ny,base_date,base_time,state,generation,token,lease_until,retry_after,expires_at,items)
      values('short',{nx},1,to_char((timezone('Asia/Seoul',clock_timestamp()))::date-{days},'YYYYMMDD'),'0200',
      '{state}',4,'{token}',clock_timestamp(){lease},clock_timestamp(){retry},{expiry},
      {'\'[{"fixture":true}]\'::jsonb' if state == 'ready' else 'null'});"""


def attempt(token, days=9, completed="clock_timestamp()-interval '8 days'", reserved=9):
    return f"""insert into public.weather_fetch_attempts(token,model,nx,ny,base_date,base_time,generation,
      reserved_day,reserved_bytes,started_at,completed_at,outcome)
      values('{token}','short',1,1,'20000101','0200',1,
      (timezone('Asia/Seoul',clock_timestamp()))::date-{reserved},1048576,
      clock_timestamp()-interval '{days} days',{completed},{'null' if completed == 'null' else "'late'"});"""


def scalar_check(query):
    assert rollback(query)[-1] == 't', query


def acl():
    for role in ('anon', 'authenticated', 'service_role'):
        assert 'permission denied' in sql(f'set role {role};select public.prune_weather_cache_internal();', False)
    scalar_check("select not prosecdef and proconfig=array['search_path=\"\"'] from pg_proc where oid='public.prune_weather_cache_internal(integer)'::regprocedure")
    for limit in ('null', '0', '1001'):
        assert 'INVALID_RETENTION_BATCH' in sql(f'set role postgres;select public.prune_weather_cache_internal({limit});', False)


test('owner-only invoker and bounded inputs', acl)


def payloads():
    q = cache(101, state='ready', expiry="clock_timestamp()-interval '1 second'")
    q += cache(102, state='ready', expiry="clock_timestamp()+interval '1 minute'")
    q += "select public.prune_weather_cache_internal();"
    q += "select (select state='expired' and items is null and generation=4 from public.weather_fetch_cache where nx=101 and ny=1) and (select state='ready' and items is not null from public.weather_fetch_cache where nx=102 and ny=1);"
    scalar_check(q)


test('expired payload removed, fresh payload and generation retained', payloads)


def protected():
    q = cache(103, 9, 'claimed', lease="+interval '1 minute'")
    q += cache(104, 9, 'fetching', retry="+interval '1 minute'")
    q += cache(105, 9, 'failed', retry="+interval '1 minute'")
    q += cache(106, 9, 'ready', expiry="clock_timestamp()+interval '1 minute'")
    q += cache(107, 2) + cache(108, 3)
    q += "select public.prune_weather_cache_internal();select count(*)=5 from public.weather_fetch_cache where ny=1 and nx between 103 and 108;"
    scalar_check(q)


test('lease, in-flight cooldown, failure cooldown, expiry and deletion date boundary', protected)


def admission():
    before = sql('select count(*) from public.weather_fetch_cache;')
    for offset in (-2, 1):
        date = sql(f"select to_char((timezone('Asia/Seoul',clock_timestamp()))::date+{offset},'YYYYMMDD');")
        assert claim(('ultra', 109, 1, date, '1000'), str(uuid.uuid4()), member)['status'] == 'superseded'
    yesterday = sql("select to_char((timezone('Asia/Seoul',clock_timestamp()))::date-1,'YYYYMMDD');")
    assert claim(('ultra', 110, 1, yesterday, '1000'), str(uuid.uuid4()), member)['status'] == 'owner'
    assert int(sql('select count(*) from public.weather_fetch_cache;')) == int(before) + 1


test('Seoul today/yesterday admission, older and future keys create no rows', admission)


def replay():
    token = str(uuid.uuid4())
    date = sql("select to_char((timezone('Asia/Seoul',clock_timestamp()))::date-9,'YYYYMMDD');")
    args = f"'short',111,1,'{date}','0200','{token}'"
    q = cache(111, 9, token=token)
    q += 'select public.prune_weather_cache_internal();set local role service_role;'
    q += f"select public.claim_weather_fetch_internal('{member}',{args})->>'status';"
    q += f"select public.start_weather_fetch_internal('{member}',{args},4,100)->>'status';"
    q += f"select public.finish_weather_fetch_internal({args},4,null,null,'oversize');"
    result = rollback(q)
    assert result[-3:] == ['superseded', 'superseded', 'f'], result


test('deleted key cannot be reclaimed/dispatched/published by late old worker', replay)


def renewal():
    token = str(uuid.uuid4())
    q = cache(112, state='ready', expiry="clock_timestamp()-interval '1 second'", token=token)
    q += 'select public.prune_weather_cache_internal();set local role service_role;'
    args = f"'short',112,1,'{today}','0200'"
    q += f"select public.claim_weather_fetch_internal('{member}',{args},'{token}')->>'status';"
    q += f"select public.claim_weather_fetch_internal('{peer}',{args},'{uuid.uuid4()}')->>'generation';"
    assert rollback(q)[-2:] == ['superseded', '5']


test('payload cleanup preserves token replay denial and new owner generation', renewal)


def attempts():
    tokens = [str(uuid.uuid4()) for _ in range(7)]
    q = attempt(tokens[0]) + attempt(tokens[1], completed='null')
    q += attempt(tokens[2], days=6) + attempt(tokens[3], completed='clock_timestamp()')
    q += attempt(tokens[4], reserved=7) + attempt(tokens[5], completed='null')
    q += cache(113, token=tokens[5])
    q += attempt(tokens[6], completed='null', reserved=0)
    q += 'select public.prune_weather_cache_internal();'
    q += 'select count(*)=5 from public.weather_fetch_attempts where token in (' + ','.join(map(quote, tokens)) + ');'
    out = rollback(q)
    metrics = json.loads(out[-2])
    assert out[-1] == 't' and metrics['attemptRows'] == 2 and metrics['unknownAttempts'] == 1, out


test('7-day completed/unknown attempts pruned; recent completion/reservation/reference retained', attempts)


def budget_integrity():
    q = "create temporary table original_usage as select to_jsonb(x) v from public.weather_usage_daily x;"
    q += "create temporary table original_operations as select to_jsonb(x) v from public.api_usage_daily x;"
    q += cache(114, 9) + attempt(str(uuid.uuid4()), completed='null')
    q += "select public.prune_weather_cache_internal();"
    q += "select not exists((select v from original_usage except select to_jsonb(x) from public.weather_usage_daily x) union all (select to_jsonb(x) from public.weather_usage_daily x except select v from original_usage)) and not exists((select v from original_operations except select to_jsonb(x) from public.api_usage_daily x) union all (select to_jsonb(x) from public.api_usage_daily x except select v from original_operations));"
    scalar_check(q)


test('both usage ledgers unchanged including unknown request charges', budget_integrity)


def bounded():
    q = ''.join(cache(nx, 9, 'ready', expiry="clock_timestamp()-interval '1 second'") for nx in range(115, 120))
    q += ''.join(attempt(str(uuid.uuid4())) for _ in range(5))
    q += 'select public.prune_weather_cache_internal(2);'
    r = json.loads(rollback(q)[-1])
    assert r['payloads'] == r['cacheRows'] == r['attemptRows'] == 2, r


test('every deletion/payload batch respects explicit row limit', bounded)


def hold_lock(query):
    proc = subprocess.Popen(BASE, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
    proc.stdin.write('begin;set role postgres;' + query + ";select 'LOCKED';\n")
    proc.stdin.flush()
    # The sentinel is emitted only after the SQL lock is actually acquired.
    while True:
        line = proc.stdout.readline().strip()
        if line == 'LOCKED':
            return proc
        assert proc.poll() is None, 'lock holder exited before acquiring lock'


def release(proc):
    _, stderr = proc.communicate('rollback;\n', timeout=10)
    assert proc.returncode == 0, stderr


def locked_rows():
    sql(cache(120, 9) + cache(121, 9))
    holder = hold_lock('select 1 from public.weather_fetch_cache where nx=120 and ny=1 for update')
    try:
        out = json.loads(sql("set role postgres;set statement_timeout='2s';select public.prune_weather_cache_internal();"))
        assert out['cacheRows'] == 1, out
        assert sql('select count(*) from public.weather_fetch_cache where nx=120 and ny=1;') == '1'
    finally:
        release(holder)
    assert json.loads(sql('set role postgres;select public.prune_weather_cache_internal();'))['cacheRows'] == 1


test('busy cache row skipped without blocking and removed after lock release', locked_rows)


def overlapping():
    holder = hold_lock('select pg_advisory_xact_lock(724010,2)')
    try:
        assert json.loads(sql("set role postgres;set statement_timeout='2s';select public.prune_weather_cache_internal();")) == {'status': 'busy'}
    finally:
        release(holder)


test('overlapping maintenance returns busy without taking request budget lock', overlapping)


def concurrent_claim_cleanup():
    # Current material stays addressable while expired payloads are purged.
    token = str(uuid.uuid4())
    sql(cache(122, state='ready', expiry="clock_timestamp()-interval '1 second'", token=token))
    key = ('short', 122, 1, today, '0200')
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(claim, key, str(uuid.uuid4()), member)
        b = pool.submit(sql, 'set role postgres;select public.prune_weather_cache_internal();')
        owner, _ = a.result(), b.result()
    assert owner['status'] == 'owner' and owner['generation'] == 5, owner
    assert sql('select state from public.weather_fetch_cache where nx=122 and ny=1;') == 'claimed'


test('real two-connection claim/cleanup race preserves a single new owner', concurrent_claim_cleanup)

metrics = {'database': DATABASE, 'container': CONTAINER, 'retention_PASS': passed, 'FAIL': 0,
           'ERROR': 0, 'SKIP': 0, 'provider_calls': 0, 'cron': 'NOT_RUN'}
(root / '.supabase/journey-weather-retention-run.json').write_text(json.dumps(metrics, indent=2)+'\n', encoding='utf-8')
print(f'RETENTION RESULT: {passed} PASS / 0 FAIL / 0 ERROR / 0 SKIP; evidence DB retained', flush=True)
