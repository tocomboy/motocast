"""Issue #124 migration proof in a new isolated database of the existing local container.

Creates motocast_saved_places_folders_<hex> from template0 inside supabase_db_motocast
(127.0.0.1:54322). It never resets or drops an existing database and never connects to
a hosted project. The created database is retained as evidence; its name is printed.

Order: earlier migrations -> #123 fixtures (ten, hidden and legacy stars) -> lock-bound
failures (first lock and final policy step, both fully rolled back) -> migration
committed while two old-body star RPC calls wait on its lock -> preservation, ACL and
the unchanged service-role allowlist -> rerun with folder data (no change) -> rerun
over a star-total violation (whole rollback) -> the #123 and #124 suites.
"""
import subprocess
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CONTAINER = 'supabase_db_motocast'
DATABASE = 'motocast_saved_places_folders_' + uuid.uuid4().hex[:10]
MIGRATIONS = ROOT / 'supabase/migrations'
TARGET = MIGRATIONS / '20261009120000_shared_place_folders.sql'
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
assert migrations[-1] == TARGET, 'the shared-folder migration must be the latest'
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

# #123 state before the migration. Owners 92..05/06 are the transition owners whose
# old-body calls wait on the migration lock.
sql("""
create function pg_temp.place(k text) returns jsonb language sql immutable as $$
  select jsonb_build_object('kakaoPlaceId',k,'verificationToken',repeat('a',43),'name','원본 '||k,'address','경기도 양평군 테스트','roadAddress',null,'longitude',127,'latitude',37)
$$;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000',('92000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','folders-migration-'||n||'@motocast.test','',now(),now(),now(),'{}','{}'
from generate_series(1,7) n;
insert into public.memberships(user_id,role,revoked_at)
select ('92000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'rider',case when n=3 then now() end from generate_series(1,7) n;
insert into public.saved_places(owner_id,place,alias,kind,province,revision,created_at,updated_at)
select ('92000000-0000-0000-0000-'||lpad(o::text,12,'0'))::uuid,pg_temp.place('o'||o||'-'||n),case when n=2 then '별칭' end,
  case when n%3=0 then 'restaurant' else 'riding_spot' end,case when n<>4 then '경기' end,1+n%4,
  '2026-09-01T00:00:00Z'::timestamptz+n*interval '1 minute','2026-09-02T00:00:00Z'::timestamptz+n*interval '1 minute'
from generate_series(1,7) o cross join generate_series(1,12) n;
-- Owner 1: ten stars (five mirrored, five hidden). Owner 2: stars 1,3 and hidden 7.
-- Owner 3: revoked with stars. Owners 5/6: transition. Owner 7: none.
insert into public.place_stars(owner_id,slot,saved_place_id,created_at)
select saved.owner_id,v.slot,saved.id,'2026-09-03T00:00:00Z'::timestamptz+v.slot*interval '1 minute'
from (values (1,1,1),(1,2,2),(1,3,3),(1,4,4),(1,5,5),(1,6,6),(1,7,7),(1,8,8),(1,9,9),(1,10,10),(2,1,1),(2,3,2),(2,7,3),(3,1,1),(3,6,2),
  (5,1,1),(5,2,2),(5,3,3),(5,4,4),(5,5,5),(5,6,6),(5,7,7),(5,8,8),(5,9,9),(6,1,1),(6,2,2)) v(o,slot,n)
join public.saved_places saved on saved.owner_id=('92000000-0000-0000-0000-'||lpad(v.o::text,12,'0'))::uuid and saved.place->>'kakaoPlaceId'='o'||v.o||'-'||v.n;
create function public.test_folder_old_call(statement text) returns text language plpgsql set search_path = '' as $$
begin execute statement; return 'OK'; exception when others then return sqlerrm; end $$;
revoke all on function public.test_folder_old_call(text) from public,anon,authenticated,service_role;
grant execute on function public.test_folder_old_call(text) to authenticated;
""")
STABLE_OWNERS = "owner_id not in ('92000000-0000-0000-0000-000000000005','92000000-0000-0000-0000-000000000006')"
ROWS = "select md5(coalesce(string_agg(row_to_json(s)::text,'|' order by s.id),'')) from public.saved_places s where {};"
STAR_ROWS = "select md5(coalesce(string_agg(row_to_json(p)::text,'|' order by p.owner_id,p.slot),'')) from public.place_stars p where {};"
LEGACY_VIEW = "select md5(coalesce(string_agg(row_to_json(v)::text,'|' order by v.owner_id,v.slot),'')) from public.place_favorites v where {};"
ENTRY_VIEW = "select md5(coalesce(string_agg(row_to_json(v)::text,'|' order by v.id),'')) from public.saved_place_entries v where {};"
DEFAULT_ACL = ("select coalesce(string_agg(format('%s|%s|%s|%s',defaclrole::regrole,defaclnamespace::regnamespace,defaclobjtype,defaclacl),';' "
               "order by defaclrole,defaclnamespace,defaclobjtype),'') from pg_default_acl;")
