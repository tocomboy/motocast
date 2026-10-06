"""Issue #123 migration proof in a new isolated database of the existing local container.

Creates motocast_saved_places_ten_<hex> from template0 inside supabase_db_motocast
(127.0.0.1:54322). It never resets or drops an existing database and never connects to
a hosted project. The created database is retained as evidence; its name is printed.

Order: earlier migrations -> legacy fixtures -> migration committed while two old-body
RPC calls wait on its lock -> preservation, backfill, I1/I2, ACL -> rerun with 6..10
stars (no change) -> rerun over an unrepairable conflict (whole rollback) -> the
rollback-only and two-connection suites plus the existing saved-place suites.
"""
import subprocess
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CONTAINER = 'supabase_db_motocast'
DATABASE = 'motocast_saved_places_ten_' + uuid.uuid4().hex[:10]
MIGRATIONS = ROOT / 'supabase/migrations'
TARGET = MIGRATIONS / '20261007093000_frequent_places_ten.sql'
TESTS = ROOT / 'supabase/tests/database'
PSQL = ['docker', 'exec', '-i', '-e', 'PGCLIENTENCODING=UTF8', CONTAINER, 'psql', '-U', 'supabase_admin',
        '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d']


def run(database, script, ok=True, timeout=300):
    data = script.encode('utf-8') if isinstance(script, str) else script
    result = subprocess.run(PSQL + [database], input=data, capture_output=True, timeout=timeout)
    out = result.stdout.decode('utf-8', 'replace')
    err = result.stderr.decode('utf-8', 'replace')
    if ok:
        assert result.returncode == 0, err[-2400:]
        return out.strip()
    assert result.returncode != 0, 'expected failure but succeeded: ' + out[-600:]
    return err


def sql(query):
    return run(DATABASE, query)


checks = []


def check(ok, description):
    checks.append((bool(ok), description))
    print(('ok ' if ok else 'not ok ') + str(len(checks)) + ' - ' + description, flush=True)


identity = subprocess.run(['docker', 'inspect', CONTAINER, '--format',
                           '{{index .Config.Labels "com.supabase.cli.project"}}|{{.Config.Image}}'],
                          capture_output=True, text=True, check=True).stdout.strip()
assert identity == 'motocast|public.ecr.aws/supabase/postgres:17.6.1.166', identity
assert run('postgres', f"select count(*) from pg_database where datname='{DATABASE}';") == '0'
migrations = sorted(MIGRATIONS.glob('*.sql'))
assert migrations[-1] == TARGET, 'the frequent-places migration must be the latest'
target_text = TARGET.read_text(encoding='utf-8')
assert target_text.rstrip().endswith('commit;') and '$mig$' not in target_text

run('postgres', f'create database {DATABASE} owner postgres template template0;')
print('DATABASE ' + DATABASE, flush=True)
dump = subprocess.run(['docker', 'exec', CONTAINER, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres',
                       '--schema-only', '--schema=auth', '--section=pre-data', '--no-owner'],
                      capture_output=True, check=True)
run(DATABASE, dump.stdout)
sql("""alter table auth.users add primary key(id);
grant usage on schema auth to postgres,anon,authenticated,service_role;
grant all on all tables in schema auth to postgres;
grant all on all functions in schema auth to postgres;
grant all on all sequences in schema auth to postgres;
create schema extensions;
create extension pgcrypto with schema extensions;
create extension postgis with schema extensions;
create extension dblink with schema extensions;
grant usage on schema extensions to postgres,anon,authenticated,service_role;
grant usage on schema public to postgres,anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;""")
for path in migrations[:-1]:
    run(DATABASE, b'set role postgres;\n' + path.read_bytes())

