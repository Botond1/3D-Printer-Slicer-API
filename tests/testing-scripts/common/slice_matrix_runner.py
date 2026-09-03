"""Shared slice matrix runner helpers for API integration tests.

This module centralizes request execution, response validation, and markdown
report rendering for per-engine/per-technology full-matrix test runners.

Fixture sources: when the gitignored private corpus under ``tests/testing-files``
contains supported models it is used; otherwise the deterministic synthetic
fixture set from ``common.synthetic_fixtures`` is generated into a temporary
directory and the report states that only synthetic fixtures ran.

Contract notes: FDM successes on every engine must publish a positive direct
mass and a catalogue-priced quote (Orca ABS/TPU included); SLA (Elegoo Saturn
4 Ultra quoting) successes must publish a positive resin mass, layer count,
the ``sla_layer_time_model`` print-time source, and a catalogue-priced quote
exactly like FDM; a scenario may declare ``negative_requests`` that are sent
once against the first fixture and must be rejected with their exact status
and error code (for example ``infill=140`` is ``400 INVALID_INFILL``, never
clamped).
"""

from __future__ import annotations

import re
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import cycle
from pathlib import Path
from typing import Iterable, Sequence

from common.env_utils import resolve_base_url, resolve_slice_service_api_key
from common.http_utils import curl_json, curl_multipart_slice
from common.synthetic_fixtures import write_standard_fixture_set

PRUSA_SLICE_ENDPOINT = "/prusa/slice"
ORCA_SLICE_ENDPOINT = "/orca/slice"
BAMBU_SLICE_ENDPOINT = "/bambu/slice"
SUPPORTED_EXTENSIONS = {
    ".zip", ".stl", ".obj", ".3mf", ".ply",
    ".stp", ".step", ".igs", ".iges",
}
ENGINE_NAME_BY_ENDPOINT = {
    PRUSA_SLICE_ENDPOINT: "Prusa",
    ORCA_SLICE_ENDPOINT: "Orca",
    BAMBU_SLICE_ENDPOINT: "Bambu",
}
ENGINE_KEY_BY_ENDPOINT = {
    PRUSA_SLICE_ENDPOINT: "prusa",
    ORCA_SLICE_ENDPOINT: "orca",
    BAMBU_SLICE_ENDPOINT: "bambu",
}
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
ENGINE_VERSION_PATTERN = re.compile(r"^[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9._-]+)?$")
FIXTURE_SOURCE_LEGACY = "legacy corpus (tests/testing-files)"
FIXTURE_SOURCE_SYNTHETIC = "synthetic fixtures only (tests/testing-files is empty)"


@dataclass(frozen=True)
class ExpectedFailure:
    """Expected non-2xx API response for a specific matrix case."""

    file: str
    status: int
    error_codes: tuple[str, ...]
    reason: str


@dataclass(frozen=True)
class SliceScenario:
    """Single scenario configuration for matrix execution.

    ``materials`` optionally cycles additional materials across the discovered
    files (the first entry starts the cycle); when empty, ``material`` is used
    for every request. ``printer_profile`` selects the Bambu registry printer.
    ``negative_requests`` are ``(label, extra_fields, expected_status,
    error_codes)`` tuples sent once against the first fixture; each must be
    rejected with that exact status and one of the accepted error codes.
    """

    key: str
    report_title: str
    endpoint: str
    technology: str
    material: str
    layer_heights: tuple[float, ...]
    report_filename: str
    legacy_report_files: tuple[str, ...] = ()
    expected_failures: tuple[ExpectedFailure, ...] = ()
    materials: tuple[str, ...] = ()
    printer_profile: str | None = None
    negative_requests: tuple[tuple[str, dict[str, str], int, tuple[str, ...]], ...] = ()