SERVICE_FUNCTIONS = ("select string_agg(p.oid::regprocedure::text,';' order by p.oid::regprocedure::text) from pg_proc p "
                     "join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname<>'test_folder_old_call' "
                     "and has_function_privilege('service_role',p.oid,'EXECUTE');")
LEGACY_RPCS = ("select string_agg(format('%s|%s|%s|%s',p.oid::regprocedure,pg_get_function_result(p.oid),p.prosecdef,p.proacl),';' order by p.oid::regprocedure::text) "
               "from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in "
               "('save_place','save_place_v2','set_place_star','set_saved_place_star','add_place_favorite','remove_place_favorite','update_saved_place','delete_saved_place');")
STAR_TRIGGERS = ("select md5(string_agg(pg_get_triggerdef(t.oid),'' order by t.tgname)) from pg_trigger t "
                 "where t.tgrelid in ('public.saved_places'::regclass,'public.place_stars'::regclass) and not t.tgisinternal and t.tgname<>'place_stars_z_check_star_total';")
before = {name: sql(query.format(STABLE_OWNERS)) for name, query in
          (('rows', ROWS), ('stars', STAR_ROWS), ('legacy_view', LEGACY_VIEW), ('entries', ENTRY_VIEW))}
before_acl = sql(DEFAULT_ACL)
before_service = sql(SERVICE_FUNCTIONS)
before_rpcs = sql(LEGACY_RPCS)
before_triggers = sql(STAR_TRIGGERS)
before_star_count = int(sql('select count(*) from public.place_stars;'))

first_statements = [line for line in target_text.splitlines() if line and not line.startswith('--')][:3]
check(first_statements == ['begin;', "set local lock_timeout = '5s';", "set local statement_timeout = '60s';"],
      'migration sets lock_timeout 5s and statement_timeout 60s before any lock')


