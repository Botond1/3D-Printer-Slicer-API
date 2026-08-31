"""Owner-run HTTP proof for J3/J3B orientation and native-envelope contracts.

The runner creates synthetic STL cuboids in a private temporary directory,
independently measures the vertices written to disk, and qualifies every normal
fixture with the exact native ``prusa-slicer --info`` path before each service
row.  A separate binary zero-normal fixture deliberately fails that native
metadata read while remaining repairable by automatic orientation.  Reports
never retain the selected host, credentials, native output, response bodies,
or temporary paths.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import math
import os
import re
import struct
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
REPORT_PATH = RESULTS_DIR / "orientation_visibility_test_result.md"

from common.env_utils import resolve_base_url, resolve_slice_service_api_key
from common.http_utils import curl_json, curl_multipart_slice


AXES = ("x", "y", "z")
IDENTITY_MATRIX = (
    (1.0, 0.0, 0.0),
    (0.0, 1.0, 0.0),
    (0.0, 0.0, 1.0),
)
MODEL_TRANSFORM_FIELDS = frozenset({
    "transform_schema",
    "size_unit",
    "keep_proportions",
    "requested_size",
    "scale_percent",
    "scale_factors",
    "orientation_mode",
    "orientation_outcome",
    "automatic_orientation_applied",
    "automatic_rotation_deg",
    "requested_rotation_deg",
    "rotation_deg",
    "automatic_rotation_matrix",
    "rotation_matrix",
    "original_dimensions_available",
    "original_dimensions_mm",
    "oriented_dimensions_mm",
    "final_dimensions_mm",
})
P1S_LIMITS_BY_ENGINE = {
    "prusa": {"x": 256.0, "y": 256.0, "z": 249.9},
    "orca": {"x": 253.9, "y": 253.9, "z": 249.9},
}
DECLARED_LIMITS_BY_PRINTER = {
    "P1S": {"x": 256.0, "y": 256.0, "z": 250.0},
    "H2D-QUOTE": {"x": 350.0, "y": 320.0, "z": 325.0},
}
MINIMUM_LIMITS = {"x": 1.0, "y": 1.0, "z": 1.0}
LAYER_HEIGHT = 0.2
MATERIAL = "PLA"
MAX_ATTEMPTS = 3
DEFAULT_RETRY_WAIT_SECONDS = 20
DIMENSION_TOLERANCE_MM = 0.01
MATRIX_TOLERANCE = 1e-5
NATIVE_INFO_TIMEOUT_SECONDS = 60
NATIVE_NUMBER_PATTERN = r"([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)"
DEFAULT_NATIVE_INFO_COMMAND = ("prusa-slicer", "--info", "{fixture}")
NATIVE_INFO_COMMAND_ENV = "SLICER_NATIVE_INFO_COMMAND_JSON"
CATALOGUE_SCHEMA = "r3d-profile-catalogue-v2"
CATALOGUE_LIMIT_FIELDS = frozenset({
    "minimum_dimensions_inclusive_mm",
    "declared_build_volume_dimensions_mm",
    "largest_passing_dimensions_inclusive_mm",
    "source_profile",
    "declared_source_kind",
})
PROFILE_SELECTORS = {
    ("prusa", "P1S"): {
        "printerProfile": "FDM_0.2mm.ini",
    },
    ("orca", "P1S"): {
        "printerProfile": "Bambu_P1S_0.4_nozzle.json",
        "processProfile": "FDM_0.2mm.json",
    },
    ("prusa", "H2D-QUOTE"): {
        "printerProfile": "FDM_P1S_H2D_SIZE_QUOTING_0.2mm.ini",
    },
    ("orca", "H2D-QUOTE"): {
        "printerProfile": "Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json",
        "processProfile": "FDM_0.2mm.json",
    },
}


@dataclass(frozen=True)
class FixtureSpec:
    """Synthetic cuboid input owned by this runner."""

    key: str
    dimensions_mm: tuple[float, float, float]
    fixture_kind: str = "normal-ascii"

    @property
    def filename(self) -> str:
        return f"{self.key}.stl"

    @property
    def requires_native_acceptance(self) -> bool:
        return self.fixture_kind == "normal-ascii"


@dataclass(frozen=True)
class OrientationCase:
    """One engine/profile/orientation expectation."""

    key: str
    engine: str
    printer: str
    fixture_key: str
    orientation_mode: str | None
    expected_status: int
    require_auto_applied: bool | None = None
    layer_height: float = LAYER_HEIGHT
    requested_rotation_deg: tuple[float, float, float] = (0.0, 0.0, 0.0)
    expected_original_dimensions_available: bool | None = True
    expected_error_code: str | None = None
    expected_material_used_g: float | None = None
    expected_automatic_rotation_deg: tuple[float, float, float] | None = None
    expected_oriented_dimensions_mm: tuple[float, float, float] | None = None
    expected_final_dimensions_mm: tuple[float, float, float] | None = None
    expected_automatic_rotation_matrix: tuple[tuple[float, float, float], ...] | None = None
    expected_rotation_matrix: tuple[tuple[float, float, float], ...] | None = None

    @property
    def endpoint(self) -> str:
        return f"/{self.engine}/slice"

    @property
    def expected_mode(self) -> str:
        return self.orientation_mode or "auto"

    @property
    def fixed_expected_limits(self) -> dict[str, float] | None:
        limits = P1S_LIMITS_BY_ENGINE.get(self.engine) if self.printer == "P1S" else None
        return dict(limits) if limits else None


@dataclass(frozen=True)
class FixtureObservation:
    """Independent measurement of one generated fixture."""

    key: str
    expected_dimensions_mm: dict[str, float]
    measured_dimensions_mm: dict[str, float]
    fixture_kind: str
    facet_normals_valid: bool
    native_info_expectation: str
    native_info_observation: str
    success: bool


@dataclass(frozen=True)
class NativeInfoObservation:
    """Sanitized result of an exact native model-info probe."""

    accepted: bool
    dimensions_mm: dict[str, float] | None
    exit_code: int | None
    observation: str


@dataclass(frozen=True)
class CatalogueObservation:
    """Bounded catalogue-v2 selector/envelope validation result."""

    key: str
    success: bool
    observation: str


@dataclass(frozen=True)
class CaseResult:
    """Bounded, report-safe result for one live request."""

    key: str
    endpoint: str
    printer: str
    requested_mode: str
    requested_rotation_deg: tuple[float, float, float]
    fixture_key: str
    layer_height: float
    expected_status: int
    http_status: int
    error_code: str | None
    success: bool
    duration_sec: float
    observation: str


FIXTURE_SPECS = (
    FixtureSpec("j3_primary_20x255x255", (20.0, 255.0, 255.0)),
    FixtureSpec("j3_distinct_20x240x245", (20.0, 240.0, 245.0)),
    FixtureSpec("j3_all_axes_distinct_18x130x240", (18.0, 130.0, 240.0)),
    FixtureSpec("j2_z230_20x20x230", (20.0, 20.0, 230.0)),
    FixtureSpec("j2_z260_20x20x260", (20.0, 20.0, 260.0)),
    FixtureSpec("j2_x300_300x20x20", (300.0, 20.0, 20.0)),
    FixtureSpec("j3b_orca_253x253x20", (253.0, 253.0, 20.0)),
    FixtureSpec("j3b_orca_254x254x20", (254.0, 254.0, 20.0)),
    FixtureSpec("j3b_orca_254x100x20", (254.0, 100.0, 20.0)),
    FixtureSpec("j3b_orca_100x254x20", (100.0, 254.0, 20.0)),
    FixtureSpec("j3b_prusa_256x256x20", (256.0, 256.0, 20.0)),
    FixtureSpec(
        "j3b_zero_normal_60x60x240",
        (60.0, 60.0, 240.0),
        "deliberate-zero-normal-binary",
    ),
)
FIXTURE_SPEC_BY_KEY = {spec.key: spec for spec in FIXTURE_SPECS}


def _case(
    key: str,
    engine: str,
    printer: str,
    fixture_key: str,
    orientation_mode: str | None,
    expected_status: int,
    require_auto_applied: bool | None = None,
    requested_rotation_deg: tuple[float, float, float] = (0.0, 0.0, 0.0),
    expected_original_dimensions_available: bool | None = True,
    expected_error_code: str | None = None,
    expected_material_used_g: float | None = None,
    expected_automatic_rotation_deg: tuple[float, float, float] | None = None,
    expected_oriented_dimensions_mm: tuple[float, float, float] | None = None,
    expected_final_dimensions_mm: tuple[float, float, float] | None = None,
    expected_automatic_rotation_matrix: tuple[tuple[float, float, float], ...] | None = None,
    expected_rotation_matrix: tuple[tuple[float, float, float], ...] | None = None,
    layer_height: float = LAYER_HEIGHT,
) -> OrientationCase:
    return OrientationCase(
        key=key,
        engine=engine,
        printer=printer,
        fixture_key=fixture_key,
        orientation_mode=orientation_mode,
        expected_status=expected_status,
        require_auto_applied=require_auto_applied,
        layer_height=layer_height,
        requested_rotation_deg=requested_rotation_deg,
        expected_original_dimensions_available=expected_original_dimensions_available,
        expected_error_code=expected_error_code,
        expected_material_used_g=expected_material_used_g,
        expected_automatic_rotation_deg=expected_automatic_rotation_deg,
        expected_oriented_dimensions_mm=expected_oriented_dimensions_mm,
        expected_final_dimensions_mm=expected_final_dimensions_mm,
        expected_automatic_rotation_matrix=expected_automatic_rotation_matrix,
        expected_rotation_matrix=expected_rotation_matrix,
    )


def build_cases() -> tuple[OrientationCase, ...]:
    """Return the approved J3 matrix plus the J3B corrective regressions."""
    cases: list[OrientationCase] = []
    primary = "j3_primary_20x255x255"
    distinct = "j3_distinct_20x240x245"
    all_axes_distinct = "j3_all_axes_distinct_18x130x240"
    laid_flat_matrix = (
        (0.0, 1.0, 0.0),
        (0.0, 0.0, 1.0),
        (1.0, 0.0, 0.0),
    )
    requested_x90_matrix = (
        (1.0, 0.0, 0.0),
        (0.0, 0.0, -1.0),
        (0.0, 1.0, 0.0),
    )

    for engine in ("prusa", "orca"):
        primary_auto_status = 200 if engine == "prusa" else 422
        cases.extend([
            _case(
                f"{engine}-p1s-primary-default-auto",
                engine, "P1S", primary, None, primary_auto_status, True,
                expected_automatic_rotation_deg=(-90.0, -90.0, 0.0),
                expected_oriented_dimensions_mm=(255.0, 255.0, 20.0),
                expected_final_dimensions_mm=(255.0, 255.0, 20.0),
                expected_automatic_rotation_matrix=laid_flat_matrix,
                expected_rotation_matrix=laid_flat_matrix,
            ),
            _case(
                f"{engine}-p1s-primary-explicit-auto",
                engine, "P1S", primary, "auto", primary_auto_status, True,
                expected_automatic_rotation_deg=(-90.0, -90.0, 0.0),
                expected_oriented_dimensions_mm=(255.0, 255.0, 20.0),
                expected_final_dimensions_mm=(255.0, 255.0, 20.0),
                expected_automatic_rotation_matrix=laid_flat_matrix,
                expected_rotation_matrix=laid_flat_matrix,
            ),
            _case(
                f"{engine}-p1s-primary-preserve-bounds",
                engine, "P1S", primary, "preserve", 422, False,
            ),
            _case(
                f"{engine}-p1s-distinct-auto-zero-request-transform",
                engine, "P1S", distinct, "auto", 200, True,
            ),
            _case(
                f"{engine}-p1s-distinct-auto-request-z90",
                engine, "P1S", distinct, "auto", 200, True, (0.0, 0.0, 90.0),
            ),
            _case(
                f"{engine}-p1s-distinct-preserve",
                engine, "P1S", distinct, "preserve", 200, False,
            ),
            _case(
                f"{engine}-p1s-all-axes-distinct-auto-replay",
                engine, "P1S", all_axes_distinct, "auto", 200, True,
                expected_automatic_rotation_deg=(-90.0, -90.0, 0.0),
                expected_oriented_dimensions_mm=(130.0, 240.0, 18.0),
                expected_final_dimensions_mm=(130.0, 240.0, 18.0),
                expected_automatic_rotation_matrix=laid_flat_matrix,
                expected_rotation_matrix=laid_flat_matrix,
            ),
            _case(
                f"{engine}-p1s-all-axes-distinct-preserve-request-x90",
                engine, "P1S", all_axes_distinct, "preserve", 200, False,
                (90.0, 0.0, 0.0),
                expected_oriented_dimensions_mm=(18.0, 130.0, 240.0),
                expected_final_dimensions_mm=(18.0, 240.0, 130.0),
                expected_rotation_matrix=requested_x90_matrix,
            ),
            _case(
                f"{engine}-p1s-invalid-orientation-mode",
                engine, "P1S", all_axes_distinct, "sideways", 400, None,
                expected_original_dimensions_available=None,
                expected_error_code="INVALID_ORIENTATION_MODE",
            ),
        ])

    for engine in ("prusa", "orca"):
        cases.extend([
            _case(
                f"{engine}-h2d-quote-primary-auto",
                engine, "H2D-QUOTE", primary, "auto", 200, True,
            ),
            _case(
                f"{engine}-h2d-quote-primary-preserve",
                engine, "H2D-QUOTE", primary, "preserve", 200, False,
            ),
        ])

    regressions = (
        ("j2-z230-default-auto-accepted", "j2_z230_20x20x230", 200, True),
        ("j2-z260-default-auto-rejected", "j2_z260_20x20x260", 422, True),
        ("j2-x300-default-auto-rejected", "j2_x300_300x20x20", 422, None),
    )
    for engine in ("prusa", "orca"):
        for suffix, fixture_key, status, applied in regressions:
            cases.append(_case(
                f"{engine}-p1s-{suffix}",
                engine, "P1S", fixture_key, None, status, applied,
            ))

    cases.extend([
        _case(
            "orca-p1s-253x253-preserve-accepted",
            "orca", "P1S", "j3b_orca_253x253x20", "preserve", 200, False,
            layer_height=0.3,
            expected_material_used_g=456.33,
        ),
        _case(
            "orca-p1s-254x254-preserve-bounds",
            "orca", "P1S", "j3b_orca_254x254x20", "preserve", 422, False,
        ),
        _case(
            "orca-p1s-254x100-preserve-bounds",
            "orca", "P1S", "j3b_orca_254x100x20", "preserve", 422, False,
        ),
        _case(
            "orca-p1s-100x254-preserve-bounds",
            "orca", "P1S", "j3b_orca_100x254x20", "preserve", 422, False,
        ),
        _case(
            "prusa-p1s-256x256-preserve-accepted",
            "prusa", "P1S", "j3b_prusa_256x256x20", "preserve", 200, False,
        ),
    ])

    zero_normal = "j3b_zero_normal_60x60x240"
    for engine in ("prusa", "orca"):
        cases.extend([
            _case(
                f"{engine}-zero-normal-explicit-auto-degraded-original",
                engine, "P1S", zero_normal, "auto", 200, True,
                expected_original_dimensions_available=False,
            ),
            _case(
                f"{engine}-zero-normal-preserve-degraded-original",
                engine, "P1S", zero_normal, "preserve", 200, False,
                expected_original_dimensions_available=False,
            ),
        ])
    return tuple(cases)


def _format_number(value: float) -> str:
    rounded = round(float(value), 9)
    if rounded.is_integer():
        return str(int(rounded))
    return f"{rounded:.9f}".rstrip("0").rstrip(".")


def _cuboid_triangles(
    dimensions_mm: Sequence[float],
) -> tuple[tuple[tuple[float, float, float], tuple[tuple[float, float, float], ...]], ...]:
    if (
        len(dimensions_mm) != 3
        or any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or value <= 0
            for value in dimensions_mm
        )
    ):
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
    if not solid_name or not all(
        character.isalnum() or character == "_" for character in solid_name
    ):
        raise ValueError("Cuboid fixture inputs are invalid.")
    lines = [f"solid {solid_name}"]
    for normal, triangle in _cuboid_triangles(dimensions_mm):
        normal_text = " ".join(_format_number(value) for value in normal)
        lines.extend((f"  facet normal {normal_text}", "    outer loop"))
        for vertex in triangle:
            coordinates = " ".join(_format_number(value) for value in vertex)
            lines.append(f"      vertex {coordinates}")
        lines.extend(("    endloop", "  endfacet"))
    lines.append(f"endsolid {solid_name}")
    return ("\n".join(lines) + "\n").encode("ascii")


def cuboid_binary_zero_normal_stl(
    dimensions_mm: Sequence[float],
    solid_name: str,
) -> bytes:
    """Reproduce the legal binary regression fixture with twelve zero normals."""
    if not solid_name or not all(
        character.isalnum() or character == "_" for character in solid_name
    ):
        raise ValueError("Cuboid fixture inputs are invalid.")
    header = (f"J3B zero-normal {solid_name}".encode("ascii")[:80]).ljust(80, b"\0")
    facets = []
    for _, triangle in _cuboid_triangles(dimensions_mm):
        values = (0.0, 0.0, 0.0, *(value for vertex in triangle for value in vertex))
        facets.append(struct.pack("<12fH", *values, 0))
    return header + struct.pack("<I", len(facets)) + b"".join(facets)


def _read_ascii_facets(
    file_path: Path,
) -> list[tuple[tuple[float, float, float], tuple[tuple[float, float, float], ...]]]:
    try:
        lines = file_path.read_text(encoding="ascii").splitlines()
    except (OSError, UnicodeError) as error:
        raise ValueError("Fixture is not a readable ASCII STL.") from error

    facets = []
    normal: tuple[float, float, float] | None = None
    vertices: list[tuple[float, float, float]] = []
    for line in lines:
        parts = line.strip().split()
        if not parts:
            continue
        if [part.lower() for part in parts[:2]] == ["facet", "normal"]:
            if len(parts) != 5 or normal is not None:
                raise ValueError("Fixture contains a malformed STL normal.")
            try:
                normal = tuple(float(token) for token in parts[2:])
            except ValueError as error:
                raise ValueError("Fixture contains a non-numeric STL normal.") from error
            vertices = []
        elif parts[0].lower() == "vertex":
            if len(parts) != 4 or normal is None:
                raise ValueError("Fixture contains a malformed STL vertex.")
            try:
                vertex = tuple(float(token) for token in parts[1:])
            except ValueError as error:
                raise ValueError("Fixture contains a non-numeric STL vertex.") from error
            if any(not math.isfinite(value) for value in vertex):
                raise ValueError("Fixture contains a non-finite STL vertex.")
            vertices.append(vertex)
        elif parts[0].lower() == "endfacet":
            if normal is None or len(vertices) != 3:
                raise ValueError("Fixture contains a malformed STL facet.")
            if any(not math.isfinite(value) for value in normal):
                raise ValueError("Fixture contains a non-finite STL normal.")
            facets.append((normal, tuple(vertices)))
            normal = None
            vertices = []
    if normal is not None or len(facets) != 12:
        raise ValueError("Fixture must contain exactly 12 triangles.")
    return facets


def _measure_vertices(vertices: Sequence[Sequence[float]]) -> dict[str, float]:
    if len(vertices) != 36:
        raise ValueError("Fixture must contain exactly 12 triangles.")
    dimensions = {
        axis: max(vertex[index] for vertex in vertices)
        - min(vertex[index] for vertex in vertices)
        for index, axis in enumerate(AXES)
    }
    if any(value <= 0 for value in dimensions.values()):
        raise ValueError("Fixture has a non-positive measured dimension.")
    return {axis: round(dimensions[axis], 6) for axis in AXES}


def measure_ascii_stl(file_path: Path) -> dict[str, float]:
    """Measure the on-disk ASCII STL from parsed vertex coordinates."""
    facets = _read_ascii_facets(file_path)
    return _measure_vertices([
        vertex for _, facet_vertices in facets for vertex in facet_vertices
    ])


def _read_binary_facets(
    file_path: Path,
) -> list[tuple[tuple[float, float, float], tuple[tuple[float, float, float], ...]]]:
    """Parse the exact 12-facet binary fixture without trusting its declaration."""
    try:
        payload = file_path.read_bytes()
    except OSError as error:
        raise ValueError("Fixture is not a readable binary STL.") from error
    if len(payload) < 84:
        raise ValueError("Fixture contains a truncated binary STL header.")
    facet_count = struct.unpack_from("<I", payload, 80)[0]
    if facet_count != 12 or len(payload) != 84 + facet_count * 50:
        raise ValueError("Fixture must contain exactly 12 binary triangles.")
    facets = []
    for index in range(facet_count):
        values = struct.unpack_from("<12fH", payload, 84 + index * 50)
        normal = tuple(float(value) for value in values[:3])
        vertices = tuple(
            tuple(float(value) for value in values[offset:offset + 3])
            for offset in (3, 6, 9)
        )
        if any(not math.isfinite(value) for value in values[:12]):
            raise ValueError("Fixture contains a non-finite binary STL value.")
        facets.append((normal, vertices))
    return facets


def measure_binary_stl(file_path: Path) -> dict[str, float]:
    """Measure the on-disk binary STL from parsed vertex coordinates."""
    facets = _read_binary_facets(file_path)
    return _measure_vertices([
        vertex for _, facet_vertices in facets for vertex in facet_vertices
    ])


def _cross(left: Sequence[float], right: Sequence[float]) -> tuple[float, float, float]:
    return (
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    )


def validate_ascii_outward_normals(file_path: Path) -> bool:
    """Require every stored normal to be nonzero, geometric, and outward."""
    facets = _read_ascii_facets(file_path)
    all_vertices = [vertex for _, vertices in facets for vertex in vertices]
    center = tuple(
        (min(vertex[index] for vertex in all_vertices)
         + max(vertex[index] for vertex in all_vertices)) / 2
        for index in range(3)
    )
    for normal, vertices in facets:
        edge_a = tuple(vertices[1][index] - vertices[0][index] for index in range(3))
        edge_b = tuple(vertices[2][index] - vertices[0][index] for index in range(3))
        geometric = _cross(edge_a, edge_b)
        normal_length = math.sqrt(sum(value * value for value in normal))
        geometric_length = math.sqrt(sum(value * value for value in geometric))
        if normal_length <= 0 or geometric_length <= 0:
            return False
        alignment = sum(normal[index] * geometric[index] for index in range(3))
        if alignment / (normal_length * geometric_length) < 1 - MATRIX_TOLERANCE:
            return False
        centroid = tuple(sum(vertex[index] for vertex in vertices) / 3 for index in range(3))
        outward = sum(
            normal[index] * (centroid[index] - center[index])
            for index in range(3)
        )
        if outward <= 0:
            return False
    return True


def validate_binary_zero_normals(file_path: Path) -> bool:
    """Prove the binary regression fixture stores zero normals but real facets."""
    for normal, vertices in _read_binary_facets(file_path):
        if any(value != 0 for value in normal):
            return False
        edge_a = tuple(vertices[1][index] - vertices[0][index] for index in range(3))
        edge_b = tuple(vertices[2][index] - vertices[0][index] for index in range(3))
        if math.sqrt(sum(value * value for value in _cross(edge_a, edge_b))) <= 0:
            return False
    return True


def _axis_map(dimensions: Sequence[float]) -> dict[str, float]:
    return {axis: float(dimensions[index]) for index, axis in enumerate(AXES)}


def dimensions_close(left: object, right: object) -> bool:
    """Compare exact-axis dimension maps within response rounding tolerance."""
    return (
        isinstance(left, Mapping)
        and isinstance(right, Mapping)
        and set(left) == set(AXES)
        and set(right) == set(AXES)
        and all(
            _finite_number(left[axis])
            and _finite_number(right[axis])
            and abs(float(left[axis]) - float(right[axis])) <= DIMENSION_TOLERANCE_MM
            for axis in AXES
        )
    )


def _native_info_environment(source: Mapping[str, str] | None = None) -> dict[str, str]:
    """Mirror the production native-child environment without application secrets."""
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

    environment = {}
    for name in keys:
        value = read_value(name)
        if value:
            environment[name] = value
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


def parse_native_info_command(raw_json: str | None) -> tuple[str, ...]:
    """Parse one bounded no-shell argv template for host or exact-container probing."""
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
    allowed_placeholders = ("{fixture}", "{fixture_dir}", "{fixture_name}")
    for token in parsed:
        remainder = token
        for placeholder in allowed_placeholders:
            remainder = remainder.replace(placeholder, "")
        if "{" in remainder or "}" in remainder:
            raise ValueError("Native-info command contains an unknown placeholder.")
    return tuple(parsed)


def expand_native_info_command(
    template: Sequence[str], fixture_path: Path,
) -> list[str]:
    """Expand only the admitted fixture placeholders without a shell."""
    replacements = {
        "{fixture}": str(fixture_path),
        "{fixture_dir}": str(fixture_path.parent),
        "{fixture_name}": fixture_path.name,
    }
    return [
        _replace_placeholders(token, replacements)
        for token in template
    ]


def _replace_placeholders(token: str, replacements: Mapping[str, str]) -> str:
    result = token
    for placeholder, value in replacements.items():
        result = result.replace(placeholder, value)
    return result


def parse_native_info_dimensions(stdout: str) -> dict[str, float] | None:
    """Parse the exact three size fields consumed by the service."""
    parsed = {}
    for axis in AXES:
        match = re.search(
            rf"\bsize_{axis}\s*=\s*{NATIVE_NUMBER_PATTERN}",
            stdout,
            flags=re.IGNORECASE,
        )
        if not match:
            return None
        value = float(match.group(1))
        if not math.isfinite(value) or value <= 0:
            return None
        parsed[axis] = value
    return parsed


def probe_native_model_info(
    file_path: Path,
    command_runner=subprocess.run,
    command_template: Sequence[str] = DEFAULT_NATIVE_INFO_COMMAND,
) -> NativeInfoObservation:
    """Run exact native ``prusa-slicer --info`` without retaining its output."""
    try:
        completed = command_runner(
            expand_native_info_command(command_template, file_path),
            shell=False,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=NATIVE_INFO_TIMEOUT_SECONDS,
            env=_native_info_environment(),
        )
    except FileNotFoundError:
        return NativeInfoObservation(False, None, None, "native_binary_unavailable")
    except subprocess.TimeoutExpired:
        return NativeInfoObservation(False, None, None, "native_info_timeout")
    except OSError:
        return NativeInfoObservation(False, None, None, "native_info_launch_failed")
    exit_code = int(completed.returncode)
    dimensions = parse_native_info_dimensions(completed.stdout) if exit_code == 0 else None
    if exit_code != 0:
        return NativeInfoObservation(False, None, exit_code, "native_info_rejected")
    if dimensions is None:
        return NativeInfoObservation(False, None, exit_code, "native_info_dimensions_unavailable")
    return NativeInfoObservation(True, dimensions, exit_code, "native_info_accepted")


def _qualify_native_observation(
    spec: FixtureSpec,
    expected_dimensions: Mapping[str, float],
    observation: NativeInfoObservation,
) -> bool:
    if spec.requires_native_acceptance:
        return observation.accepted and dimensions_close(
            observation.dimensions_mm, expected_dimensions,
        )
    return observation.exit_code is not None and observation.exit_code != 0


def write_and_measure_fixtures(
    directory: Path,
    native_info_probe=probe_native_model_info,
) -> tuple[dict[str, Path], dict[str, dict[str, float]], list[FixtureObservation]]:
    """Write, measure, normal-check, and natively qualify every fixture."""
    paths: dict[str, Path] = {}
    measurements: dict[str, dict[str, float]] = {}
    observations: list[FixtureObservation] = []
    for spec in FIXTURE_SPECS:
        fixture_path = directory / spec.filename
        if spec.requires_native_acceptance:
            fixture_path.write_bytes(cuboid_ascii_stl(spec.dimensions_mm, spec.key))
            measured = measure_ascii_stl(fixture_path)
            normals_valid = validate_ascii_outward_normals(fixture_path)
            native_expectation = "accepted-with-positive-requested-dimensions"
        else:
            fixture_path.write_bytes(cuboid_binary_zero_normal_stl(spec.dimensions_mm, spec.key))
            measured = measure_binary_stl(fixture_path)
            normals_valid = validate_binary_zero_normals(fixture_path)
            native_expectation = "deliberate-rejection"
        expected = _axis_map(spec.dimensions_mm)
        native_observation = native_info_probe(fixture_path)
        success = (
            dimensions_close(measured, expected)
            and normals_valid
            and _qualify_native_observation(spec, expected, native_observation)
        )
        observations.append(FixtureObservation(
            spec.key,
            expected,
            measured,
            spec.fixture_kind,
            normals_valid,
            native_expectation,
            native_observation.observation,
            success,
        ))
        paths[spec.key] = fixture_path
        measurements[spec.key] = measured
    return paths, measurements, observations


def normal_fixture_precondition(
    fixture_path: Path,
    expected_dimensions: Mapping[str, float],
    native_info_probe=probe_native_model_info,
) -> tuple[bool, str]:
    """Re-run exact native acceptance immediately before one normal HTTP row."""
    observation = native_info_probe(fixture_path)
    if not observation.accepted:
        return False, "fixture_native_info_precondition_failed_service_not_evaluated"
    if not dimensions_close(observation.dimensions_mm, expected_dimensions):
        return False, "fixture_native_dimensions_precondition_failed_service_not_evaluated"
    return True, "fixture_native_info_precondition_passed"


def report_target_class(base_url: str) -> str:
    """Classify a target without retaining its hostname or address."""
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


def build_request_fields(case: OrientationCase) -> dict[str, str]:
    """Build the zero-request-transform multipart fields for one case."""
    fields = {
        "sizeUnit": "mm",
        "keepProportions": "true",
        "scalePercent": "100",
        "rotationX": _format_number(case.requested_rotation_deg[0]),
        "rotationY": _format_number(case.requested_rotation_deg[1]),
        "rotationZ": _format_number(case.requested_rotation_deg[2]),
    }
    selector = PROFILE_SELECTORS.get((case.engine, case.printer))
    if selector is None:
        raise ValueError("The case references an unavailable engine/profile pair.")
    fields.update(selector)
    if case.orientation_mode is not None:
        fields["orientationMode"] = case.orientation_mode
    return fields


def _catalogue_selector_parameters(profile: object) -> dict[str, str] | None:
    if not isinstance(profile, dict):
        return None
    selector = profile.get("slice_selector")
    parameters = selector.get("parameters") if isinstance(selector, dict) else None
    if (
        not isinstance(selector, dict)
        or selector.get("endpoint") != f"/{profile.get('engine')}/slice"
        or not isinstance(parameters, list)
    ):
        return None
    parsed = {}
    for parameter in parameters:
        if (
            not isinstance(parameter, dict)
            or set(parameter) != {"name", "value"}
            or not isinstance(parameter.get("name"), str)
            or not isinstance(parameter.get("value"), str)
            or parameter["name"] in parsed
        ):
            return None
        parsed[parameter["name"]] = parameter["value"]
    return parsed


def validate_catalogue_v2(
    body: object,
) -> tuple[dict[tuple[str, str], dict[str, float]], list[CatalogueObservation]]:
    """Resolve authoritative admission limits for every matrix selector."""
    resolved: dict[tuple[str, str], dict[str, float]] = {}
    observations: list[CatalogueObservation] = []
    profiles = body.get("profiles") if isinstance(body, dict) else None
    schema_valid = isinstance(body, dict) and body.get("schema") == CATALOGUE_SCHEMA
    if not schema_valid or not isinstance(profiles, list):
        return resolved, [CatalogueObservation(
            "catalogue-v2", False, "catalogue_schema_or_profiles_invalid",
        )]

    for identity, expected_selector in PROFILE_SELECTORS.items():
        engine, printer = identity
        expected_material = "PLA" if engine == "orca" else None
        matches = [
            profile for profile in profiles
            if isinstance(profile, dict)
            and profile.get("engine") == engine
            and isinstance(profile.get("printer"), dict)
            and profile["printer"].get("id") == printer
            and profile.get("layer_height_mm") == LAYER_HEIGHT
            and profile.get("material") == expected_material
            and _catalogue_selector_parameters(profile) == expected_selector
        ]
        key = f"{engine}:{printer}:0.2"
        if len(matches) != 1:
            observations.append(CatalogueObservation(
                key, False, "catalogue_selector_not_unique",
            ))
            continue
        limits = matches[0].get("build_volume_limits_mm")
        if not isinstance(limits, dict) or set(limits) != CATALOGUE_LIMIT_FIELDS:
            observations.append(CatalogueObservation(
                key, False, "catalogue_named_envelope_shape_invalid",
            ))
            continue
        minimum = limits.get("minimum_dimensions_inclusive_mm")
        declared = limits.get("declared_build_volume_dimensions_mm")
        largest = limits.get("largest_passing_dimensions_inclusive_mm")
        declared_expected = DECLARED_LIMITS_BY_PRINTER[printer]
        source_expected = expected_selector["printerProfile"]
        numeric_valid = (
            dimensions_close(minimum, MINIMUM_LIMITS)
            and dimensions_close(declared, declared_expected)
            and isinstance(largest, Mapping)
            and set(largest) == set(AXES)
            and all(_finite_number(largest[axis]) for axis in AXES)
            and all(
                float(minimum[axis]) <= float(largest[axis]) <= float(declared[axis])
                for axis in AXES
            )
            and limits.get("source_profile") == source_expected
            and isinstance(limits.get("declared_source_kind"), str)
            and bool(limits["declared_source_kind"])
        )
        if numeric_valid and printer == "P1S":
            numeric_valid = dimensions_close(largest, P1S_LIMITS_BY_ENGINE[engine])
        elif numeric_valid:
            numeric_valid = all(
                float(largest[axis]) > P1S_LIMITS_BY_ENGINE[engine][axis]
                for axis in AXES
            )
        if not numeric_valid:
            observations.append(CatalogueObservation(
                key, False, "catalogue_inclusive_envelope_invalid",
            ))
            continue
        resolved[identity] = {axis: float(largest[axis]) for axis in AXES}
        observations.append(CatalogueObservation(
            key, True, "catalogue_inclusive_envelope_and_selector_valid",
        ))
    return resolved, observations


def _finite_number(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _valid_rotation(rotation: object) -> bool:
    return (
        isinstance(rotation, Mapping)
        and set(rotation) == set(AXES)
        and all(_finite_number(rotation[axis]) for axis in AXES)
    )


def _valid_rotation_matrix(matrix: object) -> bool:
    if (
        not isinstance(matrix, list)
        or len(matrix) != 3
        or any(not isinstance(row, list) or len(row) != 3 for row in matrix)
        or any(not _finite_number(value) for row in matrix for value in row)
    ):
        return False
    rows = [[float(value) for value in row] for row in matrix]
    columns = [[rows[row][column] for row in range(3)] for column in range(3)]
    for vectors in (rows, columns):
        for index in range(3):
            norm = sum(value * value for value in vectors[index])
            if abs(norm - 1.0) > MATRIX_TOLERANCE:
                return False
            for other in range(index + 1, 3):
                dot = sum(
                    vectors[index][axis] * vectors[other][axis]
                    for axis in range(3)
                )
                if abs(dot) > MATRIX_TOLERANCE:
                    return False
    determinant = (
        rows[0][0] * (rows[1][1] * rows[2][2] - rows[1][2] * rows[2][1])
        - rows[0][1] * (rows[1][0] * rows[2][2] - rows[1][2] * rows[2][0])
        + rows[0][2] * (rows[1][0] * rows[2][1] - rows[1][1] * rows[2][0])
    )
    return abs(determinant - 1.0) <= MATRIX_TOLERANCE


def _matrix_is_identity(matrix: list[list[float]]) -> bool:
    return all(
        abs(float(matrix[row][column]) - IDENTITY_MATRIX[row][column])
        <= MATRIX_TOLERANCE
        for row in range(3)
        for column in range(3)
    )


def rotation_matrix_from_euler(rotation: Mapping[str, float]) -> list[list[float]]:
    """Rebuild the API's Z-Y-X Euler matrix independently in Python."""
    x = math.radians(float(rotation["x"]))
    y = math.radians(float(rotation["y"]))
    z = math.radians(float(rotation["z"]))
    sx, cx = math.sin(x), math.cos(x)
    sy, cy = math.sin(y), math.cos(y)
    sz, cz = math.sin(z), math.cos(z)
    return [
        [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
        [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
        [-sy, cy * sx, cy * cx],
    ]


def _matrices_close(left: Sequence[Sequence[float]], right: Sequence[Sequence[float]]) -> bool:
    return all(
        abs(float(left[row][column]) - float(right[row][column])) <= MATRIX_TOLERANCE
        for row in range(3)
        for column in range(3)
    )


def multiply_rotation_matrices(
    left: Sequence[Sequence[float]],
    right: Sequence[Sequence[float]],
) -> list[list[float]]:
    """Compose rotations in the same requested-times-automatic order as J3."""
    return [
        [
            sum(float(left[row][inner]) * float(right[inner][column]) for inner in range(3))
            for column in range(3)
        ]
        for row in range(3)
    ]


def replay_rotated_dimensions(
    original_dimensions: Mapping[str, float],
    rotation_matrix: Sequence[Sequence[float]],
) -> dict[str, float]:
    """Replay an axis-aligned cuboid's dimensions through a rotation matrix."""
    source = [float(original_dimensions[axis]) for axis in AXES]
    return {
        axis: sum(abs(float(rotation_matrix[index][column])) * source[column] for column in range(3))
        for index, axis in enumerate(AXES)
    }


def _expected_laid_flat(dimensions: Mapping[str, float]) -> tuple[float, list[float]]:
    ordered = sorted(float(dimensions[axis]) for axis in AXES)
    return ordered[0], ordered[1:]


def validate_original_dimensions_contract(
    transform: Mapping[str, object],
    expected_available: bool,
    measured_dimensions: Mapping[str, float],
) -> tuple[bool, str]:
    """Validate schema-v2 availability/nullability without hiding measured zeroes."""
    available = transform.get("original_dimensions_available")
    original = transform.get("original_dimensions_mm")
    if available is not expected_available:
        return False, "original_dimensions_availability_invalid"
    if not expected_available:
        return (
            (True, "original_dimensions_unavailable_explicit")
            if original is None
            else (False, "unavailable_original_dimensions_not_null")
        )
    if not (
        isinstance(original, Mapping)
        and set(original) == set(AXES)
        and all(_finite_number(original[axis]) and float(original[axis]) >= 0 for axis in AXES)
    ):
        return False, "available_original_dimensions_invalid"
    if not dimensions_close(original, measured_dimensions):
        return False, "original_dimensions_not_submitted_dimensions"
    return True, "original_dimensions_measured"


def validate_model_transform(
    transform: object,
    case: OrientationCase,
    measured_dimensions: Mapping[str, float],
) -> tuple[bool, str]:
    """Validate K1/K3 and the approved orientation semantics."""
    if not isinstance(transform, dict) or set(transform) != MODEL_TRANSFORM_FIELDS:
        return False, "model_transform_shape_invalid"
    if transform.get("transform_schema") != 2:
        return False, "transform_schema_v2_invalid"
    if (
        transform.get("size_unit") != "mm"
        or transform.get("keep_proportions") is not True
        or transform.get("requested_size") != {"x": None, "y": None, "z": None}
        or transform.get("scale_percent") != 100
        or not dimensions_close(transform.get("scale_factors"), {"x": 1, "y": 1, "z": 1})
    ):
        return False, "zero_requested_transform_contract_invalid"
    if transform.get("orientation_mode") != case.expected_mode:
        return False, "orientation_mode_invalid"

    outcome = transform.get("orientation_outcome")
    applied = transform.get("automatic_orientation_applied")
    automatic_matrix = transform.get("automatic_rotation_matrix")
    total_matrix = transform.get("rotation_matrix")
    if not _valid_rotation_matrix(automatic_matrix) or not _valid_rotation_matrix(total_matrix):
        return False, "k3_rotation_matrix_invalid"
    automatic_identity = _matrix_is_identity(automatic_matrix)
    if case.expected_mode == "preserve":
        if outcome != "preserved" or applied is not False or not automatic_identity:
            return False, "preserve_orientation_contract_invalid"
    else:
        if outcome not in {"applied", "unchanged", "fallback_unmodified"}:
            return False, "auto_orientation_outcome_invalid"
        if applied is not (outcome == "applied"):
            return False, "automatic_orientation_flag_invalid"
        if (outcome == "applied") is automatic_identity:
            return False, "automatic_orientation_matrix_identity_invalid"
        if case.require_auto_applied is not None and applied is not case.require_auto_applied:
            return False, "expected_automatic_orientation_application_missing"

    requested_rotation = transform.get("requested_rotation_deg")
    automatic_rotation = transform.get("automatic_rotation_deg")
    total_rotation = transform.get("rotation_deg")
    if not all(_valid_rotation(value) for value in (
        requested_rotation, automatic_rotation, total_rotation,
    )):
        return False, "rotation_degrees_invalid"
    expected_requested = {
        axis: case.requested_rotation_deg[index]
        for index, axis in enumerate(AXES)
    }
    if any(
        abs(float(requested_rotation[axis]) - expected_requested[axis]) > MATRIX_TOLERANCE
        for axis in AXES
    ):
        return False, "requested_rotation_does_not_match_request"
    if case.expected_automatic_rotation_deg is not None:
        expected_automatic = _axis_map(case.expected_automatic_rotation_deg)
        if any(
            abs(float(automatic_rotation[axis]) - expected_automatic[axis])
            > MATRIX_TOLERANCE
            for axis in AXES
        ):
            return False, "automatic_rotation_does_not_match_approved_j3_row"
    requested_matrix = rotation_matrix_from_euler(requested_rotation)
    expected_total_matrix = multiply_rotation_matrices(
        requested_matrix, automatic_matrix,
    )
    if not _matrices_close(expected_total_matrix, total_matrix):
        return False, "k3_total_matrix_composition_invalid"
    if not _matrices_close(
        rotation_matrix_from_euler(automatic_rotation), automatic_matrix,
    ):
        return False, "automatic_euler_matrix_mismatch"
    if not _matrices_close(rotation_matrix_from_euler(total_rotation), total_matrix):
        return False, "total_euler_matrix_mismatch"
    if (
        case.expected_automatic_rotation_matrix is not None
        and not _matrices_close(case.expected_automatic_rotation_matrix, automatic_matrix)
    ):
        return False, "automatic_rotation_matrix_does_not_match_approved_j3_row"
    if (
        case.expected_rotation_matrix is not None
        and not _matrices_close(case.expected_rotation_matrix, total_matrix)
    ):
        return False, "rotation_matrix_does_not_match_approved_j3_row"

    original_available = case.expected_original_dimensions_available
    if original_available is None:
        return False, "original_dimensions_expectation_missing"
    original_contract_ok, original_observation = validate_original_dimensions_contract(
        transform,
        original_available,
        measured_dimensions,
    )
    if not original_contract_ok:
        return False, original_observation
    oriented = transform.get("oriented_dimensions_mm")
    final = transform.get("final_dimensions_mm")
    replayed_oriented = replay_rotated_dimensions(
        measured_dimensions, automatic_matrix,
    )
    if not dimensions_close(replayed_oriented, oriented):
        return False, "automatic_rotation_matrix_not_replayable"
    replayed_final = replay_rotated_dimensions(measured_dimensions, total_matrix)
    if not dimensions_close(replayed_final, final):
        return False, "k3_rotation_matrix_not_replayable"
    if (
        case.expected_oriented_dimensions_mm is not None
        and not dimensions_close(
            oriented,
            _axis_map(case.expected_oriented_dimensions_mm),
        )
    ):
        return False, "oriented_dimensions_do_not_match_approved_j3_row"
    if (
        case.expected_final_dimensions_mm is not None
        and not dimensions_close(
            final,
            _axis_map(case.expected_final_dimensions_mm),
        )
    ):
        return False, "final_dimensions_do_not_match_approved_j3_row"

    if case.expected_mode == "preserve":
        if not dimensions_close(oriented, measured_dimensions):
            return False, "preserve_orientation_dimensions_changed"
    else:
        expected_z, expected_xy = _expected_laid_flat(measured_dimensions)
        observed_xy = sorted((float(final["x"]), float(final["y"]))) \
            if isinstance(final, Mapping) else []
        if (
            not isinstance(final, Mapping)
            or abs(float(final["z"]) - expected_z) > DIMENSION_TOLERANCE_MM
            or len(observed_xy) != 2
            or any(
                abs(observed_xy[index] - expected_xy[index]) > DIMENSION_TOLERANCE_MM
                for index in range(2)
            )
        ):
            return False, "auto_dimensions_not_laid_flat"
    return True, "schema2_transform_and_replay_valid"


def _validate_limits(
    payload: object,
    case: OrientationCase,
    expected_limits: Mapping[str, float],
) -> bool:
    expected_source = PROFILE_SELECTORS[(case.engine, case.printer)]["printerProfile"]
    return (
        isinstance(payload, dict)
        and set(payload) == {"min", "max", "source_profile"}
        and dimensions_close(payload.get("min"), MINIMUM_LIMITS)
        and dimensions_close(payload.get("max"), expected_limits)
        and payload.get("source_profile") == expected_source
    )


def validate_case_response(
    case: OrientationCase,
    measured_dimensions: Mapping[str, float],
    status: int,
    body: object,
    expected_limits: Mapping[str, float] | None = None,
) -> tuple[bool, str]:
    """Validate one success or K2 bounds response without retaining raw data."""
    if status != case.expected_status:
        return False, "unexpected_http_status"
    if not isinstance(body, dict):
        return False, "response_not_json_object"
    if case.expected_error_code == "INVALID_ORIENTATION_MODE":
        if (
            case.expected_status == 400
            and set(body) == {"success", "error", "errorCode"}
            and body.get("success") is False
            and body.get("error")
            == "Invalid orientationMode. Allowed values: auto, preserve."
            and body.get("errorCode") == "INVALID_ORIENTATION_MODE"
        ):
            return True, "invalid_orientation_mode_bare_400_valid"
        return False, "invalid_orientation_mode_payload_invalid"
    if case.expected_error_code == "MODEL_DIMENSIONS_UNAVAILABLE":
        if (
            case.expected_status == 422
            and set(body) == {"success", "error", "errorCode"}
            and body.get("success") is False
            and body.get("errorCode") == "MODEL_DIMENSIONS_UNAVAILABLE"
            and isinstance(body.get("error"), str)
            and bool(body["error"])
        ):
            return True, "oriented_dimensions_unavailable_typed_422_valid"
        return False, "model_dimensions_unavailable_payload_invalid"

    effective_limits = expected_limits or case.fixed_expected_limits
    if effective_limits is None:
        return False, "catalogue_limits_missing"
    transform = body.get("model_transform")
    transform_ok, transform_observation = validate_model_transform(
        transform, case, measured_dimensions,
    )
    if not transform_ok:
        return False, transform_observation
    if not _validate_limits(body.get("build_volume_limits_mm"), case, effective_limits):
        return False, "build_volume_limits_invalid"

    final = transform["final_dimensions_mm"]
    if case.expected_status == 200:
        stats = body.get("stats")
        height = stats.get("object_height_mm") if isinstance(stats, dict) else None
        if (
            body.get("success") is not True
            or body.get("slicer_engine") != case.engine
            or not _finite_number(height)
            or abs(float(height) - float(final["z"])) > DIMENSION_TOLERANCE_MM
        ):
            return False, "success_or_object_height_contract_invalid"
        if case.expected_material_used_g is not None:
            material_used_g = stats.get("material_used_g") if isinstance(stats, dict) else None
            if (
                not _finite_number(material_used_g)
                or abs(float(material_used_g) - case.expected_material_used_g) > 0.01
            ):
                return False, "expected_material_mass_regressed"
        return True, "schema2_k3_success_and_height_invariant_valid"

    if (
        case.expected_status != 422
        or body.get("success") is not False
        or body.get("errorCode") != "MODEL_OUT_OF_PRINTER_BOUNDS"
        or not dimensions_close(body.get("model_dimensions_mm"), final)
    ):
        return False, "k2_bounds_payload_invalid"
    return True, "schema2_full_k2_k3_bounds_contract_valid"


def _retry_wait_seconds(body: object) -> int:
    if isinstance(body, dict):
        try:
            parsed = int(body.get("retryAfterSeconds") or DEFAULT_RETRY_WAIT_SECONDS)
        except (TypeError, ValueError):
            parsed = DEFAULT_RETRY_WAIT_SECONDS
        return max(1, min(parsed, 60))
    return DEFAULT_RETRY_WAIT_SECONDS


def run_case(
    base_url: str,
    slice_service_api_key: str,
    case: OrientationCase,
    fixture_path: Path,
    measured_dimensions: Mapping[str, float],
    expected_limits: Mapping[str, float] | None = None,
    native_info_probe=None,
) -> CaseResult:
    """Execute one bounded request with rate-limit retry."""
    fixture_spec = FIXTURE_SPEC_BY_KEY[case.fixture_key]
    precondition_observation = "deliberate_zero_normal_excluded_from_normal_precondition"
    if fixture_spec.requires_native_acceptance:
        probe = native_info_probe or probe_native_model_info
        precondition_ok, precondition_observation = normal_fixture_precondition(
            fixture_path,
            measured_dimensions,
            probe,
        )
        if not precondition_ok:
            return CaseResult(
                key=case.key,
                endpoint=case.endpoint,
                printer=case.printer,
                requested_mode=case.orientation_mode or "default(auto)",
                requested_rotation_deg=case.requested_rotation_deg,
                fixture_key=case.fixture_key,
                layer_height=case.layer_height,
                expected_status=case.expected_status,
                http_status=0,
                error_code=None,
                success=False,
                duration_sec=0.0,
                observation=precondition_observation,
            )
    total_duration = 0.0
    status = 0
    body: object = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        status, body, duration = curl_multipart_slice(
            base_url=base_url,
            endpoint=case.endpoint,
            file_path=fixture_path,
            layer_height=case.layer_height,
            material=MATERIAL,
            slice_service_api_key=slice_service_api_key,
            extra_fields=build_request_fields(case),
        )
        total_duration += duration
        if status != 429 or attempt == MAX_ATTEMPTS:
            break
        wait_seconds = _retry_wait_seconds(body)
        print(
            f"[ORIENTATION TEST] {case.key}: rate limited; "
            f"retrying in {wait_seconds}s ({attempt + 1}/{MAX_ATTEMPTS})"
        )
        time.sleep(wait_seconds)

    success, observation = validate_case_response(
        case, measured_dimensions, status, body, expected_limits,
    )
    observation = f"{precondition_observation};{observation}"
    error_code = body.get("errorCode") if isinstance(body, dict) else None
    return CaseResult(
        key=case.key,
        endpoint=case.endpoint,
        printer=case.printer,
        requested_mode=case.orientation_mode or "default(auto)",
        requested_rotation_deg=case.requested_rotation_deg,
        fixture_key=case.fixture_key,
        layer_height=case.layer_height,
        expected_status=case.expected_status,
        http_status=status,
        error_code=error_code if isinstance(error_code, str) else None,
        success=success,
        duration_sec=total_duration,
        observation=observation,
    )


def write_report(
    base_url: str,
    health_status: int,
    health_success: bool,
    fixtures: Sequence[FixtureObservation],
    results: Sequence[CaseResult],
    catalogue: Sequence[CatalogueObservation] = (),
    native_info_command_source: str = "host-default",
) -> None:
    """Write a bounded privacy-safe owner evidence report."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    fixture_passed = sum(observation.success for observation in fixtures)
    catalogue_passed = sum(observation.success for observation in catalogue)
    case_passed = sum(result.success for result in results)
    matrix_summary = (
        f"{case_passed}/{len(results)} PASS" if results else "NOT_RUN"
    )
    lines = [
        "# J3B Orientation and Native Envelope Integration Test Report",
        "",
        f"Generated at (UTC): **{datetime.now(timezone.utc).isoformat()}**",
        f"Target class: **{report_target_class(base_url)}**",
        f"Health preflight: **{'PASS' if health_success else 'FAIL'}** (`{health_status}`)",
        f"Native-info command source: **{native_info_command_source}**",
        f"Fixture measurements: **{fixture_passed}/{len(fixtures)} PASS**",
        f"Catalogue v2 selectors/envelopes: **{catalogue_passed}/{len(catalogue)} PASS**",
        f"HTTP matrix: **{matrix_summary}**",
        "",
        "## Evidence boundary",
        "",
        "The fixtures are synthetic and are independently remeasured from their on-disk "
        "STL vertices before use. Every normal ASCII matrix row reruns exact native "
        "`prusa-slicer --info <synthetic-fixture>` and requires exit zero plus positive "
        "requested X/Y/Z within tolerance before the service result is evaluated. The "
        "deliberate zero-normal binary regression fixture is separately required to be "
        "rejected by that metadata command and is never admitted to the normal sweep "
        "precondition. This runner validates live HTTP responses and a completed native "
        "slice for HTTP 200 rows. It validates K3 by replaying the "
        "reported total rotation matrix into the final dimensions; process argv and image "
        "identity remain separate exact-image/source evidence. H2D-QUOTE rows use the "
        "catalogue-v2 P1S-derived enlarged quoting selectors on both engines; they do not "
        "claim machine-accurate or production-ready H2D G-code.",
        "",
        "No base URL, hostname, IP address, credential, response body, or temporary path "
        "is retained in this report.",
        "",
        "## Independently measured fixtures",
        "",
        "| Fixture | Kind | Expected X/Y/Z (mm) | Measured X/Y/Z (mm) | Normals | Native info expectation/observation | Result |",
        "|:--------|:-----|:--------------------|:--------------------|:-------:|:-----------------------------------|:------:|",
    ]
    for observation in fixtures:
        expected = "/".join(_format_number(observation.expected_dimensions_mm[axis]) for axis in AXES)
        measured = "/".join(_format_number(observation.measured_dimensions_mm[axis]) for axis in AXES)
        lines.append(
            f"| `{observation.key}` | `{observation.fixture_kind}` | `{expected}` | `{measured}` | "
            f"{'PASS' if observation.facet_normals_valid else 'FAIL'} | "
            f"`{observation.native_info_expectation}/{observation.native_info_observation}` | "
            f"{'PASS' if observation.success else 'FAIL'} |"
        )
    lines.extend([
        "",
        "## Catalogue v2 selector and inclusive-envelope preflight",
        "",
        "| Selector | Result | Observation |",
        "|:---------|:------:|:------------|",
    ])
    for observation in catalogue:
        lines.append(
            f"| `{observation.key}` | {'PASS' if observation.success else 'FAIL'} | "
            f"`{observation.observation}` |"
        )
    lines.extend([
        "",
        "## HTTP matrix",
        "",
        "| Case | Endpoint | Printer | Layer (mm) | Mode | Requested X/Y/Z (deg) | Fixture | Expected/actual | Error code | Result | Observation |",
        "|:-----|:---------|:--------|-----------:|:-----|:----------------------|:--------|:----------------|:-----------|:------:|:------------|",
    ])
    for result in results:
        error_code = result.error_code or "-"
        requested_rotation = "/".join(
            _format_number(value) for value in result.requested_rotation_deg
        )
        lines.append(
            f"| `{result.key}` | `{result.endpoint}` | `{result.printer}` | "
            f"`{_format_number(result.layer_height)}` | `{result.requested_mode}` | "
            f"`{requested_rotation}` | `{result.fixture_key}` | "
            f"`{result.expected_status}/{result.http_status}` | `{error_code}` | "
            f"{'PASS' if result.success else 'FAIL'} | `{result.observation}` |"
        )
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--native-info-command-json",
        default=os.getenv(NATIVE_INFO_COMMAND_ENV),
        help=(
            "No-shell JSON argv template for host or exact-container prusa-slicer --info. "
            "Use {fixture}, or both {fixture_dir} and {fixture_name}."
        ),
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    base_url = resolve_base_url(PROJECT_ROOT)
    slice_service_api_key = resolve_slice_service_api_key(PROJECT_ROOT)
    native_info_command_source = (
        "configured" if args.native_info_command_json else "host-default"
    )
    try:
        native_info_command = parse_native_info_command(args.native_info_command_json)
    except ValueError as error:
        print(f"[ORIENTATION TEST] ERROR: {error}")
        write_report(
            base_url,
            0,
            False,
            [],
            [],
            native_info_command_source="invalid",
        )
        return 1
    native_info_probe = lambda file_path: probe_native_model_info(
        file_path,
        command_template=native_info_command,
    )
    print(
        "[ORIENTATION TEST] "
        f"target_class={report_target_class(base_url)} "
        f"slice_service_api_key_found={bool(slice_service_api_key)} "
        f"native_info_command_source={native_info_command_source}"
    )
    if not slice_service_api_key:
        print("[ORIENTATION TEST] ERROR: SLICE_SERVICE_API_KEY is unavailable.")
        return 1

    health_status, health_body = curl_json(
        method="GET", base_url=base_url, endpoint="/health",
    )
    health_success = (
        health_status == 200
        and isinstance(health_body, dict)
        and health_body.get("status") == "OK"
    )
    catalogue_status, catalogue_body = curl_json(
        method="GET", base_url=base_url, endpoint="/profiles",
    )
    catalogue_limits, catalogue_observations = validate_catalogue_v2(catalogue_body)
    catalogue_success = (
        catalogue_status == 200
        and len(catalogue_limits) == len(PROFILE_SELECTORS)
        and all(observation.success for observation in catalogue_observations)
    )

    results: list[CaseResult] = []
    with tempfile.TemporaryDirectory(prefix="j3-orientation-visibility-") as temp_dir:
        paths, measurements, fixtures = write_and_measure_fixtures(
            Path(temp_dir), native_info_probe=native_info_probe,
        )
        fixtures_valid = all(observation.success for observation in fixtures)
        if health_success and fixtures_valid and catalogue_success:
            for case in build_cases():
                print(f"[ORIENTATION TEST] Running {case.key}")
                results.append(run_case(
                    base_url,
                    slice_service_api_key,
                    case,
                    paths[case.fixture_key],
                    measurements[case.fixture_key],
                    catalogue_limits[(case.engine, case.printer)],
                    native_info_probe=native_info_probe,
                ))

    write_report(
        base_url,
        health_status,
        health_success,
        fixtures,
        results,
        catalogue_observations,
        native_info_command_source,
    )
    failures = [result for result in results if not result.success]
    print(
        f"[ORIENTATION TEST] Completed. matrix_total={len(results)} "
        f"matrix_failed={len(failures)} health_ok={health_success} "
        f"catalogue_ok={catalogue_success}"
    )
    print(f"[ORIENTATION TEST] Report: {REPORT_PATH}")
    for result in failures:
        print(
            f"[ORIENTATION TEST] FAIL {result.key}: "
            f"status={result.http_status} observation={result.observation}"
        )
    complete = (
        health_success
        and catalogue_success
        and all(observation.success for observation in fixtures)
        and len(results) == len(build_cases())
        and not failures
    )
    return 0 if complete else 1


if __name__ == "__main__":
    raise SystemExit(main())
