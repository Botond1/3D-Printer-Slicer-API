"""Confirm the measured Bambu Studio admission envelopes at their exact edges.

Every point uploads a generated cuboid through ``POST /bambu/slice`` with
``orientationMode=preserve`` and a zero request rotation, so the API keeps the
submitted pose and only the inclusive largest-passing ceiling decides. A
passing edge must answer HTTP 200 with ``final_dimensions_mm`` equal to the
cuboid within 0.05 mm; the next 0.1 mm must answer HTTP 422
``MODEL_OUT_OF_PRINTER_BOUNDS``. The runner also proves that ``GET /profiles``
publishes the same measured triples on the bambu rows.

Measured envelopes (inclusive, exact):
  P1S  256 x 228 x 250 mm, alternative footprint 238 x 256 mm (L-shaped bed
       because of the 18 x 28 mm exclude corner)
  H2D  325 x 320 x 325 mm
"""

from __future__ import annotations

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
REPORT_PATH = RESULTS_DIR / "bambu_envelope_confirmation_result.md"

from common.env_utils import resolve_base_url, resolve_slice_service_api_key
from common.http_utils import curl_json
from common.runner_support import (
    AXES,
    axis_map_equals,
    error_code_of,
    format_number,
    post_slice_with_retry,
    report_target_class,
)
from common.synthetic_fixtures import dimensions_close, inspect_binary_stl, write_cuboid_stl

BAMBU_SLICE_ENDPOINT = "/bambu/slice"
CATALOGUE_ENDPOINT = "/profiles"
CATALOGUE_SCHEMA = "r3d-profile-catalogue-v2"
LAYER_HEIGHT = "0.2"
MATERIAL = "PLA"
SLEEP_SECONDS = 12
FINAL_DIMENSION_TOLERANCE_MM = 0.05
BOUNDS_ERROR_CODE = "MODEL_OUT_OF_PRINTER_BOUNDS"
MEASURED_ENVELOPES_MM = {
    "P1S": {"x": 256, "y": 228, "z": 250},
    "H2D": {"x": 325, "y": 320, "z": 325},
}
P1S_ALTERNATIVE_FOOTPRINT_MM = {"x": 238, "y": 256}
EDGE_POINTS: tuple[tuple[str, tuple[float, float, float], str, str], ...] = (
    ("P1S", (256, 228, 10), "pass", "primary footprint X/Y edge"),
    ("P1S", (256, 228.1, 10), "fail", "primary footprint Y + 0.1 mm"),
    ("P1S", (238, 256, 10), "pass", "alternative footprint X/Y edge"),
    ("P1S", (238.1, 256, 10), "fail", "alternative footprint X + 0.1 mm"),
    ("P1S", (20, 20, 250), "pass", "Z edge"),
    ("P1S", (20, 20, 250.1), "fail", "Z + 0.1 mm"),
    ("P1S", (256, 256, 10), "fail", "full square exceeds both footprints"),
    ("H2D", (325, 320, 10), "pass", "X/Y edge"),
    ("H2D", (325.1, 320, 10), "fail", "X + 0.1 mm"),
    ("H2D", (20, 20, 325), "pass", "Z edge"),
    ("H2D", (20, 20, 325.1), "fail", "Z + 0.1 mm"),
)


@dataclass(frozen=True)
class EdgeCase:
    printer: str
    dimensions_mm: tuple[float, float, float]
    expectation: str  # pass | fail
    label: str


@dataclass
class EdgeResult:
    index: int
    case: EdgeCase
    http_status: int
    success: bool
    error_code: str | None
    observation: str
    duration_sec: float


@dataclass(frozen=True)
class CatalogueCheck:
    name: str
    status: int | str
    success: bool
    observation: str


def build_cases() -> tuple[EdgeCase, ...]:
    return tuple(EdgeCase(printer, dims, expectation, label) for printer, dims, expectation, label in EDGE_POINTS)


def build_request_fields(printer: str) -> dict[str, str]:
    return {
        "printerProfile": printer,
        "sizeUnit": "mm",
        "keepProportions": "true",
        "scalePercent": "100",
        "rotationX": "0",
        "rotationY": "0",
        "rotationZ": "0",
        "orientationMode": "preserve",
        "infill": "0",
        "supports": "false",
    }


def _expected_map(case: EdgeCase) -> dict[str, float]:
    return {axis: float(value) for axis, value in zip(AXES, case.dimensions_mm)}


