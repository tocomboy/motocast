#!/usr/bin/env python3
"""Memory-only, fail-closed Preview to Production user transfer operator."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
from decimal import Decimal
from pathlib import Path
from typing import Any, Protocol


SOURCE_REF = "lehjmbgfpoemqcwxowbx"
TARGET_REF = "obodvbyzptxeehgpcpkd"
MANAGEMENT_ORIGIN = "https://api.supabase.com"
IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$")
MIGRATION_FILE = re.compile(r"^(\d{14})_[a-z0-9_]+\.sql$")

AUTH_USERS_COLUMNS = (
    "id",
    "instance_id",
    "aud",
    "role",
    "email",
    "email_confirmed_at",
    "invited_at",
    "last_sign_in_at",
    "raw_app_meta_data",
    "raw_user_meta_data",
    "created_at",
    "updated_at",
    "is_super_admin",
    "is_sso_user",
    "is_anonymous",
)
AUTH_USERS_OMITTED = frozenset(
    {
        "encrypted_password",
        "confirmation_token",
        "confirmation_sent_at",
        "recovery_token",
        "recovery_sent_at",
        "email_change_token_new",
        "email_change",
        "email_change_sent_at",
        "phone",
        "phone_confirmed_at",
        "phone_change",
        "phone_change_token",
        "phone_change_sent_at",
        "confirmed_at",
        "email_change_token_current",
        "email_change_confirm_status",
        "banned_until",
        "reauthentication_token",
        "reauthentication_sent_at",
        "deleted_at",
    }
)
AUTH_IDENTITIES_COLUMNS = (
    "id",
    "provider_id",
    "user_id",
    "identity_data",
    "provider",
    "last_sign_in_at",
    "created_at",
    "updated_at",
)
AUTH_IDENTITIES_OMITTED = frozenset({"email"})

PUBLIC_TABLES = (
    "profiles",
    "memberships",
    "invitations",
    "riding_collections",
    "collection_versions",
    "trips",
    "trip_waypoints",
    "route_cache",
    "weather_snapshots",
    "share_links",
    "route_plan_drafts",
    "route_plan_runs",
    "collection_save_operations",
)
TABLES = ("auth.users", "auth.identities") + tuple(
    f"public.{name}" for name in PUBLIC_TABLES
)
EXPECTED_MIGRATION_COUNT = 11


class TransferError(RuntimeError):
    """An expected failure whose code is safe to show to an operator."""

    def __init__(self, code: str):
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", code):
            code = "INTERNAL_ERROR"
        self.code = code
        super().__init__(code)


class QueryAdapter(Protocol):
    def query_value(self, project_ref: str, sql: str) -> Any: ...

    def auth_config(self, project_ref: str) -> dict[str, Any]: ...


class ManagementApi:
    """Minimal no-retry adapter for the Supabase Management API."""

    def __init__(self, access_token: str, timeout_seconds: int = 90):
        if not access_token:
            raise TransferError("ACCESS_TOKEN_EMPTY")
        self._access_token = access_token
        self._timeout_seconds = timeout_seconds

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
        data = None
        headers = {
            "Authorization": f"Bearer {self._access_token}",
            "Accept": "application/json",
        }
        if payload is not None:
            data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            f"{MANAGEMENT_ORIGIN}{path}", data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"), parse_float=Decimal)
        except urllib.error.HTTPError as error:
            raise TransferError(f"MANAGEMENT_HTTP_{error.code}") from None
        except (urllib.error.URLError, TimeoutError):
            raise TransferError("MANAGEMENT_TRANSPORT_ERROR") from None
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise TransferError("MANAGEMENT_RESPONSE_INVALID") from None

    def query_value(self, project_ref: str, sql: str) -> Any:
        response = self._request(
            "POST", f"/v1/projects/{project_ref}/database/query", {"query": sql}
        )
        if not isinstance(response, list) or len(response) != 1 or not isinstance(response[0], dict):
            raise TransferError("DATABASE_QUERY_SHAPE_INVALID")
        row = response[0]
        if len(row) != 1:
            raise TransferError("DATABASE_QUERY_SHAPE_INVALID")
        value = next(iter(row.values()))
        if isinstance(value, str):
            try:
                return json.loads(value, parse_float=Decimal)
            except json.JSONDecodeError:
                raise TransferError("DATABASE_QUERY_VALUE_INVALID") from None
        return value

    def auth_config(self, project_ref: str) -> dict[str, Any]:
        response = self._request("GET", f"/v1/projects/{project_ref}/config/auth")
        if not isinstance(response, dict):
            raise TransferError("AUTH_CONFIG_SHAPE_INVALID")
        return response


def canonical_json(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise TransferError("JSON_NUMBER_INVALID")
        return format(value, "f")
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        if any(not isinstance(key, str) for key in value):
            raise TransferError("JSON_OBJECT_KEY_INVALID")
        return "{" + ",".join(
            canonical_json(key) + ":" + canonical_json(value[key]) for key in sorted(value)
        ) + "}"
    raise TransferError("JSON_VALUE_UNSUPPORTED")


def digest(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def quote_identifier(value: str) -> str:
    if not IDENTIFIER.fullmatch(value):
        raise TransferError("IDENTIFIER_INVALID")
    return f'"{value}"'


def quote_table(table: str) -> str:
    try:
        schema, name = table.split(".", 1)
    except ValueError:
        raise TransferError("TABLE_NAME_INVALID") from None
    if table not in TABLES:
        raise TransferError("TABLE_NOT_ALLOWED")
    return f"{quote_identifier(schema)}.{quote_identifier(name)}"


def sql_literal(value: str) -> str:
    if "\x00" in value:
        raise TransferError("SQL_LITERAL_INVALID")
    return "'" + value.replace("'", "''") + "'"


def expected_migrations(migrations_dir: Path) -> list[str]:
    if not migrations_dir.is_dir():
        raise TransferError("MIGRATIONS_DIRECTORY_INVALID")
    versions: list[str] = []
    for path in sorted(migrations_dir.iterdir()):
        if not path.is_file():
            continue
        match = MIGRATION_FILE.fullmatch(path.name)
        if match is None:
            raise TransferError("MIGRATION_FILENAME_INVALID")
        versions.append(match.group(1))
    if len(versions) != EXPECTED_MIGRATION_COUNT or len(set(versions)) != len(versions):
        raise TransferError("MIGRATION_SET_INVALID")
    return versions


def _table_values_sql() -> str:
    pairs = []
    for table in TABLES:
        schema, name = table.split(".", 1)
        pairs.append(f"({sql_literal(schema)},{sql_literal(name)})")
    return ",".join(pairs)


def _metadata_expression() -> str:
    table_values = _table_values_sql()
    return f"""
