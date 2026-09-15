#!/usr/bin/env python3
"""Anonymous, read-only responsiveness check for the temporary Free projects."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Mapping, TextIO


KEY_PATTERN = re.compile(r"^sb_publishable_[A-Za-z0-9_-]+$")
MAX_RESPONSE_BYTES = 1024
REQUEST_COUNT = 3
TIMEOUT_SECONDS = 15


@dataclass(frozen=True)
class Target:
    label: str
    project_ref: str
    enabled_variable: str
    key_variable: str


TARGETS = (
    Target(
        "preview",
        "lehjmbgfpoemqcwxowbx",
        "MOTOCAST_TEMP_KEEPALIVE_PREVIEW_ENABLED",
        "MOTOCAST_TEMP_KEEPALIVE_PREVIEW_PUBLISHABLE_KEY",
    ),
    Target(
        "production",
        "obodvbyzptxeehgpcpkd",
        "MOTOCAST_TEMP_KEEPALIVE_PRODUCTION_ENABLED",
        "MOTOCAST_TEMP_KEEPALIVE_PRODUCTION_PUBLISHABLE_KEY",
    ),
)


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


class CheckFailure(RuntimeError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _check_response(response) -> None:
    status = getattr(response, "status", None)
    if status != 200:
        code = status if isinstance(status, int) and 100 <= status <= 599 else "INVALID"
        raise CheckFailure(f"HTTP_{code}")
    payload = response.read(MAX_RESPONSE_BYTES + 1)
    if len(payload) > MAX_RESPONSE_BYTES:
        raise CheckFailure("RESPONSE_OVERSIZED")
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise CheckFailure("RESPONSE_MALFORMED") from None
    if value is not False:
        raise CheckFailure("RESPONSE_NOT_FALSE")


def _perform_reads(target: Target, key: str, opener) -> None:
    endpoint = f"https://{target.project_ref}.supabase.co/rest/v1/rpc/is_active_member"
    for _ in range(REQUEST_COUNT):
        request = urllib.request.Request(
            endpoint,
            data=b"{}",
            headers={"apikey": key, "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
                _check_response(response)
        except urllib.error.HTTPError as error:
            code = error.code if isinstance(error.code, int) and 100 <= error.code <= 599 else "INVALID"
            raise CheckFailure(f"HTTP_{code}") from None
        except CheckFailure:
            raise
        except Exception:
            raise CheckFailure("TRANSPORT") from None


def run(
    environment: Mapping[str, str],
    *,
    opener=None,
    output: TextIO = sys.stdout,
) -> int:
    client = opener or urllib.request.build_opener(NoRedirectHandler())
    failed = False
    for target in TARGETS:
        enabled = environment.get(target.enabled_variable)
        if enabled not in ("true", "false"):
            print(f"{target.label} ERROR FLAG_INVALID", file=output)
            failed = True
            continue
        if enabled == "false":
            print(f"{target.label} SKIP disabled", file=output)
            continue
        key = environment.get(target.key_variable, "")
        if not KEY_PATTERN.fullmatch(key):
            print(f"{target.label} ERROR KEY_INVALID", file=output)
            failed = True
            continue
        try:
            _perform_reads(target, key, client)
        except CheckFailure as error:
            print(f"{target.label} ERROR {error.code}", file=output)
            failed = True
            continue
        print(f"{target.label} PASS reads={REQUEST_COUNT}", file=output)
    return 1 if failed else 0


def main() -> int:
    try:
        return run(os.environ)
    except Exception:
        print("preview ERROR INTERNAL", file=sys.stdout)
        print("production ERROR INTERNAL", file=sys.stdout)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
