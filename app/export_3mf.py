#!/usr/bin/env python3
"""Write the placed binary STL of a production-model export as a core 3MF.

Usage: ``export_3mf.py <in.stl> <out.3mf> <metadata.json>``

Slicer 3.9.0 (§2.2, §4.7). This helper is NOT a measurement input: it is
unhashed, imports no hashed helper and uses the standard library only
(``struct``, ``zipfile``, ``json``, ``xml.etree``). It writes one object of
``type="model"`` in millimetres with one build item and no transform, from
exactly the triangles of the STL:

* every coordinate is the STL's float32, written as the shortest decimal
  that parses back to the same float32;
* vertices are shared only when their three float32 values are bitwise
  equal (``-0.0`` and ``0.0`` stay distinct, so nothing is merged that the
  STL keeps apart);
* triangles keep the STL's order and vertex order.

Before it answers, the helper re-reads the written package and compares the
triangle soup bitwise with the STL. Any difference, or any failure to write,
exits 1 and removes the partial output; a usage or input error exits 2. On
success it prints one JSON line ``{"schema": "r3d-export-3mf-v1", ...}``.
"""

from __future__ import annotations

import json
import math
import os
import re
import struct
import sys
import zipfile
from xml.etree import ElementTree
from xml.sax.saxutils import escape

SCHEMA = "r3d-export-3mf-v1"
CORE_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
R3D_NS = "https://rocket3d.hu/3mf/r3d/1"
MODEL_PATH = "3D/3dmodel.model"
STL_HEADER_BYTES = 80
STL_TRIANGLE_BYTES = 50
ZIP_DATE_TIME = (1980, 1, 1, 0, 0, 0)

# Metadata names of §2.2 in their written order; ``quote_ref`` only when given.
METADATA_KEYS = (
    "export_contract",
    "fidelity",
    "source_sha256",
    "sliced_geometry_sha256",
    "measurement_generation",
    "printer_profile",
    "orientation_mode",
    "rotation_deg",
    "scale_percent",
    "placement_mm",
    "final_dimensions_mm",
    "quote_ref",
)
REQUIRED_METADATA = frozenset(METADATA_KEYS) - {"quote_ref", "scale_percent"}
METADATA_VALUE = re.compile(r"^[A-Za-z0-9_.,:+-]{1,200}$")
QUOTE_REF = re.compile(r"^Q-[0-9]{7}$")

CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
    "</Types>\n"
)
RELATIONSHIPS = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
    'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
    "</Relationships>\n"
)


class ExportInputError(Exception):
    """The arguments or the input files cannot be used (exit 2)."""


class ExportWriteError(Exception):
    """The package could not be written or did not round-trip (exit 1)."""


def read_binary_stl(path: str) -> tuple[bytes, int]:
    """Return the raw STL bytes and its triangle count after strict checks."""
    with open(path, "rb") as handle:
        data = handle.read()
    if len(data) < STL_HEADER_BYTES + 4:
        raise ExportInputError("STL is shorter than a binary header.")
    (count,) = struct.unpack_from("<I", data, STL_HEADER_BYTES)
    if count <= 0 or len(data) != STL_HEADER_BYTES + 4 + count * STL_TRIANGLE_BYTES:
        raise ExportInputError("STL is not a well-formed binary STL.")
    return data, count


def triangle_vertex_bytes(data: bytes, index: int) -> tuple[bytes, bytes, bytes]:
    """The three 12-byte float32 vertex records of triangle ``index``."""
    start = STL_HEADER_BYTES + 4 + index * STL_TRIANGLE_BYTES + 12
    return data[start:start + 12], data[start + 12:start + 24], data[start + 24:start + 36]


def shortest_float32(raw: bytes) -> str:
    """Shortest decimal (≤ 9 significant digits) that parses back to ``raw``."""
    (value,) = struct.unpack("<f", raw)
    if not math.isfinite(value):
        raise ExportInputError("STL holds a non-finite coordinate.")
    if value == 0.0:
        return "-0" if math.copysign(1.0, value) < 0 else "0"
    low, high = 1, 9
    best = None
    while low <= high:  # Round-tripping is monotone in the digit count.
        digits = (low + high) // 2
        text = format(value, f".{digits}g")
        if struct.pack("<f", float(text)) == raw:
            best = text
            high = digits - 1
        else:
            low = digits + 1
    if best is None:  # pragma: no cover - 9 digits always round-trip a float32
        raise ExportWriteError("A coordinate has no round-trip decimal.")
    return best


