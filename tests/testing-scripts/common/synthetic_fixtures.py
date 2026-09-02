"""Deterministic, privacy-safe synthetic model fixtures for integration runners.

The gitignored ``tests/testing-files`` corpus is private and may be absent on a
fresh checkout. Every runner that needs a model can instead call one of the
generators below. They are numpy-free (``struct`` only), fully deterministic
(no timestamps, fixed headers, stored ZIP entries), and produce closed,
consistently wound meshes with outward non-zero facet normals so that native
``--info`` probes and the API's fail-fast geometry policy accept them.

Every generator takes an output directory, writes exactly one file, and
returns its path. ``sha256_of_file`` and ``inspect_binary_stl`` are provided
so a runner can prove the fixture it uploaded is the fixture it intended.
"""

from __future__ import annotations

import hashlib
import math
import struct
import zipfile
from pathlib import Path
from typing import Callable, Sequence

Vector = tuple[float, float, float]
Triangle = tuple[Vector, Vector, Vector, Vector]  # (normal, a, b, c)

STL_HEADER_TEXT = b"r3d synthetic fixture (binary STL, deterministic)"
STL_HEADER_SIZE = 80
STL_TRIANGLE_STRUCT = struct.Struct("<12fH")
ZIP_FIXED_DATE_TIME = (1980, 1, 1, 0, 0, 0)
NORMAL_TOLERANCE = 1e-6

DEFAULT_CUBOID_MM = (40.0, 30.0, 20.0)
DEFAULT_CYLINDER_RADIUS_MM = 15.0
DEFAULT_CYLINDER_HEIGHT_MM = 25.0
DEFAULT_CYLINDER_SEGMENTS = 64
L_BRACKET_OVERHANG_MM = 32.0
L_BRACKET_POST_MM = 20.0
L_BRACKET_DEPTH_MM = 20.0
L_BRACKET_ARM_THICKNESS_MM = 10.0
L_BRACKET_HEIGHT_MM = 50.0
THIN_WALL_BOX_OUTER_MM = (30.0, 30.0, 20.0)
THIN_WALL_BOX_WALL_MM = 1.2


