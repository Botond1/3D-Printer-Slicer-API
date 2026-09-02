"""Bambu Studio FDM matrix runner over deterministic synthetic fixtures.

Matrix: P1S x {0.12, 0.2, 0.28} x {PLA, PETG, ABS, TPU} plus H2D x {0.2} x
{PLA}, the L-bracket with ``supports`` true and false, one identical request
pair proving ``effective_profile_sha256`` stability, the negative request
cases, and (when ``ARTIFACT_API_KEY`` is available) proof that each success
retained a ``.gcode.3mf`` artifact listed by ``GET /admin/output-files``.

The private ``tests/testing-files`` corpus is optional: when present each of
its files is sliced once at P1S 0.2 mm PLA and referenced only by index and
SHA-256 prefix; otherwise the report states that only synthetic fixtures ran.
"""

from __future__ import annotations

import sys
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping

SCRIPT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_ROOT.parent))
PROJECT_ROOT = SCRIPT_ROOT.parent.parent.parent
TESTING_FILES_ROOT = SCRIPT_ROOT.parent.parent / "testing-files"
RESULTS_DIR = SCRIPT_ROOT.parent / "results"
REPORT_PATH = RESULTS_DIR / "full_api_bambu_fdm_test_result.md"

from common.env_utils import (
    resolve_artifact_api_key_candidates,
    resolve_base_url,
    resolve_slice_service_api_key,
)
from common.http_utils import curl_json
from common.runner_support import (
    ARTIFACT_ID_PATTERN,
    axis_map_equals,
    error_code_of,
    is_engine_version,
    is_lower_hex_sha256,
    is_positive_number,
    post_slice_with_retry,
    report_target_class,
    validate_optional_placement,
)
from common.slice_matrix_runner import discover_test_files
from common.synthetic_fixtures import (
    inspect_binary_stl,
    sha256_of_file,
    write_cuboid_obj,
    write_cuboid_stl,
    write_cylinder_stl,
    write_l_bracket_stl,
    write_stl_zip,
    write_thin_wall_open_box_stl,
)

BAMBU_SLICE_ENDPOINT = "/bambu/slice"
OUTPUT_FILES_ENDPOINT = "/admin/output-files"
PRICING_ENDPOINT = "/pricing"
P1S_LAYER_HEIGHTS = (0.12, 0.2, 0.28)
MATERIALS = ("PLA", "PETG", "ABS", "TPU")
H2D_CASES = ((0.2, "PLA"),)
DEFAULT_INFILL = "15"
EXPECTED_INFILL_ECHO = "15%"
# The slice limiter admits 3 requests/min sustained (burst 5) per client, so
# requests are paced at that rate; 429 responses are still retried with backoff.
SLEEP_SECONDS = 20
DIMENSION_TOLERANCE_MM = 1e-6
MEASURED_BUILD_VOLUME_MAX_MM = {
    "P1S": {"x": 256, "y": 228, "z": 250},
    "H2D": {"x": 325, "y": 320, "z": 325},
}
# `Standard` is the SLA resin material, so the forced-FDM Bambu endpoint reports
# MATERIAL_TECHNOLOGY_MISMATCH; the other codes cover unknown/unprofiled materials.
MATERIAL_REJECTION_CODES = (
    "MATERIAL_TECHNOLOGY_MISMATCH",
    "INVALID_MATERIAL_FOR_TECHNOLOGY",
    "MATERIAL_PROFILE_UNAVAILABLE",
)
ARTIFACT_SUFFIX = ".gcode.3mf"


@dataclass(frozen=True)
class BambuCase:
    """One request against ``POST /bambu/slice``."""

    name: str
    kind: str  # matrix | supports | stability | legacy | negative
    fixture_path: Path
    fixture_label: str
    printer: str
    layer_height: str
    material: str
    supports: str
    infill: str = DEFAULT_INFILL
    expected_status: int = 200
    expected_error_codes: tuple[str, ...] = ()
    stability_group: str | None = None
    field_overrides: Mapping[str, str] = field(default_factory=dict)


@dataclass
class BambuCaseResult:
    """Observed outcome of one case."""

    index: int
    case: BambuCase
    http_status: int
    success: bool
    error_code: str | None
    observation: str
    duration_sec: float
    digest: str | None = None
    artifact_id: str | None = None
    print_time_seconds: float | None = None
    material_used_g: float | None = None
    estimated_price_huf: float | None = None


@dataclass(frozen=True)
class SupplementaryCheck:
    name: str
    status: str
    success: bool
    observation: str