@dataclass
class TestCaseResult:
    """Outcome of one API request in the matrix."""

    index: int
    endpoint: str
    technology: str
    file: str
    category: str
    layer_height: float
    material: str
    http_status: int
    success: bool
    duration_sec: float
    expected_hint: str
    error_code: str | None
    error_message: str | None
    raw_body: dict | str | None
    expected_hourly_rate: float | None
    actual_hourly_rate: float | None
    hourly_rate_matches_pricing_json: bool | None


@dataclass
class ScenarioRunResult:
    """Summary information for one scenario run."""

    scenario: SliceScenario
    base_url: str
    report_path: Path
    generated_at: str
    total: int
    success_count: int
    failed_count: int
    fixture_source: str = FIXTURE_SOURCE_LEGACY


def resolve_engine_name(endpoint: str) -> str:
    """Resolve human-readable slicer engine name from endpoint path."""
    return ENGINE_NAME_BY_ENDPOINT.get(endpoint, "Prusa")


def resolve_engine_key(endpoint: str) -> str:
    """Resolve the machine-readable ``slicer_engine`` value for an endpoint."""
    return ENGINE_KEY_BY_ENDPOINT.get(endpoint, "prusa")


def _resolve_runtime_env(project_root: Path) -> tuple[str, str | None]:
    """Resolve base URL and the scoped slice service credential."""
    base_url = resolve_base_url(project_root)
    return base_url, resolve_slice_service_api_key(project_root)


def format_layer_height_token(layer_height: float) -> str:
    """Render layer height with compact trailing-zero trimming."""
    return f"{layer_height:.3f}".rstrip("0").rstrip(".")


def build_extra_fields(
    endpoint: str,
    technology: str,
    layer_height: float,
    printer_profile: str | None = None,
) -> dict[str, str]:
    """Build multipart extra fields expected by slice endpoints."""
    layer_token = format_layer_height_token(layer_height)
    fields: dict[str, str] = {
        "sizeUnit": "mm",
        "keepProportions": "true",
        "scalePercent": "100",
        "rotationX": "0",
        "rotationY": "0",
        "rotationZ": "0",
    }

    if endpoint == ORCA_SLICE_ENDPOINT:
        fields["printerProfile"] = "Bambu_P1S_0.4_nozzle.json"
        fields["processProfile"] = f"FDM_{layer_token}mm.json"
    elif endpoint == BAMBU_SLICE_ENDPOINT:
        fields["printerProfile"] = printer_profile or "P1S"
    else:
        fields["printerProfile"] = f"{technology}_{layer_token}mm.ini"

    return fields


def discover_test_files(root: Path) -> list[Path]:
    """Discover supported test input files under tests/testing-files."""
    files = []
    if not root.exists():
        return files
    for path in root.rglob("*"):
        if not path.is_file() or "results" in path.parts:
            continue
        if path.suffix.lower() in SUPPORTED_EXTENSIONS:
            files.append(path)
    return sorted(files)


def classify(path: Path) -> str:
    """Classify test input file by category folder."""
    parts = set(path.parts)
    for category in ("archive", "cad", "direct", "synthetic"):
        if category in parts:
            return category
    return "unknown"


def expected_hint_for_category(category: str) -> str:
    """Return category-level expectation hint used in reports."""
    if category in {"cad", "direct", "archive", "synthetic"}:
        return "expected_success"
    return "unknown"


def find_expected_failure(scenario: SliceScenario, relative_file: str) -> ExpectedFailure | None:
    """Resolve explicit expected failure for a scenario/file pair."""
    normalized_file = relative_file.replace("\\", "/").lower()
    for expected_failure in scenario.expected_failures:
        if expected_failure.file.replace("\\", "/").lower() == normalized_file:
            return expected_failure
    return None


def expected_hint_for_case(category: str, expected_failure: ExpectedFailure | None) -> str:
    """Return the concrete expectation label for a single matrix case."""
    if expected_failure:
        codes = "/".join(expected_failure.error_codes) if expected_failure.error_codes else "any_error"
        return f"expected_{expected_failure.status}_{codes}"
    return expected_hint_for_category(category)


