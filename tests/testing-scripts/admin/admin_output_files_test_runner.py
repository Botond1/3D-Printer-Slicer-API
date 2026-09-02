"""Integration test for protected output file listing endpoint.

Validates:
- Unauthorized request is rejected
- Authorized request succeeds
- Response structure includes total + files array
- Every listed name carries a retained artifact suffix (.gcode, .sl1, or the
  Bambu Studio .gcode.3mf project) and an admin-protected download URL
- Download endpoint requires the artifact key (probed with both a .gcode and a
  .gcode.3mf name) and serves a listed file, preferring a .gcode.3mf sample

The report never retains artifact file names; only counts and suffixes.
"""

from __future__ import annotations

import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
import sys
from urllib.parse import quote

SCRIPT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_ROOT.parent))
PROJECT_ROOT = SCRIPT_ROOT.parent.parent.parent
RESULTS_DIR = SCRIPT_ROOT.parent / "results"
REPORT_PATH = RESULTS_DIR / "admin_output_files_test_result.md"
LEGACY_REPORT_FILES = (
    RESULTS_DIR / "admin_output_files_test_report.json",
    RESULTS_DIR / "admin_output_files_test_report.md",
)
from common.env_utils import read_dotenv, resolve_artifact_api_key_candidates, resolve_base_url
from common.http_utils import curl_json

OUTPUT_FILES_ENDPOINT = "/admin/output-files"
DOWNLOAD_ENDPOINT_TEMPLATE = "/admin/download/{file_name}"
ALL_DOWNLOAD_ENDPOINT = "/admin/download/ALL"
UNAUTHORIZED_ALLOWED = {401, 503}
# Retained artifact names: Prusa/Orca G-code, Prusa SL1, and the Bambu Studio
# `.gcode.3mf` project (a compound extension matched as a suffix, never via ext).
ALLOWED_OUTPUT_SUFFIXES = (".gcode", ".sl1", ".gcode.3mf")
BAMBU_ARTIFACT_SUFFIX = ".gcode.3mf"
UNAUTHORIZED_DOWNLOAD_PROBES = (
    "does-not-exist.gcode",
    "does-not-exist-output-artifact-0.gcode.3mf",
)
DEFAULT_MAX_ZIP_ENTRIES = 500
DEFAULT_MAX_ZIP_UNCOMPRESSED_BYTES = 500 * 1024 * 1024


def parse_positive_int(raw_value: str | None, default_value: int) -> int:
    try:
        value = int(str(raw_value))
    except (TypeError, ValueError):
        return default_value

    return value if value > 0 else default_value


def resolve_bulk_download_limits(project_root: Path) -> tuple[int, int]:
    dotenv = read_dotenv(project_root)
    max_entries = parse_positive_int(
        os.getenv("MAX_ZIP_ENTRIES") or dotenv.get("MAX_ZIP_ENTRIES"),
        DEFAULT_MAX_ZIP_ENTRIES,
    )
    max_bytes = parse_positive_int(
        os.getenv("MAX_ZIP_UNCOMPRESSED_BYTES") or dotenv.get("MAX_ZIP_UNCOMPRESSED_BYTES"),
        DEFAULT_MAX_ZIP_UNCOMPRESSED_BYTES,
    )
    return max_entries, max_bytes


def read_artifact_api_key_candidates() -> list[str]:
    candidates = resolve_artifact_api_key_candidates(PROJECT_ROOT)
    if not candidates:
        raise RuntimeError("ARTIFACT_API_KEY not found in .env or process environment.")
    return candidates


