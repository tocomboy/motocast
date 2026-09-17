#!/usr/bin/env python3
"""Fail-closed retirement of backed-up MOTOCAST route history."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


ALLOWED_PROJECTS = {"lehjmbgfpoemqcwxowbx", "obodvbyzptxeehgpcpkd"}
TABLE_KEYS: dict[str, tuple[str, ...]] = {
    "share_preview_grants": ("id",),
    "share_links": ("id",),
    "weather_snapshots": ("id",),
    "route_cache": ("id",),
    "trip_waypoints": ("id",),
    "trips": ("id",),
    "collection_save_operations": ("owner_id", "operation_id"),
    "collection_versions": ("id",),
    "riding_collections": ("id",),
    "route_plan_drafts": ("owner_id", "planning_id", "candidate_profile"),
    "route_plan_runs": ("owner_id", "planning_id"),
}
DELETE_ORDER = tuple(TABLE_KEYS)
PROTECTED_TABLES = (
    "public.profiles", "public.memberships", "public.invitations",
    "public.api_usage_daily", "public.release_announcements",
    "auth.users", "auth.identities",
)
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
SHA256 = re.compile(r"^[0-9a-f]{64}$")
POOLER_HOST = re.compile(r"^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+pooler\.supabase\.com$")
ROLE_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
PSQL_ARGUMENTS = ("psql", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1")


class RetirementError(RuntimeError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _load_transfer_module():
    path = Path(__file__).with_name("production-user-transfer.py")
    spec = importlib.util.spec_from_file_location("motocast_production_user_transfer", path)
    if spec is None or spec.loader is None:
        raise RetirementError("TRANSFER_MODULE_UNAVAILABLE")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


TRANSFER = _load_transfer_module()


@dataclass(frozen=True)
class Backup:
    project_ref: str
    account_ids: tuple[str, ...]
    tables: dict[str, list[dict[str, Any]]]
    sha256: str

    @property
    def counts(self) -> dict[str, int]:
        return {table: len(self.tables[table]) for table in TABLE_KEYS}


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _canonical(value: Any) -> str:
    return TRANSFER.canonical_json(value)


def _private_path(path: Path) -> None:
    if os.name == "nt" or not hasattr(os, "getuid"):
        raise RetirementError("BACKUP_PRIVACY_UNVERIFIABLE")
    for candidate in (path.parent, path):
        try:
            details = candidate.stat()
        except OSError:
            raise RetirementError("BACKUP_UNAVAILABLE") from None
        if details.st_uid != os.getuid() or stat.S_IMODE(details.st_mode) & 0o077:
            raise RetirementError("BACKUP_NOT_OWNER_PRIVATE")


def _row_key(table: str, row: dict[str, Any]) -> tuple[str, ...]:
    values: list[str] = []
    for key in TABLE_KEYS[table]:
        value = row.get(key)
        if not isinstance(value, str) or not value or "\x00" in value:
            raise RetirementError("BACKUP_ROW_KEY_INVALID")
        values.append(value)
    return tuple(values)


def _validate_ownership(account_ids: set[str], tables: dict[str, list[dict[str, Any]]]) -> None:
    direct = {
        "share_preview_grants": "owner_id", "share_links": "owner_id", "trips": "user_id",
        "collection_save_operations": "owner_id", "riding_collections": "owner_id",
        "route_plan_drafts": "owner_id", "route_plan_runs": "owner_id",
    }
    for table, owner_key in direct.items():
        if any(row.get(owner_key) not in account_ids for row in tables[table]):
            raise RetirementError("BACKUP_OWNER_SCOPE_INVALID")
    trip_ids = {row["id"] for row in tables["trips"]}
    for table in ("weather_snapshots", "route_cache", "trip_waypoints"):
        if any(row.get("trip_id") not in trip_ids for row in tables[table]):
            raise RetirementError("BACKUP_OWNER_SCOPE_INVALID")
    collection_ids = {row["id"] for row in tables["riding_collections"]}
    if any(row.get("collection_id") not in collection_ids or row.get("created_by") not in account_ids
           for row in tables["collection_versions"]):
        raise RetirementError("BACKUP_OWNER_SCOPE_INVALID")


def load_backup(path: Path, expected_sha256: str, project_ref: str, repository: Path | None = None) -> Backup:
    if project_ref not in ALLOWED_PROJECTS or not SHA256.fullmatch(expected_sha256):
        raise RetirementError("ARGUMENT_INVALID")
    resolved = path.expanduser().resolve(strict=True)
    if repository is not None and (resolved == repository.resolve() or repository.resolve() in resolved.parents):
        raise RetirementError("BACKUP_MUST_BE_EXTERNAL")
    _private_path(resolved)
    try:
        payload = resolved.read_bytes()
    except OSError:
        raise RetirementError("BACKUP_UNAVAILABLE") from None
    actual_sha = hashlib.sha256(payload).hexdigest()
    if actual_sha != expected_sha256:
        raise RetirementError("BACKUP_SHA256_MISMATCH")
    try:
        raw = json.loads(payload, parse_float=TRANSFER.Decimal)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise RetirementError("BACKUP_JSON_INVALID") from None
    if not isinstance(raw, dict) or raw.get("schemaVersion") != 1 or raw.get("projectRef") != project_ref:
        raise RetirementError("BACKUP_HEADER_INVALID")
    if set(raw) != {"schemaVersion", "projectRef", "capturedAt", "accountIds", "tables"}:
        raise RetirementError("BACKUP_SHAPE_INVALID")
    account_values = raw.get("accountIds")
    if not isinstance(account_values, list) or not account_values or any(not isinstance(item, str) or not UUID.fullmatch(item) for item in account_values):
        raise RetirementError("BACKUP_ACCOUNT_IDS_INVALID")
    account_ids = tuple(sorted(account_values))
    if len(set(account_ids)) != len(account_ids):
        raise RetirementError("BACKUP_ACCOUNT_IDS_INVALID")
    table_values = raw.get("tables")
    if not isinstance(table_values, dict) or set(table_values) != set(TABLE_KEYS):
        raise RetirementError("BACKUP_TABLE_SET_INVALID")
    tables: dict[str, list[dict[str, Any]]] = {}
    for table in TABLE_KEYS:
        rows = table_values[table]
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise RetirementError("BACKUP_TABLE_ROWS_INVALID")
        keys = [_row_key(table, row) for row in rows]
        if len(keys) != len(set(keys)):
            raise RetirementError("BACKUP_ROW_KEY_DUPLICATE")
        tables[table] = [row for _, row in sorted(zip(keys, rows), key=lambda item: item[0])]
    _validate_ownership(set(account_ids), tables)
    return Backup(project_ref, account_ids, tables, actual_sha)


def _rows_sql(table: str) -> str:
    order = ", ".join(f"t.{key}" for key in TABLE_KEYS[table])
    return f"coalesce((select jsonb_agg(to_jsonb(t) order by {order}) from public.{table} t), '[]'::jsonb)"


def build_readback_sql() -> str:
    table_pairs = ",\n".join(f"      {_sql_literal(table)}, {_rows_sql(table)}" for table in TABLE_KEYS)
    return f"""select jsonb_build_object(
  'accountIds', coalesce((select jsonb_agg(id order by id) from auth.users), '[]'::jsonb),
  'tables', jsonb_build_object(
{table_pairs}
  )
) as snapshot"""


def _expected_state(backup: Backup) -> dict[str, Any]:
    return {"accountIds": list(backup.account_ids), "tables": backup.tables}


def verify_readback(adapter: Any, backup: Backup) -> None:
    current = adapter.query_value(backup.project_ref, build_readback_sql())
    if _canonical(current) != _canonical(_expected_state(backup)):
        raise RetirementError("CURRENT_STATE_DIFFERS_FROM_BACKUP")


def _fingerprint_sql(table: str) -> str:
    return (
        "encode(extensions.digest(coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text "
        f"from {table} t), '[]'), 'sha256'), 'hex')"
    )


def _delete_sql(table: str, rows: list[dict[str, Any]]) -> str:
    if not rows:
        return ""
    keys = TABLE_KEYS[table]
    left = ", ".join(f"{key}::text" for key in keys)
    values = ", ".join("(" + ", ".join(_sql_literal(str(row[key])) for key in keys) + ")" for row in rows)
    return f"""
  delete from public.{table} where ({left}) in (values {values});
  get diagnostics affected_rows = row_count;
  if affected_rows <> {len(rows)} then raise exception using message = 'RETIRE_ROWCOUNT_MISMATCH'; end if;"""


def _dollar_quote(body: str) -> str:
    suffix = ""
    counter = 0
    while True:
        delimiter = f"$retire{suffix}$"
        if delimiter not in body:
            return f"{delimiter}\n{body}\n{delimiter}"
        counter += 1
        suffix = f"_{counter}"


def build_retirement_sql(backup: Backup) -> str:
    expected = _sql_literal(_canonical(_expected_state(backup)))
    target_tables = ", ".join(f"public.{table}" for table in TABLE_KEYS)
    protected_tables = ", ".join(PROTECTED_TABLES)
    protected_before = ",\n".join(
        f"    {_sql_literal(table)}, {_fingerprint_sql(table)}" for table in PROTECTED_TABLES
    )
    protected_after = protected_before
    deletions = "".join(_delete_sql(table, backup.tables[table]) for table in DELETE_ORDER)
    empty_checks = " and ".join(f"not exists (select 1 from public.{table})" for table in TABLE_KEYS)
    body = f"""declare
  expected jsonb := {expected}::jsonb;
  current_state jsonb;
  protected_before jsonb;
  protected_after jsonb;
  affected_rows integer;