jsonb_build_object(
  'columns', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', n.nspname || '.' || c.relname,
      'name', a.attname,
      'type', format_type(a.atttypid, a.atttypmod),
      'not_null', a.attnotnull,
      'identity', a.attidentity,
      'generated', a.attgenerated,
      'position', a.attnum
    ) order by n.nspname, c.relname, a.attnum)
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    join (values {table_values}) selected(schema_name, table_name)
      on selected.schema_name = n.nspname and selected.table_name = c.relname
    where a.attnum > 0 and not a.attisdropped
  ), '[]'::jsonb),
  'foreign_keys', coalesce((
    select jsonb_agg(jsonb_build_object(
      'source_table', ns.nspname || '.' || cl.relname,
      'source_columns', to_jsonb(array(
        select att.attname
        from unnest(con.conkey) with ordinality keys(attnum, ord)
        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = keys.attnum
        order by keys.ord
      )),
      'target_table', rns.nspname || '.' || rcl.relname,
      'target_columns', to_jsonb(array(
        select att.attname
        from unnest(con.confkey) with ordinality keys(attnum, ord)
        join pg_attribute att on att.attrelid = con.confrelid and att.attnum = keys.attnum
        order by keys.ord
      )),
      'definition', pg_get_constraintdef(con.oid)
    ) order by ns.nspname, cl.relname, con.conname)
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
    join pg_class rcl on rcl.oid = con.confrelid
    join pg_namespace rns on rns.oid = rcl.relnamespace
    join (values {table_values}) selected(schema_name, table_name)
      on selected.schema_name = ns.nspname and selected.table_name = cl.relname
    where con.contype = 'f'
  ), '[]'::jsonb),
  'migrations', coalesce((
    select jsonb_agg(version::text order by version::text)
    from supabase_migrations.schema_migrations
  ), '[]'::jsonb)
)
""".strip()


def build_metadata_sql() -> str:
    return f"select {_metadata_expression()} as metadata"


def _normalize_metadata(metadata: Any) -> dict[str, Any]:
    if not isinstance(metadata, dict):
        raise TransferError("SCHEMA_METADATA_INVALID")
    columns = metadata.get("columns")
    foreign_keys = metadata.get("foreign_keys")
    migrations = metadata.get("migrations")
    if not isinstance(columns, list) or not isinstance(foreign_keys, list) or not isinstance(migrations, list):
        raise TransferError("SCHEMA_METADATA_INVALID")
    return metadata


def columns_by_table(metadata: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    result = {table: [] for table in TABLES}
    for column in metadata["columns"]:
        if not isinstance(column, dict) or column.get("table") not in result:
            raise TransferError("SCHEMA_COLUMN_INVALID")
        name = column.get("name")
        if not isinstance(name, str) or not IDENTIFIER.fullmatch(name):
            raise TransferError("SCHEMA_COLUMN_INVALID")
        if not isinstance(column.get("position"), int):
            raise TransferError("SCHEMA_COLUMN_INVALID")
        if column.get("identity") not in ("", None) or column.get("generated") not in ("", None, "s"):
            raise TransferError("SCHEMA_COLUMN_INVALID")
        result[column["table"]].append(column)
    if any(not values for values in result.values()):
        raise TransferError("SCHEMA_TABLE_MISSING")
    for values in result.values():
        values.sort(key=lambda column: column["position"])
    return result


def validate_metadata(metadata_value: Any, migrations: list[str]) -> dict[str, Any]:
    metadata = _normalize_metadata(metadata_value)
    if metadata["migrations"] != migrations:
        raise TransferError("MIGRATION_HISTORY_MISMATCH")
    grouped = columns_by_table(metadata)

    users = {column["name"]: column for column in grouped["auth.users"]}
    if set(users) != set(AUTH_USERS_COLUMNS) | AUTH_USERS_OMITTED:
        raise TransferError("AUTH_USERS_SCHEMA_MISMATCH")
    identities = {column["name"]: column for column in grouped["auth.identities"]}
    if set(identities) != set(AUTH_IDENTITIES_COLUMNS) | AUTH_IDENTITIES_OMITTED:
        raise TransferError("AUTH_IDENTITIES_SCHEMA_MISMATCH")

    for name in AUTH_USERS_COLUMNS:
        if users[name].get("generated") not in ("", None) or users[name].get("identity") not in ("", None):
            raise TransferError("AUTH_USERS_PROJECTION_INVALID")
    if users["confirmed_at"].get("generated") != "s":
        raise TransferError("AUTH_USERS_GENERATED_COLUMN_MISMATCH")
    for name in AUTH_USERS_OMITTED - {"confirmed_at"}:
        if users[name].get("generated") not in ("", None) or users[name].get("identity") not in ("", None):
            raise TransferError("AUTH_USERS_OMITTED_COLUMN_INVALID")

    for name in AUTH_IDENTITIES_COLUMNS:
        if identities[name].get("generated") not in ("", None) or identities[name].get("identity") not in ("", None):
            raise TransferError("AUTH_IDENTITIES_PROJECTION_INVALID")
    if identities["email"].get("generated") != "s":
        raise TransferError("AUTH_IDENTITIES_GENERATED_COLUMN_MISMATCH")

    for table in (f"public.{name}" for name in PUBLIC_TABLES):
        for column in grouped[table]:
            if column.get("generated") not in ("", None) or column.get("identity") not in ("", None):
                raise TransferError("PUBLIC_GENERATED_COLUMN_UNSUPPORTED")

    for fk in metadata["foreign_keys"]:
        if not isinstance(fk, dict) or fk.get("source_table") not in TABLES:
            raise TransferError("FOREIGN_KEY_METADATA_INVALID")
        target_table = fk.get("target_table")
        if not isinstance(target_table, str) or "." not in target_table:
            raise TransferError("FOREIGN_KEY_METADATA_INVALID")
        target_schema, target_name = target_table.split(".", 1)
        if not IDENTIFIER.fullmatch(target_schema) or not IDENTIFIER.fullmatch(target_name):
            raise TransferError("FOREIGN_KEY_METADATA_INVALID")
        if not isinstance(fk.get("definition"), str) or not fk["definition"]:
            raise TransferError("FOREIGN_KEY_METADATA_INVALID")
        if not isinstance(fk.get("source_columns"), list) or not fk["source_columns"]:
            raise TransferError("FOREIGN_KEY_METADATA_INVALID")
        if not isinstance(fk.get("target_columns"), list) or len(fk["target_columns"]) != len(fk["source_columns"]):
            raise TransferError("FOREIGN_KEY_METADATA_INVALID")
        for name in fk["source_columns"] + fk["target_columns"]:
            if not isinstance(name, str) or not IDENTIFIER.fullmatch(name):
                raise TransferError("FOREIGN_KEY_METADATA_INVALID")
        source_names = {column["name"] for column in grouped[fk["source_table"]]}
        if not set(fk["source_columns"]).issubset(source_names):
            raise TransferError("FOREIGN_KEY_METADATA_INVALID")
        if target_table in grouped:
            target_names = {column["name"] for column in grouped[target_table]}
            if not set(fk["target_columns"]).issubset(target_names):
                raise TransferError("FOREIGN_KEY_METADATA_INVALID")
    return metadata


def projection_for(table: str, metadata: dict[str, Any]) -> tuple[str, ...]:
    if table == "auth.users":
        return AUTH_USERS_COLUMNS
    if table == "auth.identities":
        return AUTH_IDENTITIES_COLUMNS
    grouped = columns_by_table(metadata)
    return tuple(column["name"] for column in grouped[table])


def _rows_expression(table: str, columns: tuple[str, ...]) -> str:
    selected = ", ".join(quote_identifier(column) for column in columns)
    return f"""
