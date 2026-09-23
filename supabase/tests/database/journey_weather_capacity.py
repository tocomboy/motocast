"""Storage admission against real isolated PostgreSQL, including racing callers.
Replays all migrations and the existing security/cache/retention suites first.
No hosted writes or provider calls. Synthetic committed evidence is retained.
"""
import concurrent.futures
import json
import runpy
import subprocess
import time
import uuid
from pathlib import Path

retention = runpy.run_path(str(Path(__file__).with_name('journey_weather_retention.py')))
base = retention['base']
sql, quote, claim, start, finish, where, material, key_args = (
    base[n] for n in ('sql', 'quote', 'claim', 'start', 'finish', 'where', 'material', 'key_args'))
member, today, BASE, root = (base[n] for n in ('member', 'base_date', 'BASE', 'root'))
passed = 0
durations = {}


def test(name, body):
    global passed
    moment = time.monotonic()
    body()
    durations[name] = round(time.monotonic() - moment, 3)
    passed += 1
    print(f'CAPACITY PASS: {name} ({durations[name]}s)', flush=True)


def policy(values):
    sql('update public.weather_budget_policy set ' + values + ';')


def defaults():
    policy('max_cache_rows=10000,max_attempt_rows=10000,max_payload_bytes=67108864,'
           'max_relation_bytes=134217728,max_database_bytes=250000000')


def key(nx):
    return ('short', nx, 2, today, '0200')


def claim_sql(k, token):
    return f"select public.claim_weather_fetch_internal('{member}',{','.join(key_args(k))},'{token}');"


def start_sql(k, token, generation):
    return f"select public.start_weather_fetch_internal('{member}',{','.join(key_args(k))},'{token}',{generation},100);"


def rejected(query):
    err = sql('set role service_role;' + query, False)
    assert 'WEATHER_STORAGE_CAPACITY' in err, err


def usage():
    return sql("select jsonb_agg(to_jsonb(t) order by usage_date) from public.weather_usage_daily t;")


# Separate workload allocation in this task-owned synthetic DB; never erase usage.
policy('daily_calls=100')
sql('update public.weather_usage_daily set hard_calls=100;')


def acl():
    for role in ('anon', 'authenticated', 'service_role'):
        assert 'permission denied' in sql(f'set role {role};select public.assert_weather_capacity_internal(1,0,0);', False)
        assert 'permission denied' in sql(f'set role {role};update public.weather_budget_policy set max_cache_rows=10000;', False)
    assert sql("select not prosecdef and proconfig=array['search_path=\"\"'] from pg_proc where oid='public.assert_weather_capacity_internal(integer,integer,bigint)'::regprocedure;") == 't'
    for args in ('null,0,0', '-1,0,0', '0,-1,0', '0,0,-1'):
        assert 'INVALID_WEATHER_CAPACITY' in sql(f'set role postgres;select public.assert_weather_capacity_internal({args});', False)


test('owner-only guard, policy protection and invalid inputs', acl)


def metadata():
    before, charged = sql('select count(*) from public.weather_fetch_cache;'), usage()
    policy('max_cache_rows=' + before)
    rejected(claim_sql(key(1), uuid.uuid4()))
    assert sql('select count(*) from public.weather_fetch_cache;') == before
    assert usage() == charged
    defaults()


test('full cache rejects a new key before row creation or charging', metadata)


def race_cache():
    before = int(sql('select count(*) from public.weather_fetch_cache;'))
    policy(f'max_cache_rows={before+1}')
    def contender(nx):
        return subprocess.run(BASE, input='set role service_role;' + claim_sql(key(nx), uuid.uuid4()),
                              text=True, encoding='utf-8', capture_output=True, timeout=25)
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(contender, range(2, 12)))
    assert sum(r.returncode == 0 for r in results) == 1
    assert sum('WEATHER_STORAGE_CAPACITY' in r.stderr for r in results) == 9
    assert int(sql('select count(*) from public.weather_fetch_cache;')) == before + 1
    defaults()


test('ten distinct keys race for one metadata slot; exactly one commits', race_cache)


def attempts():
    token = str(uuid.uuid4()); k = key(12)
    generation = claim(k, token, member)['generation']
    before = sql('select count(*) from public.weather_fetch_attempts;'); charged = usage()
    policy('max_attempt_rows=' + before)
    rejected(start_sql(k, token, generation))
    assert sql('select count(*) from public.weather_fetch_attempts;') == before
    assert usage() == charged
    assert sql('select state from public.weather_fetch_cache where ' + where(k)) == 'claimed'
    defaults()


test('full attempt ledger prevents dispatch and leaves both usage/state unchanged', attempts)