# Legacy fixtures written before the migration exists. Owners 95..05/06 are the
# transition owners whose old-body calls wait on the migration lock.
sql("""
create function pg_temp.place(k text) returns jsonb language sql immutable as $$
  select jsonb_build_object('kakaoPlaceId',k,'verificationToken',repeat('a',43),'name','원본 '||k,'address','경기도 양평군 테스트','roadAddress',null,'longitude',127,'latitude',37)
$$;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000',('95000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','frequent-migration-'||n||'@motocast.test','',now(),now(),now(),'{}','{}'
from generate_series(1,7) n;
insert into public.memberships(user_id,role,revoked_at)
select ('95000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'rider',case when n=4 then now() end from generate_series(1,7) n;
insert into public.saved_places(owner_id,place,alias,kind,province,star_slot,revision,created_at,updated_at) values
('95000000-0000-0000-0000-000000000001',pg_temp.place('zero-a'),null,'riding_spot','경기',null,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
('95000000-0000-0000-0000-000000000001',pg_temp.place('zero-b'),'별칭','restaurant',null,null,4,'2026-09-02T00:00:00Z','2026-09-03T00:00:00Z'),
('95000000-0000-0000-0000-000000000002',pg_temp.place('three-1'),null,'riding_spot','경기',1,1,'2026-09-01T01:00:00Z','2026-09-01T01:00:00Z'),
('95000000-0000-0000-0000-000000000002',pg_temp.place('three-2'),'두번째','restaurant','경기',2,3,'2026-09-01T02:00:00Z','2026-09-04T00:00:00Z'),
('95000000-0000-0000-0000-000000000002',pg_temp.place('three-3'),null,'riding_spot',null,3,2,'2026-09-01T03:00:00Z','2026-09-05T00:00:00Z'),
('95000000-0000-0000-0000-000000000002',pg_temp.place('three-none'),null,'riding_spot','경기',null,1,'2026-09-01T04:00:00Z','2026-09-01T04:00:00Z'),
('95000000-0000-0000-0000-000000000004',pg_temp.place('revoked-1'),null,'riding_spot','경기',1,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
('95000000-0000-0000-0000-000000000004',pg_temp.place('revoked-4'),null,'restaurant','경기',4,2,'2026-09-01T00:00:00Z','2026-09-02T00:00:00Z'),
('95000000-0000-0000-0000-000000000005',pg_temp.place('t1-a'),null,'riding_spot','경기',1,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
('95000000-0000-0000-0000-000000000005',pg_temp.place('t1-b'),null,'riding_spot','경기',2,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
('95000000-0000-0000-0000-000000000005',pg_temp.place('t1-new'),null,'riding_spot','경기',null,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
('95000000-0000-0000-0000-000000000006',pg_temp.place('t2-a'),null,'riding_spot','경기',1,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
('95000000-0000-0000-0000-000000000006',pg_temp.place('t2-star'),null,'riding_spot','경기',2,5,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
('95000000-0000-0000-0000-000000000007',pg_temp.place('c-fixable'),null,'riding_spot','경기',null,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
('95000000-0000-0000-0000-000000000007',pg_temp.place('c-conflict'),null,'riding_spot','경기',null,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');
insert into public.saved_places(owner_id,place,province,star_slot,created_at)
select '95000000-0000-0000-0000-000000000003',pg_temp.place('five-'||n),'경기',case when n<=5 then n end,'2026-09-01T00:00:00Z'::timestamptz+n*interval '1 minute'
from generate_series(1,12) n;
create function public.test_frequent_old_call(statement text) returns text language plpgsql set search_path = '' as $$
begin execute statement; return 'OK'; exception when others then return sqlerrm; end $$;
revoke all on function public.test_frequent_old_call(text) from public,anon,authenticated,service_role;
grant execute on function public.test_frequent_old_call(text) to authenticated;
""")
STABLE_OWNERS = "owner_id not in ('95000000-0000-0000-0000-000000000005','95000000-0000-0000-0000-000000000006')"
ROWS = "select md5(coalesce(string_agg(row_to_json(s)::text,'|' order by s.id),'')) from public.saved_places s where {};"
LEGACY_VIEW = "select md5(coalesce(string_agg(row_to_json(v)::text,'|' order by v.owner_id,v.slot),'')) from public.place_favorites v where {};"
DEFAULT_ACL = ("select coalesce(string_agg(format('%s|%s|%s|%s',defaclrole::regrole,defaclnamespace::regnamespace,defaclobjtype,defaclacl),';' "
               "order by defaclrole,defaclnamespace,defaclobjtype),'') from pg_default_acl;")
SERVICE_FUNCTIONS = ("select string_agg(p.oid::regprocedure::text,';' order by p.oid::regprocedure::text) from pg_proc p "
                     "join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname<>'test_frequent_old_call' "
                     "and has_function_privilege('service_role',p.oid,'EXECUTE');")
before_rows = sql(ROWS.format(STABLE_OWNERS))
before_view = sql(LEGACY_VIEW.format(STABLE_OWNERS))
before_acl = sql(DEFAULT_ACL)
before_service = sql(SERVICE_FUNCTIONS)
before_starred = int(sql('select count(*) from public.saved_places where star_slot is not null;'))
transition_revisions = sql("select string_agg(place->>'kakaoPlaceId'||'='||revision,',' order by place->>'kakaoPlaceId') "
                           "from public.saved_places where place->>'kakaoPlaceId' in ('t1-new','t2-star');")