def matches_expected_failure(
    *,
    status: int,
    error_code: str | None,
    expected_failure: ExpectedFailure | None,
) -> bool:
    """Check whether an API response matches an explicit expected failure."""
    if not expected_failure or status != expected_failure.status:
        return False
    if not expected_failure.error_codes:
        return True
    return error_code in expected_failure.error_codes


def run_slice_request(
    base_url: str,
    endpoint: str,
    file_path: Path,
    layer_height: float,
    material: str,
    slice_service_api_key: str,
    extra_fields: dict[str, str] | None = None,
) -> tuple[int, dict | str | None, float]:
    """Execute one multipart slicing request."""
    return curl_multipart_slice(
        base_url=base_url,
        endpoint=endpoint,
        file_path=file_path,
        layer_height=layer_height,
        material=material,
        slice_service_api_key=slice_service_api_key,
        extra_fields=extra_fields,
    )


def run_slice_request_with_retry(
    base_url: str,
    endpoint: str,
    file_path: Path,
    layer_height: float,
    material: str,
    slice_service_api_key: str,
    extra_fields: dict[str, str] | None = None,
    retry_on_429: int = 3,
    retry_wait_seconds: int = 20,
) -> tuple[int, dict | str | None, float]:
    """Execute slicing request with bounded retry for 429 responses."""
    total_duration = 0.0
    status = 0
    body: dict | str | None = None

    max_attempts = max(1, retry_on_429)
    for attempt in range(1, max_attempts + 1):
        status, body, duration = run_slice_request(
            base_url,
            endpoint,
            file_path,
            layer_height,
            material,
            slice_service_api_key,
            extra_fields,
        )
        total_duration += duration

        if status != 429:
            return status, body, total_duration

        if attempt < max_attempts:
            print(
                f"[RUNNER]    got 429, retrying in {retry_wait_seconds}s "
                f"(attempt {attempt + 1}/{max_attempts})"
            )
            time.sleep(retry_wait_seconds)

    return status, body, total_duration


def _normalize_material(material: str) -> str:
    return str(material or "").strip().lower()


def _resolve_expected_rate(pricing_map: dict | None, technology: str, material: str) -> float | None:
    """Resolve the exact configured hourly rate for one technology/material.

    Only an exact (case-insensitive) material match is authoritative; falling
    back to an unrelated material would silently validate the wrong price.
    """
    if not isinstance(pricing_map, dict):
        return None

    tech_map = pricing_map.get(technology)
    if not isinstance(tech_map, dict):
        return None

    target = _normalize_material(material)
    for key, value in tech_map.items():
        if _normalize_material(str(key)) == target:
            try:
                numeric = float(value)
            except (TypeError, ValueError):
                return None
            return numeric if numeric > 0 else None

    return None


def fetch_pricing_map(base_url: str) -> dict | None:
    """Read active pricing matrix from the API runtime."""
    status, body = curl_json(method="GET", base_url=base_url, endpoint="/pricing")
    if status != 200 or not isinstance(body, dict):
        print(f"[RUNNER] WARNING: Could not read live pricing via /pricing (status={status}).")
        return None
    return body


def _is_positive_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0


def _validate_engine_profiles(profiles: dict, endpoint: str) -> str | None:
    """Validate the per-engine ``profiles`` object and shared identity fields."""
    digest = profiles.get("effective_profile_sha256")
    if not isinstance(digest, str) or SHA256_PATTERN.fullmatch(digest) is None:
        return "profiles.effective_profile_sha256 must be lowercase 64-hex"

    if endpoint == ORCA_SLICE_ENDPOINT:
        if not profiles.get("machine_profile") or not profiles.get("process_profile"):
            return "Orca response must include machine_profile and process_profile"
    elif endpoint == BAMBU_SLICE_ENDPOINT:
        for field in ("printer", "machine_profile", "process_profile", "filament_profile", "bed_type"):
            if not isinstance(profiles.get(field), str) or not profiles[field]:
                return f"Bambu response must include non-empty profiles.{field}"
        if not _is_positive_number(profiles.get("filament_diameter_mm")) or not _is_positive_number(
            profiles.get("filament_density_g_cm3")
        ):
            return "Bambu response must include positive filament diameter and density"
    elif not profiles.get("prusa_profile"):
        return "Prusa response must include prusa_profile"
    return None


