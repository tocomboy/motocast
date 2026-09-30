"""Local-only claim/revoke races in an identity-verified isolated DB; retain evidence."""
from pathlib import Path
import argparse, re, subprocess, time, uuid

CONTAINER = "supabase_db_motocast"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--database", required=True, help="Fresh task-owned local invite database")
parser.add_argument("--container-id", required=True, help="Expected full 64-hex local container ID")
parser.add_argument("--database-marker", required=True, help="Expected task ownership comment on the database")
arguments = parser.parse_args()
DATABASE = arguments.database
CONTAINER_ID = arguments.container_id
DATABASE_MARKER = arguments.database_marker
if not re.fullmatch(r"motocast_invite_[0-9]{8}_[0-9a-f]{10}", DATABASE):
    raise RuntimeError("Refusing database outside the task-owned invite namespace")
if not re.fullmatch(r"[0-9a-f]{64}", CONTAINER_ID):
    raise RuntimeError("Expected container ID must be exactly 64 lowercase hexadecimal characters")
if not re.fullmatch(r"motocast-invite-dependency(?:-[0-9]{8})?;owner=invite_dependency;isolated=template0", DATABASE_MARKER):
    raise RuntimeError("Refusing database marker outside the task-owned invite purpose")
APPLICATION = "motocast_invite_" + uuid.uuid4().hex
BASE = ["docker", "exec", "-i", CONTAINER, "psql", "-U", "supabase_admin", "-d", DATABASE, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"]
ADMIN = "98000000-0000-4000-8000-000000000001"
USERS = [ADMIN, "98000000-0000-4000-8000-000000000002", "98000000-0000-4000-8000-000000000003"]
INVITES = ["98000000-0000-4000-8000-000000000010", "98000000-0000-4000-8000-000000000011"]
TOKENS = ["S" * 43, "T" * 43]  # synthetic, local fixtures only

def sql(query):
    result = subprocess.run(BASE, input=query, encoding="utf-8", capture_output=True, timeout=20)
    if result.returncode: raise AssertionError(result.stderr)
    return result.stdout.strip()

def quoted(values): return ",".join("'" + v + "'" for v in values)

def start(query):
    child = subprocess.Popen(BASE, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
    child.stdin.write(query); child.stdin.close(); child.stdin = None
    return child

def wait_for(predicate):
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        if sql(predicate) == "t": return
        time.sleep(0.05)
    raise AssertionError("expected database concurrency phase not reached")

identity = subprocess.run(["docker", "inspect", CONTAINER, "--format", "{{.Id}}|{{index .Config.Labels \"com.supabase.cli.project\"}}|{{.Config.Image}}|{{.State.Running}}"], capture_output=True, text=True, check=True).stdout.strip()
if identity != CONTAINER_ID + "|motocast|public.ecr.aws/supabase/postgres:17.6.1.166|true":
    raise RuntimeError("Local container identity mismatch")
if sql("select current_database();") != DATABASE:
    raise RuntimeError("Connected database identity mismatch")
if sql("select pg_get_userbyid(datdba)||'|'||coalesce(shobj_description(oid,'pg_database'),'') from pg_database where datname=current_database();") != "postgres|" + DATABASE_MARKER:
    raise RuntimeError("Task database ownership marker mismatch")
print("Dedicated database: " + DATABASE, flush=True)
assert sql("select count(*) from auth.users where id in (" + quoted(USERS) + ");") == "0"
assert sql("select to_regprocedure('public.revoke_invite(uuid)') is null;") == "t"
migration = Path(__file__).resolve().parents[2] / "migrations/20260921155004_invite_management_revoke.sql"
setup = "begin;set local role postgres;" + migration.read_text(encoding="utf-8") + "\ninsert into auth.users(id,aud,role,raw_user_meta_data) values "
setup += ",".join("('%s','authenticated','authenticated','{}')" % user for user in USERS) + ";"
setup += "insert into public.memberships(user_id,role) values ('%s','admin');" % ADMIN
for item, token in zip(INVITES, TOKENS):
    setup += "insert into public.invitations(id,token_hash,created_by,expires_at) values ('%s',encode(extensions.digest('%s','sha256'),'hex'),'%s',now()+interval '1 day');" % (item,token,ADMIN)
setup += "commit;"
children = []
try:
    sql(setup)
    for index, winner in enumerate(("revoke", "claim")):
        item, token, user = INVITES[index], TOKENS[index], USERS[index+1]
        claim = "select public.claim_invite('%s');" % token
        revoke = "select public.revoke_invite('%s');" % item
        first_user, first = (ADMIN, revoke) if winner == "revoke" else (user, claim)
        second_user, second = (user, claim) if winner == "revoke" else (ADMIN, revoke)
        first_sql = "set application_name='%s_winner';begin;set local role authenticated;set local \"request.jwt.claim.sub\"='%s';%s select pg_sleep(4);commit;" % (APPLICATION,first_user,first)
        a = start(first_sql); children.append(a)
        wait_for("select exists(select 1 from pg_stat_activity where datname=current_database() and application_name='%s_winner' and wait_event='PgSleep');" % APPLICATION)
        b = start("set application_name='%s_waiter';begin;set local role authenticated;set local \"request.jwt.claim.sub\"='%s';%s commit;" % (APPLICATION,second_user,second)); children.append(b)
        wait_for("select exists(select 1 from pg_stat_activity where datname=current_database() and application_name='%s_waiter' and wait_event_type='Lock');" % APPLICATION)
        out_a, err_a = a.communicate(timeout=12); out_b, err_b = b.communicate(timeout=12)
        assert a.returncode == 0, err_a
        if winner == "revoke":
            assert b.returncode != 0 and "INVALID_INVITE" in err_b
            assert sql("select revoked_at is not null and consumed_at is null from public.invitations where id='%s';" % item) == "t"
            assert sql("select count(*) from public.memberships where user_id='%s';" % user) == "0"
        else:
            assert b.returncode == 0 and out_b.strip() == "used", err_b
            assert sql("select revoked_at is null and consumed_at is not null from public.invitations where id='%s';" % item) == "t"
            assert sql("select count(*) from public.memberships where user_id='%s' and revoked_at is null;" % user) == "1"
        print("PASS: " + winner + " wins; competing operation waited for the row lock")
finally:
    for child in children:
        if child.poll() is None: child.terminate(); child.wait(timeout=5)
    print("RETAINED: task database, candidate function and exact synthetic fixtures", flush=True)
