from __future__ import annotations

import io
import json
import threading
import unittest
import urllib.error
import urllib.request
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import check


PREVIEW_KEY = "sb_publishable_preview-Test_123"
PRODUCTION_KEY = "sb_publishable_production-Test_456"


@dataclass
class FakeResponse:
    payload: bytes
    status: int = 200

    def __enter__(self):
        return self

    def __exit__(self, exception_type, exception, traceback):
        return False

    def read(self, limit):
        return self.payload[:limit]


class FakeOpener:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def open(self, request, timeout):
        self.calls.append((request, timeout))
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


def enabled_environment():
    return {
        "MOTOCAST_TEMP_KEEPALIVE_PREVIEW_ENABLED": "true",
        "MOTOCAST_TEMP_KEEPALIVE_PRODUCTION_ENABLED": "true",
        "MOTOCAST_TEMP_KEEPALIVE_PREVIEW_PUBLISHABLE_KEY": PREVIEW_KEY,
        "MOTOCAST_TEMP_KEEPALIVE_PRODUCTION_PUBLISHABLE_KEY": PRODUCTION_KEY,
    }


class TemporaryKeepaliveTests(unittest.TestCase):
    def invoke(self, environment, outcomes):
        opener = FakeOpener(outcomes)
        output = io.StringIO()
        result = check.run(environment, opener=opener, output=output)
        return result, output.getvalue().splitlines(), opener.calls

    def test_exact_requests_and_three_reads_per_target(self):
        result, lines, calls = self.invoke(
            enabled_environment(), [FakeResponse(b"false") for _ in range(6)]
        )
        self.assertEqual(result, 0)
        self.assertEqual(lines, ["preview PASS reads=3", "production PASS reads=3"])
        self.assertEqual(len(calls), 6)
        expected_urls = (
            ["https://lehjmbgfpoemqcwxowbx.supabase.co/rest/v1/rpc/is_active_member"] * 3
            + ["https://obodvbyzptxeehgpcpkd.supabase.co/rest/v1/rpc/is_active_member"] * 3
        )
        for index, (request, timeout) in enumerate(calls):
            expected_key = PREVIEW_KEY if index < 3 else PRODUCTION_KEY
            self.assertEqual(request.full_url, expected_urls[index])
            self.assertEqual(request.method, "POST")
            self.assertEqual(request.data, b"{}")
            self.assertEqual(request.get_header("Apikey"), expected_key)
            self.assertEqual(request.get_header("Content-type"), "application/json")
            self.assertIsNone(request.get_header("Authorization"))
            self.assertEqual(timeout, 15)

    def test_target_failure_stops_that_target_and_checks_other_target(self):
        result, lines, calls = self.invoke(
            enabled_environment(),
            [FakeResponse(b"true"), FakeResponse(b"false"), FakeResponse(b"false"), FakeResponse(b"false")],
        )
        self.assertEqual(result, 1)
        self.assertEqual(lines, ["preview ERROR RESPONSE_NOT_FALSE", "production PASS reads=3"])
        self.assertEqual(len(calls), 4)
        self.assertIn("lehjmbgfpoemqcwxowbx", calls[0][0].full_url)
        self.assertTrue(all("obodvbyzptxeehgpcpkd" in call[0].full_url for call in calls[1:]))

    def test_disabled_targets_skip_without_keys_or_network(self):
        result, lines, calls = self.invoke(
            {
                "MOTOCAST_TEMP_KEEPALIVE_PREVIEW_ENABLED": "false",
                "MOTOCAST_TEMP_KEEPALIVE_PRODUCTION_ENABLED": "false",
            },
            [],
        )
        self.assertEqual(result, 0)
        self.assertEqual(lines, ["preview SKIP disabled", "production SKIP disabled"])
        self.assertEqual(calls, [])

    def test_missing_malformed_flags_and_bad_keys_are_config_errors(self):
        cases = (
            ({}, ["preview ERROR FLAG_INVALID", "production ERROR FLAG_INVALID"]),
            (
                {
                    "MOTOCAST_TEMP_KEEPALIVE_PREVIEW_ENABLED": "TRUE",
                    "MOTOCAST_TEMP_KEEPALIVE_PRODUCTION_ENABLED": "false",
                },
                ["preview ERROR FLAG_INVALID", "production SKIP disabled"],
            ),
            (
                enabled_environment()
                | {"MOTOCAST_TEMP_KEEPALIVE_PREVIEW_PUBLISHABLE_KEY": "sb_secret_private"},
                ["preview ERROR KEY_INVALID", "production PASS reads=3"],
            ),
            (
                {
                    key: value
                    for key, value in enabled_environment().items()
                    if key != "MOTOCAST_TEMP_KEEPALIVE_PREVIEW_PUBLISHABLE_KEY"
                },
                ["preview ERROR KEY_INVALID", "production PASS reads=3"],
            ),
            (
                enabled_environment()
                | {"MOTOCAST_TEMP_KEEPALIVE_PREVIEW_PUBLISHABLE_KEY": " sb_publishable_bad"},
                ["preview ERROR KEY_INVALID", "production PASS reads=3"],
            ),
        )
        for environment, expected_lines in cases:
            with self.subTest(expected_lines=expected_lines):
                expected_reads = 3 if "production PASS reads=3" in expected_lines else 0
                result, lines, calls = self.invoke(
                    environment, [FakeResponse(b"false") for _ in range(expected_reads)]
                )
                self.assertEqual(result, 1)
                self.assertEqual(lines, expected_lines)
                self.assertEqual(len(calls), expected_reads)

    def test_redirect_is_denied_and_reported_without_location(self):
        redirect = urllib.error.HTTPError(
            "https://private.invalid",
            302,
            "redirect with private body",
            {"Location": "https://private.invalid/secret"},
            None,
        )
        environment = enabled_environment() | {
            "MOTOCAST_TEMP_KEEPALIVE_PRODUCTION_ENABLED": "false"
        }
        result, lines, calls = self.invoke(environment, [redirect])
        self.assertEqual(result, 1)
        self.assertEqual(lines, ["preview ERROR HTTP_302", "production SKIP disabled"])
        self.assertEqual(len(calls), 1)

        received = {"redirector": 0, "destination": 0, "destination_key": None}

        class DestinationHandler(BaseHTTPRequestHandler):
            def do_POST(self):
                received["destination"] += 1
                received["destination_key"] = self.headers.get("apikey")
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"false")

            def log_message(self, format, *args):
                return

        destination = ThreadingHTTPServer(("127.0.0.1", 0), DestinationHandler)
        destination_url = f"http://127.0.0.1:{destination.server_port}/redirected"

        class RedirectHandler(BaseHTTPRequestHandler):
            def do_POST(self):
                received["redirector"] += 1
                self.send_response(302)
                self.send_header("Location", destination_url)
                self.end_headers()

            def log_message(self, format, *args):
                return

        redirector = ThreadingHTTPServer(("127.0.0.1", 0), RedirectHandler)
        threads = [
            threading.Thread(target=server.serve_forever, daemon=True)
            for server in (destination, redirector)
        ]
        for thread in threads:
            thread.start()
        try:
            opener = urllib.request.build_opener(check.NoRedirectHandler())
            request = urllib.request.Request(
                f"http://127.0.0.1:{redirector.server_port}/start",
                data=b"{}",
                headers={"apikey": PREVIEW_KEY},
                method="POST",
            )
            with self.assertRaises(urllib.error.HTTPError) as captured:
                opener.open(request, timeout=2)
            self.assertEqual(captured.exception.code, 302)
        finally:
            redirector.shutdown()
            destination.shutdown()
            redirector.server_close()
            destination.server_close()
            for thread in threads:
                thread.join(timeout=2)
        self.assertEqual(received["redirector"], 1)
        self.assertEqual(received["destination"], 0)
        self.assertIsNone(received["destination_key"])

    def test_response_and_transport_failures_are_bounded_and_redacted(self):
        secret_body = "private-user-row-" + PREVIEW_KEY
        cases = (
            (FakeResponse(b"{"), "RESPONSE_MALFORMED"),
            (FakeResponse(b"x" * 1025), "RESPONSE_OVERSIZED"),
            (FakeResponse(json.dumps(None).encode()), "RESPONSE_NOT_FALSE"),
            (FakeResponse(json.dumps(True).encode()), "RESPONSE_NOT_FALSE"),
            (FakeResponse(b"false", status=503), "HTTP_503"),
            (TimeoutError(secret_body), "TRANSPORT"),
            (RuntimeError(secret_body), "TRANSPORT"),
        )
        environment = enabled_environment() | {
            "MOTOCAST_TEMP_KEEPALIVE_PRODUCTION_ENABLED": "false"
        }
        for outcome, code in cases:
            with self.subTest(code=code, outcome_type=type(outcome).__name__):
                result, lines, calls = self.invoke(environment, [outcome])
                self.assertEqual(result, 1)
                self.assertEqual(lines, [f"preview ERROR {code}", "production SKIP disabled"])
                rendered = "\n".join(lines)
                self.assertNotIn(secret_body, rendered)
                self.assertNotIn(PREVIEW_KEY, rendered)
                self.assertNotIn("Traceback", rendered)
                self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