def race_payload():
    owners = [(key(nx), str(uuid.uuid4())) for nx in (13, 14)]
    generations = [claim(k, t, member)['generation'] for k, t in owners]
    occupied = int(sql('select coalesce(sum(storage_bytes),0) from public.weather_fetch_cache;'))
    policy(f'max_payload_bytes={occupied+1048576}')
    before = int(sql('select sum(calls) from public.weather_usage_daily;'))
    def contender(i):
        k, token = owners[i]
        return subprocess.run(BASE, input='set role service_role;' + start_sql(k, token, generations[i]),
                              text=True, encoding='utf-8', capture_output=True, timeout=25)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(contender, range(2)))
    assert sum(r.returncode == 0 for r in results) == 1
    assert sum('WEATHER_STORAGE_CAPACITY' in r.stderr for r in results) == 1
    assert int(sql('select sum(calls) from public.weather_usage_daily;')) == before+1
    assert int(sql('select sum(storage_bytes) from public.weather_fetch_cache;')) == occupied+1048576
    winner = next(i for i, r in enumerate(results) if r.returncode == 0)
    k, token = owners[winner]
    # Already admitted bytes may complete even if an operator lowers all cutoffs.
    policy('max_payload_bytes=1,max_relation_bytes=1,max_database_bytes=1,max_cache_rows=1,max_attempt_rows=1')
    assert finish(k, token, generations[winner], material(k))
    assert sql('select storage_bytes=octet_length(items::text) from public.weather_fetch_cache where ' + where(k)) == 't'
    assert claim(k, str(uuid.uuid4()), member)['status'] == 'hit'
    assert int(sql('select sum(calls) from public.weather_usage_daily;')) == before+1
    defaults()


test('last payload reservation is atomic; admitted finish and cache hit survive full cutoffs', race_payload)


def physical():
    token = str(uuid.uuid4()); k = key(15)
    generation = claim(k, token, member)['generation']; charged = usage()
    for field in ('max_relation_bytes', 'max_database_bytes'):
        policy(field + '=1')
        rejected(claim_sql(key(16), uuid.uuid4()))
        rejected(start_sql(k, token, generation))
        assert usage() == charged
        defaults()


test('physical relation and database cutoffs reject claim and dispatch independently', physical)


def failure():
    token = str(uuid.uuid4()); k = key(17)
    generation = claim(k, token, member)['generation']
    assert start(k, token, generation, member)['status'] == 'permit'
    charged = usage()
    policy('max_payload_bytes=1,max_relation_bytes=1,max_database_bytes=1')
    assert finish(k, token, generation, failure='timeout')
    assert sql('select storage_bytes from public.weather_fetch_cache where ' + where(k)) == '0'
    assert usage() == charged
    assert claim(k, str(uuid.uuid4()), member)['status'] == 'wait'
    defaults()


test('timeout at full capacity frees storage reservation but retains charge and cooldown', failure)


def cleanup():
    # Obsolete synthetic row is the sole removable capacity slot in this scenario.
    sql(retention['cache'](145, days=9))
    before = int(sql('select count(*) from public.weather_fetch_cache;'))
    charged = usage(); policy(f'max_cache_rows={before}')
    rejected(claim_sql(key(18), uuid.uuid4()))
    policy('max_relation_bytes=1,max_database_bytes=1')
    result = json.loads(sql('set role postgres;select public.prune_weather_cache_internal();'))
    assert result['cacheRows'] >= 1
    assert usage() == charged
    policy('max_relation_bytes=134217728,max_database_bytes=250000000')
    assert claim(key(18), str(uuid.uuid4()), member)['status'] == 'owner'
    defaults()


test('maintenance runs at full capacity; deleted slot is reusable without budget refund', cleanup)


def expiry():
    # Generated accounting follows the actual payload removal, not a stale counter.
    result = retention['rollback'](retention['cache'](146, state='ready', expiry="clock_timestamp()-interval '1 second'") +
        "select storage_bytes>0 from public.weather_fetch_cache where nx=146 and ny=1;"
        "update public.weather_budget_policy set max_payload_bytes=1,max_database_bytes=1;"
        "select public.prune_weather_cache_internal();"
        "select storage_bytes=0 and items is null from public.weather_fetch_cache where nx=146 and ny=1;")
    assert result[0] == result[-1] == 't', result


test('expired JSON releases exact stored-byte accounting during cleanup', expiry)


def attempt_cleanup():
    token = str(uuid.uuid4())
    sql(retention['attempt'](token, completed='null'))
    before = int(sql('select count(*) from public.weather_fetch_attempts;'))
    k, claim_token = key(19), str(uuid.uuid4())
    generation = claim(k, claim_token, member)['generation']
    policy(f'max_attempt_rows={before}')
    rejected(start_sql(k, claim_token, generation))
    charged = usage()
    result = json.loads(sql('set role postgres;select public.prune_weather_cache_internal();'))
    assert result['unknownAttempts'] >= 1 and usage() == charged
    assert start(k, claim_token, generation, member)['status'] == 'permit'
    assert finish(k, claim_token, generation, failure='provider')
    defaults()


test('old unknown detail can be pruned for a new attempt without deleting its usage charge', attempt_cleanup)


def revocation():
    # Authorization is enforced even for a hit; capacity never creates an access bypass.
    k = ('ultra', 60, 127, today, '1000')
    err = sql(f"begin;update public.memberships set revoked_at=clock_timestamp() where user_id='{member}';"
              'set local role service_role;' + claim_sql(k, uuid.uuid4()) + 'rollback;', False)
    assert 'MEMBERSHIP_REQUIRED' in err


test('revoked member cannot read an otherwise valid shared meteorological cache', revocation)

metrics = {'database': base['DATABASE'], 'container': base['CONTAINER'], 'capacity_PASS': passed,
           'FAIL': 0, 'ERROR': 0, 'SKIP': 0, 'provider_calls': 0, 'durations_seconds': durations}
(root / '.supabase/journey-weather-capacity-run.json').write_text(json.dumps(metrics, indent=2)+'\n', encoding='utf-8')
print(f'CAPACITY RESULT: {passed} PASS / 0 FAIL / 0 ERROR / 0 SKIP; evidence DB retained', flush=True)
