"""Replay the additive capacity migration over existing weather rows in an isolated DB.
No hosted connection, provider request, reset or deletion of an existing evidence DB.
"""
import json
import subprocess
import uuid
from pathlib import Path

root = Path(__file__).resolve().parents[3]
container = 'supabase_db_motocast'
database = 'motocast_weather_' + uuid.uuid4().hex[:10]
base = ['docker', 'exec', '-i', container, 'psql', '-U', 'supabase_admin', '-d', database,
        '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']
identity = subprocess.run(['docker', 'inspect', container, '--format',
    '{{index .Config.Labels "com.supabase.cli.project"}}|{{.Config.Image}}'],
    capture_output=True, text=True, check=True).stdout.strip()
assert identity == 'motocast|public.ecr.aws/supabase/postgres:17.6.1.166'
admin = base.copy(); admin[admin.index(database)] = 'postgres'
assert subprocess.run(admin, input='select count(*) from auth.users;',
    capture_output=True, text=True, check=True).stdout.strip() == '0'


def sql(query):
    result = subprocess.run(base, input=query, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr[-1800:]
    return result.stdout.strip()


subprocess.run(admin, input='create database ' + database + ' owner postgres template template0;',
               capture_output=True, text=True, check=True)
dump = subprocess.run(['docker', 'exec', container, 'pg_dump', '-U', 'supabase_admin',
                       '-d', 'postgres', '--schema-only', '--schema=auth',
                       '--section=pre-data', '--no-owner'], capture_output=True, check=True)
assert subprocess.run(base, input=dump.stdout, capture_output=True).returncode == 0
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
alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;""")

migration = root / 'supabase/migrations/20260922095045_journey_weather_capacity.sql'
assert migration.is_file()
for path in sorted((root / 'supabase/migrations').glob('*.sql')):
    if path == migration:
        continue
    result = subprocess.run(base, input=b'set role postgres;\n' + path.read_bytes(),
                            capture_output=True, timeout=30)
    assert result.returncode == 0, (path.name, result.stderr.decode()[-1800:])

today = sql("select to_char(timezone('Asia/Seoul',clock_timestamp()),'YYYYMMDD');")
ready_token, fetching_token = str(uuid.uuid4()), str(uuid.uuid4())
sql(f"""insert into public.weather_budget_policy values(true,40,41943040,1048576);
insert into public.weather_fetch_cache(model,nx,ny,base_date,base_time,state,generation,token,lease_until,retry_after,items,expires_at,fetched_at)
values('ultra',60,127,'{today}','0200','ready',1,'{ready_token}',clock_timestamp()+interval '1 minute',clock_timestamp(),
       '[{{"existing":true}}]'::jsonb,clock_timestamp()+interval '5 minutes',clock_timestamp());
insert into public.weather_fetch_cache(model,nx,ny,base_date,base_time,state,generation,token,lease_until,retry_after,response_bytes,reserved_day)
values('short',61,127,'{today}','0200','fetching',1,'{fetching_token}',clock_timestamp()+interval '1 minute',clock_timestamp()+interval '10 minutes',1048576,(timezone('Asia/Seoul',clock_timestamp()))::date);
insert into public.weather_fetch_attempts(token,model,nx,ny,base_date,base_time,generation,reserved_day,reserved_bytes)
values('{fetching_token}','short',61,127,'{today}','0200',1,(timezone('Asia/Seoul',clock_timestamp()))::date,1048576);
""")
before = sql('select count(*) from public.weather_fetch_cache;')
assert before == '2'
result = subprocess.run(base, input=b'set role postgres;\n' + migration.read_bytes(),
                        capture_output=True, timeout=30)
assert result.returncode == 0, result.stderr.decode()[-1800:]
assert sql('select count(*) from public.weather_fetch_cache;') == before
assert sql("select storage_bytes=octet_length(items::text) from public.weather_fetch_cache where state='ready';") == 't'
assert sql("select storage_bytes=1048576 from public.weather_fetch_cache where state='fetching';") == 't'
assert sql('select count(*) from public.weather_fetch_attempts;') == '1'
assert sql('select max_cache_rows||\':\'||max_attempt_rows||\':\'||max_payload_bytes from public.weather_budget_policy;') == '10000:10000:67108864'
assert sql("select not has_function_privilege('service_role','public.assert_weather_capacity_internal(integer,integer,bigint)','EXECUTE');") == 't'
print('UPGRADE RESULT: 1 PASS / 0 FAIL / 0 ERROR / 0 SKIP; existing ready/fetching payloads and attempt retained; ' + database, flush=True)