def blocked_migration(blocker_sql, relation):
    blocker = subprocess.Popen(PSQL + [DATABASE], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    blocker.stdin.write(("set application_name='folders-blocker'; begin; " + blocker_sql + "; select pg_sleep(20); rollback;").encode())
    blocker.stdin.close()
    for _ in range(500):
        if sql(f"select count(*) from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='folders-blocker' "
               f"and a.datname=current_database() and l.relation='{relation}'::regclass and l.granted;") != '0':
            break
        time.sleep(0.02)
    else:
        raise AssertionError('blocker did not take its lock')
    started = time.monotonic()
    error = run(DATABASE, b'set role postgres;\n' + TARGET.read_bytes(), ok=False, timeout=60)
    elapsed = time.monotonic() - started
    sql("select pg_cancel_backend(pid) from pg_stat_activity where application_name='folders-blocker' and datname=current_database();")
    blocker.wait(timeout=60)
    return error, elapsed


NOT_APPLIED = ("select to_regclass('public.place_folders') is null and to_regclass('public.shared_place_stars') is null "
               "and to_regprocedure('public.create_place_folder(text,text,uuid[],uuid)') is null and to_regclass('public.place_folder_create_requests') is null "
               "and to_regprocedure('public.place_star_total(uuid)') is null "
               "and not exists(select 1 from pg_trigger where tgname='place_stars_z_check_star_total') "
               "and not exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.datname=current_database() "
               "and a.pid<>pg_backend_pid() and l.relation in ('public.place_stars'::regclass,'auth.users'::regclass));")
error, elapsed = blocked_migration('update public.place_stars set slot=slot where false', 'public.place_stars')
check('lock timeout' in error and 4 <= elapsed <= 20, f'an in-flight personal star writer makes the migration fail after {elapsed:.1f}s')
check(sql(NOT_APPLIED) == 't', 'first-lock failure leaves nothing applied and no lock held')
error, elapsed = blocked_migration('lock table auth.sessions in row exclusive mode', 'auth.sessions')
check('lock timeout' in error and 4 <= elapsed <= 20, f'an in-flight auth write makes the final policy step fail after {elapsed:.1f}s')
check(sql(NOT_APPLIED) == 't' and sql(LEGACY_RPCS) == before_rpcs and sql("select count(*) from pg_proc where prosrc like '%place_star_total%';") == '0',
      'a failure at the last step rolls back every table, trigger and replaced function')

body = target_text.rstrip()[:-len('commit;')]
connect = ("select extensions.dblink_connect('{0}',format('host=127.0.0.1 port=5432 dbname=%I user=supabase_admin "
           "password=postgres application_name=folders-{0}',current_database()));")
transition = '\n'.join([
    connect.format('mig'), connect.format('old1'), connect.format('old2'),
    "select extensions.dblink_exec('old1','set role authenticated');",
    "select extensions.dblink_exec('old2','set role authenticated');",
    "select extensions.dblink_exec('old1','set \"request.jwt.claim.sub\"=''92000000-0000-0000-0000-000000000005''');",
    "select extensions.dblink_exec('old2','set \"request.jwt.claim.sub\"=''92000000-0000-0000-0000-000000000006''');",
    "select extensions.dblink_exec('mig','set role postgres');",
    "create temp table apply_clock as select clock_timestamp() as started;",
    'select extensions.dblink_exec(\'mig\',$mig$' + body + '$mig$);',
    "select 'RESULT:apply_ms='||round(extract(epoch from clock_timestamp()-started)*1000) from apply_clock;",
    # The migration is uncommitted and holds place_stars; both calls resolve the old
    # #123 bodies and block on their place_stars INSERT.
    "select extensions.dblink_send_query('old1',format('select public.test_folder_old_call(%L)',"
    "format('select public.set_place_star(%L::uuid,%s,true)',(select id from public.saved_places where place->>'kakaoPlaceId'='o5-10'),"
    "(select revision from public.saved_places where place->>'kakaoPlaceId'='o5-10'))));",
    "select extensions.dblink_send_query('old2',format('select public.test_folder_old_call(%L)',"
    "format('select public.set_saved_place_star(%L::uuid,%s,true)',(select id from public.saved_places where place->>'kakaoPlaceId'='o6-3'),"
    "(select revision from public.saved_places where place->>'kakaoPlaceId'='o6-3'))));",
    """do $$ declare attempt integer; begin
  for attempt in 1..1000 loop
    if (select count(*) from pg_stat_activity where datname=current_database() and application_name in ('folders-old1','folders-old2')
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
sql('drop function public.test_folder_old_call(text);')
check(results.get('waited') == 'true', 'two old-body star calls waited on the migration lock')
print('migration body (uncommitted) took ' + results.get('apply_ms', '?') + ' ms', flush=True)
check(results.get('timeouts') == '5s/1min', 'the migration transaction runs with its lock and statement timeouts')
check(results.get('old1') == 'OK' and results.get('old2') == 'OK', 'waiting old-body calls completed after the migration commit')
STARS = ("select coalesce(string_agg(star.slot||':'||(saved.place->>'kakaoPlaceId'),',' order by star.slot),'') from public.place_stars star "
         "join public.saved_places saved on saved.id=star.saved_place_id where star.owner_id='{}';")
check(sql(STARS.format('92000000-0000-0000-0000-000000000005')).endswith(',10:o5-10'), 'old-body tenth star after commit is stored')
check(sql(STARS.format('92000000-0000-0000-0000-000000000006')) == '1:o6-1,2:o6-2,3:o6-3', 'old-body legacy star after commit takes its slot and mirror')
CONSISTENT = ("select coalesce(bool_and(public.place_stars_consistent(owners.owner_id) and public.place_star_total_consistent(owners.owner_id)),true) from "
              "(select owner_id from public.saved_places union select owner_id from public.place_stars) owners;")
check(sql(CONSISTENT) == 't', '#123 I1/I2 and the new star total hold for every owner after the transition')
after = {name: sql(query.format(STABLE_OWNERS)) for name, query in
         (('rows', ROWS), ('stars', STAR_ROWS), ('legacy_view', LEGACY_VIEW), ('entries', ENTRY_VIEW))}
check(after['rows'] == before['rows'], 'every other saved place, alias, kind, province, revision and signed place is unchanged')
check(after['stars'] == before['stars'], 'every other star keeps its slot and creation time')
check(after['legacy_view'] == before['legacy_view'] and after['entries'] == before['entries'], 'the three-slot view and saved_place_entries read the same')
check(int(sql('select count(*) from public.place_stars;')) == before_star_count + 2, 'only the two transition stars were added')
check(sql(STAR_TRIGGERS) == before_triggers, '#123 star triggers are unchanged')
check(sql(DEFAULT_ACL) == before_acl, 'future-object default ACL is unchanged')
check(sql(SERVICE_FUNCTIONS) == before_service and len(before_service.split(';')) == 14, 'service role still executes the same fourteen functions')
after_rpcs = sql(LEGACY_RPCS)
strip = lambda text: ';'.join(sorted(item.rsplit('|', 2)[0] for item in text.split(';')))
check(strip(after_rpcs) == strip(before_rpcs) and len(after_rpcs.split(';')) == 8, 'legacy star RPC signatures and return shapes are unchanged')
check(after_rpcs == before_rpcs, 'legacy star RPCs keep definer rights and their grants')

# Rerun with folder data present: nothing changes.
sql("""set role authenticated; set "request.jwt.claim.sub"='92000000-0000-0000-0000-000000000007';
select public.create_place_folder('검증 폴더','칠',(select array_agg(id) from public.saved_places where owner_id='92000000-0000-0000-0000-000000000007' and place->>'kakaoPlaceId' in ('o7-1','o7-2')),'95000000-0000-0000-0000-000000000007');
select public.set_shared_place_star((select id from public.shared_places limit 1),true);
select public.add_avoided_place((select place from public.saved_places where place->>'kakaoPlaceId'='o7-3'));
select public.create_place_folder_invite((select id from public.place_folders limit 1));""")
EVERYTHING = '\n'.join([
    ROWS.format('true'),
    STAR_ROWS.format('true'),
    *[f"select md5(coalesce(string_agg(row_to_json(t)::text,'|' order by row_to_json(t)::text),'')) from public.{table} t;" for table in
      ('place_folders', 'place_folder_members', 'place_folder_preferences', 'shared_places', 'place_folder_invites', 'avoided_places', 'shared_place_stars', 'place_folder_create_requests')],
    "select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p');",
    "select md5(string_agg(pg_get_triggerdef(t.oid),'' order by t.tgrelid::regclass::text,t.tgname)) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal;",
    "select md5(string_agg(c.relname||coalesce(c.relacl::text,'')||c.relrowsecurity||coalesce(pg_get_viewdef(c.oid),''),'|' order by c.relname)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v');",
    "select md5(string_agg(pol.polname||pg_get_expr(pol.polqual,pol.polrelid),'|' order by pol.polname)) from pg_policy pol;",
    "select md5(string_agg(attrelid::regclass::text||attname||coalesce(attacl::text,''),'|' order by attrelid::regclass::text,attnum)) from pg_attribute where attrelid='public.place_folder_members'::regclass;",
    "select md5(string_agg(indexrelid::regclass::text||pg_get_indexdef(indexrelid),'|' order by indexrelid::regclass::text)) from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public';",
    DEFAULT_ACL,
])
before_rerun = sql(EVERYTHING)
check(sql('select count(*) from public.shared_place_stars;') == '1' and sql('select count(*) from public.place_folder_invites;') == '1',
      'folder, shared star, avoided place and link exist before the rerun')
run(DATABASE, b'set role postgres;\n' + TARGET.read_bytes())
check(sql(EVERYTHING) == before_rerun, 'rerun changes no row, function, grant, trigger, view, policy, index or ACL')

# Rerun over a state the migration rejects: everything rolls back.
sql("""begin; set local session_replication_role = replica;
insert into public.shared_place_stars(owner_id,shared_place_id) select '92000000-0000-0000-0000-000000000001',id from public.shared_places limit 1;
commit;""")
before_conflict = sql(EVERYTHING)
error = run(DATABASE, b'set role postgres;\n' + TARGET.read_bytes(), ok=False)
check('SAVED_PLACE_STAR_INVARIANT' in error, 'migration rerun rejects a star total over ten and a non-member shared star')
check(sql(EVERYTHING) == before_conflict, 'the failed rerun rolls back completely')
sql("delete from public.shared_place_stars where owner_id='92000000-0000-0000-0000-000000000001';")
check(sql(CONSISTENT) == 't', 'conflict fixture is removed and every owner is consistent again')

suites = {}
# Fixed plans: a suite that silently drops an assertion fails here.
PLANS = {'frequent_places.test.sql': 146, 'frequent_places_concurrency.test.sql': 26, 'saved_places.test.sql': 78,
         'saved_places_concurrency.test.sql': 17, 'shared_place_folders.test.sql': 265, 'shared_place_folders_concurrency.test.sql': 34}
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

HARNESS_PLAN = 33
check(len(checks) + 1 == HARNESS_PLAN, f'harness ran its fixed plan of {HARNESS_PLAN} checks')
failed = sum(not ok for ok, _ in checks)
print(f'RESULT: harness {len(checks) - failed} PASS / {failed} FAIL; suites ' +
      ', '.join(f'{name} {p}/{f}' for name, (p, f) in suites.items()) + f'; database retained: {DATABASE}', flush=True)
sys.exit(1 if failed else 0)
