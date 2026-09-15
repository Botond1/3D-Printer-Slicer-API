"""Mesh-to-STL conversion utility.

Loads supported polygonal mesh formats and exports normalized STL output in
millimetres. Invalid source geometry is reported through one machine-readable
marker line, ``INVALID_SOURCE_GEOMETRY|<short reason>``, written to both
stdout and stderr with exit status 2 so the API can classify it without
parsing free-form text. No automatic repair is ever applied.

A 3MF is flattened here, exactly as its build declares it (3MF core plus the
production extension's external model parts): every build item, through
every component with its transform, down to the mesh objects. Slicer project
files (Bambu Studio, OrcaSlicer, PrusaSlicer) keep their geometry in such
parts, and a generic loader can miscount instanced parts - measured on real
customer files, one loader returned nine copies of a nine-item plate. The
walk below is the contract.
"""

import io
import math
import os
import sys
import zipfile

import trimesh

# numpy and lxml are pinned in the image and imported where the 3MF walk needs
# them, so the converter module still loads (and its marker contract still
# tests) on a machine without the geometry stack.


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


THREE_MF_ROOT_MODEL = "3d/3dmodel.model"
THREE_MF_PRINTED_TYPES = {"model", "solidsupport", "support"}
THREE_MF_MAX_PARTS = 512
THREE_MF_MAX_DEPTH = 16
THREE_MF_MAX_INSTANCES = 4096


class ThreeMfPart:
    """One parsed ``.model`` part: its unit, objects and (root only) build items."""

    def __init__(self, unit, objects, items):
        self.unit = unit
        self.objects = objects
        self.items = items


def _three_mf_key(name):
    """Canonical archive key: forward slashes, no leading slash, lower case."""
    return str(name or "").replace("\\", "/").lstrip("/").lower()


def _three_mf_matrix(text):
    """A 3MF ``transform`` (12 numbers, 4 rows x 3 columns) as a 4x4 for row vectors.

    The core specification multiplies ``[x y z 1]`` from the left: the first
    three rows rotate and scale, the fourth row translates.
    """
    import numpy as np

    if text is None or not str(text).strip():
        return np.eye(4)
    try:
        values = [float(value) for value in str(text).split()]
    except ValueError as error:
        raise InvalidSourceGeometry("3mf transform is malformed") from error
    if len(values) != 12 or not all(math.isfinite(value) for value in values):
        raise InvalidSourceGeometry("3mf transform is malformed")
    matrix = np.eye(4)
    matrix[0, :3] = values[0:3]
    matrix[1, :3] = values[3:6]
    matrix[2, :3] = values[6:9]
    matrix[3, :3] = values[9:12]
    return matrix


def _three_mf_path_attribute(element):
    for key, value in element.attrib.items():
        if key.rsplit("}", 1)[-1] == "path":
            return value
    return None


def _three_mf_local(tag):
    return str(tag).rsplit("}", 1)[-1]


def _parse_three_mf_part(data, with_geometry=True):
    """Stream one ``.model`` part. Entities are refused; nothing is resolved."""
    import numpy as np
    from lxml import etree

    lowered = data.lower()
    if b"<!doctype" in lowered or b"<!entity" in lowered:
        raise InvalidSourceGeometry("3mf model part declares entities")
    unit = None
    objects = {}
    items = []
    current = None
    vertices = []
    faces = []
    try:
        for event, element in etree.iterparse(io.BytesIO(data), events=("start", "end"), resolve_entities=False,
                                              no_network=True, remove_comments=True, huge_tree=False):
            tag = _three_mf_local(element.tag)
            if event == "start":
                if tag == "model":
                    unit = element.get("unit")
                elif tag == "object":
                    current = {"id": element.get("id"), "type": element.get("type") or "model", "mesh": None, "components": None}
                    vertices = []
                    faces = []
                elif tag == "components" and current is not None:
                    current["components"] = []
                continue
            if tag == "vertex":
                if with_geometry:
                    vertices.append((float(element.get("x")), float(element.get("y")), float(element.get("z"))))
                element.clear()
            elif tag == "triangle":
                if with_geometry:
                    faces.append((int(element.get("v1")), int(element.get("v2")), int(element.get("v3"))))
                else:
                    faces.append(None)
                element.clear()
            elif tag == "component" and current is not None and current["components"] is not None:
                current["components"].append((_three_mf_path_attribute(element), element.get("objectid"),
                                              _three_mf_matrix(element.get("transform"))))
            elif tag == "mesh" and current is not None:
                if with_geometry:
                    points = np.asarray(vertices, dtype=float).reshape(-1, 3)
                    triangles = np.asarray(faces, dtype=np.int64).reshape(-1, 3)
                    if len(triangles) and (triangles.min() < 0 or triangles.max() >= len(points)):
                        raise InvalidSourceGeometry("3mf triangle index out of range")
                    if not np.isfinite(points).all():
                        raise InvalidSourceGeometry("3mf vertex is not finite")
                    current["mesh"] = (points, triangles)
                else:
                    current["mesh"] = (None, len(faces))
                vertices = []
                faces = []
            elif tag == "object" and current is not None:
                objects[current["id"]] = current
                current = None
                element.clear()
            elif tag == "item":
                items.append((_three_mf_path_attribute(element), element.get("objectid"), _three_mf_matrix(element.get("transform"))))
    except (ValueError, TypeError) as error:
        if isinstance(error, InvalidSourceGeometry):
            raise
        raise InvalidSourceGeometry("3mf model part is malformed") from error
    except etree.XMLSyntaxError as error:
        raise InvalidSourceGeometry("3mf model part is not well-formed") from error
    return ThreeMfPart(unit, objects, items)


