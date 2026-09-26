"""AUTH-007 real PostgreSQL admission/ACL/concurrency proof on a task-owned local DB.
Never touches hosted databases or resets an existing DB. Retains fixtures and failure evidence.
"""
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import sys
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[3]
CONTAINER = "supabase_db_motocast"
DATABASE = "motocast_play_20260926"
LOG = ROOT / "verification-logs" / "play-admission"
LOG.mkdir(parents=True, exist_ok=True)
BASE = ["docker", "exec", "-i", CONTAINER, "psql", "-U", "supabase_admin", "-d", DATABASE, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"]
ADMIN = BASE.copy()
ADMIN[ADMIN.index(DATABASE)] = "postgres"

def run(command, data=None):
    return subprocess.run(command, input=data, capture_output=True, timeout=120)

def sql(query, ok=True):
    result = run(BASE, query.encode())
    if ok:
        assert result.returncode == 0, result.stderr.decode()[-3000:]
        return result.stdout.decode().strip()
    assert result.returncode != 0, "Expected rejection"
    return result.stderr.decode()

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

def rpc(name, *args, ok=True, role="service_role"):
    return sql("set role " + role + ";select public." + name + "(" + ",".join(map(quote, args)) + ");", ok)

passed = 0
def check(name, fn):
    global passed
    fn()
    passed += 1
    print("PASS: " + name, flush=True)

identity = run(["docker", "inspect", CONTAINER, "--format", '{{index .Config.Labels "com.supabase.cli.project"}}|{{.Config.Image}}'])
assert identity.stdout.decode().strip() == "motocast|public.ecr.aws/supabase/postgres:17.6.1.166"
assert shutil.disk_usage(ROOT).free > 10 * 1024**3, "Insufficient safety space"
probe = run(ADMIN, ("select count(*) from pg_database where datname=" + quote(DATABASE)).encode())
reuse = "--reuse" in sys.argv
assert probe.returncode == 0 and probe.stdout.strip() == (b"1" if reuse else b"0"), "Unexpected database identity"
if reuse:
    prior = json.loads((LOG / "database-resource.json").read_text())
    assert prior["owner"] == "play-membership" and prior["database"] == DATABASE
    assert prior["migrations"] == {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT / "supabase/migrations").glob("*.sql"))}
    assert sql("select count(*) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid();") == "0"
    (LOG / "database-resource-prior.json").write_text(json.dumps(prior,indent=2))
manifest = {"owner": "play-membership", "purpose": "AUTH-007 migration and admission proof", "database": DATABASE,
    "container": CONTAINER, "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "state": "RUNNING",
    "budgetBytes": 1024**3, "freeBytesBefore": shutil.disk_usage(ROOT).free,
    "retention": "Preserve failures; successful reproducible DB eligible for reviewed cleanup after 48 hours, not automatic deletion"}
manifest_path = LOG / "database-resource.json"
manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
if not reuse:
    result = run(ADMIN, ("create database " + DATABASE + " owner postgres template template0;").encode())
    assert result.returncode == 0, result.stderr.decode()
else:
    manifest["migrations"] = prior["migrations"]
    manifest["reusedEvidence"] = "Original baseline PASS 35/125/164; first admission run failed in synthetic expiry fixture (two clock_timestamp calls crossed one microsecond)."