def build_request_fields(case: BambuCase) -> dict[str, str]:
    """Multipart fields for one case; overrides are applied last."""
    fields = {
        "printerProfile": case.printer,
        "sizeUnit": "mm",
        "keepProportions": "true",
        "scalePercent": "100",
        "rotationX": "0",
        "rotationY": "0",
        "rotationZ": "0",
        "orientationMode": "auto",
        "infill": case.infill,
        "supports": case.supports,
    }
    fields.update(case.field_overrides)
    return fields


def write_synthetic_fixtures(directory: Path) -> dict[str, Path]:
    """Write and self-verify the synthetic fixture set."""
    cuboid = write_cuboid_stl(directory)
    fixtures = {
        "cuboid": cuboid,
        "cylinder": write_cylinder_stl(directory),
        "l_bracket": write_l_bracket_stl(directory),
        "thin_wall_box": write_thin_wall_open_box_stl(directory),
        "cuboid_obj": write_cuboid_obj(directory),
        "cuboid_zip": write_stl_zip(directory, cuboid),
    }
    for key in ("cuboid", "cylinder", "l_bracket", "thin_wall_box"):
        inspect_binary_stl(fixtures[key])  # raises on a malformed or open mesh
    return fixtures


def build_cases(fixtures: Mapping[str, Path], legacy_files: list[Path]) -> list[BambuCase]:
    """Deterministically assemble the whole case list."""
    rotation = ("cuboid", "cylinder", "thin_wall_box", "cuboid_obj", "cuboid_zip", "l_bracket")
    cases: list[BambuCase] = []
    cell = 0
    for layer_height in P1S_LAYER_HEIGHTS:
        for material in MATERIALS:
            fixture_key = rotation[cell % len(rotation)]
            cell += 1
            cases.append(BambuCase(
                name=f"P1S {layer_height} mm {material} on {fixture_key}",
                kind="matrix", fixture_path=fixtures[fixture_key], fixture_label=fixture_key,
                printer="P1S", layer_height=str(layer_height), material=material, supports="true",
            ))
    for layer_height, material in H2D_CASES:
        cases.append(BambuCase(
            name=f"H2D {layer_height} mm {material} on cuboid",
            kind="matrix", fixture_path=fixtures["cuboid"], fixture_label="cuboid",
            printer="H2D", layer_height=str(layer_height), material=material, supports="true",
        ))
    for supports in ("true", "false"):
        cases.append(BambuCase(
            name=f"L-bracket 32 mm overhang supports={supports}",
            kind="supports", fixture_path=fixtures["l_bracket"], fixture_label="l_bracket",
            printer="P1S", layer_height="0.2", material="PLA", supports=supports,
        ))
    for repetition in (1, 2):
        cases.append(BambuCase(
            name=f"identical request {repetition}/2 (digest stability)",
            kind="stability", fixture_path=fixtures["cuboid"], fixture_label="cuboid",
            printer="P1S", layer_height="0.2", material="PLA", supports="true",
            stability_group="cuboid-P1S-0.2-PLA",
        ))
    for index, legacy_path in enumerate(legacy_files, 1):
        cases.append(BambuCase(
            name=f"legacy corpus #{index}",
            kind="legacy", fixture_path=legacy_path,
            fixture_label=f"legacy#{index} ({sha256_of_file(legacy_path)[:12]})",
            printer="P1S", layer_height="0.2", material="PLA", supports="true",
        ))
    cuboid = fixtures["cuboid"]
    negatives = (
        ("layerHeight 0.3 is not a registry key", {"layer_height": "0.3"}, {}, ("INVALID_LAYER_HEIGHT",)),
        ("infill 140 is rejected, never clamped", {"infill": "140"}, {}, ("INVALID_INFILL",)),
        ("printerProfile X1C is unregistered", {}, {"printerProfile": "X1C"}, ("INVALID_PRINTER_PROFILE",)),
        ("supports maybe is not boolean", {"supports": "maybe"}, {}, ("INVALID_SUPPORTS",)),
        ("material Standard is not an FDM material", {"material": "Standard"}, {}, MATERIAL_REJECTION_CODES),
    )
    for name, attributes, overrides, codes in negatives:
        cases.append(BambuCase(
            name=name, kind="negative", fixture_path=cuboid, fixture_label="cuboid",
            printer="P1S", layer_height=attributes.get("layer_height", "0.2"),
            material=attributes.get("material", "PLA"), supports=attributes.get("supports", "true"),
            infill=attributes.get("infill", DEFAULT_INFILL), expected_status=400,
            expected_error_codes=codes, field_overrides=overrides,
        ))
    return cases


