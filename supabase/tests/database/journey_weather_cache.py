"""Real PostgreSQL tests in the explicitly dedicated local DB; no hosted access or provider calls.
Creates unique synthetic members/material. Rollback-only checks don't change the shared baseline.
Concurrent checks commit only task-owned rows, retained as evidence (no destructive reset).
"""
import concurrent.futures, json, subprocess, time, uuid
from pathlib import Path

CONTAINER = "supabase_db_motocast"
DATABASE = "motocast_weather_" + uuid.uuid4().hex[:10]
BASE = ["docker", "exec", "-i", CONTAINER, "psql", "-U", "supabase_admin", "-d", DATABASE, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"]

def sql(query, ok=True):
    r = subprocess.run(BASE, input=query, encoding="utf-8", capture_output=True, timeout=25)
    if ok: assert r.returncode == 0, r.stderr
    else: assert r.returncode != 0, "Expected SQL failure"
    return r.stdout.strip() if ok else r.stderr

def quote(s): return "'" + str(s).replace("'", "''") + "'"
def literal(value): return quote(json.dumps(value)) + "::jsonb"
def rpc(name, args, role="service_role"):
    return sql("set role %s;select public.%s(%s);" % (role, name, ",".join(args)))
def key_args(key): return [quote(key[0]), str(key[1]), str(key[2]), quote(key[3]), quote(key[4])]
def claim(key, token, member): return json.loads(rpc("claim_weather_fetch_internal", [quote(member)] + key_args(key) + [quote(token)]))
def start(key, token, generation, member, limit=100): return json.loads(rpc("start_weather_fetch_internal", [quote(member)] + key_args(key) + [quote(token), str(generation), str(limit)]))
def finish(key, token, generation, items=None, failure=None):
    return rpc("finish_weather_fetch_internal", key_args(key) + [quote(token), str(generation), literal(items) if items is not None else "null", "1000" if items is not None else "null", quote(failure) if failure else "null"]) == "t"
def where(key): return "(model,nx,ny,base_date,base_time)=(%s)" % ",".join(key_args(key))
def material(key):
    return [dict(baseDate=key[3],baseTime=key[4],nx=key[1],ny=key[2],fcstDate=key[3],fcstTime=t,category=c,fcstValue=v)
            for t in ("1100","1200","1300") for c,v in (("T1H","21"),("PTY","1"),("SKY","4"),("WSD","2"))]
def test(name, body):
    begin=time.monotonic(); body(); print("PASS: %s (%.3fs)" % (name,time.monotonic()-begin), flush=True)

identity=subprocess.run(["docker","inspect",CONTAINER,"--format",'{{index .Config.Labels "com.supabase.cli.project"}}|{{.Config.Image}}'],capture_output=True,text=True,check=True).stdout.strip()
assert identity == "motocast|public.ecr.aws/supabase/postgres:17.6.1.166"
admin=BASE.copy();admin[admin.index(DATABASE)]="postgres"
assert subprocess.run(admin,input="select count(*) from auth.users;",encoding="utf-8",capture_output=True,check=True).stdout.strip()=="0"
subprocess.run(admin,input="create database "+DATABASE+" owner postgres template template0;",encoding="utf-8",capture_output=True,check=True)
dump=subprocess.run(["docker","exec",CONTAINER,"pg_dump","-U","supabase_admin","-d","postgres","--schema-only","--schema=auth","--section=pre-data","--no-owner"],capture_output=True,check=True)
r=subprocess.run(BASE,input=dump.stdout,capture_output=True);assert r.returncode==0,r.stderr.decode()[-2000:]
root=Path(__file__).resolve().parents[3]
sql("""alter table auth.users add primary key(id);
grant usage on schema auth to postgres,anon,authenticated,service_role;
grant all on all tables in schema auth to postgres;
grant all on all functions in schema auth to postgres;
grant all on all sequences in schema auth to postgres;
create schema extensions;
create extension pgcrypto with schema extensions;
create extension postgis with schema extensions;
grant usage on schema extensions to postgres,anon,authenticated,service_role;
grant usage on schema public to postgres,anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;
""")
# Bootstrap only platform auth, then replay every repository migration. A stale local public schema is not the product baseline.
for migration in sorted((root/"supabase/migrations").glob("*.sql")):
    r=subprocess.run(BASE,input=b"set role postgres;\n"+migration.read_bytes(),capture_output=True)
    assert r.returncode==0,(migration.name,r.stderr.decode()[-2000:])
for suite in ["auth_rls_budget.test.sql", "plan_collection_share.test.sql", "live_acl_readback.test.sql"]:
    r=subprocess.run(BASE,input=(root/"supabase/tests/database"/suite).read_bytes(),capture_output=True)
    lines=r.stdout.decode().splitlines(); failures=[line for line in lines if line.startswith("not ok")]
    passed=sum(line.startswith("ok ") for line in lines)
    assert r.returncode==0 and passed>0 and not failures,(suite,failures,r.stderr.decode()[-1500:])
    print("BASELINE: %s %s PASS / 0 FAIL" % (suite,passed),flush=True)
print("Dedicated database: "+DATABASE,flush=True)
assert sql("select current_database();") == DATABASE
# Refuse reusing any earlier committed test run or unreviewed baseline.
assert sql("select count(*) from public.weather_fetch_cache;") == "0"
assert sql("select count(*) from public.weather_usage_daily;") == "0"
member=str(uuid.uuid4()); peer=str(uuid.uuid4())
sql("insert into auth.users(id,aud,role) values (%s,'authenticated','authenticated'),(%s,'authenticated','authenticated');insert into public.memberships(user_id,role) values (%s,'rider'),(%s,'rider');" % (quote(member),quote(peer),quote(member),quote(peer)))
base_date=sql("select to_char(timezone('Asia/Seoul',clock_timestamp()),'YYYYMMDD');")
key=("ultra",60,127,base_date,"1000")

def no_config():
    err=sql("set role service_role;select public.claim_weather_fetch_internal(%s,%s,%s);" % (quote(member),",".join(key_args(key)),quote(uuid.uuid4())),False)
    assert "API_BUDGET_NOT_CONFIGURED" in err,err
    assert sql("select count(*) from public.api_usage_daily where provider='kma';") == "0"
test("missing policy prevents new weather calls", no_config)
def baseline_required():
    err=sql("begin;insert into public.api_usage_daily values('kma','ultra_forecast',(timezone('Asia/Seoul',now()))::date,1,100,now());insert into public.weather_budget_policy values(true,100,104857600,1048576);set local role service_role;select public.consume_daily_api_budget_internal('kma','ultra_forecast',100,%s);commit;" % quote(member),False)
    assert "API_BUDGET_BASELINE_REQUIRED" in err,err
    assert sql("select count(*) from public.weather_usage_daily;")=="0"
test("enabling mid-day requires known prior call and volume baseline",baseline_required)
sql("insert into public.weather_budget_policy values(true,100,104857600,1048576);")

def privileges():
    for role in ("anon","authenticated"):
        for call in ("select * from public.weather_fetch_cache", "select * from public.weather_budget_policy", "select public.claim_weather_fetch_internal(%s,%s,%s)" % (quote(member),",".join(key_args(key)),quote(uuid.uuid4()))):
            assert "permission denied" in sql("set role %s;%s;" % (role,call),False)
    assert "permission denied" in sql("set role service_role;update public.weather_budget_policy set daily_calls=20000;",False)
    assert "MEMBERSHIP_REQUIRED" in sql("set role service_role;select public.claim_weather_fetch_internal(%s,%s,%s);" % (quote(uuid.uuid4()),",".join(key_args(key)),quote(uuid.uuid4())),False)
test("client RPC and direct DML denied; membership enforced",privileges)

winner={}
def concurrent_claim():
    tokens=[str(uuid.uuid4()) for _ in range(10)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        results=list(pool.map(lambda pair:claim(key,pair[1],member if pair[0]%2 else peer),enumerate(tokens)))
    owners=[i for i,r in enumerate(results) if r['status']=='owner']
    assert len(owners)==1,results
    assert sum(r['status']=='wait' for r in results)==9
    winner.update(token=tokens[owners[0]],generation=results[owners[0]]['generation'])
    assert sql("select count(*) from public.api_usage_daily where provider='kma';")=='0'
    # Claim transaction has ended; no long-lived transaction blocks other clients.
    assert sql("select count(*) from pg_stat_activity where datname=current_database() and state='idle in transaction';")=='0'
test("ten simultaneous users elect exactly one owner with no network transaction",concurrent_claim)

def duplicate_start():
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        result=list(pool.map(lambda _:start(key,winner['token'],winner['generation'],member),range(2)))
    assert sorted(r['status'] for r in result)==['permit','superseded']
    assert sql("select calls from public.api_usage_daily where provider='kma';")=='1'
    assert sql("select calls||':'||reserved_bytes from public.weather_usage_daily;")=='1:1048576'
    assert claim(key,winner['token'],member)['status']=='wait'
test("duplicate dispatch reserves once and never authorizes replay",duplicate_start)

def publish_shared():
    assert finish(key,winner['token'],winner['generation'],material(key))
    assert not finish(key,winner['token'],winner['generation'],material(key))
    for who in (member,peer):
        r=claim(key,str(uuid.uuid4()),who)
        assert r['status']=='hit' and len(r['items'])==12
        assert {i['fcstTime'] for i in r['items']}=={'1100','1200','1300'}
    assert sql("select calls from public.weather_usage_daily;")=='1'
test("one response serves three target hours and two users without extra budget",publish_shared)

def expired_claim():
    k=("ultra",61,127,base_date,"1000"); old=str(uuid.uuid4()); new=str(uuid.uuid4())
    a=claim(k,old,member)
    sql("update public.weather_fetch_cache set lease_until=clock_timestamp()-interval '1 second' where "+where(k))
    b=claim(k,new,peer); assert b['generation']==a['generation']+1
    assert start(k,old,a['generation'],member)['status']=='superseded'
    assert start(k,new,b['generation'],peer)['status']=='permit'
    assert not finish(k,old,a['generation'],material(k))
    assert finish(k,new,b['generation'],None,'timeout')
    assert claim(k,str(uuid.uuid4()),peer)['status']=='wait'
    assert sql("select calls from public.weather_usage_daily;")=='2'
test("pre-dispatch crash transfers ownership; timeout never refunds or immediately retries",expired_claim)

def unknown_takeover():
    k=("ultra",62,127,base_date,"1000"); old=str(uuid.uuid4()); new=str(uuid.uuid4())
    a=claim(k,old,member); assert start(k,old,a['generation'],member)['status']=='permit'
    sql("update public.weather_fetch_cache set lease_until=clock_timestamp()-interval '1 second' where "+where(k))
    assert claim(k,new,peer)['status']=='wait'
    assert not finish(k,old,a['generation'],material(k))
    sql("update public.weather_fetch_cache set retry_after=clock_timestamp()-interval '1 second' where "+where(k))
    b=claim(k,new,peer); assert b['generation']==a['generation']+1
    assert start(k,new,b['generation'],peer)['status']=='permit'
    assert not finish(k,old,a['generation'],material(k))
    assert finish(k,new,b['generation'],material(k))
    assert sql("select calls from public.weather_usage_daily;")=='4'
test("post-dispatch crash waits cooldown; takeover charges again and fences late result",unknown_takeover)

def quotas_atomic():
    # Rollback-only policy checks don't erase the committed run evidence.
    query="begin;update public.weather_budget_policy set daily_calls=5;set local role service_role;select public.consume_daily_api_budget_internal('kma','short_forecast',100,%s);select public.consume_daily_api_budget_internal('kma','ultra_forecast',100,%s);commit;" % (quote(member),quote(peer))
    assert 'API_DAILY_BUDGET_EXHAUSTED' in sql(query,False)
    assert sql("select calls from public.weather_usage_daily;")=='4'
    query="begin;update public.weather_budget_policy set daily_bytes=4194304;set local role service_role;select public.consume_daily_api_budget_internal('kma','short_forecast',100,%s);commit;" % quote(member)
    assert 'API_DAILY_BUDGET_EXHAUSTED' in sql(query,False)
    assert sql("select calls from public.weather_usage_daily;")=='4'
    query="begin;set local role service_role;select public.consume_daily_api_budget_internal('kma','ultra_forecast',4,%s);commit;" % quote(member)
    assert 'API_DAILY_BUDGET_EXHAUSTED' in sql(query,False)
    assert sql("select calls from public.weather_usage_daily;")=='4'
test("cross-model calls, byte allocation and operation caps fail atomically",quotas_atomic)

def last_slot_concurrent():
    sql("update public.weather_budget_policy set daily_calls=5;")
    def take(operation):
        r=subprocess.run(BASE,input="set role service_role;select public.consume_daily_api_budget_internal('kma',%s,100,%s);" % (quote(operation),quote(member)),encoding='utf-8',capture_output=True,timeout=20)
        return r.returncode,r.stderr
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(take,['ultra_forecast','short_forecast']))
    assert sum(r[0]==0 for r in results)==1,results
    assert sum('API_DAILY_BUDGET_EXHAUSTED' in r[1] for r in results)==1,results
    assert sql("select calls from public.weather_usage_daily;")=='5'
    assert sql("select sum(calls) from public.api_usage_daily where provider='kma';")=='5'
test("two models race for final account slot; only one commits",last_slot_concurrent)

def rejected_publish_and_revocation():
    # Rollback checks on previously published owner show strict write protection.
    err=sql("begin;set local role service_role;update public.weather_fetch_attempts set reserved_bytes=0;rollback;",False)
    assert 'permission denied' in err
    token=str(uuid.uuid4()); k=("ultra",63,127,base_date,"1000")
    owner=claim(k,token,member)
    query="begin;update public.memberships set revoked_at=now() where user_id=%s;set local role service_role;select public.start_weather_fetch_internal(%s,%s,%s,%s,100);commit;" % (quote(member),quote(member),','.join(key_args(k)),quote(token),owner['generation'])
    assert 'MEMBERSHIP_REQUIRED' in sql(query,False)
    assert sql("select calls from public.weather_usage_daily;")=='5'
test("revocation before dispatch blocks provider and protects attempt ledger",rejected_publish_and_revocation)

# Remaining terminal checks use rollback transactions so final quota-race evidence stays intact.
def late_oversize():
    k=("ultra",64,127,base_date,"1000"); token=str(uuid.uuid4())
    q="begin;update public.weather_budget_policy set daily_calls=100;update public.weather_usage_daily set hard_calls=100;"
    q+="set local role service_role;select public.claim_weather_fetch_internal(%s,%s,%s);select public.start_weather_fetch_internal(%s,%s,%s,1,100);" % (quote(member),','.join(key_args(k)),quote(token),quote(member),','.join(key_args(k)),quote(token))
    q+="reset role;update public.weather_fetch_cache set lease_until=clock_timestamp()-interval '1 second' where %s;set local role service_role;" % where(k)
    q+="select public.finish_weather_fetch_internal(%s,%s,1,null,null,'oversize');reset role;" % (','.join(key_args(k)),quote(token))
    q+="select reserved_bytes=hard_bytes from public.weather_usage_daily;select outcome='oversize' from public.weather_fetch_attempts where token=%s;rollback;" % quote(token)
    out=sql(q).splitlines();assert out[-3:]==['f','t','t'],out
    assert sql("select calls from public.weather_usage_daily;")=='5'
test("late oversize blocks original allocation without publishing expired response",late_oversize)

metrics={"database":DATABASE,"container":CONTAINER,"PASS":12,"FAIL":0,"ERROR":0,"SKIP":0,
         "simultaneous_claims":10,"valid_owners":1,"waiting_callers":9,"target_hours_in_one_response":3,
         "actual_provider_network_calls":0,"committed_budget_calls":5,"member":member,"peer":peer}
(root/".supabase").mkdir(exist_ok=True)
(root/".supabase/journey-weather-run.json").write_text(json.dumps(metrics,indent=2)+"\n",encoding="utf-8")


print('RESULT: 12 PASS / 0 FAIL / 0 ERROR / 0 SKIP; local synthetic DB retained; provider network calls=0',flush=True)
