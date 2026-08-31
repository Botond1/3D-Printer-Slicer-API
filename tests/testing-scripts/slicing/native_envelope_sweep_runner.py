"""Measure inclusive native slicing envelopes through the candidate HTTP API.

This owner-run J3B runner brackets each published axis ceiling at 0.1 mm,
reproduces both endpoints twice, and records the largest passing value plus the
first failing value.  Every generated ASCII STL is independently measured,
has validated outward non-zero facet normals, and must pass an exact
``prusa-slicer --info`` precondition immediately before it is uploaded.

The native-info executable may run directly on the host or through an explicit
container command supplied as a JSON string array.  Commands are executed
without a shell and their output, paths, and arguments are never persisted.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping, Sequence
from urllib.parse import urlsplit


SCRIPT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_ROOT.parent))
PROJECT_ROOT = SCRIPT_ROOT.parent.parent.parent
RESULTS_DIR = SCRIPT_ROOT.parent / "results"
REPORT_PATH = RESULTS_DIR / "native_envelope_sweep_result.md"
MEASUREMENT_REPORT_PATH = RESULTS_DIR / "native_envelope_sweep_measurement_result.md"

from common.env_utils import resolve_base_url, resolve_slice_service_api_key
from common.http_utils import curl_json, curl_multipart_slice


AXES = ("x", "y", "z")
LAYER_HEIGHTS = (0.1, 0.2, 0.3)
XY_SWEEP_LAYER_HEIGHT = 0.2
MATERIAL = "PLA"
FIXED_CROSS_AXIS_MM = 60.0
GRID_STEP_MM = 0.1
REPETITIONS_PER_ENDPOINT = 2
MAX_HTTP_ATTEMPTS = 3
DEFAULT_RETRY_WAIT_SECONDS = 20
NATIVE_INFO_TIMEOUT_SECONDS = 60
DIMENSION_TOLERANCE_MM = 0.01
NUMBER_PATTERN = r"([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)"
DEFAULT_NATIVE_INFO_COMMAND = ("prusa-slicer", "--info", "{fixture}")
NATIVE_INFO_COMMAND_ENV = "SLICER_NATIVE_INFO_COMMAND_JSON"
MODEL_TRANSFORM_KEYS = frozenset({
    "transform_schema", "size_unit", "keep_proportions", "requested_size",
    "scale_percent", "scale_factors", "orientation_mode", "orientation_outcome",
    "automatic_orientation_applied", "automatic_rotation_deg",
    "requested_rotation_deg", "rotation_deg", "automatic_rotation_matrix",
    "rotation_matrix", "original_dimensions_available", "original_dimensions_mm",
    "oriented_dimensions_mm", "final_dimensions_mm",
})
IDENTITY_ROTATION_MATRIX = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


@dataclass(frozen=True)
class ProfileSpec:
    """One public engine/profile selector and its expected inclusive boundary."""

    key: str
    engine: str
    printer: str
    selector_fields: Mapping[str, str]
    declared_dimensions_mm: Mapping[str, float]
    expected_largest_passing_mm: Mapping[str, float]

    @property
    def endpoint(self) -> str:
        return f"/{self.engine}/slice"


@dataclass(frozen=True)
class SweepCase:
    """One 0.1 mm bracket for an engine/profile axis and layer height."""

    profile: ProfileSpec
    axis: str
    layer_height: float
    pass_value_mm: float
    fail_value_mm: float
    expected_rejection_stage: str
    expected_validation_ceiling_mm: Mapping[str, float]

    @property
    def key(self) -> str:
        layer = format_number(self.layer_height).replace(".", "p")
        return f"{self.profile.key}-{self.axis}-layer-{layer}"


@dataclass(frozen=True)
class NativeInfoResult:
    success: bool
    observation: str


@dataclass(frozen=True)
class PhaseGuardResult:
    """Sanitized proof that the API exposes the intended A or B admission state."""

    success: bool
    observation: str


@dataclass(frozen=True)
class PointObservation:
    endpoint_kind: str
    value_mm: float
    repetition: int
    http_status: int
    error_code: str | None
    rejection_stage: str | None
    native_precondition_passed: bool
    accepted: bool
    success: bool
    observation: str


@dataclass(frozen=True)
class BracketResult:
    case: SweepCase
    observations: tuple[PointObservation, ...]
    largest_passing_mm: float | None
    first_failing_mm: float | None
    monotonic: bool
    endpoints_reproduced: bool
    success: bool
    observation: str


@dataclass(frozen=True)
class CombinedCornerResult:
    """Two reproductions at the candidate inclusive X/Y corner."""

    profile: ProfileSpec
    observations: tuple[PointObservation, ...]
    endpoints_reproduced: bool
    success: bool
    observation: str


PROFILE_SPECS = (
    ProfileSpec(
        key="prusa-p1s",
        engine="prusa",
        printer="P1S",
        selector_fields={"printerProfile": "FDM_0.2mm.ini"},
        declared_dimensions_mm={"x": 256.0, "y": 256.0, "z": 250.0},
        expected_largest_passing_mm={"x": 256.0, "y": 256.0, "z": 249.9},
    ),
    ProfileSpec(
        key="orca-p1s",
        engine="orca",
        printer="P1S",
        selector_fields={
            "printerProfile": "Bambu_P1S_0.4_nozzle.json",
            "processProfile": "FDM_0.2mm.json",
        },
        declared_dimensions_mm={"x": 256.0, "y": 256.0, "z": 250.0},
        expected_largest_passing_mm={"x": 253.9, "y": 253.9, "z": 249.9},
    ),
    ProfileSpec(
        key="prusa-h2d-quote",
        engine="prusa",
        printer="H2D-QUOTE",
        selector_fields={
            "printerProfile": "FDM_P1S_H2D_SIZE_QUOTING_0.2mm.ini",
        },
        declared_dimensions_mm={"x": 350.0, "y": 320.0, "z": 325.0},
        expected_largest_passing_mm={"x": 350.0, "y": 320.0, "z": 324.9},
    ),
    ProfileSpec(
        key="orca-h2d-quote",
        engine="orca",
        printer="H2D-QUOTE",
        selector_fields={
            "printerProfile": "Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json",
            "processProfile": "FDM_0.2mm.json",
        },
        declared_dimensions_mm={"x": 350.0, "y": 320.0, "z": 325.0},
        expected_largest_passing_mm={"x": 347.9, "y": 317.9, "z": 324.9},
    ),
)


def format_number(value: float) -> str:
    rounded = round(float(value), 6)
    if rounded.is_integer():
        return str(int(rounded))
    return f"{rounded:.6f}".rstrip("0").rstrip(".")


def _finite_positive(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value > 0
    )


def _finite_number(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _cuboid_triangles(
    dimensions_mm: Sequence[float],
) -> tuple[tuple[tuple[float, float, float], tuple[tuple[float, float, float], ...]], ...]:
    if len(dimensions_mm) != 3 or not all(_finite_positive(value) for value in dimensions_mm):
        raise ValueError("Cuboid fixture dimensions are invalid.")
    x, y, z = (float(value) for value in dimensions_mm)
    p000 = (0.0, 0.0, 0.0)
    p100 = (x, 0.0, 0.0)
    p010 = (0.0, y, 0.0)
    p110 = (x, y, 0.0)
    p001 = (0.0, 0.0, z)
    p101 = (x, 0.0, z)
    p011 = (0.0, y, z)
    p111 = (x, y, z)
    return (
        ((0.0, 0.0, -1.0), (p000, p010, p110)),
        ((0.0, 0.0, -1.0), (p000, p110, p100)),
        ((0.0, 0.0, 1.0), (p001, p101, p111)),
        ((0.0, 0.0, 1.0), (p001, p111, p011)),
        ((0.0, -1.0, 0.0), (p000, p100, p101)),
        ((0.0, -1.0, 0.0), (p000, p101, p001)),
        ((1.0, 0.0, 0.0), (p100, p110, p111)),
        ((1.0, 0.0, 0.0), (p100, p111, p101)),
        ((0.0, 1.0, 0.0), (p110, p010, p011)),
        ((0.0, 1.0, 0.0), (p110, p011, p111)),
        ((-1.0, 0.0, 0.0), (p010, p000, p001)),
        ((-1.0, 0.0, 0.0), (p010, p001, p011)),
    )


def cuboid_ascii_stl(dimensions_mm: Sequence[float], solid_name: str) -> bytes:
    """Create a deterministic 12-triangle ASCII STL with outward normals."""
    if not solid_name or not all(character.isalnum() or character == "_" for character in solid_name):
        raise ValueError("Cuboid fixture name is invalid.")
    lines = [f"solid {solid_name}"]
    for normal, vertices in _cuboid_triangles(dimensions_mm):
        lines.append("  facet normal " + " ".join(format_number(value) for value in normal))
        lines.append("    outer loop")
        for vertex in vertices:
            lines.append("      vertex " + " ".join(format_number(value) for value in vertex))
        lines.extend(("    endloop", "  endfacet"))
    lines.append(f"endsolid {solid_name}")
    return ("\n".join(lines) + "\n").encode("ascii")


def _cross(left: Sequence[float], right: Sequence[float]) -> tuple[float, float, float]:
    return (
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    )


def inspect_ascii_fixture(file_path: Path) -> dict[str, float]:
    """Validate 12 outward non-zero normals and return measured dimensions."""
    try:
        lines = file_path.read_text(encoding="ascii").splitlines()
    except (OSError, UnicodeError) as error:
        raise ValueError("Fixture is not a readable ASCII STL.") from error

    facets: list[tuple[tuple[float, float, float], tuple[tuple[float, float, float], ...]]] = []
    normal: tuple[float, float, float] | None = None
    vertices: list[tuple[float, float, float]] = []
    for line in lines:
        parts = line.strip().split()
        if not parts:
            continue
        record_kind = parts[0].lower()
        if record_kind == "facet":
            if len(parts) != 5 or parts[1].lower() != "normal" or normal is not None:
                raise ValueError("Fixture contains a malformed STL normal.")
            try:
                normal = tuple(float(value) for value in parts[2:])
            except ValueError as error:
                raise ValueError("Fixture contains a non-numeric STL normal.") from error
            vertices = []
        elif record_kind == "vertex":
            if len(parts) != 4 or normal is None:
                raise ValueError("Fixture contains a malformed STL vertex.")
            try:
                vertex = tuple(float(value) for value in parts[1:])
            except ValueError as error:
                raise ValueError("Fixture contains a non-numeric STL vertex.") from error
            vertices.append(vertex)
        elif record_kind == "endfacet":
            if normal is None or len(vertices) != 3:
                raise ValueError("Fixture contains an incomplete STL facet.")
            if any(not math.isfinite(value) for value in (*normal, *vertices[0], *vertices[1], *vertices[2])):
                raise ValueError("Fixture contains a non-finite STL coordinate.")
            facets.append((normal, tuple(vertices)))
            normal = None
            vertices = []
    if normal is not None or len(facets) != 12:
        raise ValueError("Fixture must contain exactly 12 triangles.")

    all_vertices = [vertex for _, facet in facets for vertex in facet]
    center = tuple(
        (min(vertex[index] for vertex in all_vertices)
         + max(vertex[index] for vertex in all_vertices)) / 2
        for index in range(3)
    )
    for stored_normal, facet in facets:
        edge_a = tuple(facet[1][index] - facet[0][index] for index in range(3))
        edge_b = tuple(facet[2][index] - facet[0][index] for index in range(3))
        geometric = _cross(edge_a, edge_b)
        stored_length = math.sqrt(sum(value * value for value in stored_normal))
        geometric_length = math.sqrt(sum(value * value for value in geometric))
        if stored_length <= 0 or geometric_length <= 0:
            raise ValueError("Fixture contains a zero normal or degenerate facet.")
        alignment = sum(stored_normal[index] * geometric[index] for index in range(3))
        if alignment / (stored_length * geometric_length) < 1 - 1e-9:
            raise ValueError("Fixture normal does not match its vertex winding.")
        centroid = tuple(sum(vertex[index] for vertex in facet) / 3 for index in range(3))
        outward = sum(
            stored_normal[index] * (centroid[index] - center[index])
            for index in range(3)
        )
        if outward <= 0:
            raise ValueError("Fixture normal is not outward-facing.")

    dimensions = {
        axis: max(vertex[index] for vertex in all_vertices)
        - min(vertex[index] for vertex in all_vertices)
        for index, axis in enumerate(AXES)
    }
    if not all(_finite_positive(value) for value in dimensions.values()):
        raise ValueError("Fixture has a non-positive measured dimension.")
    return {axis: round(float(dimensions[axis]), 6) for axis in AXES}


def dimensions_close(left: object, right: object) -> bool:
    return (
        isinstance(left, Mapping)
        and isinstance(right, Mapping)
        and set(left) == set(AXES)
        and set(right) == set(AXES)
        and all(
            _finite_positive(left[axis])
            and _finite_positive(right[axis])
            and abs(float(left[axis]) - float(right[axis])) <= DIMENSION_TOLERANCE_MM
            for axis in AXES
        )
    )


def exact_dimensions(left: object, right: object) -> bool:
    """Require the exact numeric X/Y/Z tuple advertised by the candidate API."""
    return (
        isinstance(left, Mapping)
        and isinstance(right, Mapping)
        and set(left) == set(AXES)
        and set(right) == set(AXES)
        and all(
            _finite_positive(left[axis])
            and _finite_positive(right[axis])
            and float(left[axis]) == float(right[axis])
            for axis in AXES
        )
    )


def validate_catalogue_phase(body: object, phase: str) -> PhaseGuardResult:
    """Bind the sweep to an exact measurement-A or final-admission-B catalogue."""
    if phase not in {"native-measurement", "final-admission"}:
        return PhaseGuardResult(False, "phase_unknown")
    if (
        not isinstance(body, dict)
        or body.get("schema") != "r3d-profile-catalogue-v2"
        or not isinstance(body.get("profiles"), list)
    ):
        return PhaseGuardResult(False, "catalogue_v2_unavailable")
    expected_profiles = (
        tuple(profile for profile in PROFILE_SPECS if profile.printer == "H2D-QUOTE")
        if phase == "native-measurement"
        else PROFILE_SPECS
    )
    for profile in expected_profiles:
        expected_material = MATERIAL if profile.engine == "orca" else None
        matches = [
            entry for entry in body["profiles"]
            if isinstance(entry, dict)
            and entry.get("engine") == profile.engine
            and isinstance(entry.get("printer"), dict)
            and entry["printer"].get("id") == profile.printer
            and entry.get("layer_height_mm") == XY_SWEEP_LAYER_HEIGHT
            and entry.get("material") == expected_material
        ]
        if len(matches) != 1:
            return PhaseGuardResult(False, "catalogue_selector_not_unique")
        limits = matches[0].get("build_volume_limits_mm")
        expected_largest = (
            profile.declared_dimensions_mm
            if phase == "native-measurement"
            else profile.expected_largest_passing_mm
        )
        if (
            not isinstance(limits, dict)
            or set(limits) != {
                "minimum_dimensions_inclusive_mm",
                "declared_build_volume_dimensions_mm",
                "largest_passing_dimensions_inclusive_mm",
                "source_profile",
                "declared_source_kind",
            }
            or not exact_dimensions(
                limits.get("declared_build_volume_dimensions_mm"),
                profile.declared_dimensions_mm,
            )
            or not exact_dimensions(
                limits.get("largest_passing_dimensions_inclusive_mm"),
                expected_largest,
            )
            or limits.get("source_profile")
            != profile.selector_fields.get("printerProfile")
            or limits.get("declared_source_kind") != "profile-explicit"
        ):
            return PhaseGuardResult(False, "catalogue_phase_envelope_mismatch")
    return PhaseGuardResult(
        True,
        "declared_admission_measurement_a_verified"
        if phase == "native-measurement"
        else "published_admission_final_b_verified",
    )


def parse_native_info_command(raw_json: str | None) -> tuple[str, ...]:
    """Parse a no-shell native/container command with bounded placeholders."""
    if raw_json is None or not raw_json.strip():
        return DEFAULT_NATIVE_INFO_COMMAND
    try:
        parsed = json.loads(raw_json)
    except json.JSONDecodeError as error:
        raise ValueError("Native-info command must be a JSON string array.") from error
    if (
        not isinstance(parsed, list)
        or not 1 <= len(parsed) <= 64
        or any(
            not isinstance(token, str)
            or not 1 <= len(token) <= 4096
            or any(character in token for character in ("\0", "\r", "\n"))
            for token in parsed
        )
    ):
        raise ValueError("Native-info command must be a bounded JSON string array.")
    joined = "\0".join(parsed)
    if "{fixture}" not in joined and not (
        "{fixture_dir}" in joined and "{fixture_name}" in joined
    ):
        raise ValueError("Native-info command must address the generated fixture.")
    allowed_placeholders = {"{fixture}", "{fixture_dir}", "{fixture_name}"}
    for token in parsed:
        remainder = token
        for placeholder in allowed_placeholders:
            remainder = remainder.replace(placeholder, "")
        if "{" in remainder or "}" in remainder:
            raise ValueError("Native-info command contains an unknown placeholder.")
    return tuple(parsed)


def expand_native_info_command(template: Sequence[str], fixture_path: Path) -> list[str]:
    replacements = {
        "{fixture}": str(fixture_path),
        "{fixture_dir}": str(fixture_path.parent),
        "{fixture_name}": fixture_path.name,
    }
    return [
        _replace_placeholders(token, replacements)
        for token in template
    ]


def native_info_environment(source: Mapping[str, str] | None = None) -> dict[str, str]:
    """Mirror the production native-child allowlist without application secrets."""
    parent = os.environ if source is None else source
    windows = sys.platform == "win32"
    keys = (
        "PATH", "SystemRoot", "WINDIR", "PATHEXT", "TEMP", "TMP",
        "LANG", "LC_ALL", "LC_CTYPE",
    ) if windows else ("PATH", "LANG", "LC_ALL", "LC_CTYPE")

    def read_value(name: str) -> str | None:
        if name in parent:
            return parent[name]
        if not windows:
            return None
        actual = next(
            (candidate for candidate in parent if candidate.lower() == name.lower()),
            None,
        )
        return parent.get(actual) if actual else None

    environment = {
        name: value
        for name in keys
        if (value := read_value(name))
    }
    if not windows:
        environment.update({
            "TMPDIR": "/tmp",
            "TEMP": "/tmp",
            "TMP": "/tmp",
            "HOME": "/tmp/slicer-home",
            "XDG_CACHE_HOME": "/tmp/xdg-cache",
            "XDG_CONFIG_HOME": "/tmp/xdg-config",
            "XDG_RUNTIME_DIR": "/tmp/xdg-runtime",
        })
    environment.update({
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
        "PYTHONUNBUFFERED": "1",
        "PYTHONUTF8": "1",
    })
    return environment


def _replace_placeholders(token: str, replacements: Mapping[str, str]) -> str:
    result = token
    for placeholder, value in replacements.items():
        result = result.replace(placeholder, value)
    return result


def run_native_info_precondition(
    template: Sequence[str],
    fixture_path: Path,
    expected_dimensions_mm: Mapping[str, float],
) -> NativeInfoResult:
    """Require native acceptance and exact size reporting before HTTP upload."""
    command = expand_native_info_command(template, fixture_path)
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=NATIVE_INFO_TIMEOUT_SECONDS,
            check=False,
            env=native_info_environment(),
        )
    except (OSError, subprocess.TimeoutExpired):
        return NativeInfoResult(False, "native_info_command_unavailable_or_timed_out")
    if completed.returncode != 0:
        return NativeInfoResult(False, "native_info_rejected_fixture")
    output = f"{completed.stdout}\n{completed.stderr}"
    measured: dict[str, float] = {}
    for axis in AXES:
        match = re.search(rf"size_{axis}\s*=\s*{NUMBER_PATTERN}", output, re.IGNORECASE)
        if match is None:
            return NativeInfoResult(False, "native_info_dimensions_missing")
        measured[axis] = float(match.group(1))
    if not dimensions_close(measured, expected_dimensions_mm):
        return NativeInfoResult(False, "native_info_dimensions_mismatch")
    return NativeInfoResult(True, "native_info_exact_dimensions_valid")


def build_sweep_cases(phase: str = "final-admission") -> tuple[SweepCase, ...]:
    if phase not in {"native-measurement", "final-admission"}:
        raise ValueError("Unknown native envelope sweep phase.")
    cases: list[SweepCase] = []
    profiles = (
        tuple(profile for profile in PROFILE_SPECS if profile.printer == "H2D-QUOTE")
        if phase == "native-measurement" else PROFILE_SPECS
    )
    for profile in profiles:
        expected_validation_ceiling = (
            profile.declared_dimensions_mm
            if phase == "native-measurement"
            else profile.expected_largest_passing_mm
        )
        for axis in ("x", "y"):
            passing = float(profile.expected_largest_passing_mm[axis])
            expected_stage = (
                "native_safety_net"
                if phase == "native-measurement" and profile.engine == "orca"
                else "request_prevalidation"
            )
            cases.append(SweepCase(
                profile=profile,
                axis=axis,
                layer_height=XY_SWEEP_LAYER_HEIGHT,
                pass_value_mm=passing,
                fail_value_mm=round(passing + GRID_STEP_MM, 6),
                expected_rejection_stage=expected_stage,
                expected_validation_ceiling_mm=expected_validation_ceiling,
            ))
        for layer_height in LAYER_HEIGHTS:
            at_declared_divisible_layer = (
                phase == "native-measurement" and layer_height in {0.1, 0.2}
            )
            passing = (
                float(profile.declared_dimensions_mm["z"])
                if at_declared_divisible_layer
                else float(profile.expected_largest_passing_mm["z"])
            )
            expected_stage = (
                "native_safety_net"
                if phase == "native-measurement" and layer_height == 0.3
                else "request_prevalidation"
            )
            cases.append(SweepCase(
                profile=profile,
                axis="z",
                layer_height=layer_height,
                pass_value_mm=passing,
                fail_value_mm=round(passing + GRID_STEP_MM, 6),
                expected_rejection_stage=expected_stage,
                expected_validation_ceiling_mm=expected_validation_ceiling,
            ))
    return tuple(cases)


def is_complete_run(
    phase: str,
    health_success: bool,
    phase_guard_success: bool,
    results: Sequence[BracketResult],
    corners: Sequence[CombinedCornerResult],
) -> bool:
    """Apply exact phase-specific cardinality and success requirements."""
    expected_cases = build_sweep_cases(phase)
    expected_profile_keys = {case.profile.key for case in expected_cases}
    return (
        health_success
        and phase_guard_success
        and len(results) == len(expected_cases)
        and all(result.success for result in results)
        and len(corners) == len(expected_profile_keys)
        and {corner.profile.key for corner in corners} == expected_profile_keys
        and all(corner.success for corner in corners)
    )


def fixture_dimensions(case: SweepCase, value_mm: float) -> dict[str, float]:
    dimensions = {axis: FIXED_CROSS_AXIS_MM for axis in AXES}
    dimensions[case.axis] = value_mm
    return dimensions


def build_request_fields(case: SweepCase) -> dict[str, str]:
    fields = {
        "infill": "0",
        "sizeUnit": "mm",
        "keepProportions": "true",
        "scalePercent": "100",
        "rotationX": "0",
        "rotationY": "0",
        "rotationZ": "0",
        "orientationMode": "preserve",
        **dict(case.profile.selector_fields),
    }
    if case.profile.engine == "orca":
        fields["processProfile"] = f"FDM_{format_number(case.layer_height)}mm.json"
    elif case.profile.engine == "prusa":
        if case.profile.printer == "P1S":
            fields["printerProfile"] = f"FDM_{format_number(case.layer_height)}mm.ini"
        else:
            fields["printerProfile"] = (
                f"FDM_P1S_H2D_SIZE_QUOTING_{format_number(case.layer_height)}mm.ini"
            )
    return fields


def expected_source_profile(case: SweepCase) -> str:
    """Return the exact printer profile selected by this request.

    Prusa changes the printer profile with layer height, while Orca keeps the
    machine profile stable and changes only its process profile.  K2 reports
    the printer/machine profile as the authoritative bounds source.
    """
    return build_request_fields(case)["printerProfile"]


def _zero_rotation(value: object) -> bool:
    return (
        isinstance(value, Mapping)
        and set(value) == set(AXES)
        and all(_finite_number(value[axis]) and float(value[axis]) == 0 for axis in AXES)
    )


def _identity_matrix(value: object) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 3
        and all(isinstance(row, list) and len(row) == 3 for row in value)
        and all(
            _finite_number(value[row][column])
            and float(value[row][column]) == IDENTITY_ROTATION_MATRIX[row][column]
            for row in range(3)
            for column in range(3)
        )
    )


def validate_preserve_transform(
    transform: object,
    expected_dimensions_mm: Mapping[str, float],
) -> bool:
    """Validate the complete schema-v2 transform for a normal preserve fixture."""
    if not isinstance(transform, dict) or set(transform) != MODEL_TRANSFORM_KEYS:
        return False
    requested_size = transform.get("requested_size")
    scale_factors = transform.get("scale_factors")
    return (
        transform.get("transform_schema") == 2
        and transform.get("size_unit") == "mm"
        and transform.get("keep_proportions") is True
        and isinstance(requested_size, dict)
        and set(requested_size) == set(AXES)
        and all(requested_size[axis] is None for axis in AXES)
        and transform.get("scale_percent") == 100
        and isinstance(scale_factors, dict)
        and set(scale_factors) == set(AXES)
        and all(_finite_number(scale_factors[axis]) and float(scale_factors[axis]) == 1
                for axis in AXES)
        and transform.get("orientation_mode") == "preserve"
        and transform.get("orientation_outcome") == "preserved"
        and transform.get("automatic_orientation_applied") is False
        and _zero_rotation(transform.get("automatic_rotation_deg"))
        and _zero_rotation(transform.get("requested_rotation_deg"))
        and _zero_rotation(transform.get("rotation_deg"))
        and _identity_matrix(transform.get("automatic_rotation_matrix"))
        and _identity_matrix(transform.get("rotation_matrix"))
        and transform.get("original_dimensions_available") is True
        and dimensions_close(transform.get("original_dimensions_mm"), expected_dimensions_mm)
        and dimensions_close(transform.get("oriented_dimensions_mm"), expected_dimensions_mm)
        and dimensions_close(transform.get("final_dimensions_mm"), expected_dimensions_mm)
    )


def validate_k2_build_limits(
    limits: object,
    expected_dimensions_mm: Mapping[str, float],
    rejection_stage: str,
    expected_validation_ceiling_mm: Mapping[str, float],
    expected_source_profile: str,
) -> bool:
    """Validate exact K2 build-limit shape and the claimed rejection stage."""
    if (
        not isinstance(limits, dict)
        or set(limits) != {"min", "max", "source_profile"}
        or not isinstance(limits.get("min"), Mapping)
        or not isinstance(limits.get("max"), Mapping)
        or set(limits["min"]) != set(AXES)
        or set(limits["max"]) != set(AXES)
        or not all(_finite_positive(limits["min"][axis]) for axis in AXES)
        or not all(_finite_positive(limits["max"][axis]) for axis in AXES)
        or not isinstance(limits.get("source_profile"), str)
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", limits["source_profile"])
        or limits["source_profile"] != expected_source_profile
        or not exact_dimensions(limits["max"], expected_validation_ceiling_mm)
    ):
        return False
    within_validation_ceiling = all(
        float(expected_dimensions_mm[axis]) <= float(limits["max"][axis])
        for axis in AXES
    )
    return (
        within_validation_ceiling
        if rejection_stage == "native_safety_net"
        else not within_validation_ceiling
    )


def validate_http_point(
    endpoint_kind: str,
    expected_dimensions_mm: Mapping[str, float],
    status: int,
    body: object,
    expected_validation_ceiling_mm: Mapping[str, float] | None = None,
    expected_source_profile: str | None = None,
) -> tuple[bool, bool, str | None, str | None, str]:
    """Validate a passing success or the first controlled bounds rejection."""
    if not isinstance(body, dict):
        return False, False, None, None, "response_not_json_object"
    error_code = body.get("errorCode") if isinstance(body.get("errorCode"), str) else None
    error_message = body.get("error") if isinstance(body.get("error"), str) else ""
    rejection_stage = None
    if status == 422 and error_code == "MODEL_OUT_OF_PRINTER_BOUNDS":
        rejection_stage = (
            "native_safety_net"
            if "native slicer could not place" in error_message.lower()
            else "request_prevalidation"
        )
    if endpoint_kind == "pass":
        transform = body.get("model_transform")
        success = (
            status == 200
            and body.get("success") is True
            and validate_preserve_transform(transform, expected_dimensions_mm)
            and (
                expected_validation_ceiling_mm is None
                or validate_k2_build_limits(
                    body.get("build_volume_limits_mm"),
                    expected_dimensions_mm,
                    "native_safety_net",
                    expected_validation_ceiling_mm,
                    expected_source_profile or "",
                )
            )
        )
        return success, success, error_code, rejection_stage, (
            "accepted_exact_dimensions" if success else "expected_boundary_acceptance_missing"
        )
    rejected = (
        status == 422
        and body.get("success") is False
        and error_code == "MODEL_OUT_OF_PRINTER_BOUNDS"
        and dimensions_close(body.get("model_dimensions_mm"), expected_dimensions_mm)
        and validate_preserve_transform(body.get("model_transform"), expected_dimensions_mm)
        and rejection_stage in {"request_prevalidation", "native_safety_net"}
        and validate_k2_build_limits(
            body.get("build_volume_limits_mm"),
            expected_dimensions_mm,
            rejection_stage,
            expected_validation_ceiling_mm
            or body.get("build_volume_limits_mm", {}).get("max", {}),
            expected_source_profile
            or body.get("build_volume_limits_mm", {}).get("source_profile", ""),
        )
    )
    return rejected, False, error_code, rejection_stage, (
        "controlled_first_failure" if rejected else "expected_first_failure_missing"
    )


def _retry_wait_seconds(body: object) -> int:
    if isinstance(body, dict):
        try:
            value = int(body.get("retryAfterSeconds") or DEFAULT_RETRY_WAIT_SECONDS)
        except (TypeError, ValueError):
            value = DEFAULT_RETRY_WAIT_SECONDS
        return max(1, min(value, 60))
    return DEFAULT_RETRY_WAIT_SECONDS


def run_point(
    base_url: str,
    slice_service_api_key: str,
    native_template: Sequence[str],
    case: SweepCase,
    endpoint_kind: str,
    value_mm: float,
    repetition: int,
    directory: Path,
) -> PointObservation:
    dimensions = fixture_dimensions(case, value_mm)
    fixture_name = (
        f"{case.key}_{endpoint_kind}_{repetition}_{format_number(value_mm).replace('.', 'p')}"
    ).replace("-", "_")
    fixture_path = directory / f"{fixture_name}.stl"
    fixture_path.write_bytes(cuboid_ascii_stl(
        tuple(dimensions[axis] for axis in AXES), fixture_name,
    ))
    try:
        measured = inspect_ascii_fixture(fixture_path)
    except ValueError:
        return PointObservation(
            endpoint_kind, value_mm, repetition, 0, "FIXTURE_INVALID", None, False,
            False, False, "fixture_geometry_or_normals_invalid",
        )
    if not dimensions_close(measured, dimensions):
        return PointObservation(
            endpoint_kind, value_mm, repetition, 0, "FIXTURE_INVALID", None, False,
            False, False, "fixture_dimensions_mismatch",
        )
    status = 0
    body: object = None
    for attempt in range(1, MAX_HTTP_ATTEMPTS + 1):
        native = run_native_info_precondition(native_template, fixture_path, dimensions)
        if not native.success:
            return PointObservation(
                endpoint_kind, value_mm, repetition, 0,
                "NATIVE_FIXTURE_PRECONDITION_FAILED", None, False, False, False,
                native.observation,
            )
        status, body, _ = curl_multipart_slice(
            base_url=base_url,
            endpoint=case.profile.endpoint,
            file_path=fixture_path,
            layer_height=case.layer_height,
            material=MATERIAL,
            slice_service_api_key=slice_service_api_key,
            extra_fields=build_request_fields(case),
        )
        if status != 429 or attempt == MAX_HTTP_ATTEMPTS:
            break
        time.sleep(_retry_wait_seconds(body))
    success, accepted, error_code, rejection_stage, observation = validate_http_point(
        endpoint_kind,
        dimensions,
        status,
        body,
        case.expected_validation_ceiling_mm,
        expected_source_profile(case),
    )
    return PointObservation(
        endpoint_kind, value_mm, repetition, status, error_code, rejection_stage,
        True, accepted, success, observation,
    )


def evaluate_bracket(
    case: SweepCase,
    observations: Sequence[PointObservation],
) -> BracketResult:
    pass_rows = [row for row in observations if row.endpoint_kind == "pass"]
    fail_rows = [row for row in observations if row.endpoint_kind == "fail"]
    pass_reproduced = (
        len(pass_rows) == REPETITIONS_PER_ENDPOINT
        and all(row.success and row.accepted for row in pass_rows)
    )
    fail_reproduced = (
        len(fail_rows) == REPETITIONS_PER_ENDPOINT
        and all(
            row.success
            and not row.accepted
            and row.rejection_stage == case.expected_rejection_stage
            for row in fail_rows
        )
    )
    monotonic = (
        case.pass_value_mm < case.fail_value_mm
        and all(row.accepted for row in pass_rows)
        and all(not row.accepted for row in fail_rows)
    )
    endpoints_reproduced = pass_reproduced and fail_reproduced
    success = endpoints_reproduced and monotonic
    return BracketResult(
        case=case,
        observations=tuple(observations),
        largest_passing_mm=case.pass_value_mm if pass_reproduced else None,
        first_failing_mm=case.fail_value_mm if fail_reproduced else None,
        monotonic=monotonic,
        endpoints_reproduced=endpoints_reproduced,
        success=success,
        observation="largest_pass_and_first_fail_reproduced" if success
        else "bracket_not_established",
    )


def run_bracket(
    base_url: str,
    slice_service_api_key: str,
    native_template: Sequence[str],
    case: SweepCase,
    directory: Path,
) -> BracketResult:
    observations = []
    for endpoint_kind, value in (
        ("pass", case.pass_value_mm),
        ("fail", case.fail_value_mm),
    ):
        for repetition in range(1, REPETITIONS_PER_ENDPOINT + 1):
            observations.append(run_point(
                base_url, slice_service_api_key, native_template, case,
                endpoint_kind, value, repetition, directory,
            ))
    return evaluate_bracket(case, observations)


def run_combined_corner(
    base_url: str,
    slice_service_api_key: str,
    native_template: Sequence[str],
    profile: ProfileSpec,
    directory: Path,
    phase: str = "final-admission",
) -> CombinedCornerResult:
    """Require the candidate X/Y pair to pass together, not only per axis."""
    case = SweepCase(
        profile=profile,
        axis="x",
        layer_height=XY_SWEEP_LAYER_HEIGHT,
        pass_value_mm=float(profile.expected_largest_passing_mm["x"]),
        fail_value_mm=float(profile.expected_largest_passing_mm["x"]) + GRID_STEP_MM,
        expected_rejection_stage="request_prevalidation",
        expected_validation_ceiling_mm=(
            profile.declared_dimensions_mm
            if phase == "native-measurement"
            else profile.expected_largest_passing_mm
        ),
    )
    dimensions = {
        "x": float(profile.expected_largest_passing_mm["x"]),
        "y": float(profile.expected_largest_passing_mm["y"]),
        "z": FIXED_CROSS_AXIS_MM,
    }
    observations: list[PointObservation] = []
    for repetition in range(1, REPETITIONS_PER_ENDPOINT + 1):
        fixture_name = f"{profile.key}_combined_xy_{repetition}".replace("-", "_")
        fixture_path = directory / f"{fixture_name}.stl"
        fixture_path.write_bytes(cuboid_ascii_stl(
            tuple(dimensions[axis] for axis in AXES), fixture_name,
        ))
        try:
            measured = inspect_ascii_fixture(fixture_path)
        except ValueError:
            observations.append(PointObservation(
                "corner", dimensions["x"], repetition, 0, "FIXTURE_INVALID",
                None, False, False, False, "fixture_geometry_or_normals_invalid",
            ))
            continue
        if not dimensions_close(measured, dimensions):
            observations.append(PointObservation(
                "corner", dimensions["x"], repetition, 0, "FIXTURE_INVALID",
                None, False, False, False, "fixture_dimensions_mismatch",
            ))
            continue
        status = 0
        body: object = None
        precondition_failure: NativeInfoResult | None = None
        for attempt in range(1, MAX_HTTP_ATTEMPTS + 1):
            native = run_native_info_precondition(native_template, fixture_path, dimensions)
            if not native.success:
                precondition_failure = native
                break
            status, body, _ = curl_multipart_slice(
                base_url=base_url,
                endpoint=profile.endpoint,
                file_path=fixture_path,
                layer_height=case.layer_height,
                material=MATERIAL,
                slice_service_api_key=slice_service_api_key,
                extra_fields=build_request_fields(case),
            )
            if status != 429 or attempt == MAX_HTTP_ATTEMPTS:
                break
            time.sleep(_retry_wait_seconds(body))
        if precondition_failure is not None:
            observations.append(PointObservation(
                "corner", dimensions["x"], repetition, 0,
                "NATIVE_FIXTURE_PRECONDITION_FAILED", None, False, False, False,
                precondition_failure.observation,
            ))
            continue
        success, accepted, error_code, rejection_stage, observation = validate_http_point(
            "pass",
            dimensions,
            status,
            body,
            case.expected_validation_ceiling_mm,
            expected_source_profile(case),
        )
        observations.append(PointObservation(
            "corner", dimensions["x"], repetition, status, error_code,
            rejection_stage, True, accepted, success, observation,
        ))
    reproduced = (
        len(observations) == REPETITIONS_PER_ENDPOINT
        and all(row.success and row.accepted for row in observations)
    )
    return CombinedCornerResult(
        profile=profile,
        observations=tuple(observations),
        endpoints_reproduced=reproduced,
        success=reproduced,
        observation="combined_xy_corner_reproduced" if reproduced
        else "combined_xy_corner_unestablished",
    )


def report_target_class(base_url: str) -> str:
    try:
        hostname = urlsplit(base_url).hostname
    except ValueError:
        return "invalid-redacted"
    if not hostname:
        return "invalid-redacted"
    if hostname.lower() == "localhost":
        return "local-loopback"
    try:
        return "local-loopback" if ipaddress.ip_address(hostname).is_loopback else "external-redacted"
    except ValueError:
        return "external-redacted"


def _summarize_endpoint(
    observations: Sequence[PointObservation], endpoint_kind: str,
) -> str:
    rows = [row for row in observations if row.endpoint_kind == endpoint_kind]
    return ", ".join(
        f"{row.http_status}/{row.error_code or '-'}"
        + (f"/{row.rejection_stage}" if row.rejection_stage else "")
        for row in rows
    ) or "NOT_RUN"


def publishable_tuple_verdict(phase: str, complete: bool) -> str:
    """Classify evidence without turning admission replay into native-edge proof."""
    complete_labels = {
        "native-measurement": "AUTHORITATIVE_NATIVE_MEASUREMENT",
        "final-admission": "PUBLISHED_ADMISSION_VERIFIED",
    }
    if phase not in complete_labels:
        raise ValueError("Unknown native envelope sweep phase.")
    return complete_labels[phase] if complete else "FAIL_CLOSED_UNESTABLISHED"


def write_report(
    base_url: str,
    health_status: int,
    health_success: bool,
    command_source: str,
    results: Sequence[BracketResult],
    corners: Sequence[CombinedCornerResult] = (),
    report_path: Path = REPORT_PATH,
    phase: str = "final-admission",
    phase_guard: PhaseGuardResult = PhaseGuardResult(False, "not_run"),
) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    passed = sum(result.success for result in results)
    precondition_total = (
        sum(len(result.observations) for result in results)
        + sum(len(result.observations) for result in corners)
    )
    precondition_passed = sum(
        observation.native_precondition_passed
        for result in results
        for observation in result.observations
    ) + sum(
        observation.native_precondition_passed
        for result in corners
        for observation in result.observations
    )
    corner_passed = sum(result.success for result in corners)
    lines = [
        "# J3B Native Envelope Sweep Report",
        "",
        f"Generated at (UTC): **{datetime.now(timezone.utc).isoformat()}**",
        f"Target class: **{report_target_class(base_url)}**",
        f"Health preflight: **{'PASS' if health_success else 'FAIL'}** (`{health_status}`)",
        f"Exact candidate phase guard: **{'PASS' if phase_guard.success else 'FAIL'}** "
        f"(`{phase_guard.observation}`)",
        f"Native-info command source: **{command_source}**",
        f"Sweep phase: **{phase}**",
        f"Native fixture preconditions: **{precondition_passed}/{precondition_total} PASS**",
        f"Measured brackets: **{passed}/{len(results)} PASS**",
        f"Combined X/Y corners: **{corner_passed}/{len(corners)} PASS**",
        "",
        "## Evidence boundary",
        "",
        "Every result below is accepted only when this run observed the planned boundary pass "
        "and its next 0.1 mm service rejection twice each, with the required rejection stage, "
        "and the published "
        "X/Y corner passes twice. Source constants alone are not evidence. The suite uses "
        "preserve orientation, independently validates each "
        "outward-normal cuboid, and executes the configured native `prusa-slicer --info` "
        "precondition immediately before every HTTP upload. Every accepted success and bounds "
        "observation also carries the complete schema-v2 preserve transform; every 422 carries "
        "the exact full K2 build-limit payload and its dimensions agree with the claimed "
        "prevalidation or native-safety-net stage. The sweep uses 0% infill to keep the native "
        "artifact bounded; placement geometry, profile, layer height, and all envelope axes "
        "remain unchanged.",
        "",
        "No URL, hostname, IP address, credential, native command, native output, response body, "
        "or temporary path is retained.",
        "",
        "## Inclusive largest-pass / first-fail brackets",
        "",
        "For a declared Prusa X/Y boundary, `largest_passing_within_declared` is measured but "
        "the native edge beyond the declared profile remains `UNESTABLISHED`. A rejection "
        "above a declared boundary is a policy guard, not native-edge evidence. Rejections "
        "within a declared envelope are labelled as request prevalidation or native safety-net "
        "from the controlled response branch.",
        "",
        "| Profile | Engine | Axis | Layer (mm) | Largest PASS (mm) | Next service rejection (mm) | Required rejection stage | PASS observations | Rejection observations | Native edge beyond declared | Monotonic | Reproduced | Result |",
        "|:--------|:-------|:----:|-----------:|------------------:|----------------------------:|:-------------------------|:------------------|:-----------------------|:----------------------------|:---------:|:----------:|:------:|",
    ]
    for result in results:
        case = result.case
        largest = (
            format_number(result.largest_passing_mm)
            if result.largest_passing_mm is not None else "UNESTABLISHED"
        )
        first_fail = (
            format_number(result.first_failing_mm)
            if result.first_failing_mm is not None else "UNESTABLISHED"
        )
        declared_axis = float(case.profile.declared_dimensions_mm[case.axis])
        native_edge = (
            "UNESTABLISHED"
            if case.axis in {"x", "y"} and case.pass_value_mm >= declared_axis
            else "not_claimed_by_service_sweep"
        )
        lines.append(
            f"| `{case.profile.printer}` | `{case.profile.engine}` | `{case.axis}` | "
            f"`{format_number(case.layer_height)}` | `{largest}` | `{first_fail}` | "
            f"`{case.expected_rejection_stage}` | "
            f"`{_summarize_endpoint(result.observations, 'pass')}` | "
            f"`{_summarize_endpoint(result.observations, 'fail')}` | "
            f"`{native_edge}` | "
            f"{'PASS' if result.monotonic else 'FAIL'} | "
            f"{'PASS' if result.endpoints_reproduced else 'FAIL'} | "
            f"{'PASS' if result.success else 'FAIL'} |"
        )
    lines.extend([
        "",
        "## Combined inclusive X/Y corner",
        "",
        "| Profile | Engine | X/Y/Z fixture (mm) | Observations | Reproduced | Result |",
        "|:--------|:-------|:---------------------|:-------------|:----------:|:------:|",
    ])
    for result in corners:
        dimensions = {
            "x": result.profile.expected_largest_passing_mm["x"],
            "y": result.profile.expected_largest_passing_mm["y"],
            "z": FIXED_CROSS_AXIS_MM,
        }
        summary = ", ".join(
            f"{row.http_status}/{row.error_code or '-'}"
            + (f"/{row.rejection_stage}" if row.rejection_stage else "")
            for row in result.observations
        ) or "NOT_RUN"
        lines.append(
            f"| `{result.profile.printer}` | `{result.profile.engine}` | "
            f"`{format_number(dimensions['x'])}/{format_number(dimensions['y'])}/{format_number(dimensions['z'])}` | "
            f"`{summary}` | {'PASS' if result.endpoints_reproduced else 'FAIL'} | "
            f"{'PASS' if result.success else 'FAIL'} |"
        )

    lines.extend([
        "",
        "## Publishable tuple verdict",
        "",
        "| Profile | Engine | Largest passing inclusive X/Y/Z (mm) | Verdict |",
        "|:--------|:-------|:---------------------------------------|:--------|",
    ])
    report_profiles = []
    for result in results:
        if all(existing.key != result.case.profile.key for existing in report_profiles):
            report_profiles.append(result.case.profile)
    for profile in report_profiles:
        profile_results = [result for result in results if result.case.profile.key == profile.key]
        corner = next((result for result in corners if result.profile.key == profile.key), None)
        complete = (
            len(profile_results) == 5
            and all(result.success for result in profile_results)
            and corner is not None
            and corner.success
        )
        if complete:
            axis_values = {
                axis: min(
                    result.largest_passing_mm
                    for result in profile_results
                    if result.case.axis == axis and result.largest_passing_mm is not None
                )
                for axis in AXES
            }
            tuple_text = "/".join(format_number(axis_values[axis]) for axis in AXES)
        else:
            tuple_text = "UNESTABLISHED"
        lines.append(
            f"| `{profile.printer}` | `{profile.engine}` | `{tuple_text}` | "
            f"{publishable_tuple_verdict(phase, complete)} |"
        )
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--native-info-command-json",
        default=os.getenv(NATIVE_INFO_COMMAND_ENV),
        help=(
            "No-shell JSON argv array for host/container prusa-slicer --info. "
            "Use {fixture}, or both {fixture_dir} and {fixture_name}."
        ),
    )
    parser.add_argument(
        "--phase",
        choices=("native-measurement", "final-admission"),
        default="final-admission",
        help=(
            "native-measurement targets the measurement-only H2D candidate with declared "
            "validation ceilings; final-admission validates published P1S and H2D ceilings."
        ),
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    base_url = resolve_base_url(PROJECT_ROOT)
    slice_service_api_key = resolve_slice_service_api_key(PROJECT_ROOT)
    command_source = "configured" if args.native_info_command_json else "host-default"
    report_path = (
        MEASUREMENT_REPORT_PATH if args.phase == "native-measurement" else REPORT_PATH
    )
    try:
        native_template = parse_native_info_command(args.native_info_command_json)
    except ValueError as error:
        print(f"[NATIVE ENVELOPE] ERROR: {error}")
        write_report(
            base_url, 0, False, "invalid", [], [], report_path=report_path,
            phase=args.phase, phase_guard=PhaseGuardResult(False, "not_run"),
        )
        return 1

    print(
        "[NATIVE ENVELOPE] "
        f"target_class={report_target_class(base_url)} "
        f"slice_service_api_key_found={bool(slice_service_api_key)} "
        f"native_info_command_source={command_source}"
    )
    if not slice_service_api_key:
        print("[NATIVE ENVELOPE] ERROR: SLICE_SERVICE_API_KEY is unavailable.")
        write_report(
            base_url, 0, False, command_source, [], [], report_path=report_path,
            phase=args.phase, phase_guard=PhaseGuardResult(False, "not_run"),
        )
        return 1

    health_status, health_body = curl_json(
        method="GET", base_url=base_url, endpoint="/health",
    )
    health_success = (
        health_status == 200
        and isinstance(health_body, dict)
        and health_body.get("status") == "OK"
    )
    phase_guard = PhaseGuardResult(False, "health_preflight_failed")
    if health_success:
        catalogue_status, catalogue_body = curl_json(
            method="GET", base_url=base_url, endpoint="/profiles",
        )
        phase_guard = (
            validate_catalogue_phase(catalogue_body, args.phase)
            if catalogue_status == 200
            else PhaseGuardResult(False, "catalogue_v2_unavailable")
        )
    results: list[BracketResult] = []
    corners: list[CombinedCornerResult] = []
    if health_success and phase_guard.success:
        with tempfile.TemporaryDirectory(prefix="j3b-native-envelope-") as temp_dir:
            directory = Path(temp_dir)
            sweep_cases = build_sweep_cases(args.phase)
            profiles = []
            for case in sweep_cases:
                if all(profile.key != case.profile.key for profile in profiles):
                    profiles.append(case.profile)
                print(f"[NATIVE ENVELOPE] Running {case.key}")
                results.append(run_bracket(
                    base_url, slice_service_api_key, native_template, case, directory,
                ))
            for profile in profiles:
                print(f"[NATIVE ENVELOPE] Running {profile.key}-combined-xy")
                corners.append(run_combined_corner(
                    base_url,
                    slice_service_api_key,
                    native_template,
                    profile,
                    directory,
                    args.phase,
                ))

    write_report(
        base_url, health_status, health_success, command_source, results, corners,
        report_path=report_path,
        phase=args.phase,
        phase_guard=phase_guard,
    )
    failures = [result for result in results if not result.success]
    corner_failures = [result for result in corners if not result.success]
    print(
        f"[NATIVE ENVELOPE] Completed. brackets_total={len(results)} "
        f"brackets_failed={len(failures)} corners_failed={len(corner_failures)} "
        f"health_ok={health_success}"
    )
    print(f"[NATIVE ENVELOPE] Report: {report_path}")
    complete = is_complete_run(
        args.phase, health_success, phase_guard.success, results, corners,
    )
    return 0 if complete else 1


if __name__ == "__main__":
    raise SystemExit(main())
