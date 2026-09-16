#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("retire_history", SCRIPTS / "retire-history.py")
assert spec and spec.loader
retire = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = retire
spec.loader.exec_module(retire)


ACCOUNT = "10000000-0000-4000-8000-000000000001"


def fixture_tables() -> dict[str, list[dict[str, object]]]:
    return {
        "share_preview_grants": [{"id": "20000000-0000-4000-8000-000000000001", "owner_id": ACCOUNT, "trip_id": "30000000-0000-4000-8000-000000000001"}],
        "share_links": [{"id": "20000000-0000-4000-8000-000000000002", "owner_id": ACCOUNT}],
        "weather_snapshots": [{"id": "20000000-0000-4000-8000-000000000003", "trip_id": "30000000-0000-4000-8000-000000000001"}],
        "route_cache": [{"id": "20000000-0000-4000-8000-000000000004", "trip_id": "30000000-0000-4000-8000-000000000001"}],
        "trip_waypoints": [{"id": "20000000-0000-4000-8000-000000000005", "trip_id": "30000000-0000-4000-8000-000000000001"}],
        "trips": [{"id": "30000000-0000-4000-8000-000000000001", "user_id": ACCOUNT}],
        "collection_save_operations": [{"owner_id": ACCOUNT, "operation_id": "40000000-0000-4000-8000-000000000001"}],
        "collection_versions": [{"id": "50000000-0000-4000-8000-000000000001", "collection_id": "60000000-0000-4000-8000-000000000001", "created_by": ACCOUNT}],
        "riding_collections": [{"id": "60000000-0000-4000-8000-000000000001", "owner_id": ACCOUNT}],
        "route_plan_drafts": [{"owner_id": ACCOUNT, "planning_id": "70000000-0000-4000-8000-000000000001", "candidate_profile": "recommended"}],
        "route_plan_runs": [{"owner_id": ACCOUNT, "planning_id": "70000000-0000-4000-8000-000000000001"}],
    }


def write_backup(directory: Path, project_ref: str = "lehjmbgfpoemqcwxowbx", **changes):
    payload = {
        "schemaVersion": 1,
        "projectRef": project_ref,
        "capturedAt": "2026-09-17T00:00:00Z",
        "accountIds": [ACCOUNT],
        "tables": fixture_tables(),
    }
    payload.update(changes)
    path = directory / "backup.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.chmod(directory, 0o700)
    os.chmod(path, 0o600)
    return path, hashlib.sha256(path.read_bytes()).hexdigest(), payload