try:
    if not reuse:
        dump = run(["docker", "exec", CONTAINER, "pg_dump", "-U", "supabase_admin", "-d", "postgres",
                    "--schema-only", "--schema=auth", "--section=pre-data", "--no-owner"])
        assert dump.returncode == 0
        restored = run(BASE, dump.stdout)
        assert restored.returncode == 0, restored.stderr.decode()[-2000:]
        sql("""alter table auth.users add primary key(id);
    grant usage on schema auth to postgres,anon,authenticated,service_role;
    grant all on all tables in schema auth to postgres;
    grant all on all functions in schema auth to postgres;
    grant all on all sequences in schema auth to postgres;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create extension postgis with schema extensions;
    grant usage on schema extensions,public to postgres,anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;
    """)
        migrations = sorted((ROOT / "supabase/migrations").glob("*.sql"))
        manifest["migrations"] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in migrations}
        for migration in migrations:
            result = run(BASE, b"set role postgres;\n" + migration.read_bytes())
            assert result.returncode == 0, (migration.name, result.stderr.decode()[-3000:])
        print(f"PASS: {len(migrations)} migrations replayed on {DATABASE}", flush=True)
        for suite in ["auth_rls_budget.test.sql", "plan_collection_share.test.sql", "live_acl_readback.test.sql"]:
            result = run(BASE, (ROOT / "supabase/tests/database" / suite).read_bytes())
            (LOG / (suite + ".log")).write_bytes(result.stdout + result.stderr)
            lines = result.stdout.decode().splitlines()
            count = sum(line.startswith("ok ") for line in lines)
            assert result.returncode == 0 and count > 0 and not any(line.startswith("not ok") for line in lines), suite
            print(f"BASELINE: {suite} {count} PASS / 0 FAIL", flush=True)

    def user(kakao=True):
        uid = str(uuid.uuid4())
        sql("insert into auth.users(id,aud,role,raw_user_meta_data) values(" + quote(uid) +
            ",'authenticated','authenticated','{\"name\":\"검증 라이더\",\"role\":\"admin\"}');")
        if kakao:
            sql("insert into auth.identities(id,user_id,provider_id,provider,identity_data) values(gen_random_uuid()," +
                quote(uid) + "," + quote(uid) + ",'kakao','{}');")
        return uid

    def begin(uid):
        return json.loads(rpc("begin_play_admission_internal", uid))

    def take(uid, challenge, token="a" * 64, ok=True):
        return rpc("take_play_admission_internal", uid, challenge["challengeId"], token, ok=ok)

    def complete(uid, challenge, token="a" * 64, ok=True):
        return rpc("complete_play_admission_internal", uid, challenge["challengeId"], token, ok=ok)

    def absent(uid):
        assert sql("select (select count(*) from public.memberships where user_id=" + quote(uid) +
            ")+(select count(*) from public.profiles where id=" + quote(uid) + ");") == "0"

    def privileges():
        for role in ["anon", "authenticated"]:
            for function, args in [("begin_play_admission_internal", [user()]),
                ("take_play_admission_internal", [user(), str(uuid.uuid4()), "a" * 64]),
                ("complete_play_admission_internal", [user(), str(uuid.uuid4()), "a" * 64])]:
                assert "permission denied" in rpc(function, *args, role=role, ok=False)
        for role in ["anon", "authenticated", "service_role"]:
            for table in ["play_admission_challenges", "play_admission_budget"]:
                assert "permission denied" in sql(f"set role {role}; select * from public.{table};", False)
                assert "permission denied" in sql(f"set role {role}; update public.{table} set " +
                    ("issued_count=1" if table.endswith("challenges") else "used=0") + ";", False)
        assert sql("select bool_and(relrowsecurity) from pg_class where oid in ('public.play_admission_challenges'::regclass,'public.play_admission_budget'::regclass);") == "t"
    check("full role matrix, direct read/write denial and RLS", privileges)

    def admission():
        uid = user(); challenge = begin(uid); absent(uid)
        take(uid, challenge); absent(uid)
        complete(uid, challenge); complete(uid, challenge)
        assert sql("select role||':'||(revoked_at is null)::text from public.memberships where user_id=" + quote(uid)) == "rider:true"
        assert sql("select count(*) from public.profiles where id=" + quote(uid)) == "1"
        assert begin(uid) == {"status": "active"}
    check("one rider/profile created atomically, exact retry idempotent, metadata cannot grant admin", admission)

    def invalid():
        uid, foreign = user(), user(); challenge = begin(uid)
        assert "PLAY_INVALID_CHALLENGE" in complete(uid, challenge, ok=False)
        assert "PLAY_INVALID_CHALLENGE" in take(foreign, challenge, ok=False)
        take(uid, challenge)
        assert "PLAY_INVALID_CHALLENGE" in take(uid, challenge, ok=False)
        assert "PLAY_INVALID_CHALLENGE" in complete(uid, challenge, "b"*64, False)
        absent(uid); absent(foreign)
        later = begin(uid)
        assert later["requestHash"] != challenge["requestHash"]
        assert "PLAY_INVALID_CHALLENGE" in complete(uid, challenge, ok=False)
        sql("update public.play_admission_challenges set issued_at=statement_timestamp()-interval '4 minutes',expires_at=statement_timestamp()-interval '1 minute' where user_id=" + quote(uid))
        assert "PLAY_INVALID_CHALLENGE" in take(uid, later, ok=False)
        absent(uid)
    check("unverified/foreign/replayed/superseded/expired attempts never create member or profile", invalid)

    def revoked():
        uid = user(); challenge = begin(uid); take(uid, challenge)
        sql("insert into public.memberships(user_id,role,revoked_at) values(" + quote(uid) + ",'rider',clock_timestamp());")
        assert "PLAY_MEMBERSHIP_REVOKED" in complete(uid, challenge, ok=False)
        assert "PLAY_MEMBERSHIP_REVOKED" in rpc("begin_play_admission_internal", uid, ok=False)
        assert sql("select revoked_at is not null from public.memberships where user_id=" + quote(uid)) == "t"
        assert sql("select count(*) from public.profiles where id=" + quote(uid)) == "0"
    check("revocation during proof cannot reactivate membership", revoked)

    def role_preservation():
        for role in ["rider", "admin"]:
            uid = user(); challenge = begin(uid); take(uid, challenge)
            sql("insert into public.memberships(user_id,role) values("+quote(uid)+","+quote(role)+");insert into public.profiles(id,nickname) values("+quote(uid)+",'기존 이름');")
            complete(uid, challenge)
            assert sql("select role from public.memberships where user_id="+quote(uid)) == role
            assert sql("select nickname from public.profiles where id="+quote(uid)) == "기존 이름"
    check("concurrent invited/admin members keep their role and profile", role_preservation)

    def concurrent_admission():
        uid = user(); challenge = begin(uid)
        def attempt(_):
            return run(BASE, ("set role service_role;select public.take_play_admission_internal("+
                ",".join(map(quote,[uid,challenge["challengeId"],"a"*64]))+");").encode())
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(attempt, range(6)))
        assert sum(r.returncode == 0 for r in results) == 1
        assert all(r.returncode == 0 or b"PLAY_INVALID_CHALLENGE" in r.stderr for r in results)
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(lambda _: complete(uid,challenge),range(6)))
        assert sql("select count(*) from public.memberships where user_id="+quote(uid)) == "1"
        assert sql("select count(*) from public.profiles where id="+quote(uid)) == "1"
    check("six simultaneous proof claims have one winner; six commits are idempotent", concurrent_admission)

    def throttles():
        uid = user()
        for _ in range(5): begin(uid)
        assert "PLAY_RATE_LIMITED" in rpc("begin_play_admission_internal", uid, ok=False)
        sql("update public.play_admission_challenges set window_started_at=clock_timestamp()-interval '2 hours' where user_id="+quote(uid))
        challenge = begin(uid)
        sql("update public.play_admission_budget set used=500;")
        assert "PLAY_RATE_LIMITED" in take(uid,challenge,ok=False)
        absent(uid)
        sql("update public.play_admission_budget set service_date=service_date-1;")
        take(uid,challenge)
        assert sql("select used from public.play_admission_budget") == "1"
    check("per-user attempts and global Google-call budget including Seoul date rollover", throttles)

    def identity():
        uid = user(False)
        assert "PLAY_AUTH_REQUIRED" in rpc("begin_play_admission_internal", uid, ok=False)
        absent(uid)
    check("only server-owned Kakao identities may start admission", identity)
    manifest["state"] = "PASS_PRESERVED"
    print(f"ADMISSION: {passed} PASS / 0 FAIL / 0 SKIP", flush=True)
except BaseException:
    manifest["state"] = "FAILED_PRESERVED"
    raise
finally:
    manifest["finishedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    manifest["sizeBytes"] = sql("select pg_database_size(current_database());")
    manifest["remainingSessions"] = sql("select count(*) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid();")
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