jsonb_build_object(
  'columns', {sql_literal(canonical_json(list(columns)))}::jsonb,
  'row_count', (select count(*) from {quote_table(table)}),
  'rows', coalesce((
    select jsonb_agg(to_jsonb(projected) order by to_jsonb(projected)::text)
    from (select {selected} from {quote_table(table)}) projected
  ), '[]'::jsonb)
)
""".strip()


def build_snapshot_sql(metadata: dict[str, Any]) -> str:
    table_pairs = []
    for table in TABLES:
        table_pairs.append(sql_literal(table))
        table_pairs.append(_rows_expression(table, projection_for(table, metadata)))
    tables_expression = "jsonb_build_object(" + ",".join(table_pairs) + ")"
    guards = """
jsonb_build_object(
  'users_total', (select count(*) from auth.users),
  'identities_total', (select count(*) from auth.identities),
  'non_kakao_identities', (select count(*) from auth.identities where provider <> 'kakao'),
  'identity_user_cardinality_invalid', (select count(*) from (
    select u.id from auth.users u left join auth.identities i on i.user_id = u.id
    group by u.id having count(i.id) <> 1
  ) invalid),
  'metadata_provider_invalid', (select count(*) from auth.users u where
    coalesce(u.raw_app_meta_data ->> 'provider', '') <> 'kakao'
    or exists (select 1 from jsonb_array_elements_text(coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb)) p where p <> 'kakao')
  ),
  'mfa_factors_total', (select count(*) from auth.mfa_factors),
  'invalid_users', (select count(*) from auth.users where
    coalesce(is_super_admin, false) or coalesce(is_sso_user, false) or coalesce(is_anonymous, false)
    or deleted_at is not null or banned_until is not null or coalesce(encrypted_password, '') <> ''
  ),
  'profiles_total', (select count(*) from public.profiles),
  'memberships_total', (select count(*) from public.memberships),
  'active_admins', (select count(*) from public.memberships where role = 'admin' and revoked_at is null),
  'active_riders', (select count(*) from public.memberships where role = 'rider' and revoked_at is null),
  'inactive_memberships', (select count(*) from public.memberships where revoked_at is not null)
)
""".strip()
    return f"""