class BackupValidationTests(unittest.TestCase):
    def test_validates_private_external_backup_and_normalizes_rows(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path, digest, _ = write_backup(directory)
            with mock.patch.object(retire, "_private_path"):
                backup = retire.load_backup(path, digest, "lehjmbgfpoemqcwxowbx", Path.cwd())
            self.assertEqual(backup.account_ids, (ACCOUNT,))
            self.assertEqual(set(backup.tables), set(retire.TABLE_KEYS))
            self.assertEqual(sum(backup.counts.values()), 11)

    def test_rejects_hash_shape_scope_duplicate_and_permissions(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path, digest, payload = write_backup(directory)
            with mock.patch.object(retire, "_private_path"):
                with self.assertRaisesRegex(retire.RetirementError, "BACKUP_SHA256_MISMATCH"):
                    retire.load_backup(path, "0" * 64, "lehjmbgfpoemqcwxowbx")

            payload["tables"]["trips"][0]["user_id"] = "90000000-0000-4000-8000-000000000009"
            path.write_text(json.dumps(payload), encoding="utf-8")
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            with mock.patch.object(retire, "_private_path"):
                with self.assertRaisesRegex(retire.RetirementError, "BACKUP_OWNER_SCOPE_INVALID"):
                    retire.load_backup(path, digest, "lehjmbgfpoemqcwxowbx")

            payload["tables"] = fixture_tables()
            payload["tables"]["trips"].append(dict(payload["tables"]["trips"][0]))
            path.write_text(json.dumps(payload), encoding="utf-8")
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            with mock.patch.object(retire, "_private_path"):
                with self.assertRaisesRegex(retire.RetirementError, "BACKUP_ROW_KEY_DUPLICATE"):
                    retire.load_backup(path, digest, "lehjmbgfpoemqcwxowbx")

            os.chmod(path, 0o644)
            expected_privacy_error = "BACKUP_PRIVACY_UNVERIFIABLE" if os.name == "nt" else "BACKUP_NOT_OWNER_PRIVATE"
            with self.assertRaisesRegex(retire.RetirementError, expected_privacy_error):
                retire.load_backup(path, digest, "lehjmbgfpoemqcwxowbx")


class SqlContractTests(unittest.TestCase):
    def backup(self) -> retire.Backup:
        return retire.Backup("lehjmbgfpoemqcwxowbx", (ACCOUNT,), fixture_tables(), "a" * 64)

    def test_retirement_sql_locks_compares_deletes_exact_keys_and_protects_accounts(self):
        sql = retire.build_retirement_sql(self.backup())
        self.assertTrue(sql.startswith("begin isolation level serializable;"))
        self.assertIn("set local role postgres", sql)
        self.assertIn("share row exclusive mode", sql)
        self.assertIn("lock table public.profiles", sql)
        self.assertIn("RETIRE_CURRENT_STATE_MISMATCH", sql)
        self.assertIn("RETIRE_ROWCOUNT_MISMATCH", sql)
        self.assertIn("RETIRE_PROTECTED_STATE_CHANGED", sql)
        self.assertIn("where (id::text) in (values", sql)
        self.assertNotIn("truncate", sql.lower())
        self.assertNotRegex(sql.lower(), r"delete from [^;]+;\s*$")
        positions = [sql.index(f"delete from public.{table}") for table in retire.DELETE_ORDER]
        self.assertEqual(positions, sorted(positions))

    def test_readback_mismatch_blocks_before_transport(self):
        class Adapter:
            def query_value(self, project_ref, sql):
                return {"accountIds": [], "tables": {table: [] for table in retire.TABLE_KEYS}}

        with self.assertRaisesRegex(retire.RetirementError, "CURRENT_STATE_DIFFERS_FROM_BACKUP"):
            retire.verify_readback(Adapter(), self.backup())

    def test_changed_or_added_rows_and_protected_mutation_have_distinct_transaction_guards(self):
        sql = retire.build_retirement_sql(self.backup())
        self.assertIn("current_state is distinct from expected", sql)
        self.assertIn("not exists (select 1 from public.share_links)", sql)
        self.assertIn("protected_after is distinct from protected_before", sql)
        self.assertLess(sql.index("current_state is distinct from expected"), sql.index("delete from public.share_preview_grants"))

    def test_retirement_sql_chooses_a_safe_dollar_delimiter_for_backup_text(self):
        backup = self.backup()
        backup.tables["trips"][0]["title"] = "경로 $retire$ '인용' \\ 역슬래시"
        sql = retire.build_retirement_sql(backup)
        self.assertIn("set local standard_conforming_strings = on", sql)
        self.assertIn("do $retire_1$", sql)
        self.assertIn("$retire_1$;\ncommit;", sql)
        self.assertIn("경로 $retire$ ''인용'' \\\\ 역슬래시", sql)


class TransportTests(unittest.TestCase):
    def test_each_allowed_target_is_pinned_to_its_matching_primary_pooler(self):
        for project_ref in sorted(retire.ALLOWED_PROJECTS):
            calls = []

            def request(method, path, payload):
                calls.append((method, path, payload))
                if path.endswith("/pooler"):
                    return [{"database_type": "PRIMARY", "pool_mode": "transaction", "db_host": "aws-0-ap-northeast-2.pooler.supabase.com", "db_port": 6543, "db_name": "postgres", "db_user": f"postgres.{project_ref}"}]
                return {"role": "cli_login", "password": "secret", "ttl_seconds": 300}

            runner_calls = []
            backup = retire.Backup(project_ref, (ACCOUNT,), fixture_tables(), "a" * 64)
            with mock.patch("production_transfer_transport._validate_certificate"):
                retire.execute_retirement(request, backup, "begin;\ncommit;", runner=lambda *args, **kwargs: runner_calls.append((args, kwargs)) or SimpleNamespace(returncode=0))
            self.assertEqual(calls[-1][2], {"read_only": False})
            environment = runner_calls[0][1]["env"]
            self.assertEqual(environment["PGUSER"], f"cli_login.{project_ref}")
            self.assertEqual(environment["PGSSLMODE"], "verify-full")
            self.assertNotIn("PGOPTIONS", environment)
            self.assertEqual(runner_calls[0][1]["input"], "begin;\ncommit;")

    def test_psql_failure_is_single_attempt_and_sanitized(self):
        project_ref = "obodvbyzptxeehgpcpkd"
        attempts = []

        def request(method, path, payload):
            if path.endswith("/pooler"):
                return [{"database_type": "PRIMARY", "pool_mode": "transaction", "db_host": "aws-0-ap-northeast-1.pooler.supabase.com", "db_port": 6543, "db_name": "postgres", "db_user": f"postgres.{project_ref}"}]
            return {"role": "cli_login", "password": "secret", "ttl_seconds": 300}

        def runner(*args, **kwargs):
            attempts.append(1)
            return SimpleNamespace(returncode=1, stdout="private rows", stderr="password raw SQL")

        with mock.patch("production_transfer_transport._validate_certificate"):
            with self.assertRaisesRegex(retire.RetirementError, "^PSQL_FAILED$"):
                retire.execute_retirement(request, retire.Backup(project_ref, (ACCOUNT,), fixture_tables(), "a" * 64), "begin;\ncommit;", runner=runner)
        self.assertEqual(attempts, [1])


if __name__ == "__main__":
    unittest.main()
