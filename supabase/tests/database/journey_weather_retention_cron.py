"""Run the actual activation SQL in a dedicated network-disabled local cron container.
Prerequisite: journey_weather_retention.py passed. No real provider or user data.
Container is stopped in finally, retained for evidence; never dropped or reset.
"""
import json
import subprocess
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TARGET = 'motocast-retention-cron-' + uuid.uuid4().hex[:10]
SOURCE = json.loads((ROOT / '.supabase/journey-weather-retention-run.json').read_text())
assert SOURCE['container'] == 'supabase_db_motocast'
assert SOURCE['database'].startswith('motocast_weather_') and SOURCE['retention_PASS'] == 12
subprocess.run(['docker', 'run', '-d', '--name', TARGET, '--label', 'motocast.test=journey-weather-retention',
                '--network', 'none', '-e', 'POSTGRES_PASSWORD=postgres',
                'public.ecr.aws/supabase/postgres:17.6.1.166', 'postgres',
                '-c', 'shared_preload_libraries=pg_cron,pg_stat_statements', '-c', 'cron.database_name=postgres',
                '-c', 'cron.use_background_workers=on'], capture_output=True, check=True)
identity = subprocess.run(['docker', 'inspect', TARGET, '--format', '{{index .Config.Labels "motocast.test"}}|{{.HostConfig.NetworkMode}}|{{.Config.Image}}'], text=True, capture_output=True, check=True).stdout.strip()
assert identity == 'journey-weather-retention|none|public.ecr.aws/supabase/postgres:17.6.1.166'
BASE = ['docker', 'exec', '-i', TARGET, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']


def sql(query, ok=True):
    r = subprocess.run(BASE, input=query, text=True, encoding='utf-8', capture_output=True, timeout=30)
    assert (r.returncode == 0) == ok, r.stderr
    return r.stdout.strip() if ok else r.stderr


try:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        # Image initialization starts and shuts down a temporary server. Wait for PID 1
        # to become the final postgres process before accepting pg_isready.
        pid1 = subprocess.run(['docker','exec',TARGET,'cat','/proc/1/comm'], capture_output=True, text=True)
        ready = subprocess.run(['docker','exec',TARGET,'pg_isready','-U','postgres','-d','postgres'], capture_output=True)
        if pid1.stdout.strip() in ('postgres', '.postgres-wrapp') and ready.returncode == 0:
            break
        time.sleep(0.25)
    else:
        raise AssertionError('Isolated cron database did not start')
    # Refuse an already populated target rather than resetting it or overwriting evidence.
    assert sql("select to_regclass('public.weather_fetch_cache') is null;") == 't'
    assert sql('select count(*) from auth.users;') == '0'
    # Reuse the image's platform auth schema; replay product migrations as their real owner.
    # Empty standalone image bootstrap differs from the hosted platform's auth owner grants.
    # Only this dedicated, zero-user fixture table is assigned to the migration owner.
    sql("alter table auth.users owner to postgres;create extension if not exists postgis with schema extensions;")
    for migration in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        try:
            sql('set role postgres;\n' + migration.read_text(encoding='utf-8'))
        except AssertionError as error:
            raise AssertionError(migration.name) from error
    assert sql("select count(*) from public.memberships;") == '0'
    # Ready, already expired public synthetic weather, with no associated HTTP usage.
    sql("""insert into public.weather_fetch_cache(model,nx,ny,base_date,base_time,state,generation,token,lease_until,retry_after,expires_at,items)
      values('short',1,1,to_char(timezone('Asia/Seoul',clock_timestamp()),'YYYYMMDD'),'0200','ready',1,
      gen_random_uuid(),clock_timestamp()-interval '1 hour',clock_timestamp()-interval '1 hour',
      clock_timestamp()-interval '1 minute','[{"synthetic":true}]');""")
    activation = (ROOT / 'supabase/operations/enable_journey_weather_retention.sql').read_text(encoding='utf-8')
    assert 'RETENTION_CRON_NOT_INSTALLED' in sql('set role postgres;\n' + activation, False)
    # Standalone image has no hosted Integrations control plane; bootstrap only the
    # scheduler extension as the local superuser, then run product SQL as postgres.
    sql('create extension pg_cron;grant usage on schema cron to postgres;grant all on all tables in schema cron to postgres;grant execute on all functions in schema cron to postgres;')
    sql('set role postgres;\n' + activation)
    job = sql("select jobid from cron.job where jobname='motocast-weather-retention' and database='postgres' and username='postgres';")
    assert job.isdigit()
    assert sql(f"select schedule='*/5 * * * *' and active from cron.job where jobid={job};") == 't'
    print('CRON PASS: exact activation script creates the intended owner/database/5-minute schedule', flush=True)
    # Trigger the same SQL through real pg_cron without waiting for a wall-clock five-minute boundary.
    sql(f"set role postgres;select cron.alter_job({job},schedule:='1 second');")
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        status = sql(f"select status from cron.job_run_details where jobid={job} order by runid desc limit 1;")
        if status == 'failed':
            raise AssertionError(sql(f"select return_message from cron.job_run_details where jobid={job} order by runid desc limit 1;"))
        if status == 'succeeded' and sql("select state='expired' and items is null from public.weather_fetch_cache;") == 't':
            break
        time.sleep(0.25)
    else:
        raise AssertionError('Actual cron execution did not succeed within 25s')
    sql(f"set role postgres;select cron.alter_job({job},active:=false);")
    print('CRON PASS: actual background worker executes SQL and expires the synthetic payload', flush=True)
    for role in ('anon', 'authenticated', 'service_role'):
        assert 'permission denied' in sql(f'set role {role};select public.run_weather_retention_internal();', False)
    print('CRON PASS: all three client/server API roles denied scheduler wrapper', flush=True)

    # Rollback-only real cron history fixtures verify exact job identity and ended-only retention.
    history = f"""begin;set local role postgres;
      select cron.schedule('retention-unrelated-fixture','0 0 1 1 *','select 1');
      insert into cron.job_run_details(jobid,runid,job_pid,database,username,command,status,start_time,end_time)
      values({job},900000001,1,'postgres','postgres','select 1','succeeded',now()-interval '9 days',now()-interval '8 days'),
            ({job},900000002,1,'postgres','postgres','select 1','running',now()-interval '9 days',null),
            ((select jobid from cron.job where jobname='retention-unrelated-fixture'),900000003,1,'postgres','postgres','select 1','succeeded',now()-interval '9 days',now()-interval '8 days');
      select public.run_weather_retention_internal();
      select count(*)=2 from cron.job_run_details where runid in (900000001,900000002,900000003);
      rollback;"""
    assert sql(history).splitlines()[-1] == 't'
    print('CRON PASS: only own old ended history removed; unfinished and other job history retained', flush=True)
    # Identity conflicts must fail before replacing another command.
    conflict = f"""begin;set role postgres;select cron.alter_job({job},command:='select 42');"""
    conflict += activation[activation.rindex('do $$'):activation.index('commit;')] + 'rollback;'
    assert 'RETENTION_JOB_IDENTITY_CONFLICT' in sql(conflict, False)
    assert sql(f"select command='select public.run_weather_retention_internal();' from cron.job where jobid={job};") == 't'
    print('CRON PASS: conflicting named job cannot be overwritten', flush=True)
    # Replay is idempotent and restores the real schedule; then stop only this exact test job.
    sql('set role postgres;\n' + activation)
    assert sql("select count(*)=1 from cron.job where jobname='motocast-weather-retention';") == 't'
    assert sql(f"select schedule='*/5 * * * *' from cron.job where jobid={job};") == 't'
    sql(f"set role postgres;select cron.alter_job({job},active:=false);")
    assert sql('select count(*) from public.weather_usage_daily;') == '0'
    print('CRON PASS: idempotent activation and exact-job stop preserve usage ledger', flush=True)
    report = {'container': TARGET, 'database': 'postgres', 'PASS': 6, 'FAIL': 0, 'job_active': False,
              'activation_sql': 'supabase/operations/enable_journey_weather_retention.sql', 'network': 'none'}
    (ROOT / '.supabase/journey-weather-retention-cron.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print('CRON RESULT: 6 PASS / 0 FAIL / 0 ERROR / 0 SKIP', flush=True)
finally:
    subprocess.run(['docker', 'stop', '--time', '10', TARGET], check=True, capture_output=True)