def validate_pass(body: object, case: EdgeCase) -> tuple[bool, str]:
    if not isinstance(body, dict) or body.get("success") is not True:
        return False, "success body missing"
    if body.get("slicer_engine") != "bambu":
        return False, "slicer_engine is not bambu"
    transform = body.get("model_transform")
    if not isinstance(transform, dict) or transform.get("transform_schema") != 2:
        return False, "model_transform.transform_schema is not 2"
    if transform.get("orientation_mode") != "preserve" or transform.get("orientation_outcome") != "preserved":
        return False, "preserve mode/outcome not reported"
    expected = _expected_map(case)
    if not dimensions_close(transform.get("final_dimensions_mm"), case.dimensions_mm, FINAL_DIMENSION_TOLERANCE_MM):
        return False, "final_dimensions_mm differ from the uploaded cuboid by more than 0.05 mm"
    limits = body.get("build_volume_limits_mm")
    if not isinstance(limits, dict) or not axis_map_equals(limits.get("max"), MEASURED_ENVELOPES_MM[case.printer]):
        return False, f"build_volume_limits_mm.max is not the measured {case.printer} triple"
    stats = body.get("stats")
    if not isinstance(stats, dict) or abs(float(stats.get("object_height_mm", -1)) - expected["z"]) > FINAL_DIMENSION_TOLERANCE_MM:
        return False, "stats.object_height_mm differs from the cuboid height"
    return True, "accepted at the exact inclusive edge with preserved dimensions"


def validate_fail(status: int, body: object, case: EdgeCase) -> tuple[bool, str]:
    if status != 422:
        return False, f"expected HTTP 422, got {status}"
    if not isinstance(body, dict) or body.get("success") is not False:
        return False, "rejection body missing success:false"
    if body.get("errorCode") != BOUNDS_ERROR_CODE:
        return False, f"expected {BOUNDS_ERROR_CODE}, got {body.get('errorCode')}"
    if not dimensions_close(body.get("model_dimensions_mm"), case.dimensions_mm, FINAL_DIMENSION_TOLERANCE_MM):
        return False, "model_dimensions_mm do not echo the uploaded cuboid"
    limits = body.get("build_volume_limits_mm")
    if not isinstance(limits, dict) or not isinstance(limits.get("max"), dict):
        return False, "build_volume_limits_mm.max missing from the bounds rejection"
    transform = body.get("model_transform")
    if not isinstance(transform, dict) or transform.get("transform_schema") != 2:
        return False, "bounds rejection lacks the schema-2 transform"
    return True, "rejected 0.1 mm beyond the edge with the full K2 bounds contract"


def run_case(index: int, case: EdgeCase, base_url: str, api_key: str, directory: Path) -> EdgeResult:
    fixture_name = (
        f"edge_{case.printer}_{'_'.join(format_number(value).replace('.', 'p') for value in case.dimensions_mm)}.stl"
    )
    fixture = write_cuboid_stl(directory, case.dimensions_mm, fixture_name)
    try:
        measured = inspect_binary_stl(fixture)
    except ValueError as error:
        return EdgeResult(index, case, 0, False, "FIXTURE_INVALID", f"fixture precondition failed: {error}", 0.0)
    if not dimensions_close(measured, case.dimensions_mm, 0.001):
        return EdgeResult(index, case, 0, False, "FIXTURE_INVALID", "fixture dimensions mismatch", 0.0)
    status, body, duration = post_slice_with_retry(
        base_url=base_url, endpoint=BAMBU_SLICE_ENDPOINT, file_path=fixture,
        layer_height=LAYER_HEIGHT, material=MATERIAL, slice_service_api_key=api_key,
        extra_fields=build_request_fields(case.printer),
    )
    if case.expectation == "pass":
        success, observation = (validate_pass(body, case) if status == 200 else (
            False, f"expected HTTP 200, got {status} ({error_code_of(body)})",
        ))
    else:
        success, observation = validate_fail(status, body, case)
    return EdgeResult(index, case, status, success, error_code_of(body), observation, round(duration, 3))