def load_metadata(path: str) -> list[tuple[str, str]]:
    """Validate the metadata JSON and return ``(name, value)`` in written order."""
    with open(path, "r", encoding="utf-8") as handle:
        raw = json.load(handle)
    if not isinstance(raw, dict):
        raise ExportInputError("Metadata must be a JSON object.")
    unknown = set(raw) - set(METADATA_KEYS)
    missing = REQUIRED_METADATA - set(raw)
    if unknown or missing:
        raise ExportInputError("Metadata keys are not the export contract's.")
    entries = []
    for key in METADATA_KEYS:
        if key not in raw:
            continue
        value = raw[key]
        if not isinstance(value, str) or not METADATA_VALUE.match(value):
            raise ExportInputError("Metadata value is not a bounded label.")
        if key == "quote_ref" and not QUOTE_REF.match(value):
            raise ExportInputError("Quote reference is malformed.")
        entries.append((key, value))
    return entries


def build_model_chunks(data: bytes, count: int, metadata: list[tuple[str, str]], state: dict):
    """Yield the model XML in chunks; ``state["vertices"]`` receives the vertex count."""
    yield (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<model unit="millimeter" xml:lang="en-US" xmlns="{CORE_NS}" xmlns:r3d="{R3D_NS}">\n'
    )
    for key, value in metadata:
        yield f' <metadata name="r3d:{key}">{escape(value)}</metadata>\n'
    yield ' <resources>\n  <object id="1" type="model">\n   <mesh>\n    <vertices>\n'
    indices: dict[bytes, int] = {}
    triangles: list[tuple[int, int, int]] = []
    buffer: list[str] = []
    for index in range(count):
        corners = []
        for raw in triangle_vertex_bytes(data, index):
            vertex = indices.get(raw)
            if vertex is None:
                vertex = len(indices)
                indices[raw] = vertex
                x, y, z = (shortest_float32(raw[offset:offset + 4]) for offset in (0, 4, 8))
                buffer.append(f'     <vertex x="{x}" y="{y}" z="{z}"/>\n')
            corners.append(vertex)
        triangles.append((corners[0], corners[1], corners[2]))
        if len(buffer) >= 4096:
            yield "".join(buffer)
            buffer.clear()
    if buffer:
        yield "".join(buffer)
        buffer.clear()
    yield "    </vertices>\n    <triangles>\n"
    for v1, v2, v3 in triangles:
        buffer.append(f'     <triangle v1="{v1}" v2="{v2}" v3="{v3}"/>\n')
        if len(buffer) >= 4096:
            yield "".join(buffer)
            buffer.clear()
    if buffer:
        yield "".join(buffer)
    yield '    </triangles>\n   </mesh>\n  </object>\n </resources>\n <build>\n  <item objectid="1"/>\n </build>\n</model>\n'
    state["vertices"] = len(indices)


def zip_info(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, date_time=ZIP_DATE_TIME)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o600 << 16
    return info