assert transition_revisions == 't1-new=1,t2-star=5', transition_revisions


# Lock bounds: the migration starts with these settings and fails within lock_timeout
# when a writer holds saved_places or an auth table, leaving nothing behind.
first_statements = [line for line in target_text.splitlines() if line and not line.startswith('--')][:3]
check(first_statements == ['begin;', "set local lock_timeout = '5s';", "set local statement_timeout = '60s';"],
      'migration sets lock_timeout 5s and statement_timeout 60s before any lock')


def blocked_migration(blocker_sql, relation):
    blocker = subprocess.Popen(PSQL + [DATABASE], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    blocker.stdin.write(("set application_name='frequent-blocker'; begin; " + blocker_sql + "; select pg_sleep(20); rollback;").encode())
    blocker.stdin.close()
    for _ in range(500):
        if sql(f"select count(*) from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='frequent-blocker' "
               f"and a.datname=current_database() and l.relation='{relation}'::regclass and l.granted;") != '0':
            break
        time.sleep(0.02)
    else:
        raise AssertionError('blocker did not take its lock')
    started = time.monotonic()
    error = run(DATABASE, b'set role postgres;\n' + TARGET.read_bytes(), ok=False, timeout=60)
    elapsed = time.monotonic() - started
    sql("select pg_cancel_backend(pid) from pg_stat_activity where application_name='frequent-blocker' and datname=current_database();")
    blocker.wait(timeout=60)
    return error, elapsed


NOT_APPLIED = ("select to_regclass('public.place_stars') is null and to_regprocedure('public.save_place_v2(jsonb,text,text,boolean)') is null "
               "and not exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.datname=current_database() "
               "and a.pid<>pg_backend_pid() and l.relation in ('public.saved_places'::regclass,'auth.users'::regclass));")
error, elapsed = blocked_migration('update public.saved_places set alias=alias where false', 'public.saved_places')
check('lock timeout' in error and 4 <= elapsed <= 20, f'an in-flight saved_places writer makes the migration fail after {elapsed:.1f}s')
check(sql(NOT_APPLIED) == 't', 'lock-timeout failure leaves nothing applied and no lock held')
error, elapsed = blocked_migration('lock table auth.sessions in row exclusive mode', 'auth.sessions')
check('lock timeout' in error and 4 <= elapsed <= 20, f'an in-flight auth write makes the final policy step fail after {elapsed:.1f}s')
check(sql(NOT_APPLIED) == 't', 'auth-lock failure rolls back every earlier migration step')

body = target_text.rstrip()[:-len('commit;')]
connect = ("select extensions.dblink_connect('{0}',format('host=127.0.0.1 port=5432 dbname=%I user=supabase_admin "
           "password=postgres application_name=frequent-{0}',current_database()));")
transition = '\n'.join([
    connect.format('mig'), connect.format('old1'), connect.format('old2'),
    "select extensions.dblink_exec('old1','set role authenticated');",
    "select extensions.dblink_exec('old2','set role authenticated');",
    "select extensions.dblink_exec('old1','set \"request.jwt.claim.sub\"=''95000000-0000-0000-0000-000000000005''');",
    "select extensions.dblink_exec('old2','set \"request.jwt.claim.sub\"=''95000000-0000-0000-0000-000000000006''');",
    "select extensions.dblink_exec('mig','set role postgres');",
    "create temp table apply_clock as select clock_timestamp() as started;",
    'select extensions.dblink_exec(\'mig\',$mig$' + body + '$mig$);',
    "select 'RESULT:apply_ms='||round(extract(epoch from clock_timestamp()-started)*1000) from apply_clock;",
    # The migration is now uncommitted and holds its lock; both calls resolve the
    # old function bodies and block on their saved_places UPDATE.
    "select extensions.dblink_send_query('old1',format('select public.test_frequent_old_call(%L)',"
    "format('select public.set_saved_place_star(%L::uuid,1,true)',(select id from public.saved_places where place->>'kakaoPlaceId'='t1-new'))));",
    "select extensions.dblink_send_query('old2','select public.test_frequent_old_call(''select public.remove_place_favorite(2::smallint,''''t2-star'''')'')');",
    """do $$ declare attempt integer; begin
  for attempt in 1..1000 loop
    if (select count(*) from pg_stat_activity where datname=current_database() and application_name in ('frequent-old1','frequent-old2')
        and wait_event_type='Lock' and wait_event='relation')=2 then return; end if;
    perform pg_sleep(0.01);
  end loop;
  raise exception 'OLD_CALLS_DID_NOT_WAIT_ON_MIGRATION_LOCK';
end $$;""",
    "select 'RESULT:waited=true';",
    "select 'RESULT:timeouts='||t from extensions.dblink('mig','select current_setting(''lock_timeout'')||''/''||current_setting(''statement_timeout'')') as x(t text);",
    "select extensions.dblink_exec('mig','commit');",
    "select 'RESULT:old1='||result from extensions.dblink_get_result('old1') as t(result text);",
    "select result from extensions.dblink_get_result('old1') as t(result text);",
    "select 'RESULT:old2='||result from extensions.dblink_get_result('old2') as t(result text);",
    "select result from extensions.dblink_get_result('old2') as t(result text);",
    "select extensions.dblink_disconnect('mig'); select extensions.dblink_disconnect('old1'); select extensions.dblink_disconnect('old2');",
])
results = dict(line[len('RESULT:'):].split('=', 1) for line in sql(transition).splitlines() if line.startswith('RESULT:'))
sql('drop function public.test_frequent_old_call(text);')
check(results.get('waited') == 'true', 'two old-body calls waited on the migration lock')
print('migration body (uncommitted) took ' + results.get('apply_ms', '?') + ' ms', flush=True)
check(results.get('timeouts') == '5s/1min', 'the migration transaction runs with its lock and statement timeouts')
check(results.get('old1') == 'OK' and results.get('old2') == 'OK', 'waiting old-body calls completed after the migration commit')
STARS = ("select coalesce(string_agg(star.slot||':'||(saved.place->>'kakaoPlaceId'),',' order by star.slot),'') from public.place_stars star "
         "join public.saved_places saved on saved.id=star.saved_place_id where star.owner_id='{}';")
check(sql(STARS.format('95000000-0000-0000-0000-000000000005')) == '1:t1-a,2:t1-b,3:t1-new',
      'old-body legacy star after commit is reflected into place_stars')
check(sql(STARS.format('95000000-0000-0000-0000-000000000006')) == '1:t2-a', 'old-body legacy remove after commit deletes the star')
check(sql("select string_agg(place->>'kakaoPlaceId'||'='||revision,',' order by place->>'kakaoPlaceId') from public.saved_places "
          "where place->>'kakaoPlaceId' in ('t1-new','t2-star');") == 't1-new=2,t2-star=6', 'old-body calls advanced revision once')
CONSISTENT = ("select coalesce(bool_and(public.place_stars_consistent(owners.owner_id)),true) from "
              "(select owner_id from public.saved_places union select owner_id from public.place_stars) owners;")
check(sql(CONSISTENT) == 't', 'I1 and I2 hold for every owner after the transition')
check(sql(ROWS.format(STABLE_OWNERS)) == before_rows, 'migration preserves every other row, place, alias, kind, province and revision')
check(sql(LEGACY_VIEW.format(STABLE_OWNERS)) == before_view, 'three-slot compatibility view is unchanged')
check(int(sql('select count(*) from public.place_stars;')) == before_starred, 'backfill creates exactly one star per legacy star (+1/-1 transition)')
check(sql(f"""select not exists(
  select owner_id,star_slot,id,created_at from public.saved_places where star_slot is not null and {STABLE_OWNERS}
  except select owner_id,slot,saved_place_id,created_at from public.place_stars)
and not exists(select owner_id,slot,saved_place_id,created_at from public.place_stars where {STABLE_OWNERS}
  except select owner_id,star_slot,id,created_at from public.saved_places where star_slot is not null);""") == 't',
      'backfilled stars equal legacy slots, places and creation times')
check(sql(DEFAULT_ACL) == before_acl, 'future-object default ACL is unchanged')
check(sql(SERVICE_FUNCTIONS) == before_service and len(before_service.split(';')) == 14, 'service role still executes the same fourteen functions')
check(sql("select coalesce(max(c),0)<=5 from (select count(*) c from public.saved_places where star_slot is not null group by owner_id) s;") == 't',
      'legacy saved_places reads keep at most five stars per owner')

# Rerun after hidden stars exist: nothing changes.
for _ in range(5):
    sql("""set role authenticated; set "request.jwt.claim.sub"='95000000-0000-0000-0000-000000000003';
select public.set_place_star(saved.id,saved.revision,true) from public.saved_place_entries saved
where saved.star_position is null order by saved.place->>'kakaoPlaceId' limit 1;""")
check(sql(STARS.format('95000000-0000-0000-0000-000000000003')).count(',') == 9 and
      sql("select count(*) from public.saved_places where owner_id='95000000-0000-0000-0000-000000000003' and star_slot is not null;") == '5',
      'ten stars exist with five legacy mirrors before the rerun')
EVERYTHING = '\n'.join([
    ROWS.format('true'),
    "select md5(coalesce(string_agg(row_to_json(p)::text,'|' order by p.owner_id,p.slot),'')) from public.place_stars p;",
    "select md5(string_agg(pg_get_functiondef(p.oid),'' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p');",
    "select md5(string_agg(pg_get_triggerdef(t.oid),'' order by t.tgname)) from pg_trigger t where t.tgrelid in ('public.saved_places'::regclass,'public.place_stars'::regclass) and not t.tgisinternal;",
    "select md5(pg_get_viewdef('public.saved_place_entries'::regclass));",
    DEFAULT_ACL,
])
before_rerun = sql(EVERYTHING)
run(DATABASE, b'set role postgres;\n' + TARGET.read_bytes())
check(sql(EVERYTHING) == before_rerun, 'rerun with 6..10 stars changes no row, star, function, trigger, view or ACL')

# Rerun over a conflict the backfill cannot repair: everything rolls back, including
# the repairable missing star of the same run.
sql("""begin; set local session_replication_role = replica;
update public.saved_places set star_slot=4 where place->>'kakaoPlaceId'='c-fixable';
update public.saved_places set star_slot=5 where place->>'kakaoPlaceId'='c-conflict';
insert into public.place_stars(owner_id,slot,saved_place_id) select owner_id,9,id from public.saved_places where place->>'kakaoPlaceId'='c-conflict';
commit;""")
before_conflict = sql(EVERYTHING)
error = run(DATABASE, b'set role postgres;\n' + TARGET.read_bytes(), ok=False)
check('SAVED_PLACE_STAR_INVARIANT' in error, 'migration rerun rejects an unrepairable conflict')
check(sql(EVERYTHING) == before_conflict and sql(STARS.format('95000000-0000-0000-0000-000000000007')) == '9:c-conflict',
      'failed migration rolls back completely, including its repairable backfill row')
sql("""begin; set local session_replication_role = replica;
update public.saved_places set star_slot=null where place->>'kakaoPlaceId' in ('c-fixable','c-conflict');
delete from public.place_stars where owner_id='95000000-0000-0000-0000-000000000007';
commit;""")
check(sql(CONSISTENT) == 't', 'conflict fixture is removed and every owner is consistent again')

suites = {}
# Fixed plans: a suite that silently drops an assertion fails here.
PLANS = {'frequent_places.test.sql': 146, 'frequent_places_concurrency.test.sql': 26, 'saved_places.test.sql': 78,
         'saved_places_concurrency.test.sql': 17}
for name, planned in PLANS.items():
    result = subprocess.run(PSQL + [DATABASE], input=(TESTS / name).read_bytes(), capture_output=True, timeout=600)
    lines = [line for line in result.stdout.decode('utf-8', 'replace').splitlines() if line.startswith(('ok ', 'not ok '))]
    passed = sum(line.startswith('ok ') for line in lines)
    failed = sum(line.startswith('not ok ') for line in lines)
    suites[name] = (passed, failed)
    for line in lines:
        if line.startswith('not ok '):
            print(f'  {name}: {line}', flush=True)
    if result.returncode != 0:
        print(f'  {name} ERROR: ' + result.stderr.decode('utf-8', 'replace')[-1600:], flush=True)
    check(result.returncode == 0 and failed == 0 and passed == planned, f'{name}: {passed} PASS / {failed} FAIL of {planned} planned / exit {result.returncode}')
check(sql(CONSISTENT) == 't', 'every owner is consistent after all suites')

HARNESS_PLAN = 30
check(len(checks) + 1 == HARNESS_PLAN, f'harness ran its fixed plan of {HARNESS_PLAN} checks')
failed = sum(not ok for ok, _ in checks)
print(f'RESULT: harness {len(checks) - failed} PASS / {failed} FAIL; suites ' +
      ', '.join(f'{name} {p}/{f}' for name, (p, f) in suites.items()) + f'; database retained: {DATABASE}', flush=True)
sys.exit(1 if failed else 0)
