"""Local-only concurrent retired invitation denial in an identity-verified isolated DB."""
from pathlib import Path
import argparse, re, subprocess, uuid

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

identity = subprocess.run(["docker", "inspect", CONTAINER, "--format", "{{.Id}}|{{index .Config.Labels \"com.supabase.cli.project\"}}|{{.Config.Image}}|{{.State.Running}}"], capture_output=True, text=True, check=True).stdout.strip()
if identity != CONTAINER_ID + "|motocast|public.ecr.aws/supabase/postgres:17.6.1.166|true":
    raise RuntimeError("Local container identity mismatch")
if sql("select current_database();") != DATABASE:
    raise RuntimeError("Connected database identity mismatch")
if sql("select pg_get_userbyid(datdba)||'|'||coalesce(shobj_description(oid,'pg_database'),'') from pg_database where datname=current_database();") != "postgres|" + DATABASE_MARKER:
    raise RuntimeError("Task database ownership marker mismatch")
print("Dedicated database: " + DATABASE, flush=True)
assert sql("select count(*) from auth.users where id in (" + quoted(USERS) + ");") == "0"
migration = Path(__file__).resolve().parents[2] / "migrations/20261001160839_retire_invitation_enrollment.sql"
setup = "begin;set local role postgres;" + migration.read_text(encoding="utf-8") + "\ninsert into auth.users(id,aud,role,raw_user_meta_data) values "
setup += ",".join("('%s','authenticated','authenticated','{}')" % user for user in USERS) + ";"
setup += "insert into public.memberships(user_id,role) values ('%s','admin');" % ADMIN
for item, token in zip(INVITES, TOKENS):
    setup += "insert into public.invitations(id,token_hash,created_by,expires_at) values ('%s',encode(extensions.digest('%s','sha256'),'hex'),'%s',now()+interval '1 day');" % (item,token,ADMIN)
setup += "commit;"
children = []
try:
    sql(setup)
    operations = [
        ("create", "select public.create_invite(interval '1 day');"),
        ("claim", "select public.claim_invite('%s');" % TOKENS[0]),
        ("revoke", "select public.revoke_invite('%s');" % INVITES[0]),
    ]
    for operation, query in operations:
        attempts = [start("set application_name='%s_%s';begin;set local role authenticated;"
            "set local \"request.jwt.claim.sub\"='%s';%s commit;" %
            (APPLICATION, operation, user, query)) for user in USERS[1:]]
        children.extend(attempts)
        for child in attempts:
            output, error = child.communicate(timeout=12)
            assert child.returncode != 0 and "permission denied for function" in error, (output, error)
        assert sql("select count(*) from public.memberships where user_id in (" + quoted(USERS[1:]) + ");") == "0"
        assert sql("select count(*) from public.profiles where id in (" + quoted(USERS[1:]) + ");") == "0"
        assert sql("select bool_and(consumed_at is null and consumed_by is null and revoked_at is null) "
            "from public.invitations where id in (" + quoted(INVITES) + ");") == "t"
        assert sql("select role||'|'||(revoked_at is null)::text from public.memberships where user_id='%s';" % ADMIN) == "admin|true"
        print("PASS: concurrent " + operation + " denied; member/profile/history unchanged")
finally:
    for child in children:
        if child.poll() is None: child.terminate(); child.wait(timeout=5)
    print("RETAINED: task database, candidate function and exact synthetic fixtures", flush=True)
