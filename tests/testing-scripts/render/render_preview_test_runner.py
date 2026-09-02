"""Focused HTTP checks for the deterministic ``POST /render`` PNG preview.

Contract under test:
- identical request twice: HTTP 200, ``image/png``, PNG signature, IHDR
  1024 x 768, byte-identical bodies;
- ``rotationZ=90`` on the same model: a different PNG;
- ``orientationMode=sideways``: HTTP 400 ``INVALID_ORIENTATION_MODE``;
- wrong credential: HTTP 401 with the exact slice-service auth body;
- unsupported upload extension: HTTP 400 ``UNSUPPORTED_FILE_FORMAT``.

The preview shares the slice rate limiter, so requests are paced and 429
responses are retried within a bounded window.
"""

from __future__ import annotations

import json
import struct
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_ROOT.parent))
PROJECT_ROOT = SCRIPT_ROOT.parent.parent.parent
RESULTS_DIR = SCRIPT_ROOT.parent / "results"
REPORT_PATH = RESULTS_DIR / "render_preview_test_result.md"

from common.env_utils import resolve_base_url, resolve_slice_service_api_key
from common.http_utils import curl_multipart_download
from common.runner_support import (
    SLICE_SERVICE_AUTH_REQUIRED_BODY,
    report_target_class,
    retry_wait_seconds,
)
from common.synthetic_fixtures import sha256_of_bytes, write_cuboid_stl

RENDER_ENDPOINT = "/render"
EXPECTED_WIDTH = 1024
EXPECTED_HEIGHT = 768
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# Paced to the shared 3 requests/min sustained slice limiter; 429s are retried.
SLEEP_SECONDS = 20
MAX_ATTEMPTS = 3
PREVIEW_MODEL_MM = (40.0, 60.0, 25.0)
# Deliberately not a credential: a fixed, well-formed but unconfigured value.
UNAUTHORIZED_PROBE_VALUE = "runner-unauthorized-probe-" + "0" * 40


@dataclass(frozen=True)
class RenderCase:
    name: str
    fields: dict[str, str]
    fixture_name: str = "preview_cuboid.stl"
    use_valid_key: bool = True
    expected_status: int = 200
    expected_error_code: str | None = None


@dataclass
class RenderResult:
    index: int
    case: RenderCase
    http_status: int
    content_type: str
    success: bool
    observation: str
    body_sha256: str | None
    body_bytes: int
    duration_sec: float


@dataclass(frozen=True)
class ComparisonCheck:
    name: str
    success: bool
    observation: str


def base_fields(**overrides: str) -> dict[str, str]:
    fields = {
        "layerHeight": "0.2",
        "material": "PLA",
        "sizeUnit": "mm",
        "keepProportions": "true",
        "scalePercent": "100",
        "rotationX": "0",
        "rotationY": "0",
        "rotationZ": "0",
        "orientationMode": "preserve",
    }
    fields.update(overrides)
    return fields


def build_cases() -> tuple[RenderCase, ...]:
    return (
        RenderCase("baseline preview A", base_fields()),
        RenderCase("baseline preview B (identical request)", base_fields()),
        RenderCase("rotated preview (rotationZ=90)", base_fields(rotationZ="90")),
        RenderCase(
            "invalid orientationMode", base_fields(orientationMode="sideways"),
            expected_status=400, expected_error_code="INVALID_ORIENTATION_MODE",
        ),
        RenderCase(
            "wrong slice-service credential", base_fields(), use_valid_key=False,
            expected_status=401, expected_error_code="SLICE_SERVICE_AUTH_REQUIRED",
        ),
        RenderCase(
            "unsupported upload extension", base_fields(), fixture_name="unsupported_artwork.png",
            expected_status=400, expected_error_code="UNSUPPORTED_FILE_FORMAT",
        ),
    )


def parse_png_dimensions(payload: bytes) -> tuple[int, int] | None:
    """Return (width, height) from the IHDR chunk of a PNG, or None."""
    if len(payload) < 33 or not payload.startswith(PNG_SIGNATURE):
        return None
    length, chunk_type = struct.unpack(">I4s", payload[8:16])
    if chunk_type != b"IHDR" or length != 13:
        return None
    width, height = struct.unpack(">II", payload[16:24])
    return width, height


def decode_json_body(payload: bytes) -> dict | None:
    try:
        decoded = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    return decoded if isinstance(decoded, dict) else None


def evaluate_case(case: RenderCase, status: int, content_type: str, body: bytes) -> tuple[bool, str]:
    if case.expected_status != 200:
        decoded = decode_json_body(body)
        if status != case.expected_status:
            return False, f"expected HTTP {case.expected_status}, got {status}"
        if decoded is None or decoded.get("success") is not False:
            return False, "rejection body is not the typed success:false envelope"
        if case.expected_error_code == "SLICE_SERVICE_AUTH_REQUIRED" and decoded != SLICE_SERVICE_AUTH_REQUIRED_BODY:
            return False, "401 body differs from the exact slice-service auth envelope"
        if decoded.get("errorCode") != case.expected_error_code:
            return False, f"unexpected errorCode {decoded.get('errorCode')}"
        return True, f"rejected with {case.expected_error_code}"
    if status != 200:
        decoded = decode_json_body(body)
        return False, f"expected HTTP 200, got {status} ({(decoded or {}).get('errorCode')})"
    if not content_type.lower().startswith("image/png"):
        return False, f"content-type is not image/png ({content_type or 'missing'})"
    dimensions = parse_png_dimensions(body)
    if dimensions is None:
        return False, "body is not a PNG with an IHDR chunk"
    if dimensions != (EXPECTED_WIDTH, EXPECTED_HEIGHT):
        return False, f"IHDR is {dimensions[0]}x{dimensions[1]}, expected {EXPECTED_WIDTH}x{EXPECTED_HEIGHT}"
    return True, f"PNG {EXPECTED_WIDTH}x{EXPECTED_HEIGHT}, {len(body)} bytes"