begin
  select ({build_readback_sql()}) into current_state;
  if current_state is distinct from expected then raise exception using message = 'RETIRE_CURRENT_STATE_MISMATCH'; end if;
  protected_before := jsonb_build_object(
{protected_before}
  );
{deletions}
  if not ({empty_checks}) then raise exception using message = 'RETIRE_TARGET_ROWS_REMAIN'; end if;
  protected_after := jsonb_build_object(
{protected_after}
  );
  if protected_after is distinct from protected_before then raise exception using message = 'RETIRE_PROTECTED_STATE_CHANGED'; end if;
end;"""
    return f"""begin isolation level serializable;
set local role postgres;
set local statement_timeout = '60s';
set local standard_conforming_strings = on;
lock table {target_tables} in share row exclusive mode;
lock table {protected_tables} in share mode;
do {_dollar_quote(body)};
commit;
"""


def _select_pooler(value: Any, project_ref: str) -> dict[str, Any]:
    if project_ref not in ALLOWED_PROJECTS or not isinstance(value, list):
        raise RetirementError("POOLER_CONFIG_INVALID")
    primary = [item for item in value if isinstance(item, dict) and item.get("database_type") == "PRIMARY"]
    if len(primary) != 1 or primary[0].get("pool_mode") != "transaction":
        raise RetirementError("POOLER_CONFIG_INVALID")
    pooler = primary[0]
    if not isinstance(pooler.get("db_host"), str) or not POOLER_HOST.fullmatch(pooler["db_host"]):
        raise RetirementError("POOLER_CONFIG_INVALID")
    if pooler.get("db_port") != 6543 or pooler.get("db_name") != "postgres" or pooler.get("db_user") != f"postgres.{project_ref}":
        raise RetirementError("POOLER_CONFIG_INVALID")
    return pooler


def execute_retirement(
    management_request: Callable[[str, str, dict[str, Any] | None], Any],
    backup: Backup,
    sql: str,
    *,
    runner: Callable[..., Any] = subprocess.run,
    certificate_path: Path | None = None,
) -> None:
    transport = importlib.import_module("production_transfer_transport")
    certificate = certificate_path or transport.CERTIFICATE_PATH
    try:
        transport._validate_certificate(certificate)
    except transport.ImportTransportError as error:
        raise RetirementError("TLS_CERTIFICATE_INVALID") from error
    pooler = _select_pooler(management_request("GET", f"/v1/projects/{backup.project_ref}/config/database/pooler", None), backup.project_ref)
    login = management_request("POST", f"/v1/projects/{backup.project_ref}/cli/login-role", {"read_only": False})
    if not isinstance(login, dict) or login.get("ttl_seconds") != 300 or not isinstance(login.get("role"), str) or not ROLE_NAME.fullmatch(login["role"]):
        raise RetirementError("LOGIN_ROLE_INVALID")
    password = login.get("password")
    if not isinstance(password, str) or not password or "\x00" in password:
        raise RetirementError("LOGIN_ROLE_INVALID")
    environment = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    environment.update({
        "PGHOST": pooler["db_host"], "PGPORT": "6543", "PGDATABASE": "postgres",
        "PGUSER": f"{login['role']}.{backup.project_ref}", "PGPASSWORD": password,
        "PGSSLMODE": "verify-full", "PGSSLROOTCERT": str(certificate),
        "PGCONNECT_TIMEOUT": "15", "PGCLIENTENCODING": "UTF8",
    })
    try:
        completed = runner(list(PSQL_ARGUMENTS), input=sql, env=environment, capture_output=True,
                           text=True, encoding="utf-8", timeout=90, check=False)
    except subprocess.TimeoutExpired:
        raise RetirementError("PSQL_TIMEOUT") from None
    except OSError:
        raise RetirementError("PSQL_UNAVAILABLE") from None
    if completed.returncode != 0:
        raise RetirementError("PSQL_FAILED")


def summary(backup: Backup, status: str) -> dict[str, Any]:
    return {"status": status, "projectRef": backup.project_ref, "backupSha256": backup.sha256, "counts": backup.counts}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify or retire backed-up MOTOCAST route history.")
    parser.add_argument("--project-ref", required=True, choices=sorted(ALLOWED_PROJECTS))
    parser.add_argument("--backup", required=True, type=Path)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        repository = Path(__file__).resolve().parents[1]
        backup = load_backup(args.backup, args.expected_sha256, args.project_ref, repository)
        api = TRANSFER.ManagementApi(TRANSFER.read_access_token())
        verify_readback(api, backup)
        if args.apply:
            execute_retirement(api._request, backup, build_retirement_sql(backup))
        print(_canonical(summary(backup, "applied" if args.apply else "verified-dry-run")))
        return 0
    except RetirementError as error:
        print(_canonical({"code": error.code}), file=sys.stderr)
        return 2
    except TRANSFER.TransferError as error:
        print(_canonical({"code": error.code}), file=sys.stderr)
        return 2
    except Exception:
        print(_canonical({"code": "INTERNAL_ERROR"}), file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