def _validate_stats_contract(body: dict, technology: str) -> str | None:
    """Validate positive/nullable stats per technology after the SLA pricing corrective."""
    stats = body.get("stats")
    if not isinstance(stats, dict):
        return "Missing stats object in success response"
    if not _is_positive_number(stats.get("print_time_seconds")):
        return "stats.print_time_seconds must be positive"
    if technology == "FDM":
        if not _is_positive_number(stats.get("material_used_m")):
            return "stats.material_used_m must be positive for FDM"
        if not _is_positive_number(stats.get("material_used_g")):
            return "stats.material_used_g must be positive for FDM"
        if not _is_positive_number(stats.get("estimated_price_huf")):
            return "stats.estimated_price_huf must be positive for FDM"
        if not _is_positive_number(body.get("hourly_rate")):
            return "hourly_rate must be positive for FDM"
        return None
    # SLA (Elegoo Saturn 4 Ultra quoting): a positive resin mass and layer
    # count, the deterministic layer-time model source, and automatic pricing
    # exactly like FDM. The SL1 raster output remains quote-only; only the
    # published estimate is priced.
    if not _is_positive_number(stats.get("material_used_ml")):
        return "stats.material_used_ml must be positive for SLA"
    if not _is_positive_number(stats.get("material_used_g")):
        return "stats.material_used_g must be positive for SLA"
    if not isinstance(stats.get("layer_count"), int) or stats.get("layer_count") <= 0:
        return "stats.layer_count must be a positive integer for SLA"
    if stats.get("print_time_source") != "sla_layer_time_model":
        return "stats.print_time_source must be sla_layer_time_model for SLA"
    if not _is_positive_number(stats.get("estimated_price_huf")):
        return "stats.estimated_price_huf must be positive for SLA"
    if not _is_positive_number(body.get("hourly_rate")):
        return "hourly_rate must be positive for SLA"
    profiles = body.get("profiles")
    if not isinstance(profiles, dict) or not profiles.get("sla_printer"):
        return "profiles.sla_printer must be present for SLA"
    if not _is_positive_number(profiles.get("resin_density_g_cm3")):
        return "profiles.resin_density_g_cm3 must be positive for SLA"
    return None


def _validate_new_field_payload(
    *,
    body: dict,
    endpoint: str,
    expected_fields: dict[str, str],
    technology: str,
) -> tuple[bool, str | None]:
    if body.get("slicer_engine") != resolve_engine_key(endpoint):
        return False, f"slicer_engine mismatch: expected {resolve_engine_key(endpoint)}"

    engine_version = body.get("engine_version")
    if not isinstance(engine_version, str) or ENGINE_VERSION_PATTERN.fullmatch(engine_version) is None:
        return False, "engine_version is missing or not a machine-readable version"

    model_transform = body.get("model_transform")
    if not isinstance(model_transform, dict):
        return False, "Missing model_transform in success response"
    if model_transform.get("transform_schema") != 2:
        return False, "model_transform.transform_schema must be 2"

    build_volume_limits = body.get("build_volume_limits_mm")
    if not isinstance(build_volume_limits, dict):
        return False, "Missing build_volume_limits_mm in success response"

    if not isinstance(build_volume_limits.get("min"), dict) or not isinstance(build_volume_limits.get("max"), dict):
        return False, "build_volume_limits_mm must include min/max objects"

    expected_unit = expected_fields.get("sizeUnit", "mm").lower()
    if str(model_transform.get("size_unit", "")).lower() != expected_unit:
        return False, (
            f"model_transform.size_unit mismatch: expected {expected_unit}, "
            f"got {model_transform.get('size_unit')}"
        )

    expected_keep = expected_fields.get("keepProportions", "true").strip().lower() == "true"
    if bool(model_transform.get("keep_proportions")) != expected_keep:
        return False, (
            f"model_transform.keep_proportions mismatch: expected {expected_keep}, "
            f"got {model_transform.get('keep_proportions')}"
        )

    profiles = body.get("profiles")
    if not isinstance(profiles, dict):
        return False, "Missing profiles object in success response"
    profile_error = _validate_engine_profiles(profiles, endpoint)
    if profile_error:
        return False, profile_error

    stats_error = _validate_stats_contract(body, technology)
    if stats_error:
        return False, stats_error

    return True, None