def fetch_pricing_map(base_url: str) -> dict | None:
    status, body = curl_json(method="GET", base_url=base_url, endpoint=PRICING_ENDPOINT)
    return body if status == 200 and isinstance(body, dict) else None


def expected_hourly_rate(pricing_map: dict | None, material: str) -> float | None:
    fdm = pricing_map.get("FDM") if isinstance(pricing_map, dict) else None
    if not isinstance(fdm, dict):
        return None
    for key, value in fdm.items():
        if str(key).strip().upper() == material.upper():
            try:
                rate = float(value)
            except (TypeError, ValueError):
                return None
            return rate if rate > 0 else None
    return None


def validate_success_body(
    body: object, case: BambuCase, pricing_map: dict | None,
) -> tuple[bool, str]:
    """Validate the complete Bambu success contract for one case."""
    if not isinstance(body, dict) or body.get("success") is not True:
        return False, "success body missing or success flag not true"
    if body.get("slicer_engine") != "bambu":
        return False, "slicer_engine is not bambu"
    if not is_engine_version(body.get("engine_version")):
        return False, "engine_version is not a machine-readable version"
    if body.get("technology") != "FDM" or body.get("material") != case.material:
        return False, "technology/material echo mismatch"
    if body.get("infill") != EXPECTED_INFILL_ECHO:
        return False, "infill echo is not the normalized percentage"
    if body.get("supports") is not (case.supports == "true"):
        return False, "supports flag is not echoed as the requested boolean"
    profiles = body.get("profiles")
    if not isinstance(profiles, dict):
        return False, "profiles object missing"
    if not is_lower_hex_sha256(profiles.get("effective_profile_sha256")):
        return False, "effective_profile_sha256 is not lowercase 64-hex"
    if profiles.get("printer") != case.printer:
        return False, "profiles.printer does not echo the selected printer"
    for name in ("machine_profile", "process_profile", "filament_profile", "bed_type"):
        if not isinstance(profiles.get(name), str) or not profiles[name].strip():
            return False, f"profiles.{name} missing"
    if not is_positive_number(profiles.get("filament_diameter_mm")) or not is_positive_number(
        profiles.get("filament_density_g_cm3")
    ):
        return False, "filament diameter/density are not positive"
    transform = body.get("model_transform")
    if not isinstance(transform, dict) or transform.get("transform_schema") != 2:
        return False, "model_transform.transform_schema is not 2"
    final_dimensions = transform.get("final_dimensions_mm")
    if not isinstance(final_dimensions, dict) or not all(
        is_positive_number(final_dimensions.get(axis)) for axis in ("x", "y", "z")
    ):
        return False, "final_dimensions_mm are not positive"
    limits = body.get("build_volume_limits_mm")
    if not isinstance(limits, dict) or not axis_map_equals(
        limits.get("max"), MEASURED_BUILD_VOLUME_MAX_MM[case.printer], DIMENSION_TOLERANCE_MM,
    ):
        return False, f"build_volume_limits_mm.max is not the measured {case.printer} envelope"
    stats = body.get("stats")
    if not isinstance(stats, dict):
        return False, "stats object missing"
    for name in ("print_time_seconds", "material_used_m", "material_used_g", "estimated_price_huf"):
        if not is_positive_number(stats.get(name)):
            return False, f"stats.{name} is not positive"
    if not is_positive_number(body.get("hourly_rate")):
        return False, "hourly_rate is not positive"
    expected_rate = expected_hourly_rate(pricing_map, case.material)
    if expected_rate is not None and abs(float(body["hourly_rate"]) - expected_rate) > 1e-9:
        return False, "hourly_rate does not match the live /pricing FDM rate"
    if not isinstance(stats.get("object_height_mm"), (int, float)) or abs(
        float(stats["object_height_mm"]) - float(final_dimensions["z"])
    ) > 1e-6:
        return False, "stats.object_height_mm differs from final_dimensions_mm.z"
    artifact_id = body.get("artifact_id")
    if not isinstance(artifact_id, str) or ARTIFACT_ID_PATTERN.fullmatch(artifact_id) is None:
        return False, "artifact_id is missing or not artifact-<32 hex>"
    placement_ok, placement_note = validate_optional_placement(body)
    if not placement_ok:
        return False, placement_note
    return True, f"complete Bambu success contract ({placement_note})"