select jsonb_build_object(
  'schema', ({_metadata_expression()}),
  'tables', {tables_expression},
  'guards', {guards}
)::text as snapshot
""".strip()


def validate_schema_match(source: dict[str, Any], target: dict[str, Any]) -> None:
    if canonical_json(source) != canonical_json(target):
        raise TransferError("SOURCE_TARGET_SCHEMA_MISMATCH")


def validate_fk_closure(snapshot: dict[str, Any]) -> None:
    table_rows = {table: snapshot["tables"][table]["rows"] for table in TABLES}
    for fk in snapshot["schema"]["foreign_keys"]:
        source_table = fk["source_table"]
        target_table = fk["target_table"]
        if target_table not in table_rows:
            if any(
                any(row.get(column) is not None for column in fk["source_columns"])
                for row in table_rows[source_table]
            ):
                raise TransferError("FOREIGN_KEY_OUTSIDE_TRANSFER")
            continue
        target_keys = {
            tuple(row.get(column) for column in fk["target_columns"])
            for row in table_rows[target_table]
        }
        for row in table_rows[source_table]:
            key = tuple(row.get(column) for column in fk["source_columns"])
            if any(value is None for value in key):
                continue
            if key not in target_keys:
                raise TransferError("FOREIGN_KEY_CLOSURE_FAILED")


def validate_source_snapshot(snapshot_value: Any, metadata: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(snapshot_value, dict) or not isinstance(snapshot_value.get("tables"), dict):
        raise TransferError("SOURCE_SNAPSHOT_INVALID")
    snapshot = snapshot_value
    if canonical_json(snapshot.get("schema")) != canonical_json(metadata):
        raise TransferError("SOURCE_SCHEMA_DRIFT")
    if set(snapshot["tables"]) != set(TABLES):
        raise TransferError("SOURCE_TABLE_SET_INVALID")
    for table in TABLES:
        value = snapshot["tables"].get(table)
        if not isinstance(value, dict) or not isinstance(value.get("rows"), list):
            raise TransferError("SOURCE_TABLE_SNAPSHOT_INVALID")
        if value.get("columns") != list(projection_for(table, metadata)):
            raise TransferError("SOURCE_PROJECTION_MISMATCH")
        if value.get("row_count") != len(value["rows"]):
            raise TransferError("SOURCE_ROW_COUNT_MISMATCH")

    expected_guards = {
        "users_total": 2,
        "identities_total": 2,
        "non_kakao_identities": 0,
        "identity_user_cardinality_invalid": 0,
        "metadata_provider_invalid": 0,
        "mfa_factors_total": 0,
        "invalid_users": 0,
        "profiles_total": 2,
        "memberships_total": 2,
        "active_admins": 1,
        "active_riders": 1,
        "inactive_memberships": 0,
    }
    if snapshot.get("guards") != expected_guards:
        raise TransferError("SOURCE_INVARIANTS_FAILED")
    validate_fk_closure(snapshot)
    return snapshot


def build_count_sql() -> str:
    pairs: list[str] = []
    for table in TABLES:
        pairs.extend((sql_literal(table), f"(select count(*) from {quote_table(table)})"))
    return "select jsonb_build_object(" + ",".join(pairs) + ") as counts"


def require_target_empty(counts: Any) -> dict[str, int]:
    if not isinstance(counts, dict) or set(counts) != set(TABLES):
        raise TransferError("TARGET_COUNTS_INVALID")
    if any(not isinstance(counts[table], int) or counts[table] < 0 for table in TABLES):
        raise TransferError("TARGET_COUNTS_INVALID")
    if any(counts[table] != 0 for table in TABLES):
        raise TransferError("TARGET_NOT_EMPTY")
    return counts


def _ordered_rows_sql(table: str, columns: tuple[str, ...]) -> str:
    selected = ", ".join(quote_identifier(column) for column in columns)
    return (
        "(select coalesce(jsonb_agg(to_jsonb(projected) order by to_jsonb(projected)::text),"
        f"'[]'::jsonb) from (select {selected} from {quote_table(table)}) projected)"
    )


def _dollar_quoted_do(body: str) -> str:
    suffix = 0
    while True:
        delimiter = "$transfer$" if suffix == 0 else f"$transfer_{suffix}$"
        if delimiter not in body:
            return f"do {delimiter}\n{body}\n{delimiter};"
        suffix += 1


def build_import_sql(snapshot: dict[str, Any], metadata: dict[str, Any], injected_sql: str = "") -> str:
    lock_tables = ", ".join(quote_table(table) for table in TABLES)
    nonempty = " or ".join(f"exists (select 1 from {quote_table(table)})" for table in TABLES)
    inserts: list[str] = []
    verifies: list[str] = []
    for table in TABLES:
        columns = projection_for(table, metadata)
        quoted_columns = ", ".join(quote_identifier(column) for column in columns)
        rows = snapshot["tables"][table]["rows"]
        rows_literal = sql_literal(canonical_json(rows))
        inserts.append(
            f"insert into {quote_table(table)} ({quoted_columns}) "
            f"select {quoted_columns} from jsonb_populate_recordset(null::{quote_table(table)}, {rows_literal}::jsonb);"
        )
        verifies.append(
            f"if {_ordered_rows_sql(table, columns)} is distinct from {rows_literal}::jsonb then "
            "raise exception 'TRANSFER_VERIFY_MISMATCH'; end if;"
        )

    result_pairs: list[str] = []
    for table in TABLES:
        result_pairs.extend((sql_literal(table), f"(select count(*) from {quote_table(table)})"))
    empty_check_body = f"""begin
  if {nonempty} then
    raise exception 'TRANSFER_TARGET_NOT_EMPTY';
  end if;