def evaluate_slice_response(
    *,
    body: dict | str | None,
    status: int,
    technology: str,
    material: str,
    pricing_map: dict | None,
    endpoint: str,
    expected_fields: dict[str, str],
) -> tuple[bool, str | None, str | None, float | None, float | None, bool | None]:
    """Evaluate response payload and derive normalized success fields."""
    if not isinstance(body, dict):
        success = 200 <= status < 300
        error_message = str(body) if body else None
        return success, None, error_message, None, None, None

    success = bool(body.get("success")) and (200 <= status < 300)
    error_code = body.get("errorCode")
    error_message = body.get("error")
    expected_hourly_rate = _resolve_expected_rate(pricing_map, technology, material)
    actual_rate_raw = body.get("hourly_rate")

    try:
        actual_hourly_rate = float(actual_rate_raw) if actual_rate_raw is not None else None
    except (TypeError, ValueError):
        actual_hourly_rate = None

    hourly_rate_matches = None
    if success and expected_hourly_rate is not None and actual_hourly_rate is not None:
        hourly_rate_matches = abs(expected_hourly_rate - actual_hourly_rate) < 1e-9
        if not hourly_rate_matches:
            success = False
            error_code = error_code or "PRICING_SOURCE_MISMATCH"
            error_message = (
                f"hourly_rate mismatch: expected {expected_hourly_rate} from /pricing, "
                f"got {actual_hourly_rate}"
            )
    elif success and technology in ("FDM", "SLA") and expected_hourly_rate is not None and actual_hourly_rate is None:
        # FDM without a positive mass and a profile-less Orca material are the
        # only remaining null-rate cases; SLA always has a positive resin mass
        # and prices automatically like FDM, so a null rate here is a defect.
        hourly_rate_matches = False
        success = False
        error_code = error_code or f"{technology}_PRICING_MISSING"
        error_message = (
            f"hourly_rate is null although /pricing publishes {expected_hourly_rate} for "
            f"{technology}/{material}"
        )

    if success:
        payload_valid, payload_error = _validate_new_field_payload(
            body=body,
            endpoint=endpoint,
            expected_fields=expected_fields,
            technology=technology,
        )
        if not payload_valid:
            success = False
            error_code = error_code or "NEW_FIELDS_VALIDATION_FAILED"
            error_message = payload_error

    return success, error_code, error_message, expected_hourly_rate, actual_hourly_rate, hourly_rate_matches


def markdown_summary(
    report_title: str,
    results: Iterable[TestCaseResult],
    generated_at: str,
    base_url: str,
    fixture_source: str = FIXTURE_SOURCE_LEGACY,
) -> str:
    """Render markdown report for one scenario."""
    rows = list(results)
    total = len(rows)
    ok = sum(1 for row in rows if row.success)
    bad = total - ok

    lines = [
        f"# {report_title}",
        "",
        f"Generated at (UTC): **{generated_at}**",
        f"Base URL: **{base_url}**",
        f"Fixture source: **{fixture_source}**",
        f"Total requests: **{total}**",
        f"Success: **{ok}**",
        f"Failed: **{bad}**",
        "",
        "| # | Engine | Tech | Endpoint | File | Layer | Material | Expected | Status | Success | RateFromPricing | ErrorCode |",
        "|---:|:------:|:----:|:---------|:-----|------:|:---------|:---------|------:|:-------:|:--------------:|:---------|",
    ]

    def rate_match_icon(result: TestCaseResult) -> str:
        if result.hourly_rate_matches_pricing_json is True:
            return "✅"
        if result.hourly_rate_matches_pricing_json is False:
            return "❌"
        return "n/a"

    for row in rows:
        lines.append(
            f"| {row.index} | {resolve_engine_name(row.endpoint)} | {row.technology} | "
            f"`{row.endpoint}` | `{row.file}` | {row.layer_height} | {row.material} | "
            f"`{row.expected_hint}` | {row.http_status} | "
            f"{'✅' if row.success else '❌'} | {rate_match_icon(row)} | {row.error_code or '-'} |"
        )

    return "\n".join(lines) + "\n"