def write_report(*, base_url: str, success: bool, details: dict) -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    for legacy_path in LEGACY_REPORT_FILES:
        if legacy_path.exists():
            legacy_path.unlink()

    generated_at = datetime.now(timezone.utc).isoformat()

    lines = [
        "# Admin Output Files Test Report",
        "",
        f"Generated at (UTC): **{generated_at}**",
        f"Base URL: **{base_url}**",
        f"Success: **{success}**",
        "",
        "## Details",
        "",
        f"- Unauthorized status: `{details.get('unauthorized_status')}`",
        f"- Authorized status: `{details.get('authorized_status')}`",
        f"- Download unauthorized status: `{details.get('download_unauthorized_status')}`",
        f"- Download authorized status: `{details.get('download_authorized_status')}`",
        f"- ALL download unauthorized status: `{details.get('all_download_unauthorized_status')}`",
        f"- ALL download authorized status: `{details.get('all_download_authorized_status')}`",
        f"- Total files: `{details.get('total_files')}`",
        f"- Bambu `.gcode.3mf` files: `{details.get('bambu_artifact_files')}`",
        f"- Total size bytes: `{details.get('total_size_bytes')}`",
        f"- Bulk max entries: `{details.get('max_bulk_entries')}`",
        f"- Bulk max bytes: `{details.get('max_bulk_bytes')}`",
        f"- Download sample suffix: `{artifact_suffix_of(details.get('download_sample_endpoint'))}`",
    ]
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def build_report_details(
    *,
    unauthorized_status: int | None,
    authorized_status: int | None,
    download_unauthorized_status: int | None,
    download_authorized_status: int | None,
    all_download_unauthorized_status: int | None,
    all_download_authorized_status: int | None,
    total_files: int | None,
    download_sample_endpoint: str | None,
    total_size_bytes: int | None = None,
    max_bulk_entries: int | None = None,
    max_bulk_bytes: int | None = None,
    bambu_artifact_files: int | None = None,
) -> dict:
    return {
        "unauthorized_status": unauthorized_status,
        "authorized_status": authorized_status,
        "download_unauthorized_status": download_unauthorized_status,
        "download_authorized_status": download_authorized_status,
        "all_download_unauthorized_status": all_download_unauthorized_status,
        "all_download_authorized_status": all_download_authorized_status,
        "total_files": total_files,
        "download_sample_endpoint": download_sample_endpoint,
        "total_size_bytes": total_size_bytes,
        "max_bulk_entries": max_bulk_entries,
        "max_bulk_bytes": max_bulk_bytes,
        "bambu_artifact_files": bambu_artifact_files,
    }


def has_allowed_output_suffix(file_name: str) -> bool:
    lowered = file_name.lower()
    return any(lowered.endswith(suffix) for suffix in ALLOWED_OUTPUT_SUFFIXES)


def artifact_suffix_of(endpoint: str | None) -> str | None:
    """Reduce a download endpoint to its artifact suffix so no file name is reported."""
    if not isinstance(endpoint, str):
        return None
    lowered = endpoint.lower()
    for suffix in sorted(ALLOWED_OUTPUT_SUFFIXES, key=len, reverse=True):
        if lowered.endswith(suffix):
            return suffix
    return "unknown"


def run_unauthorized_check(base_url: str) -> tuple[bool, int, dict | str | None]:
    status, body = curl_json(method="GET", base_url=base_url, endpoint=OUTPUT_FILES_ENDPOINT)
    return status in UNAUTHORIZED_ALLOWED, status, body


def run_authorized_check(base_url: str, api_keys: list[str]) -> tuple[int, dict | str | None]:
    status, body = 0, None
    for api_key in api_keys:
        status, body = curl_json(method="GET", base_url=base_url, endpoint=OUTPUT_FILES_ENDPOINT, api_key=api_key)
        if status == 200:
            break
    return status, body


def curl_status_only(*, method: str, base_url: str, endpoint: str, api_key: str | None = None) -> tuple[int, str | None]:
    cmd = [
        "curl",
        "-sS",
        "-X",
        method,
        f"{base_url}{endpoint}",
        "-o",
        os.devnull,
        "-w",
        "%{http_code}",
    ]

    if api_key:
        cmd.extend(["-H", f"x-api-key: {api_key}"])

    completed = subprocess.run(cmd, capture_output=True, text=True)
    if completed.returncode != 0:
        return 0, (completed.stderr or "").strip() or "curl status check failed"

    try:
        return int(completed.stdout.strip() or "0"), None
    except ValueError:
        return 0, f"invalid HTTP status output: {completed.stdout!r}"