end"""
    verification_body = f"""begin
  {chr(10).join(verifies)}
  if (select count(*) from auth.users) <> 2
     or (select count(*) from auth.identities) <> 2
     or (select count(*) from public.profiles) <> 2
     or (select count(*) from public.memberships) <> 2
     or (select count(*) from public.memberships where role = 'admin' and revoked_at is null) <> 1
     or (select count(*) from public.memberships where role = 'rider' and revoked_at is null) <> 1
     or (select count(*) from public.memberships where revoked_at is not null) <> 0 then
    raise exception 'TRANSFER_INVARIANTS_FAILED';
  end if;
end"""
    return f"""
begin;
set local statement_timeout = '60s';
set local standard_conforming_strings = on;
lock table {lock_tables} in share row exclusive mode;
{_dollar_quoted_do(empty_check_body)}
{chr(10).join(inserts)}
{injected_sql}
{_dollar_quoted_do(verification_body)}
commit;
select jsonb_build_object({','.join(result_pairs)}) as counts
""".strip()


def verify_auth_configs(source: dict[str, Any], target: dict[str, Any]) -> None:
    required = (
        "external_kakao_enabled",
        "external_kakao_email_optional",
        "external_kakao_client_id",
    )
    if any(key not in source or key not in target for key in required):
        raise TransferError("KAKAO_CONFIG_INCOMPLETE")
    if source["external_kakao_enabled"] is not True or target["external_kakao_enabled"] is not True:
        raise TransferError("KAKAO_CONFIG_DISABLED")
    if source["external_kakao_email_optional"] is not True or target["external_kakao_email_optional"] is not True:
        raise TransferError("KAKAO_EMAIL_OPTIONAL_DISABLED")
    source_client = source["external_kakao_client_id"]
    target_client = target["external_kakao_client_id"]
    if not isinstance(source_client, str) or not source_client or source_client != target_client:
        raise TransferError("KAKAO_CLIENT_ID_MISMATCH")


def require_same_snapshot(before: dict[str, Any], after: dict[str, Any], code: str) -> None:
    if digest(before) != digest(after):
        raise TransferError(code)


def summary(snapshot: dict[str, Any]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    digests: dict[str, str] = {}
    for table in TABLES:
        rows = snapshot["tables"][table]["rows"]
        counts[table] = len(rows)
        digests[table] = digest(rows)
    return {"counts": counts, "digests": digests, "snapshot_digest": digest(snapshot)}


def run_operator(adapter: QueryAdapter, migrations_dir: Path, apply: bool) -> dict[str, Any]:
    migrations = expected_migrations(migrations_dir)
    verify_auth_configs(adapter.auth_config(SOURCE_REF), adapter.auth_config(TARGET_REF))

    source_metadata = validate_metadata(adapter.query_value(SOURCE_REF, build_metadata_sql()), migrations)
    source_sql = build_snapshot_sql(source_metadata)
    source_snapshot = validate_source_snapshot(adapter.query_value(SOURCE_REF, source_sql), source_metadata)

    target_metadata = validate_metadata(adapter.query_value(TARGET_REF, build_metadata_sql()), migrations)
    validate_schema_match(source_metadata, target_metadata)
    require_target_empty(adapter.query_value(TARGET_REF, build_count_sql()))

    if not apply:
        return summary(source_snapshot)

    source_before_import = validate_source_snapshot(
        adapter.query_value(SOURCE_REF, source_sql), source_metadata
    )
    require_same_snapshot(source_snapshot, source_before_import, "SOURCE_DRIFT_BEFORE_IMPORT")

    try:
        adapter.query_value(TARGET_REF, build_import_sql(source_snapshot, target_metadata))
        target_after = validate_source_snapshot(
            adapter.query_value(TARGET_REF, build_snapshot_sql(target_metadata)), target_metadata
        )
        source_after = validate_source_snapshot(
            adapter.query_value(SOURCE_REF, source_sql), source_metadata
        )
        require_same_snapshot(source_snapshot, source_after, "SOURCE_DRIFT")
        require_same_snapshot(source_snapshot, target_after, "TARGET_MISMATCH")
        return summary(target_after)
    except TransferError as error:
        raise TransferError(
            f"POST_IMPORT_STATE_UNCERTAIN_DATA_PRESERVED_{error.code}"
        ) from None
    except Exception:
        raise TransferError("POST_IMPORT_STATE_UNCERTAIN_DATA_PRESERVED_INTERNAL_ERROR") from None


def read_access_token() -> str:
    path = Path.home() / ".supabase" / "access-token"
    try:
        token = path.read_text(encoding="utf-8").strip()
    except OSError:
        raise TransferError("ACCESS_TOKEN_UNAVAILABLE") from None
    if not token:
        raise TransferError("ACCESS_TOKEN_EMPTY")
    return token


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Preflight or apply the fixed two-user MOTOCAST Preview to Production transfer."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="perform the one-shot import after all fail-closed preflight checks",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        migrations_dir = Path(__file__).resolve().parents[1] / "supabase" / "migrations"
        result = run_operator(ManagementApi(read_access_token()), migrations_dir, args.apply)
        print(canonical_json(result))
        return 0
    except TransferError as error:
        print(canonical_json({"code": error.code}), file=sys.stderr)
        return 2
    except Exception:
        print(canonical_json({"code": "INTERNAL_ERROR"}), file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
