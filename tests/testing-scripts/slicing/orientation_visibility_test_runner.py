"""Owner-run HTTP proof for J3 orientation visibility and control.

The runner creates synthetic ASCII STL cuboids in a private temporary
directory, independently measures the vertices written to disk, and exercises
the approved auto/preserve contract against both slice engines.  Reports never
retain the selected host, credentials, response bodies, or temporary paths.
"""

from __future__ import annotations

import ipaddress
import math
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
    "original_dimensions_mm",
    "oriented_dimensions_mm",
    "final_dimensions_mm",
})
P1S_LIMITS = {"x": 256.0, "y": 256.0, "z": 250.0}
H2D_LIMITS = {"x": 350.0, "y": 320.0, "z": 325.0}
MINIMUM_LIMITS = {"x": 1.0, "y": 1.0, "z": 1.0}
LAYER_HEIGHT = 0.2
MATERIAL = "PLA"
MAX_ATTEMPTS = 3
DEFAULT_RETRY_WAIT_SECONDS = 20
DIMENSION_TOLERANCE_MM = 0.01
MATRIX_TOLERANCE = 1e-5


@dataclass(frozen=True)
class FixtureSpec:
    """Synthetic cuboid input owned by this runner."""

    key: str
    dimensions_mm: tuple[float, float, float]

    @property
    def filename(self) -> str:
        return f"{self.key}.stl"


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
    requested_rotation_deg: tuple[float, float, float] = (0.0, 0.0, 0.0)

    @property
    def endpoint(self) -> str:
        return f"/{self.engine}/slice"

    @property
    def expected_mode(self) -> str:
        return self.orientation_mode or "auto"

    @property
    def expected_limits(self) -> dict[str, float]:
        return dict(H2D_LIMITS if self.printer == "H2D" else P1S_LIMITS)


@dataclass(frozen=True)
class FixtureObservation:
    """Independent measurement of one generated fixture."""

    key: str
    expected_dimensions_mm: dict[str, float]
    measured_dimensions_mm: dict[str, float]
    success: bool


@dataclass(frozen=True)
class CaseResult:
    """Bounded, report-safe result for one live request."""

    key: str
    endpoint: str
    printer: str
    requested_mode: str
    requested_rotation_deg: tuple[float, float, float]
    fixture_key: str
    expected_status: int
    http_status: int
    error_code: str | None
    success: bool
    duration_sec: float
    observation: str


FIXTURE_SPECS = (
    FixtureSpec("j3_primary_20x255x255", (20.0, 255.0, 255.0)),
    FixtureSpec("j3_distinct_20x240x245", (20.0, 240.0, 245.0)),
    FixtureSpec("j2_z230_20x20x230", (20.0, 20.0, 230.0)),
    FixtureSpec("j2_z260_20x20x260", (20.0, 20.0, 260.0)),
    FixtureSpec("j2_x300_300x20x20", (300.0, 20.0, 20.0)),
)


