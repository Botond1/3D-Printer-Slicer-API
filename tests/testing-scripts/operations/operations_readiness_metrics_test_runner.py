"""Focused integration checks for public and operations-scoped health surfaces."""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_ROOT.parent))
PROJECT_ROOT = SCRIPT_ROOT.parent.parent.parent
RESULTS_DIR = SCRIPT_ROOT.parent / "results"
REPORT_PATH = RESULTS_DIR / "operations_readiness_metrics_test_result.md"

from common.env_utils import resolve_base_url, resolve_operations_api_key_candidates
from common.http_utils import curl_json

OPERATIONS_PATHS = (
    "/health/detailed",
    "/operations/readiness",
    "/operations/metrics",
)
AUTH_ERROR_CODE = "OPERATIONS_AUTH_REQUIRED"


@dataclass(frozen=True)
class Check:
    name: str
    endpoint: str
    status: int
    success: bool
    detail: str


def request_with_candidates(
    base_url: str,
    endpoint: str,
    candidates: list[str],
) -> tuple[int, dict | str | None]:
    status: int = 0
    body: dict | str | None = None
    for key in candidates:
        status, body = curl_json(
            method="GET",
            base_url=base_url,
            endpoint=endpoint,
            api_key=key,
        )
        if status != 401:
            break
    return status, body


def safe_payload(body: dict | str | None, credentials: list[str]) -> bool:
    serialized = json.dumps(body, ensure_ascii=True)
    forbidden = credentials + [
        "OPERATIONS_API_KEY",
        "absolutePath",
        "fileName",
    ]
    return all(value not in serialized for value in forbidden)


def run_checks(base_url: str, credentials: list[str]) -> list[Check]:
    checks: list[Check] = []
    ready_status, ready_body = curl_json(
        method="GET",
        base_url=base_url,
        endpoint="/ready",
    )
    ready_ok = (
        ready_status in {200, 503}
        and isinstance(ready_body, dict)
        and set(ready_body) == {"status"}
        and ready_body["status"] in {"READY", "NOT_READY"}
    )
    checks.append(Check("public readiness is minimal", "/ready", ready_status, ready_ok,
                        "Expected only READY/NOT_READY status."))

    for endpoint in OPERATIONS_PATHS:
        status, body = curl_json(method="GET", base_url=base_url, endpoint=endpoint)
        unauthorized_ok = (
            status == 401
            and isinstance(body, dict)
            and body.get("errorCode") == AUTH_ERROR_CODE
        )
        checks.append(Check(
            "operations authentication required",
            endpoint,
            status,
            unauthorized_ok,
            f"Expected HTTP 401 {AUTH_ERROR_CODE}.",
        ))

    for endpoint in OPERATIONS_PATHS:
        status, body = request_with_candidates(base_url, endpoint, credentials)
        if endpoint == "/operations/metrics":
            shape_ok = (
                status == 200
                and isinstance(body, str)
                and "slicer_readiness " in body
                and len(body.encode("utf-8")) < 16 * 1024
            )
        elif endpoint == "/health/detailed":
            shape_ok = (
                status in {200, 503}
                and isinstance(body, dict)
                and body.get("status") in {"OK", "DEGRADED"}
                and isinstance(body.get("subsystems"), dict)
            )
        else:
            shape_ok = (
                status in {200, 503}
                and isinstance(body, dict)
                and isinstance(body.get("ready"), bool)
            )
        checks.append(Check(
            "operations credential accepted",
            endpoint,
            status,
            shape_ok and safe_payload(body, credentials),
            "Expected bounded, sanitized operations response.",
        ))
    return checks


def write_report(base_url: str, checks: list[Check]) -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    passed = sum(check.success for check in checks)
    lines = [
        "# Operations Readiness and Metrics Test Report",
        "",
        f"Generated at (UTC): **{datetime.now(timezone.utc).isoformat()}**",
        f"Base URL: **{base_url}**",
        f"Total checks: **{len(checks)}**",
        f"Passed: **{passed}**",
        f"Failed: **{len(checks) - passed}**",
        "",
        "| # | Check | Endpoint | Status | Result |",
        "|---:|:------|:---------|------:|:------:|",
    ]
    for index, check in enumerate(checks, 1):
        lines.append(
            f"| {index} | {check.name} | `{check.endpoint}` | "
            f"{check.status} | {'PASS' if check.success else 'FAIL'} |"
        )
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    base_url = resolve_base_url(PROJECT_ROOT)
    credentials = resolve_operations_api_key_candidates(PROJECT_ROOT)
    if not credentials:
        print("[OPERATIONS TEST] ERROR: OPERATIONS_API_KEY not found.")
        return 1
    checks = run_checks(base_url, credentials)
    write_report(base_url, checks)
    failures = [check for check in checks if not check.success]
    print(f"[OPERATIONS TEST] Completed. total={len(checks)} failed={len(failures)}")
    print(f"[OPERATIONS TEST] Report: {REPORT_PATH}")
    for check in failures:
        print(
            f"[OPERATIONS TEST] FAIL {check.endpoint} status={check.status}: "
            f"{check.detail}"
        )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
