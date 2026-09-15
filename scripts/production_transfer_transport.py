"""Pinned, single-attempt psql transport for the Production import transaction."""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Callable


TARGET_REF = "obodvbyzptxeehgpcpkd"
CERTIFICATE_PATH = Path.home() / ".local/share/motocast/certificates/prod-ca-2021.crt"
CERTIFICATE_SHA256 = "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7"
ROLE_NAME = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
POOLER_HOST = re.compile(
    r"^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+pooler\.supabase\.com$"
)
PSQL_ARGUMENTS = ("psql", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1")


class ImportTransportError(RuntimeError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _select_pooler(value: Any, project_ref: str) -> dict[str, Any]:
    if project_ref != TARGET_REF or not isinstance(value, list):
        raise ImportTransportError("TARGET_POOLER_CONFIG_INVALID")
    primary = [item for item in value if isinstance(item, dict) and item.get("database_type") == "PRIMARY"]
    if len(primary) != 1 or primary[0].get("pool_mode") != "transaction":
        raise ImportTransportError("TARGET_POOLER_CONFIG_INVALID")
    pooler = primary[0]
    host = pooler.get("db_host")
    if not isinstance(host, str) or not POOLER_HOST.fullmatch(host):
        raise ImportTransportError("TARGET_POOLER_CONFIG_INVALID")
    if pooler.get("db_port") != 6543:
        raise ImportTransportError("TARGET_POOLER_CONFIG_INVALID")
    if pooler.get("db_name") != "postgres" or pooler.get("db_user") != f"postgres.{project_ref}":
        raise ImportTransportError("TARGET_POOLER_CONFIG_INVALID")
    return pooler


def _validate_login(value: Any) -> tuple[str, str]:
    if not isinstance(value, dict) or value.get("ttl_seconds") != 300:
        raise ImportTransportError("TARGET_LOGIN_ROLE_INVALID")
    role = value.get("role")
    password = value.get("password")
    if not isinstance(role, str) or not ROLE_NAME.fullmatch(role):
        raise ImportTransportError("TARGET_LOGIN_ROLE_INVALID")
    if not isinstance(password, str) or not password or "\x00" in password:
        raise ImportTransportError("TARGET_LOGIN_ROLE_INVALID")
    return role, password


def _validate_certificate(path: Path) -> None:
    try:
        payload = path.read_bytes()
    except OSError:
        raise ImportTransportError("TARGET_TLS_CERTIFICATE_INVALID") from None
    if hashlib.sha256(payload).hexdigest() != CERTIFICATE_SHA256:
        raise ImportTransportError("TARGET_TLS_CERTIFICATE_INVALID")


def _wire_sql(sql: str) -> str:
    prefix = "begin;\n"
    if not isinstance(sql, str) or not sql.startswith(prefix):
        raise ImportTransportError("TARGET_IMPORT_SQL_INVALID")
    return prefix + "set local role postgres;\n" + sql[len(prefix) :]


def execute_target_import(
    management_request: Callable[[str, str, dict[str, Any] | None], Any],
    project_ref: str,
    sql: str,
    *,
    runner: Callable[..., Any] = subprocess.run,
    inherited_environment: dict[str, str] | None = None,
    certificate_path: Path = CERTIFICATE_PATH,
) -> None:
    """Execute one import attempt without exposing credentials, SQL, or stderr."""

    if project_ref != TARGET_REF:
        raise ImportTransportError("TARGET_POOLER_CONFIG_INVALID")
    wire_sql = _wire_sql(sql)
    _validate_certificate(certificate_path)
    poolers = management_request("GET", f"/v1/projects/{project_ref}/config/database/pooler", None)
    pooler = _select_pooler(poolers, project_ref)
    login = management_request(
        "POST", f"/v1/projects/{project_ref}/cli/login-role", {"read_only": False}
    )
    role, password = _validate_login(login)
    source_environment = os.environ if inherited_environment is None else inherited_environment
    environment = {key: value for key, value in source_environment.items() if not key.startswith("PG")}
    environment.update(
        {
            "PGHOST": pooler["db_host"],
            "PGPORT": "6543",
            "PGDATABASE": "postgres",
            "PGUSER": f"{role}.{project_ref}",
            "PGPASSWORD": password,
            "PGSSLMODE": "verify-full",
            "PGSSLROOTCERT": str(certificate_path),
            "PGCONNECT_TIMEOUT": "15",
            "PGCLIENTENCODING": "UTF8",
        }
    )
    try:
        completed = runner(
            list(PSQL_ARGUMENTS),
            input=wire_sql,
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=90,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise ImportTransportError("TARGET_IMPORT_PSQL_TIMEOUT") from None
    except OSError:
        raise ImportTransportError("TARGET_IMPORT_PSQL_UNAVAILABLE") from None
    if completed.returncode != 0:
        raise ImportTransportError("TARGET_IMPORT_PSQL_FAILED")