def run_case(index: int, case: RenderCase, base_url: str, api_key: str, directory: Path) -> RenderResult:
    fixture = directory / case.fixture_name
    if not fixture.exists():
        fixture.write_bytes(b"not-a-supported-model")
    credential = api_key if case.use_valid_key else UNAUTHORIZED_PROBE_VALUE
    status, headers, body, total_duration = 0, {}, b"", 0.0
    for attempt in range(1, MAX_ATTEMPTS + 1):
        status, headers, body, duration = curl_multipart_download(
            base_url=base_url, endpoint=RENDER_ENDPOINT, file_path=fixture,
            fields=case.fields, slice_service_api_key=credential,
        )
        total_duration += duration
        if status != 429 or attempt == MAX_ATTEMPTS:
            break
        time.sleep(retry_wait_seconds(decode_json_body(body)))
    content_type = headers.get("content-type", "")
    success, observation = evaluate_case(case, status, content_type, body)
    return RenderResult(
        index=index, case=case, http_status=status, content_type=content_type, success=success,
        observation=observation, body_sha256=sha256_of_bytes(body) if body else None,
        body_bytes=len(body), duration_sec=round(total_duration, 3),
    )


def evaluate_comparisons(results: list[RenderResult]) -> list[ComparisonCheck]:
    by_name = {result.case.name: result for result in results}
    first = by_name.get("baseline preview A")
    second = by_name.get("baseline preview B (identical request)")
    rotated = by_name.get("rotated preview (rotationZ=90)")
    checks: list[ComparisonCheck] = []
    identical = (
        first is not None and second is not None and first.success and second.success
        and first.body_sha256 is not None and first.body_sha256 == second.body_sha256
    )
    checks.append(ComparisonCheck(
        "identical requests produce byte-identical PNGs", identical,
        "baseline A and B share one SHA-256" if identical else "baseline PNGs differ or are unavailable",
    ))
    differs = (
        first is not None and rotated is not None and first.success and rotated.success
        and first.body_sha256 is not None and first.body_sha256 != rotated.body_sha256
    )
    checks.append(ComparisonCheck(
        "rotationZ=90 changes the preview", differs,
        "rotated PNG differs from the baseline" if differs else "rotated PNG is identical or unavailable",
    ))
    return checks


def write_report(base_url: str, results: list[RenderResult], checks: list[ComparisonCheck]) -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    passed = sum(1 for result in results if result.success) + sum(1 for check in checks if check.success)
    total = len(results) + len(checks)
    lines = [
        "# Render Preview Test Report", "",
        f"Generated at (UTC): **{datetime.now(timezone.utc).isoformat()}**",
        f"Target class: **{report_target_class(base_url)}**",
        f"Total checks: **{total}**", f"Passed: **{passed}**", f"Failed: **{total - passed}**", "",
        "The preview model is a generated 40 x 60 x 25 mm cuboid. No base URL, hostname, "
        "credential, or temporary path is retained.", "",
        "| # | Case | Status | Content-Type | Bytes | Body SHA-256 (prefix) | Result | Observation |",
        "|---:|:-----|------:|:-------------|------:|:---------------------|:------:|:------------|",
    ]
    for result in results:
        lines.append(
            f"| {result.index} | {result.case.name} | {result.http_status} | `{result.content_type or '-'}` | "
            f"{result.body_bytes} | `{(result.body_sha256 or '')[:16] or '-'}` | "
            f"{'PASS' if result.success else 'FAIL'} | {result.observation} |"
        )
    lines.extend(["", "## Determinism", "", "| Check | Result | Observation |", "|:------|:------:|:------------|"])
    for check in checks:
        lines.append(f"| {check.name} | {'PASS' if check.success else 'FAIL'} | {check.observation} |")
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    base_url = resolve_base_url(PROJECT_ROOT)
    api_key = resolve_slice_service_api_key(PROJECT_ROOT)
    print(f"[RENDER PREVIEW TEST] slice_service_api_key_found={bool(api_key)}")
    if not api_key:
        print("[RENDER PREVIEW TEST] ERROR: SLICE_SERVICE_API_KEY not found in .env or process environment.")
        return 1
    cases = build_cases()
    results: list[RenderResult] = []
    with tempfile.TemporaryDirectory(prefix="render-preview-") as temp_dir_name:
        directory = Path(temp_dir_name)
        write_cuboid_stl(directory, PREVIEW_MODEL_MM, "preview_cuboid.stl")
        for index, case in enumerate(cases, 1):
            print(f"[RENDER PREVIEW TEST] #{index} {case.name}")
            result = run_case(index, case, base_url, api_key, directory)
            results.append(result)
            print(f"[RENDER PREVIEW TEST]    status={result.http_status} success={result.success} :: {result.observation}")
            if index < len(cases):
                time.sleep(SLEEP_SECONDS)
    checks = evaluate_comparisons(results)
    write_report(base_url, results, checks)
    failed = sum(1 for result in results if not result.success) + sum(1 for check in checks if not check.success)
    print(f"[RENDER PREVIEW TEST] Completed. total={len(results) + len(checks)} failed={failed}")
    print(f"[RENDER PREVIEW TEST] Report: {REPORT_PATH}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
