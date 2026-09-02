"""Mesh-to-STL conversion utility.

Loads supported polygonal mesh formats and exports normalized STL output in
millimetres. Invalid source geometry is reported through one machine-readable
marker line, ``INVALID_SOURCE_GEOMETRY|<short reason>``, written to both
stdout and stderr with exit status 2 so the API can classify it without
parsing free-form text. No automatic repair is ever applied.
"""

import math
import os
import sys

import trimesh


GEOMETRY_MARKER = "INVALID_SOURCE_GEOMETRY"
GEOMETRY_EXIT_CODE = 2

# 3MF ``unit`` attribute values (plus tolerated aliases) scaled to millimetres.
UNIT_TO_MM = {
    "micron": 0.001,
    "microns": 0.001,
    "micrometer": 0.001,
    "micrometre": 0.001,
    "um": 0.001,
    "millimeter": 1.0,
    "millimeters": 1.0,
    "millimetre": 1.0,
    "millimetres": 1.0,
    "mm": 1.0,
    "centimeter": 10.0,
    "centimeters": 10.0,
    "centimetre": 10.0,
    "centimetres": 10.0,
    "cm": 10.0,
    "inch": 25.4,
    "inches": 25.4,
    "in": 25.4,
    "foot": 304.8,
    "feet": 304.8,
    "ft": 304.8,
    "meter": 1000.0,
    "meters": 1000.0,
    "metre": 1000.0,
    "metres": 1000.0,
    "m": 1000.0,
}


class InvalidSourceGeometry(ValueError):
    """Raised when the uploaded file holds no usable geometry."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def _short_reason(reason):
    """Bound a reason to one short printable ASCII token without separators."""
    text = "".join(ch for ch in str(reason) if 0x20 <= ord(ch) <= 0x7E)
    text = text.replace("|", "/").strip()
    return (text[:80] or "unspecified")


def report_invalid_geometry(reason):
    """Emit the marker line on both streams and exit with the geometry status."""
    marker = f"{GEOMETRY_MARKER}|{_short_reason(reason)}"
    print(marker)
    sys.stdout.flush()
    print(marker, file=sys.stderr)
    sys.stderr.flush()
    sys.exit(GEOMETRY_EXIT_CODE)


def _declared_units(*sources):
    """Return the first declared ``units`` label from metadata-bearing objects."""
    for source in sources:
        if source is None:
            continue
        metadata = getattr(source, "metadata", None)
        if isinstance(metadata, dict):
            units = metadata.get("units")
            if isinstance(units, str) and units.strip():
                return units
    return None


def unit_scale_to_mm(units):
    """Resolve the millimetre scale factor for a declared unit label.

    Missing or empty labels mean millimetres (the 3MF default). Any other
    unrecognised label is a malformed source and fails closed.
    """
    if units is None:
        return 1.0
    label = str(units).strip().lower()
    if not label:
        return 1.0
    if label not in UNIT_TO_MM:
        raise InvalidSourceGeometry(f"unsupported unit {label[:24]}")
    return UNIT_TO_MM[label]


def _concatenate_scene(scene):
    """Merge every scene geometry into one mesh without deprecated APIs."""
    if not scene.geometry:
        raise InvalidSourceGeometry("scene is empty")
    to_mesh = getattr(scene, "to_mesh", None)
    if callable(to_mesh):
        return to_mesh()
    return trimesh.util.concatenate(scene.dump())


def _assert_usable_mesh(mesh):
    """Fail closed on empty or degenerate geometry; never repair it."""
    vertices = getattr(mesh, "vertices", None)
    faces = getattr(mesh, "faces", None)
    if vertices is None or faces is None or len(vertices) == 0:
        raise InvalidSourceGeometry("mesh has no vertices")
    if len(faces) == 0:
        raise InvalidSourceGeometry("mesh has no faces")
    extents = getattr(mesh, "extents", None)
    if extents is None or len(extents) != 3:
        raise InvalidSourceGeometry("mesh extents unavailable")
    values = [float(value) for value in extents]
    if any(not math.isfinite(value) for value in values):
        raise InvalidSourceGeometry("mesh extents are not finite")
    if max(values) <= 0.0:
        raise InvalidSourceGeometry("mesh has zero extent")


def _load_as_mesh(input_path):
    """Load input file and normalize to a single millimetre-scaled mesh."""
    loaded = trimesh.load(input_path)
    scene = loaded if isinstance(loaded, trimesh.Scene) else None
    if scene is not None:
        print("[PYTHON] Input is a Scene, merging geometries...")
        geometries = list(scene.geometry.values()) if hasattr(scene.geometry, "values") else []
        units = _declared_units(scene, *geometries)
        mesh = _concatenate_scene(scene)
    else:
        mesh = loaded
        units = _declared_units(mesh)

    factor = unit_scale_to_mm(units)
    if factor != 1.0:
        print(f"[PYTHON] Scaling declared unit '{units}' to millimetres (x{factor}).")
        mesh.apply_scale(factor)
    _assert_usable_mesh(mesh)
    return mesh


def convert_mesh_to_stl(input_path, output_path):
    """Convert a mesh or mesh scene to STL.

    Args:
        input_path: Path to input mesh (.obj, .3mf, .ply).
        output_path: Destination STL output path.

    Returns:
        None. Writes STL output to disk.

    Raises:
        SystemExit: Status 2 with the geometry marker for invalid geometry,
            status 1 for every other failure. Resource exhaustion
            (``MemoryError``) and I/O failures (``OSError`` other than a
            missing input) are server-side faults, so they exit 1 WITHOUT
            the marker and are never reported as the customer's bad geometry.
    """
    print(f"[PYTHON] Loading mesh: {os.path.basename(str(input_path))}")
    try:
        mesh = _load_as_mesh(input_path)
    except FileNotFoundError:
        print("[PYTHON] ERROR: Input mesh file was not found.")
        sys.exit(1)
    except InvalidSourceGeometry as error:
        report_invalid_geometry(error.reason)
    except (MemoryError, OSError) as error:
        print(f"[PYTHON] ERROR: Could not load this mesh file. {type(error).__name__}")
        sys.exit(1)
    except Exception as error:  # noqa: BLE001 - any loader/parse failure is a bad source
        report_invalid_geometry(f"unloadable {type(error).__name__}")

    try:
        mesh.export(output_path)
        print(f"[PYTHON] Success! Exported to {os.path.basename(str(output_path))}")
    except Exception as error:  # noqa: BLE001
        print(f"[PYTHON] ERROR: Could not export this mesh file. {type(error).__name__}")
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 mesh2stl.py input.(obj|3mf|ply) output.stl")
        sys.exit(1)

    convert_mesh_to_stl(sys.argv[1], sys.argv[2])