def resolve_fixture_files(tests_root: Path, synthetic_dir: Path) -> tuple[list[Path], Path, str]:
    """Return the input files, their root, and the fixture-source label."""
    files = discover_test_files(tests_root)
    if files:
        return files, tests_root, FIXTURE_SOURCE_LEGACY
    synthetic_root = synthetic_dir / "synthetic"
    synthetic_root.mkdir(parents=True, exist_ok=True)
    return write_standard_fixture_set(synthetic_root), synthetic_dir, FIXTURE_SOURCE_SYNTHETIC


def evaluate_negative_response(
    status: int,
    body: dict | str | None,
    expected_status: int,
    error_codes: tuple[str, ...],
) -> tuple[bool, str | None, str | None]:
    """Judge one declared rejection: exact status, typed envelope, accepted code."""
    error_code = body.get("errorCode") if isinstance(body, dict) else None
    error_message = body.get("error") if isinstance(body, dict) else None
    if status != expected_status:
        return False, error_code, (
            f"Expected {expected_status}, got status={status}, errorCode={error_code}"
        )
    if not isinstance(body, dict) or body.get("success") is not False:
        return False, error_code, "Rejection body is not the typed success:false envelope"
    if error_codes and error_code not in error_codes:
        return False, error_code, f"Expected errorCode in {error_codes}, got {error_code}"
    return True, error_code, error_message


def select_negative_fixture(files: Sequence[Path]) -> Path:
    """Prefer a plain STL for negative requests so only the option under test can fail."""
    for candidate in files:
        if candidate.suffix.lower() == ".stl":
            return candidate
    return files[0]


def run_negative_requests(
    scenario: SliceScenario,
    *,
    base_url: str,
    slice_service_api_key: str,
    file_path: Path,
    relative_file: str,
    first_index: int,
    retry_on_429: int,
    retry_wait_seconds: int,
    sleep_seconds: int,
) -> list[TestCaseResult]:
    """Send each declared negative request against one fixture and expect its rejection."""
    rows: list[TestCaseResult] = []
    layer_height = scenario.layer_heights[0]
    material = scenario.material
    for offset, (label, overrides, expected_status, error_codes) in enumerate(
        scenario.negative_requests,
    ):
        index = first_index + offset
        extra_fields = build_extra_fields(
            scenario.endpoint, scenario.technology, layer_height, scenario.printer_profile,
        )
        extra_fields.update(overrides)
        codes = "/".join(error_codes) if error_codes else "any_error"
        print(f"[RUNNER:{scenario.key}] #{index} -> negative | {relative_file} | {label}")
        status, body, duration = run_slice_request_with_retry(
            base_url,
            scenario.endpoint,
            file_path,
            layer_height,
            material,
            slice_service_api_key,
            extra_fields,
            retry_on_429=retry_on_429,
            retry_wait_seconds=retry_wait_seconds,
        )
        success, error_code, error_message = evaluate_negative_response(
            status, body, expected_status, error_codes,
        )
        rows.append(
            TestCaseResult(
                index=index,
                endpoint=scenario.endpoint,
                technology=scenario.technology,
                file=f"{relative_file} [{label}]",
                category="negative",
                layer_height=layer_height,
                material=material,
                http_status=status,
                success=success,
                duration_sec=round(duration, 3),
                expected_hint=f"expected_{expected_status}_{codes}",
                error_code=error_code,
                error_message=error_message,
                raw_body=body,
                expected_hourly_rate=None,
                actual_hourly_rate=None,
                hourly_rate_matches_pricing_json=None,
            )
        )
        print(f"[RUNNER:{scenario.key}]    status={status} success={success} duration={duration:.2f}s")
        if not success and error_message:
            print(f"[RUNNER:{scenario.key}]    detail={error_message}")
        time.sleep(sleep_seconds)
    return rows