def evaluate_case(case: BambuCase, status: int, body: object, pricing_map: dict | None) -> tuple[bool, str]:
    if case.kind == "negative":
        code = error_code_of(body)
        if status != case.expected_status:
            return False, f"expected HTTP {case.expected_status}, got {status}"
        if isinstance(body, dict) and body.get("success") is not False:
            return False, "rejection body must carry success:false"
        if case.expected_error_codes and code not in case.expected_error_codes:
            return False, f"unexpected errorCode {code}"
        return True, f"rejected with {code}"
    if status != 200:
        return False, f"expected HTTP 200, got {status} ({error_code_of(body)})"
    return validate_success_body(body, case, pricing_map)


def run_case(
    index: int, case: BambuCase, base_url: str, api_key: str, pricing_map: dict | None,
) -> BambuCaseResult:
    status, body, duration = post_slice_with_retry(
        base_url=base_url, endpoint=BAMBU_SLICE_ENDPOINT, file_path=case.fixture_path,
        layer_height=case.layer_height, material=case.material,
        slice_service_api_key=api_key, extra_fields=build_request_fields(case),
    )
    success, observation = evaluate_case(case, status, body, pricing_map)
    result = BambuCaseResult(
        index=index, case=case, http_status=status, success=success,
        error_code=error_code_of(body), observation=observation, duration_sec=round(duration, 3),
    )
    if isinstance(body, dict) and status == 200:
        profiles = body.get("profiles") if isinstance(body.get("profiles"), dict) else {}
        stats = body.get("stats") if isinstance(body.get("stats"), dict) else {}
        result.digest = profiles.get("effective_profile_sha256")
        result.artifact_id = body.get("artifact_id") if isinstance(body.get("artifact_id"), str) else None
        result.print_time_seconds = stats.get("print_time_seconds")
        result.material_used_g = stats.get("material_used_g")
        result.estimated_price_huf = stats.get("estimated_price_huf")
    return result


def evaluate_digest_stability(results: list[BambuCaseResult]) -> SupplementaryCheck:
    groups: dict[str, list[str | None]] = {}
    for result in results:
        if result.case.stability_group:
            groups.setdefault(result.case.stability_group, []).append(result.digest)
    if not groups:
        return SupplementaryCheck("effective_profile_sha256 stability", "NOT_RUN", False, "no pair recorded")
    for group, digests in groups.items():
        if len(digests) < 2 or any(not is_lower_hex_sha256(digest) for digest in digests):
            return SupplementaryCheck(
                "effective_profile_sha256 stability", "FAIL", False,
                f"{group}: an identical request did not return a valid digest",
            )
        if len(set(digests)) != 1:
            return SupplementaryCheck(
                "effective_profile_sha256 stability", "FAIL", False,
                f"{group}: identical requests returned different digests",
            )
    return SupplementaryCheck(
        "effective_profile_sha256 stability", "PASS", True,
        "identical requests returned one identical lowercase 64-hex digest",
    )


def evaluate_artifact_retention(
    results: list[BambuCaseResult], base_url: str, artifact_keys: list[str],
) -> SupplementaryCheck:
    artifact_ids = [result.artifact_id for result in results if result.success and result.artifact_id]
    if not artifact_keys:
        return SupplementaryCheck(
            "retained .gcode.3mf artifacts", "SKIPPED", True,
            "ARTIFACT_API_KEY runner input unavailable; listing not verified",
        )
    if not artifact_ids:
        return SupplementaryCheck(
            "retained .gcode.3mf artifacts", "FAIL", False, "no successful slice produced an artifact id",
        )
    status, body = 0, None
    for key in artifact_keys:
        status, body = curl_json(method="GET", base_url=base_url, endpoint=OUTPUT_FILES_ENDPOINT, api_key=key)
        if status == 200:
            break
    files = body.get("files") if isinstance(body, dict) else None
    if status != 200 or not isinstance(files, list):
        return SupplementaryCheck(
            "retained .gcode.3mf artifacts", str(status), False, "artifact listing unavailable",
        )
    names = [item.get("fileName") for item in files if isinstance(item, dict) and isinstance(item.get("fileName"), str)]
    missing = [
        artifact_id for artifact_id in artifact_ids
        if not any(artifact_id in name and name.endswith(ARTIFACT_SUFFIX) for name in names)
    ]
    if missing:
        return SupplementaryCheck(
            "retained .gcode.3mf artifacts", "FAIL", False,
            f"{len(missing)} of {len(artifact_ids)} artifacts are not listed with a {ARTIFACT_SUFFIX} name",
        )
    return SupplementaryCheck(
        "retained .gcode.3mf artifacts", "PASS", True,
        f"all {len(artifact_ids)} successful artifacts are listed with a {ARTIFACT_SUFFIX} name",
    )