def run_download_unauthorized_check(base_url: str) -> tuple[bool, int, dict | str | None]:
    """Every probe name, including a `.gcode.3mf` one, must be refused without a key."""
    status, error = 0, None
    for probe in UNAUTHORIZED_DOWNLOAD_PROBES:
        endpoint = DOWNLOAD_ENDPOINT_TEMPLATE.format(file_name=probe)
        status, error = curl_status_only(method="GET", base_url=base_url, endpoint=endpoint)
        if error or status not in UNAUTHORIZED_ALLOWED:
            return False, status, ({"error": error} if error else None)
    return True, status, None


def run_all_download_unauthorized_check(base_url: str) -> tuple[bool, int, dict | str | None]:
    status, error = curl_status_only(method="GET", base_url=base_url, endpoint=ALL_DOWNLOAD_ENDPOINT)
    return status in UNAUTHORIZED_ALLOWED, status, ({"error": error} if error else None)


def run_download_authorized_check(
    base_url: str,
    api_keys: list[str],
    download_endpoint: str | None,
) -> tuple[bool, int | None, str | None]:
    if not download_endpoint:
        return True, None, None

    status, _body = 0, None
    for api_key in api_keys:
        status, error = curl_status_only(method="GET", base_url=base_url, endpoint=download_endpoint, api_key=api_key)
        if error:
            continue
        if status == 200:
            return True, status, None

    return False, status, f"expected 200 for authorized download endpoint, got {status}"


def run_all_download_authorized_check(
    base_url: str,
    api_keys: list[str],
    *,
    expected_total: int,
    expected_total_size_bytes: int,
    max_entries: int,
    max_bytes: int,
) -> tuple[bool, int | None, str | None]:
    expected_status = 404 if expected_total <= 0 else 200
    if expected_total > max_entries or expected_total_size_bytes > max_bytes:
        expected_status = 413

    status, _body = 0, None
    for api_key in api_keys:
        status, error = curl_status_only(method="GET", base_url=base_url, endpoint=ALL_DOWNLOAD_ENDPOINT, api_key=api_key)
        if error:
            continue
        if status == expected_status:
            return True, status, None

    return False, status, f"expected {expected_status} for authorized ALL download endpoint, got {status}"


def calculate_total_size_bytes(body: dict | str | None) -> int:
    if not isinstance(body, dict):
        return 0

    files = body.get("files")
    if not isinstance(files, list):
        return 0

    total_size = 0
    for item in files:
        if isinstance(item, dict) and isinstance(item.get("sizeBytes"), int):
            total_size += item["sizeBytes"]

    return total_size


def validate_authorized_payload(
    body: dict | str | None,
) -> tuple[bool, int | None, str | None, str | None, int]:
    """Validate every listed item; return (ok, total, error, sample endpoint, bambu count).

    Error messages carry positions, never file names, so console output and
    reports stay free of customer-derived artifact names.
    """
    if not isinstance(body, dict):
        return False, None, "expected 200 with JSON body", None, 0

    if body.get("success") is not True:
        return False, None, "success flag is not true", None, 0

    files = body.get("files")
    total = body.get("total")
    if not isinstance(files, list) or not isinstance(total, int):
        return False, None, "invalid schema", None, 0

    if total != len(files):
        return False, total, f"total mismatch. total={total} len(files)={len(files)}", None, 0

    required = {"fileName", "downloadUrl", "sizeBytes", "createdAt", "modifiedAt"}
    download_sample_endpoint = None
    sample_is_bambu = False
    bambu_count = 0
    for position, item in enumerate(files):
        if not isinstance(item, dict) or not required.issubset(item.keys()):
            return False, total, f"file item schema mismatch at index {position}", None, bambu_count

        file_name = item.get("fileName")
        download_url = item.get("downloadUrl")
        if not isinstance(file_name, str) or not isinstance(download_url, str):
            return False, total, f"file item type mismatch at index {position}", None, bambu_count
        if not has_allowed_output_suffix(file_name):
            return (
                False, total,
                f"file item at index {position} has no retained artifact suffix "
                f"({'/'.join(ALLOWED_OUTPUT_SUFFIXES)})",
                None, bambu_count,
            )

        expected_download_url = DOWNLOAD_ENDPOINT_TEMPLATE.format(file_name=quote(file_name))
        if download_url != expected_download_url:
            return False, total, f"downloadUrl mismatch at index {position}", None, bambu_count

        is_bambu = file_name.lower().endswith(BAMBU_ARTIFACT_SUFFIX)
        bambu_count += int(is_bambu)
        if download_sample_endpoint is None or (is_bambu and not sample_is_bambu):
            download_sample_endpoint = download_url
            sample_is_bambu = is_bambu

    return True, total, None, download_sample_endpoint, bambu_count


