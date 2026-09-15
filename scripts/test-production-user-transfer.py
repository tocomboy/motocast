#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import io
import json
import os
import subprocess
import sys
import unittest
import urllib.error
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import production_transfer_transport as transport


SCRIPT = Path(__file__).with_name("production-user-transfer.py")
SPEC = importlib.util.spec_from_file_location("production_user_transfer", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("test module load failed")
transfer = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = transfer
SPEC.loader.exec_module(transfer)

DB_PORT = "55434"
LOCAL_REF = "local-validation166"
FIXTURE_USERS = (
    "92000000-0000-0000-0000-000000000001",
    "92000000-0000-0000-0000-000000000002",
)
FIXTURE_TIME = "2026-09-15T00:00:00+00:00"


class LocalDatabaseAdapter:
    """Single-use psql calls against only the retained isolated .166 database."""

    def query_value(self, project_ref: str, sql: str):
        if project_ref != LOCAL_REF:
            raise AssertionError("unexpected local project ref")
        environment = os.environ.copy()
        environment["PGPASSWORD"] = "postgres"
        completed = subprocess.run(
            [
                "psql",
                "-X",
                "-q",
                "-t",
                "-A",
                "-h",
                "127.0.0.1",
                "-p",
                DB_PORT,
                "-U",
                "supabase_admin",
                "-d",
                "postgres",
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                sql,
            ],
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=90,
            check=False,
        )
        if completed.returncode != 0:
            raise transfer.TransferError("LOCAL_QUERY_FAILED")
        lines = [line for line in completed.stdout.splitlines() if line.strip()]
        if not lines:
            return None
        try:
            return json.loads(lines[-1], parse_float=Decimal)
        except json.JSONDecodeError:
            raise transfer.TransferError("LOCAL_QUERY_RESULT_INVALID") from None

    def auth_config(self, project_ref: str):
        if project_ref != LOCAL_REF:
            raise AssertionError("unexpected local project ref")
        return {
            "external_kakao_enabled": True,
            "external_kakao_email_optional": True,
            "external_kakao_client_id": "synthetic-client-id",
        }

    def import_snapshot(self, project_ref: str, sql: str):
        if project_ref != LOCAL_REF:
            raise AssertionError("unexpected local project ref")
        if not sql.startswith("begin;\n"):
            raise AssertionError("unexpected import SQL")
        environment = os.environ.copy()
        environment["PGPASSWORD"] = "postgres"
        completed = subprocess.run(
            [
                "psql",
                "-X",
                "-q",
                "-t",
                "-A",
                "-h",
                "127.0.0.1",
                "-p",
                DB_PORT,
                "-U",
                "supabase_admin",
                "-d",
                "postgres",
                "-v",
                "ON_ERROR_STOP=1",
            ],
            input="begin;\nset local role postgres;\n" + sql[len("begin;\n") :],
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=90,
            check=False,
        )
        if completed.returncode != 0:
            raise transfer.TransferError("LOCAL_IMPORT_FAILED")


def table_value(metadata, table, rows):
    columns = list(transfer.projection_for(table, metadata))
    return {"columns": columns, "row_count": len(rows), "rows": rows}


def synthetic_snapshot(metadata):
    user_a, user_b = FIXTURE_USERS
    users = [
        {
            "id": user_a,
            "instance_id": "00000000-0000-0000-0000-000000000000",
            "aud": "authenticated",
            "role": "authenticated",
            "email": "transfer-a@motocast.test",
            "email_confirmed_at": FIXTURE_TIME,
            "invited_at": None,
            "last_sign_in_at": FIXTURE_TIME,
            "raw_app_meta_data": {"provider": "kakao", "providers": ["kakao"]},
            "raw_user_meta_data": {
                "name": "O'Brien $transfer$ $transfer_1$; DROP TABLE auth.users; --\n\\q\nretained",
                "number": Decimal("12345678901234567.8901234567890123456789"),
            },
            "created_at": FIXTURE_TIME,
            "updated_at": FIXTURE_TIME,
            "is_super_admin": False,
            "is_sso_user": False,
            "is_anonymous": False,
        },
        {
            "id": user_b,
            "instance_id": "00000000-0000-0000-0000-000000000000",
            "aud": "authenticated",
            "role": "authenticated",
            "email": "transfer-b@motocast.test",
            "email_confirmed_at": FIXTURE_TIME,
            "invited_at": FIXTURE_TIME,
            "last_sign_in_at": None,
            "raw_app_meta_data": {"provider": "kakao", "providers": ["kakao"]},
            "raw_user_meta_data": {"name": "라이더 B", "nested": {"count": 7}},
            "created_at": FIXTURE_TIME,
            "updated_at": FIXTURE_TIME,
            "is_super_admin": False,
            "is_sso_user": False,
            "is_anonymous": False,
        },
    ]
    identities = [
        {
            "id": "92100000-0000-0000-0000-000000000001",
            "provider_id": "synthetic-kakao-a",
            "user_id": user_a,
            "identity_data": {"email": "transfer-a@motocast.test", "sub": "synthetic-kakao-a"},
            "provider": "kakao",
            "last_sign_in_at": FIXTURE_TIME,
            "created_at": FIXTURE_TIME,
            "updated_at": FIXTURE_TIME,
        },
        {
            "id": "92100000-0000-0000-0000-000000000002",
            "provider_id": "synthetic-kakao-b",
            "user_id": user_b,
            "identity_data": {"email": "transfer-b@motocast.test", "sub": "synthetic-kakao-b"},
            "provider": "kakao",
            "last_sign_in_at": None,
            "created_at": FIXTURE_TIME,
            "updated_at": FIXTURE_TIME,
        },
    ]
    profiles = [
        {
            "id": user_a,
            "nickname": "관리자 'A'",
            "avatar_url": None,
            "created_at": FIXTURE_TIME,
            "updated_at": FIXTURE_TIME,
        },
        {
            "id": user_b,
            "nickname": "라이더 B",
            "avatar_url": "https://example.invalid/avatar?value='quoted'",
            "created_at": FIXTURE_TIME,
            "updated_at": FIXTURE_TIME,
        },
    ]
    memberships = [
        {
            "user_id": user_a,
            "role": "admin",
            "invited_by": None,
            "joined_at": FIXTURE_TIME,
            "revoked_at": None,
        },
        {
            "user_id": user_b,
            "role": "rider",
            "invited_by": user_a,
            "joined_at": FIXTURE_TIME,
            "revoked_at": None,
        },
    ]
    collection_id = "92200000-0000-0000-0000-000000000001"
    version_id = "92300000-0000-0000-0000-000000000001"
    collections = [
        {
            "id": collection_id,
            "owner_id": user_a,
            "title": "Route '); DROP TABLE public.trips; --",
            "description": "synthetic transfer fixture",
            "created_at": FIXTURE_TIME,
            "updated_at": FIXTURE_TIME,
        }
    ]
    versions = [
        {
            "id": version_id,
            "collection_id": collection_id,
            "version_number": 7,
            "title": "Version 7",
            "description": "number and timestamp preservation",
            "points": [
                {
                    "label": "O'Brien",
                    "lat": Decimal("37.1234567890123456789012345"),
                    "order": 1,
                }
            ],
            "created_by": user_a,
            "created_at": FIXTURE_TIME,
            "origin": {"lat": Decimal("37.1"), "lng": Decimal("127.1")},
            "destination": {"lat": Decimal("37.2"), "lng": Decimal("127.2")},
        }
    ]

    rows = {table: [] for table in transfer.TABLES}
    rows.update(
        {
            "auth.users": users,
            "auth.identities": identities,
            "public.profiles": profiles,
            "public.memberships": memberships,
            "public.riding_collections": collections,
            "public.collection_versions": versions,
        }
    )
    tables = {table: table_value(metadata, table, rows[table]) for table in transfer.TABLES}
    guards = {
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
    return {"schema": metadata, "tables": tables, "guards": guards}


class ProductionUserTransferTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adapter = LocalDatabaseAdapter()
        image = subprocess.run(
            [
                "docker",
                "inspect",
                "supabase_db_motocast-production-validation166-202609",
                "--format",
                "{{.Config.Image}}|{{.State.Health.Status}}|{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=15,
            check=True,
        ).stdout.strip()
        if image != "public.ecr.aws/supabase/postgres:17.6.1.166|healthy|55434":
            raise AssertionError("isolated .166 validation database identity mismatch")

        migrations = transfer.expected_migrations(
            SCRIPT.resolve().parents[1] / "supabase" / "migrations"
        )
        cls.metadata = transfer.validate_metadata(
            cls.adapter.query_value(LOCAL_REF, transfer.build_metadata_sql()), migrations
        )
        transfer.require_target_empty(cls.adapter.query_value(LOCAL_REF, transfer.build_count_sql()))

        seed = synthetic_snapshot(cls.metadata)
        cls.adapter.import_snapshot(LOCAL_REF, transfer.build_import_sql(seed, cls.metadata))
        cls.snapshot = transfer.validate_source_snapshot(
            cls.adapter.query_value(LOCAL_REF, transfer.build_snapshot_sql(cls.metadata)),
            cls.metadata,
        )
        cls._cleanup()

    @classmethod
    def _cleanup(cls):
        user_ids = ",".join(transfer.sql_literal(value) for value in FIXTURE_USERS)
        cls.adapter.query_value(
            LOCAL_REF,
            f"delete from auth.users where id in ({user_ids}); select 'null'::jsonb as result",
        )
        transfer.require_target_empty(cls.adapter.query_value(LOCAL_REF, transfer.build_count_sql()))

    def tearDown(self):
        counts = self.adapter.query_value(LOCAL_REF, transfer.build_count_sql())
        if any(counts.values()):
            self._cleanup()

    def test_snapshot_preserves_numbers_timestamps_and_malicious_looking_json(self):
        user = self.snapshot["tables"]["auth.users"]["rows"][0]
        self.assertEqual(
            user["raw_user_meta_data"]["name"],
            "O'Brien $transfer$ $transfer_1$; DROP TABLE auth.users; --\n\\q\nretained",
        )
        self.assertIsInstance(user["raw_user_meta_data"]["number"], Decimal)
        self.assertEqual(
            user["raw_user_meta_data"]["number"],
            Decimal("12345678901234567.8901234567890123456789"),
        )
        self.assertEqual(user["created_at"], FIXTURE_TIME)

        version = self.snapshot["tables"]["public.collection_versions"]["rows"][0]
        self.assertEqual(version["version_number"], 7)
        self.assertIsInstance(version["version_number"], int)
        self.assertEqual(
            version["points"][0]["lat"], Decimal("37.1234567890123456789012345")
        )
        self.assertEqual(version["created_at"], FIXTURE_TIME)

    def test_generated_columns_are_explicitly_excluded_and_public_generated_rejected(self):
        users = {item["name"]: item for item in self.metadata["columns"] if item["table"] == "auth.users"}
        identities = {
            item["name"]: item for item in self.metadata["columns"] if item["table"] == "auth.identities"
        }
        self.assertEqual(users["confirmed_at"]["generated"], "s")
        self.assertNotIn("confirmed_at", transfer.AUTH_USERS_COLUMNS)
        self.assertEqual(identities["email"]["generated"], "s")
        self.assertNotIn("email", transfer.AUTH_IDENTITIES_COLUMNS)

        modified = copy.deepcopy(self.metadata)
        for column in modified["columns"]:
            if column["table"] == "public.profiles" and column["name"] == "nickname":
                column["generated"] = "s"
        migrations = transfer.expected_migrations(
            SCRIPT.resolve().parents[1] / "supabase" / "migrations"
        )
        with self.assertRaisesRegex(transfer.TransferError, "PUBLIC_GENERATED_COLUMN_UNSUPPORTED"):
            transfer.validate_metadata(modified, migrations)

    def test_fk_closure_and_projection_user_identity_invariants(self):
        transfer.validate_fk_closure(self.snapshot)
        users = {row["id"] for row in self.snapshot["tables"]["auth.users"]["rows"]}
        identities = self.snapshot["tables"]["auth.identities"]["rows"]
        self.assertEqual({row["user_id"] for row in identities}, users)
        self.assertEqual({row["provider"] for row in identities}, {"kakao"})
        memberships = self.snapshot["tables"]["public.memberships"]["rows"]
        self.assertEqual({row["role"] for row in memberships}, {"admin", "rider"})

    def test_sql_literal_escaping_keeps_payload_inside_json_literal(self):
        sql = transfer.build_import_sql(self.snapshot, self.metadata)
        self.assertIn(
            "O''Brien $transfer$ $transfer_1$; DROP TABLE auth.users; --", sql
        )
        self.assertIn("\\q", sql)
        self.assertIn("Route ''); DROP TABLE public.trips; --", sql)
        self.assertEqual(sql.count("drop table"), 0)
        self.assertIn("DROP TABLE", sql)
        self.assertIn("do $transfer_2$", sql)
        self.assertEqual(sql.count("$transfer_2$"), 2)
        self.assertIn("12345678901234567.8901234567890123456789", sql)
        self.assertLess(sql.rindex("select jsonb_build_object("), sql.rindex("commit"))

    def test_canonical_json_rejects_lossy_or_nonfinite_numbers(self):
        exact = Decimal("12345678901234567.8901234567890123456789")
        self.assertEqual(transfer.canonical_json({"number": exact}), '{"number":12345678901234567.8901234567890123456789}')
        with self.assertRaisesRegex(transfer.TransferError, "JSON_VALUE_UNSUPPORTED"):
            transfer.canonical_json({"number": 1.25})
        with self.assertRaisesRegex(transfer.TransferError, "JSON_NUMBER_INVALID"):
            transfer.canonical_json({"number": Decimal("NaN")})

    def test_injected_post_insert_mismatch_rolls_back_to_zero(self):
        injected = (
            "update public.profiles set nickname = 'injected mismatch' "
            f"where id = {transfer.sql_literal(FIXTURE_USERS[0])}::uuid;"
        )
        with self.assertRaisesRegex(transfer.TransferError, "LOCAL_IMPORT_FAILED"):
            self.adapter.import_snapshot(
                LOCAL_REF, transfer.build_import_sql(self.snapshot, self.metadata, injected)
            )
        counts = self.adapter.query_value(LOCAL_REF, transfer.build_count_sql())
        self.assertEqual(set(counts.values()), {0})

    def test_successful_import_role_identity_and_collision_rejects_unchanged(self):
        self.adapter.import_snapshot(
            LOCAL_REF, transfer.build_import_sql(self.snapshot, self.metadata)
        )
        imported = transfer.validate_source_snapshot(
            self.adapter.query_value(LOCAL_REF, transfer.build_snapshot_sql(self.metadata)),
            self.metadata,
        )
        transfer.require_same_snapshot(self.snapshot, imported, "TEST_IMPORT_MISMATCH")
        before = transfer.digest(imported)

        role_identity = self.adapter.query_value(
            LOCAL_REF,
            """
select jsonb_build_object(
  'users', (select count(*) from auth.users),
  'identities', (select count(*) from auth.identities where provider = 'kakao'),
  'identity_users', (select count(distinct user_id) from auth.identities),
  'active_admins', (select count(*) from public.memberships where role = 'admin' and revoked_at is null),
  'active_riders', (select count(*) from public.memberships where role = 'rider' and revoked_at is null)
) as result
""".strip(),
        )
        self.assertEqual(
            role_identity,
            {"users": 2, "identities": 2, "identity_users": 2, "active_admins": 1, "active_riders": 1},
        )

        with self.assertRaisesRegex(transfer.TransferError, "TARGET_NOT_EMPTY"):
            transfer.require_target_empty(
                self.adapter.query_value(LOCAL_REF, transfer.build_count_sql())
            )
        unchanged = transfer.validate_source_snapshot(
            self.adapter.query_value(LOCAL_REF, transfer.build_snapshot_sql(self.metadata)),
            self.metadata,
        )
        self.assertEqual(transfer.digest(unchanged), before)

    def test_large_import_uses_stdin_and_preserves_exact_payload(self):
        large = copy.deepcopy(self.snapshot)
        large["tables"]["auth.users"]["rows"][0]["raw_user_meta_data"]["blob"] = (
            "x" * 3_300_000
        )
        sql = transfer.build_import_sql(large, self.metadata)
        self.assertGreater(len(sql.encode("utf-8")), 3_250_000)
        self.adapter.import_snapshot(LOCAL_REF, sql)
        imported = transfer.validate_source_snapshot(
            self.adapter.query_value(LOCAL_REF, transfer.build_snapshot_sql(self.metadata)),
            self.metadata,
        )
        transfer.require_same_snapshot(large, imported, "TEST_LARGE_IMPORT_MISMATCH")
        self.assertEqual(
            len(imported["tables"]["auth.users"]["rows"][0]["raw_user_meta_data"]["blob"]),
            3_300_000,
        )

    def test_source_drift_uses_only_sanitized_code(self):
        changed = copy.deepcopy(self.snapshot)
        changed["tables"]["public.profiles"]["rows"][0]["nickname"] = "drifted"
        with self.assertRaisesRegex(transfer.TransferError, "SOURCE_DRIFT_BEFORE_IMPORT"):
            transfer.require_same_snapshot(
                self.snapshot, changed, "SOURCE_DRIFT_BEFORE_IMPORT"
            )

    def test_apply_repeats_source_snapshot_and_never_imports_after_drift(self):
        changed = copy.deepcopy(self.snapshot)
        changed["tables"]["public.profiles"]["rows"][0]["nickname"] = "drifted"

        class DriftAdapter:
            def __init__(inner_self):
                inner_self.source_reads = 0
                inner_self.import_attempted = False

            def auth_config(inner_self, project_ref):
                return {
                    "external_kakao_enabled": True,
                    "external_kakao_email_optional": True,
                    "external_kakao_client_id": "same-client",
                }

            def import_snapshot(inner_self, project_ref, sql):
                inner_self.import_attempted = True
                raise AssertionError("import must not run after source drift")

            def query_value(inner_self, project_ref, sql):
                if sql == transfer.build_metadata_sql():
                    return self.metadata
                if sql == transfer.build_count_sql():
                    return {table: 0 for table in transfer.TABLES}
                if project_ref == transfer.SOURCE_REF:
                    inner_self.source_reads += 1
                    return self.snapshot if inner_self.source_reads == 1 else changed
                raise AssertionError("unexpected query")

        adapter = DriftAdapter()
        with self.assertRaisesRegex(transfer.TransferError, "SOURCE_DRIFT_BEFORE_IMPORT"):
            transfer.run_operator(
                adapter,
                SCRIPT.resolve().parents[1] / "supabase" / "migrations",
                apply=True,
            )
        self.assertEqual(adapter.source_reads, 2)
        self.assertFalse(adapter.import_attempted)

    def test_post_import_failures_report_uncertain_preserved_state_without_retry(self):
        class PostImportFailureAdapter:
            def __init__(inner_self, failure):
                inner_self.failure = failure
                inner_self.write_attempts = 0
                inner_self.target_snapshot_reads = 0

            def auth_config(inner_self, project_ref):
                return {
                    "external_kakao_enabled": True,
                    "external_kakao_email_optional": True,
                    "external_kakao_client_id": "same-client",
                }

            def import_snapshot(inner_self, project_ref, sql):
                inner_self.write_attempts += 1
                if inner_self.failure == "transport":
                    raise transfer.TransferError("MANAGEMENT_TRANSPORT_ERROR")

            def query_value(inner_self, project_ref, sql):
                if sql == transfer.build_metadata_sql():
                    return self.metadata
                if sql == transfer.build_count_sql():
                    return {table: 0 for table in transfer.TABLES}
                if project_ref == transfer.TARGET_REF:
                    inner_self.target_snapshot_reads += 1
                    if inner_self.failure == "response":
                        raise transfer.TransferError("DATABASE_QUERY_SHAPE_INVALID")
                    changed = copy.deepcopy(self.snapshot)
                    changed["tables"]["public.profiles"]["rows"][0]["nickname"] = "post-write mismatch"
                    return changed
                if project_ref == transfer.SOURCE_REF:
                    return self.snapshot
                raise AssertionError("unexpected query")

        expected = {
            "transport": "POST_IMPORT_STATE_UNCERTAIN_DATA_PRESERVED_MANAGEMENT_TRANSPORT_ERROR",
            "response": "POST_IMPORT_STATE_UNCERTAIN_DATA_PRESERVED_DATABASE_QUERY_SHAPE_INVALID",
            "validation": "POST_IMPORT_STATE_UNCERTAIN_DATA_PRESERVED_TARGET_MISMATCH",
        }
        for failure, code in expected.items():
            with self.subTest(failure=failure):
                adapter = PostImportFailureAdapter(failure)
                with self.assertRaises(transfer.TransferError) as captured:
                    transfer.run_operator(
                        adapter,
                        SCRIPT.resolve().parents[1] / "supabase" / "migrations",
                        apply=True,
                    )
                self.assertEqual(captured.exception.code, code)
                self.assertEqual(adapter.write_attempts, 1)

    def test_management_http_error_never_exposes_body_or_token(self):
        api = transfer.ManagementApi("top-secret-token")
        error = urllib.error.HTTPError(
            "https://api.supabase.com/test",
            500,
            "server error containing private rows",
            {},
            io.BytesIO(b'{"message":"private UUID and SQL payload"}'),
        )
        with mock.patch("urllib.request.urlopen", side_effect=error):
            with self.assertRaises(transfer.TransferError) as captured:
                api._request("GET", "/test")
        self.assertEqual(captured.exception.code, "MANAGEMENT_HTTP_500")
        rendered = str(captured.exception)
        self.assertNotIn("top-secret-token", rendered)
        self.assertNotIn("private", rendered)
        self.assertNotIn("SQL", rendered)

    def test_management_snapshot_text_preserves_long_decimal(self):
        api = transfer.ManagementApi("synthetic-token")
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = (
            b'[{"snapshot":"{\\"number\\":12345678901234567.8901234567890123456789}"}]'
        )
        with mock.patch("urllib.request.urlopen", return_value=response):
            snapshot = api.query_value(transfer.SOURCE_REF, "select synthetic snapshot")
        self.assertEqual(
            snapshot,
            {"number": Decimal("12345678901234567.8901234567890123456789")},
        )
        self.assertIsInstance(snapshot["number"], Decimal)

    def test_target_transport_binds_pooler_tls_environment_and_stdin(self):
        requests = []
        calls = []

        def management_request(method, path, payload):
            requests.append((method, path, payload))
            if path.endswith("/config/database/pooler"):
                return [
                    {
                        "database_type": "PRIMARY",
                        "pool_mode": "transaction",
                        "db_host": "aws-0-ap-northeast-2.pooler.supabase.com",
                        "db_port": 6543,
                        "db_name": "postgres",
                        "db_user": f"postgres.{transfer.TARGET_REF}",
                    }
                ]
            return {"role": "cli_login_role", "password": "private-password", "ttl_seconds": 300}

        def runner(arguments, **kwargs):
            calls.append((arguments, kwargs))
            return SimpleNamespace(returncode=0, stdout="private output", stderr="private error")

        sql = "begin;\nselect 'payload';\ncommit"
        transport.execute_target_import(
            management_request,
            transfer.TARGET_REF,
            sql,
            runner=runner,
            inherited_environment={"PATH": "/usr/bin", "PGOPTIONS": "unsafe", "PGHOST": "wrong"},
        )
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[1][2], {"read_only": False})
        self.assertEqual(len(calls), 1)
        arguments, kwargs = calls[0]
        self.assertEqual(arguments, list(transport.PSQL_ARGUMENTS))
        self.assertNotIn("-c", arguments)
        self.assertNotIn("-f", arguments)
        self.assertNotIn(sql, arguments)
        self.assertEqual(
            kwargs["input"], "begin;\nset local role postgres;\nselect 'payload';\ncommit"
        )
        environment = kwargs["env"]
        self.assertEqual(environment["PATH"], "/usr/bin")
        self.assertNotIn("PGOPTIONS", environment)
        self.assertEqual(environment["PGHOST"], "aws-0-ap-northeast-2.pooler.supabase.com")
        self.assertEqual(environment["PGPORT"], "6543")
        self.assertEqual(environment["PGDATABASE"], "postgres")
        self.assertEqual(environment["PGUSER"], f"cli_login_role.{transfer.TARGET_REF}")
        self.assertEqual(environment["PGPASSWORD"], "private-password")
        self.assertEqual(environment["PGSSLMODE"], "verify-full")
        self.assertEqual(environment["PGSSLROOTCERT"], str(transport.CERTIFICATE_PATH))
        self.assertEqual(environment["PGCONNECT_TIMEOUT"], "15")
        self.assertEqual(environment["PGCLIENTENCODING"], "UTF8")
        self.assertTrue(kwargs["capture_output"])
        self.assertEqual(kwargs["timeout"], 90)

    def test_target_transport_rejects_invalid_contract_before_psql(self):
        valid_pooler = {
            "database_type": "PRIMARY",
            "pool_mode": "transaction",
            "db_host": "aws-0-ap-northeast-2.pooler.supabase.com",
            "db_port": 6543,
            "db_name": "postgres",
            "db_user": f"postgres.{transfer.TARGET_REF}",
        }

        cases = (
            ([valid_pooler | {"db_host": "good.pooler.supabase.com/evil"}], {"role": "cli", "password": "p", "ttl_seconds": 300}),
            ([valid_pooler, valid_pooler.copy()], {"role": "cli", "password": "p", "ttl_seconds": 300}),
            ([valid_pooler | {"db_user": "postgres.wrong"}], {"role": "cli", "password": "p", "ttl_seconds": 300}),
            ([valid_pooler], {"role": "cli", "password": "p", "ttl_seconds": 299}),
        )
        for poolers, login in cases:
            with self.subTest(poolers=poolers, login=login):
                calls = []

                def request(method, path, payload):
                    return poolers if path.endswith("/pooler") else login

                with self.assertRaises(transport.ImportTransportError):
                    transport.execute_target_import(
                        request,
                        transfer.TARGET_REF,
                        "begin;\ncommit",
                        runner=lambda *args, **kwargs: calls.append((args, kwargs)),
                    )
                self.assertEqual(calls, [])

        management_calls = []
        with self.assertRaisesRegex(transport.ImportTransportError, "TARGET_IMPORT_SQL_INVALID"):
            transport.execute_target_import(
                lambda *args: management_calls.append(args),
                transfer.TARGET_REF,
                "select 1",
            )
        self.assertEqual(management_calls, [])
        with self.assertRaisesRegex(transport.ImportTransportError, "TARGET_POOLER_CONFIG_INVALID"):
            transport.execute_target_import(
                lambda *args: management_calls.append(args),
                "wrong-project-ref",
                "begin;\ncommit",
            )
        self.assertEqual(management_calls, [])

    def test_target_transport_psql_failures_are_sanitized_and_not_retried(self):
        def management_request(method, path, payload):
            if path.endswith("/config/database/pooler"):
                return [
                    {
                        "database_type": "PRIMARY",
                        "pool_mode": "transaction",
                        "db_host": "aws-0-ap-northeast-2.pooler.supabase.com",
                        "db_port": 6543,
                        "db_name": "postgres",
                        "db_user": f"postgres.{transfer.TARGET_REF}",
                    }
                ]
            return {"role": "cli_login_role", "password": "secret", "ttl_seconds": 300}

        for failure, code in (
            (SimpleNamespace(returncode=1, stdout="rows", stderr="password SQL UUID"), "TARGET_IMPORT_PSQL_FAILED"),
            (subprocess.TimeoutExpired(["psql"], 90, output="rows", stderr="password SQL UUID"), "TARGET_IMPORT_PSQL_TIMEOUT"),
        ):
            with self.subTest(code=code):
                attempts = []

                def runner(*args, **kwargs):
                    attempts.append(1)
                    if isinstance(failure, BaseException):
                        raise failure
                    return failure

                with self.assertRaises(transport.ImportTransportError) as captured:
                    transport.execute_target_import(
                        management_request,
                        transfer.TARGET_REF,
                        "begin;\ncommit",
                        runner=runner,
                    )
                self.assertEqual(captured.exception.code, code)
                self.assertEqual(str(captured.exception), code)
                self.assertEqual(attempts, [1])
                self.assertNotIn("password", str(captured.exception))
                self.assertNotIn("UUID", str(captured.exception))

    def test_auth_config_gate_requires_same_nonempty_kakao_client(self):
        valid = {
            "external_kakao_enabled": True,
            "external_kakao_email_optional": True,
            "external_kakao_client_id": "same-client",
        }
        transfer.verify_auth_configs(valid, valid.copy())
        mismatch = valid | {"external_kakao_client_id": "different-client"}
        with self.assertRaisesRegex(transfer.TransferError, "KAKAO_CLIENT_ID_MISMATCH"):
            transfer.verify_auth_configs(valid, mismatch)


if __name__ == "__main__":
    unittest.main(verbosity=2)