def write_package(data: bytes, count: int, metadata: list[tuple[str, str]], out_path: str) -> int:
    """Write the 3MF and return the number of distinct vertices."""
    state = {"vertices": 0}
    with open(out_path, "xb") as raw_handle:
        with zipfile.ZipFile(raw_handle, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
            archive.writestr(zip_info("[Content_Types].xml"), CONTENT_TYPES)
            archive.writestr(zip_info("_rels/.rels"), RELATIONSHIPS)
            with archive.open(zip_info(MODEL_PATH), "w", force_zip64=True) as model:
                for chunk in build_model_chunks(data, count, metadata, state):
                    model.write(chunk.encode("utf-8"))
        raw_handle.flush()
        os.fsync(raw_handle.fileno())
    return state["vertices"]


def verify_package(out_path: str, data: bytes, count: int, metadata: list[tuple[str, str]]) -> None:
    """Re-read the written package and compare the triangle soup bitwise."""
    with zipfile.ZipFile(out_path, "r") as archive:
        names = sorted(archive.namelist())
        if names != sorted(["[Content_Types].xml", "_rels/.rels", MODEL_PATH]):
            raise ExportWriteError("Package parts differ from the core 3MF set.")
        if archive.testzip() is not None:
            raise ExportWriteError("Package CRC check failed.")
        with archive.open(MODEL_PATH) as handle:
            root = ElementTree.parse(handle).getroot()
    core = f"{{{CORE_NS}}}"
    if root.tag != f"{core}model" or root.get("unit") != "millimeter":
        raise ExportWriteError("Model root or unit is wrong.")
    written_metadata = [(item.get("name"), item.text or "") for item in root.findall(f"{core}metadata")]
    if written_metadata != [(f"r3d:{key}", value) for key, value in metadata]:
        raise ExportWriteError("Metadata did not round-trip.")
    objects = root.findall(f"{core}resources/{core}object")
    items = root.findall(f"{core}build/{core}item")
    if len(objects) != 1 or objects[0].get("type") != "model" or objects[0].get("id") != "1":
        raise ExportWriteError("Package must hold exactly one model object.")
    if len(items) != 1 or items[0].get("objectid") != "1" or items[0].get("transform") is not None:
        raise ExportWriteError("Package must hold one build item without a transform.")
    mesh = objects[0].find(f"{core}mesh")
    if mesh is None:
        raise ExportWriteError("Model object has no mesh.")
    vertices = []
    for vertex in mesh.iterfind(f"{core}vertices/{core}vertex"):
        vertices.append(b"".join(struct.pack("<f", float(vertex.get(axis))) for axis in ("x", "y", "z")))
    triangles = mesh.findall(f"{core}triangles/{core}triangle")
    if len(triangles) != count:
        raise ExportWriteError("Triangle count did not round-trip.")
    for index, triangle in enumerate(triangles):
        try:
            refs = [int(triangle.get(key)) for key in ("v1", "v2", "v3")]
            corners = [vertices[ref] for ref in refs]
        except (TypeError, ValueError, IndexError) as error:
            raise ExportWriteError("Triangle references an unknown vertex.") from error
        if len(set(refs)) < 3:
            raise ExportWriteError("Triangle repeats a vertex index.")
        if tuple(corners) != triangle_vertex_bytes(data, index):
            raise ExportWriteError("Triangle soup differs from the STL.")


def run(arguments: list[str]) -> dict:
    if len(arguments) != 3:
        raise ExportInputError("usage: export_3mf.py <in.stl> <out.3mf> <metadata.json>")
    in_path, out_path, metadata_path = arguments
    if not out_path.lower().endswith(".3mf"):
        raise ExportInputError("Output must be a .3mf path.")
    if os.path.lexists(out_path):
        raise ExportInputError("Output path already exists.")
    data, count = read_binary_stl(in_path)
    metadata = load_metadata(metadata_path)
    # Every coordinate must be finite before anything is written.
    for index in range(count):
        corners = triangle_vertex_bytes(data, index)
        for raw in corners:
            for offset in (0, 4, 8):
                if not math.isfinite(struct.unpack_from("<f", raw, offset)[0]):
                    raise ExportInputError("STL holds a non-finite coordinate.")
        # Vertices are shared when bitwise equal, so a triangle with two equal
        # corners would be written with a repeated index, which the 3MF core
        # specification forbids (strict readers refuse it). Such a mesh is
        # exported as `stl` only: this is a write failure (exit 1).
        if len(set(corners)) < 3:
            raise ExportWriteError("A triangle repeats a vertex; the 3MF core specification forbids it (use stl).")
    try:
        vertex_count = write_package(data, count, metadata, out_path)
        verify_package(out_path, data, count, metadata)
    except ExportWriteError:
        remove_quietly(out_path)
        raise
    except (OSError, zipfile.BadZipFile, ElementTree.ParseError, ValueError) as error:
        remove_quietly(out_path)
        raise ExportWriteError("The 3MF could not be written or re-read.") from error
    return {"schema": SCHEMA, "triangles": count, "vertices": vertex_count, "verified": True}


def remove_quietly(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def main(arguments: list[str]) -> int:
    try:
        summary = run(arguments)
    except ExportInputError as error:
        sys.stderr.write(f"export_3mf: input refused: {error}\n")
        return 2
    except ExportWriteError as error:
        sys.stderr.write(f"export_3mf: write failed: {error}\n")
        return 1
    except (OSError, ValueError, json.JSONDecodeError) as error:
        sys.stderr.write(f"export_3mf: input refused: {type(error).__name__}\n")
        return 2
    sys.stdout.write(json.dumps(summary, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