def flatten_three_mf(archive, with_geometry=True):
    """Walk the build of an open 3MF archive.

    Returns ``(mesh, scope)``: the flattened millimetre mesh (``None`` when
    ``with_geometry`` is false) and ``{'unit', 'object_count',
    'instance_count', 'triangle_count'}`` where ``object_count`` counts the
    distinct mesh objects the build reaches and ``instance_count`` the build
    items. A reference the archive cannot satisfy, an entity declaration,
    an unbounded nesting and a build without printable triangles all raise
    ``InvalidSourceGeometry``; nothing is guessed.
    """
    import numpy as np

    names = {}
    for name in archive.namelist():
        names.setdefault(_three_mf_key(name), name)
    if THREE_MF_ROOT_MODEL not in names:
        raise InvalidSourceGeometry("3mf has no root model")
    parts = {}

    def part(key):
        key = _three_mf_key(key)
        if key not in parts:
            if key not in names or not key.endswith(".model"):
                raise InvalidSourceGeometry("3mf references a missing model part")
            if len(parts) >= THREE_MF_MAX_PARTS:
                raise InvalidSourceGeometry("3mf references too many model parts")
            parts[key] = _parse_three_mf_part(archive.read(names[key]), with_geometry)
        return parts[key]

    root = part(THREE_MF_ROOT_MODEL)
    root_factor = unit_scale_to_mm(root.unit)
    pieces = []
    reached = set()
    triangle_total = 0

    def flatten(part_key, object_id, matrix, depth):
        nonlocal triangle_total
        if depth > THREE_MF_MAX_DEPTH:
            raise InvalidSourceGeometry("3mf component nesting is too deep")
        current_part = part(part_key)
        target = current_part.objects.get(object_id)
        if target is None:
            raise InvalidSourceGeometry("3mf references a missing object")
        if target["type"] not in THREE_MF_PRINTED_TYPES:
            return
        if target["components"] is not None:
            for path, reference, component_matrix in target["components"]:
                flatten(path if path else part_key, reference, component_matrix @ matrix, depth + 1)
            return
        if target["mesh"] is None:
            return
        points, triangles = target["mesh"]
        count = len(triangles) if with_geometry else triangles
        if count == 0:
            return
        reached.add((_three_mf_key(part_key), object_id))
        triangle_total += count
        if with_geometry:
            factor = unit_scale_to_mm(current_part.unit) / root_factor
            homogeneous = np.hstack([points * factor, np.ones((len(points), 1))]) @ matrix
            pieces.append((homogeneous[:, :3], triangles))

    if len(root.items) > THREE_MF_MAX_INSTANCES:
        raise InvalidSourceGeometry("3mf build has too many items")
    for path, object_id, item_matrix in root.items:
        flatten(path if path else THREE_MF_ROOT_MODEL, object_id, item_matrix, 0)
    scope = {"unit": root.unit or "millimeter", "object_count": len(reached),
             "instance_count": len(root.items), "triangle_count": int(triangle_total)}
    if triangle_total == 0:
        raise InvalidSourceGeometry("3mf build has no printable triangles")
    if not with_geometry:
        return None, scope
    offsets = np.cumsum([0] + [len(points) for points, _ in pieces[:-1]])
    vertices = np.vstack([points for points, _ in pieces]) * root_factor
    faces = np.vstack([triangles + offset for (_, triangles), offset in zip(pieces, offsets)])
    return trimesh.Trimesh(vertices=vertices, faces=faces, process=False), scope


def _load_three_mf_as_mesh(input_path):
    try:
        archive = zipfile.ZipFile(input_path)
    except zipfile.BadZipFile as error:
        raise InvalidSourceGeometry("3mf archive is unreadable") from error
    with archive:
        print("[PYTHON] Flattening the 3MF build...")
        mesh, scope = flatten_three_mf(archive)
    print(f"[PYTHON] 3MF build: {scope['instance_count']} item(s), {scope['object_count']} mesh object(s), "
          f"{scope['triangle_count']} triangles, unit {scope['unit']}.")
    return mesh


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
    if str(input_path).lower().endswith(".3mf"):
        mesh = _load_three_mf_as_mesh(input_path)
        _assert_usable_mesh(mesh)
        return mesh
    loaded = trimesh.load(input_path, process=False)
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