def _case(
    key: str,
    engine: str,
    printer: str,
    fixture_key: str,
    orientation_mode: str | None,
    expected_status: int,
    require_auto_applied: bool | None = None,
    requested_rotation_deg: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> OrientationCase:
    return OrientationCase(
        key=key,
        engine=engine,
        printer=printer,
        fixture_key=fixture_key,
        orientation_mode=orientation_mode,
        expected_status=expected_status,
        require_auto_applied=require_auto_applied,
        requested_rotation_deg=requested_rotation_deg,
    )


def build_cases() -> tuple[OrientationCase, ...]:
    """Return the approved J3 matrix plus both-engine J2 regressions."""
    cases: list[OrientationCase] = []
    primary = "j3_primary_20x255x255"
    distinct = "j3_distinct_20x240x245"

    for engine in ("prusa", "orca"):
        cases.extend([
            _case(
                f"{engine}-p1s-primary-default-auto",
                engine, "P1S", primary, None, 200, True,
            ),
            _case(
                f"{engine}-p1s-primary-explicit-auto",
                engine, "P1S", primary, "auto", 200, True,
            ),
            _case(
                f"{engine}-p1s-primary-preserve-bounds",
                engine, "P1S", primary, "preserve", 422, False,
            ),
            _case(
                f"{engine}-p1s-distinct-auto-request-z90",
                engine, "P1S", distinct, "auto", 200, True, (0.0, 0.0, 90.0),
            ),
            _case(
                f"{engine}-p1s-distinct-preserve",
                engine, "P1S", distinct, "preserve", 200, False,
            ),
        ])

    # The repository exposes an H2D selector only for Orca.  A Prusa H2D row
    # would invent a profile that the service does not offer.
    cases.extend([
        _case("orca-h2d-primary-auto", "orca", "H2D", primary, "auto", 200, True),
        _case(
            "orca-h2d-primary-preserve",
            "orca", "H2D", primary, "preserve", 200, False,
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
    return tuple(cases)


def _format_number(value: float) -> str:
    rounded = round(float(value), 9)
    if rounded.is_integer():
        return str(int(rounded))
    return f"{rounded:.9f}".rstrip("0").rstrip(".")


def cuboid_ascii_stl(dimensions_mm: Sequence[float], solid_name: str) -> bytes:
    """Create a deterministic 12-triangle ASCII STL cuboid."""
    if (
        len(dimensions_mm) != 3
        or any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or value <= 0
            for value in dimensions_mm
        )
        or not solid_name
        or not all(character.isalnum() or character == "_" for character in solid_name)
    ):
        raise ValueError("Cuboid fixture inputs are invalid.")

    x, y, z = (float(value) for value in dimensions_mm)
    p000 = (0.0, 0.0, 0.0)
    p100 = (x, 0.0, 0.0)
    p010 = (0.0, y, 0.0)
    p110 = (x, y, 0.0)
    p001 = (0.0, 0.0, z)
    p101 = (x, 0.0, z)
    p011 = (0.0, y, z)
    p111 = (x, y, z)
    triangles = (
        (p000, p010, p110), (p000, p110, p100),
        (p001, p101, p111), (p001, p111, p011),
        (p000, p100, p101), (p000, p101, p001),
        (p100, p110, p111), (p100, p111, p101),
        (p110, p010, p011), (p110, p011, p111),
        (p010, p000, p001), (p010, p001, p011),
    )
    lines = [f"solid {solid_name}"]
    for triangle in triangles:
        lines.extend(("  facet normal 0 0 0", "    outer loop"))
        for vertex in triangle:
            coordinates = " ".join(_format_number(value) for value in vertex)
            lines.append(f"      vertex {coordinates}")
        lines.extend(("    endloop", "  endfacet"))
    lines.append(f"endsolid {solid_name}")
    return ("\n".join(lines) + "\n").encode("ascii")


def measure_ascii_stl(file_path: Path) -> dict[str, float]:
    """Measure the on-disk ASCII STL from parsed vertex coordinates."""
    try:
        lines = file_path.read_text(encoding="ascii").splitlines()
    except (OSError, UnicodeError) as error:
        raise ValueError("Fixture is not a readable ASCII STL.") from error

    vertices: list[tuple[float, float, float]] = []
    for line in lines:
        parts = line.strip().split()
        if not parts or parts[0].lower() != "vertex":
            continue
        if len(parts) != 4:
            raise ValueError("Fixture contains a malformed STL vertex.")
        try:
            vertex = tuple(float(token) for token in parts[1:])
        except ValueError as error:
            raise ValueError("Fixture contains a non-numeric STL vertex.") from error
        if any(not math.isfinite(value) for value in vertex):
            raise ValueError("Fixture contains a non-finite STL vertex.")
        vertices.append(vertex)

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


def write_and_measure_fixtures(
    directory: Path,
) -> tuple[dict[str, Path], dict[str, dict[str, float]], list[FixtureObservation]]:
    """Write synthetic fixtures and independently measure every on-disk STL."""
    paths: dict[str, Path] = {}
    measurements: dict[str, dict[str, float]] = {}
    observations: list[FixtureObservation] = []
    for spec in FIXTURE_SPECS:
        fixture_path = directory / spec.filename
        fixture_path.write_bytes(cuboid_ascii_stl(spec.dimensions_mm, spec.key))
        measured = measure_ascii_stl(fixture_path)
        expected = _axis_map(spec.dimensions_mm)
        success = dimensions_close(measured, expected)
        observations.append(FixtureObservation(spec.key, expected, measured, success))
        paths[spec.key] = fixture_path
        measurements[spec.key] = measured
    return paths, measurements, observations


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
    if case.engine == "orca":
        fields.update({
            "printerProfile": f"Bambu_{case.printer}_0.4_nozzle.json",
            "processProfile": "FDM_0.2mm.json",
        })
    elif case.engine == "prusa" and case.printer == "P1S":
        fields["printerProfile"] = "FDM_0.2mm.ini"
    else:
        raise ValueError("The case references an unavailable engine/profile pair.")
    if case.orientation_mode is not None:
        fields["orientationMode"] = case.orientation_mode
    return fields


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


def validate_model_transform(
    transform: object,
    case: OrientationCase,
    measured_dimensions: Mapping[str, float],
) -> tuple[bool, str]:
    """Validate K1/K3 and the approved orientation semantics."""
    if not isinstance(transform, dict) or set(transform) != MODEL_TRANSFORM_FIELDS:
        return False, "model_transform_shape_invalid"
    if transform.get("transform_schema") != 1:
        return False, "k1_transform_schema_invalid"
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

    original = transform.get("original_dimensions_mm")
    oriented = transform.get("oriented_dimensions_mm")
    final = transform.get("final_dimensions_mm")
    if not dimensions_close(original, measured_dimensions):
        return False, "original_dimensions_not_submitted_dimensions"
    replayed_oriented = replay_rotated_dimensions(
        measured_dimensions, automatic_matrix,
    )
    if not dimensions_close(replayed_oriented, oriented):
        return False, "automatic_rotation_matrix_not_replayable"
    replayed_final = replay_rotated_dimensions(measured_dimensions, total_matrix)
    if not dimensions_close(replayed_final, final):
        return False, "k3_rotation_matrix_not_replayable"

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
    return True, "versioned_transform_and_replay_valid"


def _validate_limits(payload: object, case: OrientationCase) -> bool:
    return (
        isinstance(payload, dict)
        and set(payload) == {"min", "max", "source_profile"}
        and dimensions_close(payload.get("min"), MINIMUM_LIMITS)
        and dimensions_close(payload.get("max"), case.expected_limits)
        and isinstance(payload.get("source_profile"), str)
        and Path(payload["source_profile"]).name == payload["source_profile"]
    )


def validate_case_response(
    case: OrientationCase,
    measured_dimensions: Mapping[str, float],
    status: int,
    body: object,
) -> tuple[bool, str]:
    """Validate one success or K2 bounds response without retaining raw data."""
    if status != case.expected_status:
        return False, "unexpected_http_status"
    if not isinstance(body, dict):
        return False, "response_not_json_object"
    transform = body.get("model_transform")
    transform_ok, transform_observation = validate_model_transform(
        transform, case, measured_dimensions,
    )
    if not transform_ok:
        return False, transform_observation
    if not _validate_limits(body.get("build_volume_limits_mm"), case):
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
        return True, "k1_k3_success_and_height_invariant_valid"

    if (
        case.expected_status != 422
        or body.get("success") is not False
        or body.get("errorCode") != "MODEL_OUT_OF_PRINTER_BOUNDS"
        or not dimensions_close(body.get("model_dimensions_mm"), final)
    ):
        return False, "k2_bounds_payload_invalid"
    return True, "k1_k2_k3_bounds_contract_valid"


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
) -> CaseResult:
    """Execute one bounded request with rate-limit retry."""
    total_duration = 0.0
    status = 0
    body: object = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        status, body, duration = curl_multipart_slice(
            base_url=base_url,
            endpoint=case.endpoint,
            file_path=fixture_path,
            layer_height=LAYER_HEIGHT,
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
        case, measured_dimensions, status, body,
    )
    error_code = body.get("errorCode") if isinstance(body, dict) else None
    return CaseResult(
        key=case.key,
        endpoint=case.endpoint,
        printer=case.printer,
        requested_mode=case.orientation_mode or "default(auto)",
        requested_rotation_deg=case.requested_rotation_deg,
        fixture_key=case.fixture_key,
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
) -> None:
    """Write a bounded privacy-safe owner evidence report."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    fixture_passed = sum(observation.success for observation in fixtures)
    case_passed = sum(result.success for result in results)
    matrix_summary = (
        f"{case_passed}/{len(results)} PASS" if results else "NOT_RUN"
    )
    lines = [
        "# J3 Orientation Visibility Integration Test Report",
        "",
        f"Generated at (UTC): **{datetime.now(timezone.utc).isoformat()}**",
        f"Target class: **{report_target_class(base_url)}**",
        f"Health preflight: **{'PASS' if health_success else 'FAIL'}** (`{health_status}`)",
        f"Fixture measurements: **{fixture_passed}/{len(fixtures)} PASS**",
        f"HTTP matrix: **{matrix_summary}**",
        "",
        "## Evidence boundary",
        "",
        "The fixtures are synthetic and are independently remeasured from their on-disk "
        "ASCII STL vertices before use. This runner validates live HTTP responses and a "
        "completed native slice for HTTP 200 rows. It validates K3 by replaying the "
        "reported total rotation matrix into the final dimensions; process argv and image "
        "identity remain separate exact-image/source evidence. The repository offers H2D "
        "only through Orca, so no synthetic Prusa H2D profile is claimed.",
        "",
        "No base URL, hostname, IP address, credential, response body, or temporary path "
        "is retained in this report.",
        "",
        "## Independently measured fixtures",
        "",
        "| Fixture | Expected X/Y/Z (mm) | Measured X/Y/Z (mm) | Result |",
        "|:--------|:--------------------|:--------------------|:------:|",
    ]
    for observation in fixtures:
        expected = "/".join(_format_number(observation.expected_dimensions_mm[axis]) for axis in AXES)
        measured = "/".join(_format_number(observation.measured_dimensions_mm[axis]) for axis in AXES)
        lines.append(
            f"| `{observation.key}` | `{expected}` | `{measured}` | "
            f"{'PASS' if observation.success else 'FAIL'} |"
        )
    lines.extend([
        "",
        "## HTTP matrix",
        "",
        "| Case | Endpoint | Printer | Mode | Requested X/Y/Z (deg) | Fixture | Expected/actual | Error code | Result | Observation |",
        "|:-----|:---------|:--------|:-----|:----------------------|:--------|:----------------|:-----------|:------:|:------------|",
    ])
    for result in results:
        error_code = result.error_code or "-"
        requested_rotation = "/".join(
            _format_number(value) for value in result.requested_rotation_deg
        )
        lines.append(
            f"| `{result.key}` | `{result.endpoint}` | `{result.printer}` | "
            f"`{result.requested_mode}` | `{requested_rotation}` | `{result.fixture_key}` | "
            f"`{result.expected_status}/{result.http_status}` | `{error_code}` | "
            f"{'PASS' if result.success else 'FAIL'} | `{result.observation}` |"
        )
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    base_url = resolve_base_url(PROJECT_ROOT)
    slice_service_api_key = resolve_slice_service_api_key(PROJECT_ROOT)
    print(
        "[ORIENTATION TEST] "
        f"target_class={report_target_class(base_url)} "
        f"slice_service_api_key_found={bool(slice_service_api_key)}"
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

    results: list[CaseResult] = []
    with tempfile.TemporaryDirectory(prefix="j3-orientation-visibility-") as temp_dir:
        paths, measurements, fixtures = write_and_measure_fixtures(Path(temp_dir))
        fixtures_valid = all(observation.success for observation in fixtures)
        if health_success and fixtures_valid:
            for case in build_cases():
                print(f"[ORIENTATION TEST] Running {case.key}")
                results.append(run_case(
                    base_url,
                    slice_service_api_key,
                    case,
                    paths[case.fixture_key],
                    measurements[case.fixture_key],
                ))

    write_report(base_url, health_status, health_success, fixtures, results)
    failures = [result for result in results if not result.success]
    print(
        f"[ORIENTATION TEST] Completed. matrix_total={len(results)} "
        f"matrix_failed={len(failures)} health_ok={health_success}"
    )
    print(f"[ORIENTATION TEST] Report: {REPORT_PATH}")
    for result in failures:
        print(
            f"[ORIENTATION TEST] FAIL {result.key}: "
            f"status={result.http_status} observation={result.observation}"
        )
    complete = (
        health_success
        and all(observation.success for observation in fixtures)
        and len(results) == len(build_cases())
        and not failures
    )
    return 0 if complete else 1


if __name__ == "__main__":
    raise SystemExit(main())