def validate_catalogue_envelopes(body: object) -> list[CatalogueCheck]:
    checks: list[CatalogueCheck] = []
    if not isinstance(body, dict) or body.get("schema") != CATALOGUE_SCHEMA or not isinstance(body.get("profiles"), list):
        return [CatalogueCheck("catalogue v2 available", "n/a", False, "profiles payload is not catalogue v2")]
    for printer, expected in MEASURED_ENVELOPES_MM.items():
        rows = [
            profile for profile in body["profiles"]
            if isinstance(profile, dict) and profile.get("engine") == "bambu"
            and isinstance(profile.get("printer"), dict) and profile["printer"].get("id") == printer
        ]
        if not rows:
            checks.append(CatalogueCheck(f"bambu {printer} rows published", "n/a", False, "no bambu row for this printer"))
            continue
        mismatched = [
            row for row in rows
            if not isinstance(row.get("build_volume_limits_mm"), dict)
            or not axis_map_equals(row["build_volume_limits_mm"].get("largest_passing_dimensions_inclusive_mm"), expected)
        ]
        checks.append(CatalogueCheck(
            f"bambu {printer} largest_passing_dimensions_inclusive_mm", len(rows), not mismatched,
            "every row publishes the measured triple" if not mismatched
            else f"{len(mismatched)} of {len(rows)} rows publish a different ceiling",
        ))
    machines = body.get("machine_resolutions")
    observed = {
        machine["printer"].get("id"): machine.get("largest_passing_dimensions_inclusive_mm")
        for machine in (machines if isinstance(machines, list) else [])
        if isinstance(machine, dict) and machine.get("engine") == "bambu" and isinstance(machine.get("printer"), dict)
    }
    checks.append(CatalogueCheck(
        "bambu machine resolutions", len(observed),
        all(axis_map_equals(observed.get(printer), expected) for printer, expected in MEASURED_ENVELOPES_MM.items()),
        "engine-scoped machine ceilings equal the measured triples",
    ))
    return checks


def write_report(base_url: str, results: list[EdgeResult], catalogue_checks: list[CatalogueCheck]) -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    passed = sum(1 for result in results if result.success) + sum(1 for check in catalogue_checks if check.success)
    total = len(results) + len(catalogue_checks)
    lines = [
        "# Bambu Envelope Confirmation Report", "",
        f"Generated at (UTC): **{datetime.now(timezone.utc).isoformat()}**",
        f"Target class: **{report_target_class(base_url)}**",
        f"Total checks: **{total}**", f"Passed: **{passed}**", f"Failed: **{total - passed}**", "",
        "## Measured envelopes under test", "",
        "| Printer | X | Y | Z | Note |", "|:-------:|--:|--:|--:|:-----|",
        "| P1S | 256 | 228 | 250 | alternative footprint 238 x 256 (L-shaped bed, 18 x 28 mm exclude corner) |",
        "| H2D | 325 | 320 | 325 | |", "",
        "Requests use `orientationMode=preserve`, zero rotation, 0.2 mm PLA, 0% infill, no supports, "
        "so the submitted pose is what the inclusive ceiling judges.", "",
        "No base URL, hostname, credential, or temporary path is retained.", "",
        "## Edge points", "",
        "| # | Printer | Cuboid (mm) | Expect | Status | ErrorCode | Result | Observation |",
        "|---:|:-------:|:------------|:------:|------:|:----------|:------:|:------------|",
    ]
    for result in results:
        dims = " x ".join(format_number(value) for value in result.case.dimensions_mm)
        lines.append(
            f"| {result.index} | {result.case.printer} | {dims} ({result.case.label}) | {result.case.expectation} | "
            f"{result.http_status} | {result.error_code or '-'} | {'PASS' if result.success else 'FAIL'} | {result.observation} |"
        )
    lines.extend(["", "## Catalogue publication", "", "| Check | Rows/Status | Result | Observation |", "|:------|:-----------:|:------:|:------------|"])
    for check in catalogue_checks:
        lines.append(f"| {check.name} | `{check.status}` | {'PASS' if check.success else 'FAIL'} | {check.observation} |")
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    base_url = resolve_base_url(PROJECT_ROOT)
    api_key = resolve_slice_service_api_key(PROJECT_ROOT)
    print(f"[BAMBU ENVELOPE] slice_service_api_key_found={bool(api_key)}")
    if not api_key:
        print("[BAMBU ENVELOPE] ERROR: SLICE_SERVICE_API_KEY not found in .env or process environment.")
        return 1
    status, catalogue = curl_json(method="GET", base_url=base_url, endpoint=CATALOGUE_ENDPOINT)
    catalogue_checks = validate_catalogue_envelopes(catalogue if status == 200 else None)
    results: list[EdgeResult] = []
    cases = build_cases()
    with tempfile.TemporaryDirectory(prefix="bambu-envelope-") as temp_dir_name:
        for index, case in enumerate(cases, 1):
            print(f"[BAMBU ENVELOPE] #{index} {case.printer} {case.dimensions_mm} expect={case.expectation}")
            result = run_case(index, case, base_url, api_key, Path(temp_dir_name))
            results.append(result)
            print(f"[BAMBU ENVELOPE]    status={result.http_status} success={result.success} :: {result.observation}")
            if index < len(cases):
                time.sleep(SLEEP_SECONDS)
    write_report(base_url, results, catalogue_checks)
    failed = sum(1 for result in results if not result.success) + sum(1 for check in catalogue_checks if not check.success)
    print(f"[BAMBU ENVELOPE] Completed. total={len(results) + len(catalogue_checks)} failed={failed}")
    print(f"[BAMBU ENVELOPE] Report: {REPORT_PATH}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