def main() -> int:
    base_url = resolve_base_url(PROJECT_ROOT)
    max_bulk_entries, max_bulk_bytes = resolve_bulk_download_limits(PROJECT_ROOT)

    try:
        api_keys = read_artifact_api_key_candidates()
    except Exception as exc:
        print(f"[ADMIN OUTPUT TEST] ERROR: {exc}")
        return 1

    unauthorized_ok, unauthorized_status, unauthorized_body = run_unauthorized_check(base_url)
    if not unauthorized_ok:
        write_report(
            base_url=base_url,
            success=False,
            details=build_report_details(
                unauthorized_status=unauthorized_status,
                authorized_status=None,
                download_unauthorized_status=None,
                download_authorized_status=None,
                all_download_unauthorized_status=None,
                all_download_authorized_status=None,
                total_files=None,
                download_sample_endpoint=None,
            ),
        )
        print(f"[ADMIN OUTPUT TEST] FAIL: expected 401/503 without key, got {unauthorized_status}. body={unauthorized_body}")
        return 1

    download_unauthorized_ok, download_unauthorized_status, download_unauthorized_body = run_download_unauthorized_check(base_url)
    if not download_unauthorized_ok:
        write_report(
            base_url=base_url,
            success=False,
            details=build_report_details(
                unauthorized_status=unauthorized_status,
                authorized_status=None,
                download_unauthorized_status=download_unauthorized_status,
                download_authorized_status=None,
                all_download_unauthorized_status=None,
                all_download_authorized_status=None,
                total_files=None,
                download_sample_endpoint=None,
            ),
        )
        print(
            "[ADMIN OUTPUT TEST] FAIL: expected 401/503 without key on download endpoint, "
            f"got {download_unauthorized_status}. body={download_unauthorized_body}"
        )
        return 1

    all_download_unauthorized_ok, all_download_unauthorized_status, all_download_unauthorized_body = run_all_download_unauthorized_check(
        base_url
    )
    if not all_download_unauthorized_ok:
        write_report(
            base_url=base_url,
            success=False,
            details=build_report_details(
                unauthorized_status=unauthorized_status,
                authorized_status=None,
                download_unauthorized_status=download_unauthorized_status,
                download_authorized_status=None,
                all_download_unauthorized_status=all_download_unauthorized_status,
                all_download_authorized_status=None,
                total_files=None,
                download_sample_endpoint=None,
            ),
        )
        print(
            "[ADMIN OUTPUT TEST] FAIL: expected 401/503 without key on ALL download endpoint, "
            f"got {all_download_unauthorized_status}. body={all_download_unauthorized_body}"
        )
        return 1

    status, body = run_authorized_check(base_url, api_keys)

    if status != 200:
        write_report(
            base_url=base_url,
            success=False,
            details=build_report_details(
                unauthorized_status=unauthorized_status,
                authorized_status=status,
                download_unauthorized_status=download_unauthorized_status,
                download_authorized_status=None,
                all_download_unauthorized_status=all_download_unauthorized_status,
                all_download_authorized_status=None,
                total_files=None,
                download_sample_endpoint=None,
            ),
        )
        print(f"[ADMIN OUTPUT TEST] DEBUG tried_keys={len(api_keys)}")
        print(f"[ADMIN OUTPUT TEST] FAIL: expected 200 with JSON body, got {status}.")
        return 1

    payload_ok, total, payload_error, download_sample_endpoint, bambu_count = validate_authorized_payload(body)
    if not payload_ok:
        write_report(
            base_url=base_url,
            success=False,
            details=build_report_details(
                unauthorized_status=unauthorized_status,
                authorized_status=status,
                download_unauthorized_status=download_unauthorized_status,
                download_authorized_status=None,
                all_download_unauthorized_status=all_download_unauthorized_status,
                all_download_authorized_status=None,
                total_files=total,
                download_sample_endpoint=download_sample_endpoint,
                bambu_artifact_files=bambu_count,
            ),
        )
        print(f"[ADMIN OUTPUT TEST] FAIL: {payload_error}")
        return 1

    download_authorized_ok, download_authorized_status, download_error = run_download_authorized_check(
        base_url,
        api_keys,
        download_sample_endpoint,
    )
    if not download_authorized_ok:
        write_report(
            base_url=base_url,
            success=False,
            details=build_report_details(
                unauthorized_status=unauthorized_status,
                authorized_status=status,
                download_unauthorized_status=download_unauthorized_status,
                download_authorized_status=download_authorized_status,
                all_download_unauthorized_status=all_download_unauthorized_status,
                all_download_authorized_status=None,
                total_files=total,
                download_sample_endpoint=download_sample_endpoint,
                bambu_artifact_files=bambu_count,
            ),
        )
        print(f"[ADMIN OUTPUT TEST] FAIL: {download_error}")
        return 1

    total_size_bytes = calculate_total_size_bytes(body)
    all_download_authorized_ok, all_download_authorized_status, all_download_error = run_all_download_authorized_check(
        base_url,
        api_keys,
        expected_total=total or 0,
        expected_total_size_bytes=total_size_bytes,
        max_entries=max_bulk_entries,
        max_bytes=max_bulk_bytes,
    )
    if not all_download_authorized_ok:
        write_report(
            base_url=base_url,
            success=False,
            details=build_report_details(
                unauthorized_status=unauthorized_status,
                authorized_status=status,
                download_unauthorized_status=download_unauthorized_status,
                download_authorized_status=download_authorized_status,
                all_download_unauthorized_status=all_download_unauthorized_status,
                all_download_authorized_status=all_download_authorized_status,
                total_files=total,
                download_sample_endpoint=download_sample_endpoint,
                total_size_bytes=total_size_bytes,
                max_bulk_entries=max_bulk_entries,
                max_bulk_bytes=max_bulk_bytes,
                bambu_artifact_files=bambu_count,
            ),
        )
        print(f"[ADMIN OUTPUT TEST] FAIL: {all_download_error}")
        return 1

    write_report(
        base_url=base_url,
        success=True,
        details=build_report_details(
            unauthorized_status=unauthorized_status,
            authorized_status=200,
            download_unauthorized_status=download_unauthorized_status,
            download_authorized_status=download_authorized_status,
            all_download_unauthorized_status=all_download_unauthorized_status,
            all_download_authorized_status=all_download_authorized_status,
            total_files=total,
            download_sample_endpoint=download_sample_endpoint,
            total_size_bytes=total_size_bytes,
            max_bulk_entries=max_bulk_entries,
            max_bulk_bytes=max_bulk_bytes,
            bambu_artifact_files=bambu_count,
        ),
    )

    print(
        f"[ADMIN OUTPUT TEST] PASS: listed {total} output file(s), "
        f"{bambu_count} with the {BAMBU_ARTIFACT_SUFFIX} suffix."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