def sha256_of_file(path: Path) -> str:
    """Return the lowercase hexadecimal SHA-256 of one file, read in bounded chunks."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_of_bytes(payload: bytes) -> str:
    """Return the lowercase hexadecimal SHA-256 of an in-memory payload."""
    return hashlib.sha256(payload).hexdigest()


def _sub(left: Vector, right: Vector) -> Vector:
    return (left[0] - right[0], left[1] - right[1], left[2] - right[2])


def _cross(left: Vector, right: Vector) -> Vector:
    return (
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    )


def _dot(left: Vector, right: Vector) -> float:
    return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]


def _normalize(vector: Vector) -> Vector:
    length = math.sqrt(_dot(vector, vector))
    if length <= 0.0:
        raise ValueError("Degenerate facet normal.")
    return (vector[0] / length, vector[1] / length, vector[2] / length)


def _oriented_triangle(a: Vector, b: Vector, c: Vector, outward: Vector) -> Triangle:
    """Return a facet wound so its right-hand normal points along ``outward``."""
    computed = _cross(_sub(b, a), _sub(c, a))
    if _dot(computed, outward) < 0.0:
        b, c = c, b
        computed = _cross(_sub(b, a), _sub(c, a))
    return (_normalize(computed), a, b, c)


def _quad(a: Vector, b: Vector, c: Vector, d: Vector, outward: Vector) -> list[Triangle]:
    """Split a planar quad (a, b, c, d in perimeter order) into two facets."""
    return [
        _oriented_triangle(a, b, c, outward),
        _oriented_triangle(a, c, d, outward),
    ]


def _polygon_signed_area(profile: Sequence[tuple[float, float]]) -> float:
    total = 0.0
    for index, (u0, v0) in enumerate(profile):
        u1, v1 = profile[(index + 1) % len(profile)]
        total += u0 * v1 - u1 * v0
    return total / 2.0


def _extrude_profile(
    profile: Sequence[tuple[float, float]],
    cap_triangles: Sequence[tuple[int, int, int]],
    length: float,
    to3d: Callable[[float, float, float], Vector],
    axis_w: Vector,
) -> list[Triangle]:
    """Extrude a CCW planar polygon along ``axis_w`` from 0 to ``length``.

    ``to3d(u, v, w)`` maps profile coordinates plus extrusion distance to 3D.
    ``cap_triangles`` must triangulate the profile using only profile vertices
    so the caps share every side vertex and the result stays watertight.
    """
    if _polygon_signed_area(profile) <= 0.0:
        raise ValueError("Extrusion profiles must be counter-clockwise.")
    negative_w = (-axis_w[0], -axis_w[1], -axis_w[2])
    triangles: list[Triangle] = []
    bottom = [to3d(u, v, 0.0) for u, v in profile]
    top = [to3d(u, v, length) for u, v in profile]
    for i, j, k in cap_triangles:
        triangles.append(_oriented_triangle(bottom[i], bottom[j], bottom[k], negative_w))
        triangles.append(_oriented_triangle(top[i], top[j], top[k], axis_w))
    for index in range(len(profile)):
        next_index = (index + 1) % len(profile)
        du = profile[next_index][0] - profile[index][0]
        dv = profile[next_index][1] - profile[index][1]
        # Outward side normal of a CCW polygon edge is the edge rotated -90 deg.
        outward = _sub(to3d(dv, -du, 0.0), to3d(0.0, 0.0, 0.0))
        triangles.extend(_quad(
            bottom[index], bottom[next_index], top[next_index], top[index], outward,
        ))
    return triangles


def cuboid_triangles(dimensions_mm: Sequence[float]) -> list[Triangle]:
    """Twelve outward-wound facets of an axis-aligned cuboid anchored at the origin."""
    x, y, z = (float(value) for value in dimensions_mm)
    if min(x, y, z) <= 0.0:
        raise ValueError("Cuboid dimensions must be positive.")
    profile = [(0.0, 0.0), (x, 0.0), (x, y), (0.0, y)]
    return _extrude_profile(
        profile, [(0, 1, 2), (0, 2, 3)], z,
        lambda u, v, w: (u, v, w), (0.0, 0.0, 1.0),
    )


def cylinder_triangles(radius_mm: float, height_mm: float, segments: int) -> list[Triangle]:
    """Facets of a Z-axis cylinder whose base circle is centred on the origin."""
    if radius_mm <= 0.0 or height_mm <= 0.0 or segments < 8:
        raise ValueError("Cylinder parameters are out of range.")
    profile = [
        (
            round(radius_mm * math.cos(2.0 * math.pi * index / segments), 9),
            round(radius_mm * math.sin(2.0 * math.pi * index / segments), 9),
        )
        for index in range(segments)
    ]
    caps = [(0, index, index + 1) for index in range(1, segments - 1)]
    return _extrude_profile(
        profile, caps, height_mm, lambda u, v, w: (u, v, w), (0.0, 0.0, 1.0),
    )


def l_bracket_triangles(
    *,
    overhang_mm: float = L_BRACKET_OVERHANG_MM,
    post_mm: float = L_BRACKET_POST_MM,
    depth_mm: float = L_BRACKET_DEPTH_MM,
    arm_thickness_mm: float = L_BRACKET_ARM_THICKNESS_MM,
    height_mm: float = L_BRACKET_HEIGHT_MM,
) -> list[Triangle]:
    """An L-bracket: a vertical post with a horizontal arm overhanging in +X.

    The arm hangs ``overhang_mm`` beyond the post with nothing beneath it, so
    the fixture needs supports and exercises ``supports=true|false`` honestly.
    The profile lies in the XZ plane and is extruded along +Y.
    """
    if min(overhang_mm, post_mm, depth_mm, arm_thickness_mm) <= 0.0 or height_mm <= arm_thickness_mm:
        raise ValueError("L-bracket parameters are out of range.")
    arm_bottom = height_mm - arm_thickness_mm
    arm_end = post_mm + overhang_mm
    # (u, v) = (x, z); counter-clockwise when viewed with X right and Z up.
    profile = [
        (0.0, 0.0), (post_mm, 0.0), (post_mm, arm_bottom),
        (arm_end, arm_bottom), (arm_end, height_mm), (0.0, height_mm),
    ]
    # Fan from the single reflex vertex (index 2) keeps every cap facet inside.
    caps = [(2, 3, 4), (2, 4, 5), (2, 5, 0), (2, 0, 1)]
    return _extrude_profile(
        profile, caps, depth_mm, lambda u, v, w: (u, w, v), (0.0, 1.0, 0.0),
    )


def thin_wall_open_box_triangles(
    outer_mm: Sequence[float] = THIN_WALL_BOX_OUTER_MM,
    wall_mm: float = THIN_WALL_BOX_WALL_MM,
) -> list[Triangle]:
    """A closed-manifold open-top box with thin walls and a thin floor."""
    x, y, z = (float(value) for value in outer_mm)
    t = float(wall_mm)
    if t <= 0.0 or min(x, y) <= 2.0 * t or z <= t:
        raise ValueError("Thin-wall box parameters are out of range.")
    triangles: list[Triangle] = []
    ob = [(0.0, 0.0, 0.0), (x, 0.0, 0.0), (x, y, 0.0), (0.0, y, 0.0)]
    ot = [(0.0, 0.0, z), (x, 0.0, z), (x, y, z), (0.0, y, z)]
    ib = [(t, t, t), (x - t, t, t), (x - t, y - t, t), (t, y - t, t)]
    it = [(t, t, z), (x - t, t, z), (x - t, y - t, z), (t, y - t, z)]
    outward_sides = [(0.0, -1.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (-1.0, 0.0, 0.0)]
    triangles.extend(_quad(ob[0], ob[1], ob[2], ob[3], (0.0, 0.0, -1.0)))
    triangles.extend(_quad(ib[0], ib[1], ib[2], ib[3], (0.0, 0.0, 1.0)))
    for index in range(4):
        nxt = (index + 1) % 4
        outward = outward_sides[index]
        inward = (-outward[0], -outward[1], -outward[2])
        triangles.extend(_quad(ob[index], ob[nxt], ot[nxt], ot[index], outward))
        triangles.extend(_quad(ib[index], ib[nxt], it[nxt], it[index], inward))
        triangles.extend(_quad(ot[index], ot[nxt], it[nxt], it[index], (0.0, 0.0, 1.0)))
    return triangles


def encode_binary_stl(triangles: Sequence[Triangle]) -> bytes:
    """Serialise facets as a binary STL with a fixed header and zero attributes."""
    header = STL_HEADER_TEXT.ljust(STL_HEADER_SIZE, b"\0")[:STL_HEADER_SIZE]
    chunks = [header, struct.pack("<I", len(triangles))]
    for normal, a, b, c in triangles:
        chunks.append(STL_TRIANGLE_STRUCT.pack(*normal, *a, *b, *c, 0))
    return b"".join(chunks)


def encode_obj(triangles: Sequence[Triangle], object_name: str) -> bytes:
    """Serialise facets as a Wavefront OBJ with deduplicated vertices."""
    if not object_name.isidentifier():
        raise ValueError("OBJ object names must be identifier-safe.")
    vertex_index: dict[Vector, int] = {}
    vertex_lines: list[str] = []
    face_lines: list[str] = []
    for _normal, *corners in triangles:
        indices = []
        for corner in corners:
            if corner not in vertex_index:
                vertex_index[corner] = len(vertex_index) + 1
                vertex_lines.append("v " + " ".join(f"{value:.6f}" for value in corner))
            indices.append(vertex_index[corner])
        face_lines.append("f " + " ".join(str(index) for index in indices))
    body = [f"o {object_name}", *vertex_lines, *face_lines]
    return ("\n".join(body) + "\n").encode("ascii")


def _write(path: Path, payload: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return path


def write_cuboid_stl(
    output_dir: Path,
    dimensions_mm: Sequence[float] = DEFAULT_CUBOID_MM,
    name: str | None = None,
) -> Path:
    """Write an axis-aligned cuboid binary STL and return its path."""
    x, y, z = dimensions_mm
    file_name = name or f"cuboid_{_token(x)}x{_token(y)}x{_token(z)}.stl"
    return _write(Path(output_dir) / file_name, encode_binary_stl(cuboid_triangles(dimensions_mm)))


def write_cylinder_stl(
    output_dir: Path,
    radius_mm: float = DEFAULT_CYLINDER_RADIUS_MM,
    height_mm: float = DEFAULT_CYLINDER_HEIGHT_MM,
    segments: int = DEFAULT_CYLINDER_SEGMENTS,
    name: str | None = None,
) -> Path:
    """Write a Z-axis cylinder binary STL and return its path."""
    file_name = name or f"cylinder_r{_token(radius_mm)}_h{_token(height_mm)}.stl"
    return _write(
        Path(output_dir) / file_name,
        encode_binary_stl(cylinder_triangles(radius_mm, height_mm, segments)),
    )


def write_l_bracket_stl(output_dir: Path, name: str = "l_bracket_overhang_32mm.stl") -> Path:
    """Write the 32 mm overhang L-bracket binary STL and return its path."""
    return _write(Path(output_dir) / name, encode_binary_stl(l_bracket_triangles()))


def write_thin_wall_open_box_stl(output_dir: Path, name: str = "thin_wall_open_box.stl") -> Path:
    """Write the thin-wall open box binary STL and return its path."""
    return _write(Path(output_dir) / name, encode_binary_stl(thin_wall_open_box_triangles()))


def write_cuboid_obj(
    output_dir: Path,
    dimensions_mm: Sequence[float] = DEFAULT_CUBOID_MM,
    name: str | None = None,
) -> Path:
    """Write the cuboid as a Wavefront OBJ and return its path."""
    x, y, z = dimensions_mm
    file_name = name or f"cuboid_{_token(x)}x{_token(y)}x{_token(z)}.obj"
    return _write(
        Path(output_dir) / file_name,
        encode_obj(cuboid_triangles(dimensions_mm), "synthetic_cuboid"),
    )


def write_stl_zip(output_dir: Path, stl_path: Path, name: str | None = None) -> Path:
    """Wrap exactly one STL in a deterministic stored ZIP and return the ZIP path."""
    stl_path = Path(stl_path)
    if stl_path.suffix.lower() != ".stl":
        raise ValueError("Only an STL may be wrapped.")
    zip_path = Path(output_dir) / (name or f"{stl_path.stem}.zip")
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    info = zipfile.ZipInfo(stl_path.name, date_time=ZIP_FIXED_DATE_TIME)
    info.compress_type = zipfile.ZIP_STORED
    info.external_attr = 0o644 << 16
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr(info, stl_path.read_bytes())
    return zip_path


def _token(value: float) -> str:
    return f"{float(value):.3f}".rstrip("0").rstrip(".").replace(".", "p").replace("-", "m")


def inspect_binary_stl(path: Path) -> dict[str, float | int]:
    """Measure a binary STL: facet count, bounding box, and normal consistency.

    Raises ``ValueError`` when the file is not a well-formed binary STL, when a
    facet is degenerate, or when a stored normal disagrees with the computed
    right-hand normal (which would mean an inconsistently wound fixture).
    """
    payload = Path(path).read_bytes()
    if len(payload) < STL_HEADER_SIZE + 4:
        raise ValueError("Binary STL is truncated.")
    (count,) = struct.unpack_from("<I", payload, STL_HEADER_SIZE)
    expected_size = STL_HEADER_SIZE + 4 + count * STL_TRIANGLE_STRUCT.size
    if count == 0 or len(payload) != expected_size:
        raise ValueError("Binary STL facet count does not match its size.")
    minimum = [math.inf] * 3
    maximum = [-math.inf] * 3
    directed_edges: dict[tuple[Vector, Vector], int] = {}
    offset = STL_HEADER_SIZE + 4
    for _ in range(count):
        values = STL_TRIANGLE_STRUCT.unpack_from(payload, offset)
        offset += STL_TRIANGLE_STRUCT.size
        normal = values[0:3]
        a, b, c = values[3:6], values[6:9], values[9:12]
        computed = _normalize(_cross(_sub(b, a), _sub(c, a)))
        if _dot(computed, normal) < 1.0 - 1e-3:
            raise ValueError("Stored facet normal disagrees with vertex winding.")
        for start, end in ((a, b), (b, c), (c, a)):
            directed_edges[(start, end)] = directed_edges.get((start, end), 0) + 1
        for corner in (a, b, c):
            for axis in range(3):
                minimum[axis] = min(minimum[axis], corner[axis])
                maximum[axis] = max(maximum[axis], corner[axis])
    for (start, end), occurrences in directed_edges.items():
        if occurrences != 1 or directed_edges.get((end, start)) != 1:
            raise ValueError("Binary STL is not a closed, consistently wound manifold.")
    return {
        "facets": count,
        "x": round(maximum[0] - minimum[0], 6),
        "y": round(maximum[1] - minimum[1], 6),
        "z": round(maximum[2] - minimum[2], 6),
    }


def dimensions_close(observed: object, expected: Sequence[float], tolerance: float = 0.05) -> bool:
    """Compare an ``{x, y, z}`` mapping against an ``(x, y, z)`` triple."""
    if not isinstance(observed, dict):
        return False
    try:
        return all(
            abs(float(observed[axis]) - float(value)) <= tolerance
            for axis, value in zip(("x", "y", "z"), expected)
        )
    except (KeyError, TypeError, ValueError):
        return False


def write_standard_fixture_set(output_dir: Path) -> list[Path]:
    """Write the canonical runner fixture set and return the paths in stable order."""
    output_dir = Path(output_dir)
    cuboid = write_cuboid_stl(output_dir)
    return [
        cuboid,
        write_cylinder_stl(output_dir),
        write_l_bracket_stl(output_dir),
        write_thin_wall_open_box_stl(output_dir),
        write_cuboid_obj(output_dir),
        write_stl_zip(output_dir, cuboid),
    ]