def write_report(
    base_url: str, fixture_source: str, results: list[BambuCaseResult], checks: list[SupplementaryCheck],
) -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    passed = sum(1 for result in results if result.success) + sum(1 for check in checks if check.success)
    total = len(results) + len(checks)
    lines = [
        "# Full API Bambu FDM Test Report", "",
        f"Generated at (UTC): **{datetime.now(timezone.utc).isoformat()}**",
        f"Target class: **{report_target_class(base_url)}**",
        f"Fixture source: **{fixture_source}**",
        f"Total checks: **{total}**", f"Passed: **{passed}**", f"Failed: **{total - passed}**", "",
        "## Evidence boundary", "",
        "This runner exercises `POST /bambu/slice` over generated fixtures and validates the "
        "public success/rejection contract, the measured inclusive build envelopes, pricing "
        "consistency with `GET /pricing`, digest stability, and artifact retention. It does not "
        "prove native binary identity, deployment state, or calibration accuracy.", "",
        "No base URL, hostname, credential, private path, or customer file name is retained.", "",
        "| # | Kind | Case | Fixture | Printer | Layer | Material | Supports | Status | Result | Time (s) | Mass (g) | Price (HUF) | ErrorCode | Observation |",
        "|---:|:-----|:-----|:--------|:-------:|------:|:--------:|:--------:|------:|:------:|---------:|---------:|------------:|:----------|:------------|",
    ]
    for result in results:
        case = result.case
        lines.append(
            f"| {result.index} | {case.kind} | {case.name} | `{case.fixture_label}` | {case.printer} | "
            f"{case.layer_height} | {case.material} | {case.supports} | {result.http_status} | "
            f"{'PASS' if result.success else 'FAIL'} | {_cell(result.print_time_seconds)} | "
            f"{_cell(result.material_used_g)} | {_cell(result.estimated_price_huf)} | "
            f"{result.error_code or '-'} | {result.observation} |"
        )
    lines.extend(["", "## Supplementary checks", "", "| Check | Status | Result | Observation |", "|:------|:------:|:------:|:------------|"])
    for check in checks:
        lines.append(f"| {check.name} | `{check.status}` | {'PASS' if check.success else 'FAIL'} | {check.observation} |")
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _cell(value: object) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"{float(value):.2f}"
    return "-"


def main() -> int:
    base_url = resolve_base_url(PROJECT_ROOT)
    api_key = resolve_slice_service_api_key(PROJECT_ROOT)
    print(f"[BAMBU FDM TEST] slice_service_api_key_found={bool(api_key)}")
    if not api_key:
        print("[BAMBU FDM TEST] ERROR: SLICE_SERVICE_API_KEY not found in .env or process environment.")
        return 1
    artifact_keys = resolve_artifact_api_key_candidates(PROJECT_ROOT)
    legacy_files = discover_test_files(TESTING_FILES_ROOT)
    fixture_source = (
        f"synthetic fixtures plus {len(legacy_files)} legacy corpus file(s)"
        if legacy_files else "synthetic fixtures only (tests/testing-files is empty)"
    )
    pricing_map = fetch_pricing_map(base_url)
    results: list[BambuCaseResult] = []
    with tempfile.TemporaryDirectory(prefix="bambu-fdm-fixtures-") as temp_dir_name:
        try:
            fixtures = write_synthetic_fixtures(Path(temp_dir_name))
        except ValueError as error:
            print(f"[BAMBU FDM TEST] ERROR: synthetic fixture precondition failed: {error}")
            return 1
        cases = build_cases(fixtures, legacy_files)
        print(f"[BAMBU FDM TEST] fixture_source={fixture_source} cases={len(cases)}")
        for index, case in enumerate(cases, 1):
            print(f"[BAMBU FDM TEST] #{index} {case.kind}: {case.name}")
            result = run_case(index, case, base_url, api_key, pricing_map)
            results.append(result)
            print(
                f"[BAMBU FDM TEST]    status={result.http_status} success={result.success} "
                f"errorCode={result.error_code} duration={result.duration_sec:.2f}s :: {result.observation}"
            )
            if index < len(cases):
                time.sleep(SLEEP_SECONDS)
    checks = [
        evaluate_digest_stability(results),
        evaluate_artifact_retention(results, base_url, artifact_keys),
    ]
    write_report(base_url, fixture_source, results, checks)
    failed = [result for result in results if not result.success] + [check for check in checks if not check.success]
    print(f"[BAMBU FDM TEST] Completed. total={len(results) + len(checks)} failed={len(failed)}")
    print(f"[BAMBU FDM TEST] Report: {REPORT_PATH}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