def run_scenario(
    scripts_root: Path,
    scenario: SliceScenario,
    *,
    sleep_seconds: int = 12,
    retry_on_429: int = 3,
    retry_wait_seconds: int = 20,
) -> ScenarioRunResult:
    """Execute one complete scenario against all test inputs and write markdown report."""
    tests_root = scripts_root.parent / "testing-files"
    project_root = scripts_root.parent.parent
    results_dir = scripts_root / "results"
    report_path = results_dir / scenario.report_filename

    results_dir.mkdir(parents=True, exist_ok=True)
    for legacy_filename in scenario.legacy_report_files:
        legacy_path = results_dir / legacy_filename
        if legacy_path.exists():
            legacy_path.unlink()

    base_url, slice_service_api_key = _resolve_runtime_env(project_root)
    print(
        f"[RUNNER:{scenario.key}] endpoint={scenario.endpoint} tech={scenario.technology} "
        f"material={scenario.material} "
        f"slice_service_api_key_found={bool(slice_service_api_key)}"
    )
    if not slice_service_api_key:
        raise RuntimeError("SLICE_SERVICE_API_KEY not found in .env or process environment.")

    with tempfile.TemporaryDirectory(prefix="slice-matrix-fixtures-") as temp_dir_name:
        files, files_root, fixture_source = resolve_fixture_files(tests_root, Path(temp_dir_name))
        if not files:
            raise FileNotFoundError(f"No supported input files found under {tests_root}.")
        print(f"[RUNNER:{scenario.key}] fixture_source={fixture_source}")

        pricing_map = fetch_pricing_map(base_url)
        layer_cycle = cycle(scenario.layer_heights)
        material_cycle = cycle(scenario.materials or (scenario.material,))

        rows: list[TestCaseResult] = []
        req_index = 1

        print(f"[RUNNER:{scenario.key}] Found {len(files)} input files. Starting...")

        for file_path in files:
            layer_height = next(layer_cycle)
            material = next(material_cycle)
            category = classify(file_path)
            relative_file = str(file_path.relative_to(files_root)).replace("\\", "/")
            expected_failure = find_expected_failure(scenario, relative_file)
            expected_hint = expected_hint_for_case(category, expected_failure)
            extra_fields = build_extra_fields(
                scenario.endpoint, scenario.technology, layer_height, scenario.printer_profile,
            )

            print(
                f"[RUNNER:{scenario.key}] #{req_index} -> {resolve_engine_name(scenario.endpoint)}/"
                f"{scenario.technology} | {relative_file} | layer={layer_height} | material={material}"
            )

            status, body, duration = run_slice_request_with_retry(
                base_url,
                scenario.endpoint,
                file_path,
                layer_height,
                material,
                slice_service_api_key,
                extra_fields,
                retry_on_429=retry_on_429,
                retry_wait_seconds=retry_wait_seconds,
            )

            (
                success,
                error_code,
                error_message,
                expected_hourly_rate,
                actual_hourly_rate,
                hourly_rate_matches,
            ) = evaluate_slice_response(
                body=body,
                status=status,
                technology=scenario.technology,
                material=material,
                pricing_map=pricing_map,
                endpoint=scenario.endpoint,
                expected_fields=extra_fields,
            )

            if expected_failure:
                success = matches_expected_failure(
                    status=status,
                    error_code=error_code,
                    expected_failure=expected_failure,
                )
                if not success:
                    error_message = (
                        f"Expected {expected_failure.status} with "
                        f"{expected_failure.error_codes}, got status={status}, errorCode={error_code}"
                    )

            rows.append(
                TestCaseResult(
                    index=req_index,
                    endpoint=scenario.endpoint,
                    technology=scenario.technology,
                    file=relative_file,
                    category=category,
                    layer_height=layer_height,
                    material=material,
                    http_status=status,
                    success=success,
                    duration_sec=round(duration, 3),
                    expected_hint=expected_hint,
                    error_code=error_code,
                    error_message=error_message,
                    raw_body=body,
                    expected_hourly_rate=expected_hourly_rate,
                    actual_hourly_rate=actual_hourly_rate,
                    hourly_rate_matches_pricing_json=hourly_rate_matches,
                )
            )

            print(f"[RUNNER:{scenario.key}]    status={status} success={success} duration={duration:.2f}s")
            if not success and error_message:
                print(f"[RUNNER:{scenario.key}]    detail={error_message}")

            req_index += 1
            time.sleep(sleep_seconds)

        if scenario.negative_requests:
            negative_fixture = select_negative_fixture(files)
            rows.extend(run_negative_requests(
                scenario,
                base_url=base_url,
                slice_service_api_key=slice_service_api_key,
                file_path=negative_fixture,
                relative_file=str(negative_fixture.relative_to(files_root)).replace("\\", "/"),
                first_index=req_index,
                retry_on_429=retry_on_429,
                retry_wait_seconds=retry_wait_seconds,
                sleep_seconds=sleep_seconds,
            ))

    generated_at = datetime.now(timezone.utc).isoformat()
    report_text = markdown_summary(
        scenario.report_title,
        rows,
        generated_at,
        base_url,
        fixture_source,
    )
    report_path.write_text(report_text, encoding="utf-8")

    total = len(rows)
    success_count = sum(1 for row in rows if row.success)
    failed_count = total - success_count

    print(
        f"[RUNNER:{scenario.key}] Completed. total={total} "
        f"success={success_count} failed={failed_count}"
    )
    print(f"[RUNNER:{scenario.key}] Report: {report_path}")

    return ScenarioRunResult(
        scenario=scenario,
        base_url=base_url,
        report_path=report_path,
        generated_at=generated_at,
        total=total,
        success_count=success_count,
        failed_count=failed_count,
        fixture_source=fixture_source,
    )


def build_suite_summary_markdown(
    *,
    suite_title: str,
    generated_at: str,
    scenario_results: Sequence[ScenarioRunResult],
) -> str:
    """Render summary markdown for multiple scenario runs."""
    total_requests = sum(item.total for item in scenario_results)
    total_success = sum(item.success_count for item in scenario_results)
    total_failed = sum(item.failed_count for item in scenario_results)
    base_url = scenario_results[0].base_url if scenario_results else "n/a"
    fixture_source = scenario_results[0].fixture_source if scenario_results else "n/a"

    lines = [
        f"# {suite_title}",
        "",
        f"Generated at (UTC): **{generated_at}**",
        f"Base URL: **{base_url}**",
        f"Fixture source: **{fixture_source}**",
        f"Total requests: **{total_requests}**",
        f"Success: **{total_success}**",
        f"Failed: **{total_failed}**",
        "",
        "| Scenario | Engine | Tech | Endpoint | Total | Success | Failed | Report |",
        "|:---------|:------:|:----:|:---------|------:|--------:|-------:|:-------|",
    ]

    for item in scenario_results:
        scenario = item.scenario
        lines.append(
            f"| {scenario.key} | {resolve_engine_name(scenario.endpoint)} | {scenario.technology} | "
            f"`{scenario.endpoint}` | {item.total} | {item.success_count} | {item.failed_count} | "
            f"`{item.report_path.name}` |"
        )

    return "\n".join(lines) + "\n"
