"""CLI-level tests for app/export_3mf.py (slicer 3.9.0 §2.2, §4.7).

The helper is stdlib only, so these tests need no geometry stack: they write
a small binary STL, run the helper as the service does (``python
export_3mf.py <in.stl> <out.3mf> <metadata.json>``) and re-read the package
independently, comparing every triangle bitwise with the STL.
"""

import importlib.util
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[3]
HELPER = ROOT / "app" / "export_3mf.py"
CORE = "{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}"

METADATA = {
    "export_contract": "1",
    "fidelity": "exact",
    "source_sha256": "a" * 64,
    "sliced_geometry_sha256": "b" * 64,
    "measurement_generation": "c" * 64,
    "printer_profile": "P1S",
    "orientation_mode": "preserve",
    "rotation_deg": "90,0,-37.5",
    "scale_percent": "100",
    "placement_mm": "18.000,0.000",
    "final_dimensions_mm": "40.000,40.000,40.000",
    "quote_ref": "Q-1234567",
}

# Awkward float32 values: negative zero, values with no short decimal, tiny
# and large magnitudes and a subnormal, so the shortest round-trip is exercised.
AWKWARD = (0.0, -0.0, 0.1, 1.0 / 3.0, 1e-7, 123456.789, -2.5e-3, 1.4e-45, 3.0e38, 40.0)


def write_stl(path, triangles, header=b"r3d export test"):
    data = bytearray(header.ljust(80, b"\0")[:80])
    data += struct.pack("<I", len(triangles))
    for triangle in triangles:
        data += struct.pack("<3f", 0.0, 0.0, 1.0)
        for vertex in triangle:
            data += struct.pack("<3f", *vertex)
        data += b"\0\0"
    Path(path).write_bytes(bytes(data))
    return bytes(data)


def cube_triangles(size=40.0):
    corners = [(x, y, z) for x in (0.0, size) for y in (0.0, size) for z in (0.0, size)]
    faces = [(0, 1, 3), (0, 3, 2), (4, 6, 7), (4, 7, 5), (0, 4, 5), (0, 5, 1),
             (2, 3, 7), (2, 7, 6), (0, 2, 6), (0, 6, 4), (1, 5, 7), (1, 7, 3)]
    return [tuple(corners[index] for index in face) for face in faces]


def awkward_triangles():
    triangles = []
    for index, value in enumerate(AWKWARD):
        nxt = AWKWARD[(index + 1) % len(AWKWARD)]
        triangles.append(((value, nxt, 0.0), (nxt, value, 1.0), (value, value, nxt)))
    return triangles


def stl_soup(data):
    (count,) = struct.unpack_from("<I", data, 80)
    return [data[84 + index * 50 + 12:84 + index * 50 + 48] for index in range(count)]


def read_package_soup(path):
    with zipfile.ZipFile(path) as archive:
        names = sorted(archive.namelist())
        root = ElementTree.fromstring(archive.read("3D/3dmodel.model"))
    vertices = [b"".join(struct.pack("<f", float(vertex.get(axis))) for axis in "xyz")
                for vertex in root.iter(f"{CORE}vertex")]
    soup = [b"".join(vertices[int(triangle.get(key))] for key in ("v1", "v2", "v3"))
            for triangle in root.iter(f"{CORE}triangle")]
    return names, root, vertices, soup


class Export3mfCliTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.metadata = self.root / "metadata.json"
        self.metadata.write_text(json.dumps(METADATA), encoding="utf-8")

    def tearDown(self):
        self.directory.cleanup()

    def run_helper(self, stl, output, metadata=None):
        return subprocess.run(
            [sys.executable, "-I", str(HELPER), str(stl), str(output), str(metadata or self.metadata)],
            capture_output=True, text=True, timeout=120, check=False,
        )

    def assert_round_trip(self, triangles):
        stl = self.root / "placed.stl"
        data = write_stl(stl, triangles)
        output = self.root / "out.3mf"
        result = self.run_helper(stl, output)
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["schema"], "r3d-export-3mf-v1")
        self.assertEqual(summary["triangles"], len(triangles))
        self.assertTrue(summary["verified"])
        names, root, vertices, soup = read_package_soup(output)
        self.assertEqual(names, ["3D/3dmodel.model", "[Content_Types].xml", "_rels/.rels"])
        self.assertEqual(root.get("unit"), "millimeter")
        self.assertEqual(soup, stl_soup(data))
        self.assertEqual(len(vertices), summary["vertices"])
        # Vertices are shared only when bitwise equal: no two written vertices are equal bytes.
        self.assertEqual(len(set(vertices)), len(vertices))
        objects = root.findall(f"{CORE}resources/{CORE}object")
        items = root.findall(f"{CORE}build/{CORE}item")
        self.assertEqual([(item.get("id"), item.get("type")) for item in objects], [("1", "model")])
        self.assertEqual(len(items), 1)
        self.assertIsNone(items[0].get("transform"))
        written = {item.get("name"): item.text for item in root.findall(f"{CORE}metadata")}
        self.assertEqual(written, {f"r3d:{key}": value for key, value in METADATA.items()})
        return data, output

    def test_cube_round_trips_bitwise(self):
        self.assert_round_trip(cube_triangles())

    def test_awkward_float32_values_round_trip_bitwise(self):
        _, output = self.assert_round_trip(awkward_triangles())
        names, root, vertices, _ = read_package_soup(output)
        text = zipfile.ZipFile(output).read("3D/3dmodel.model").decode("utf-8")
        # Negative zero is kept apart from zero, and 0.1f is written in its shortest form.
        self.assertIn('"-0"', text)
        self.assertIn('"0.1"', text)

    def test_output_is_deterministic(self):
        stl = self.root / "placed.stl"
        write_stl(stl, cube_triangles())
        first, second = self.root / "a.3mf", self.root / "b.3mf"
        self.assertEqual(self.run_helper(stl, first).returncode, 0)
        self.assertEqual(self.run_helper(stl, second).returncode, 0)
        self.assertEqual(first.read_bytes(), second.read_bytes())

    def test_quote_ref_is_optional(self):
        metadata = dict(METADATA)
        del metadata["quote_ref"]
        path = self.root / "meta-no-ref.json"
        path.write_text(json.dumps(metadata), encoding="utf-8")
        stl = self.root / "placed.stl"
        write_stl(stl, cube_triangles())
        output = self.root / "out.3mf"
        self.assertEqual(self.run_helper(stl, output, path).returncode, 0)
        text = zipfile.ZipFile(output).read("3D/3dmodel.model").decode("utf-8")
        self.assertNotIn("quote_ref", text)

    def test_corrupted_stl_is_refused_and_writes_nothing(self):
        stl = self.root / "placed.stl"
        data = write_stl(stl, cube_triangles())
        stl.write_bytes(data[:-7])
        output = self.root / "out.3mf"
        result = self.run_helper(stl, output)
        self.assertEqual(result.returncode, 2)
        self.assertFalse(output.exists())
        self.assertIn("input refused", result.stderr)

    def test_non_finite_coordinate_is_refused(self):
        stl = self.root / "placed.stl"
        write_stl(stl, [((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (float("nan"), 1.0, 0.0))])
        output = self.root / "out.3mf"
        self.assertEqual(self.run_helper(stl, output).returncode, 2)
        self.assertFalse(output.exists())

    def test_ascii_stl_is_refused(self):
        stl = self.root / "placed.stl"
        stl.write_text("solid x\nendsolid x\n", encoding="ascii")
        self.assertEqual(self.run_helper(stl, self.root / "out.3mf").returncode, 2)

    def test_bad_metadata_is_refused(self):
        stl = self.root / "placed.stl"
        write_stl(stl, cube_triangles())
        for broken in ({**METADATA, "quote_ref": "Q-12"}, {**METADATA, "extra": "1"},
                       {key: value for key, value in METADATA.items() if key != "fidelity"},
                       {**METADATA, "printer_profile": "<script>"}):
            path = self.root / "broken.json"
            path.write_text(json.dumps(broken), encoding="utf-8")
            output = self.root / "out.3mf"
            self.assertEqual(self.run_helper(stl, output, path).returncode, 2, broken)
            self.assertFalse(output.exists())

    def test_existing_output_is_never_overwritten_or_removed(self):
        stl = self.root / "placed.stl"
        write_stl(stl, cube_triangles())
        output = self.root / "out.3mf"
        output.write_bytes(b"keep")
        self.assertEqual(self.run_helper(stl, output).returncode, 2)
        self.assertEqual(output.read_bytes(), b"keep")

    def test_usage_error(self):
        result = subprocess.run([sys.executable, "-I", str(HELPER)], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 2)


class Export3mfRoundTripGuardTest(unittest.TestCase):
    """A writer that produced a different soup must exit 1 and leave nothing."""

    def load(self):
        spec = importlib.util.spec_from_file_location("export_3mf_under_test", HELPER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_mismatch_exits_one_and_removes_output(self):
        module = self.load()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stl = root / "placed.stl"
            write_stl(stl, cube_triangles())
            metadata = root / "metadata.json"
            metadata.write_text(json.dumps(METADATA), encoding="utf-8")
            output = root / "out.3mf"
            original = module.shortest_float32

            def drifting(raw):
                return "40.5" if raw == struct.pack("<f", 40.0) else original(raw)

            module.shortest_float32 = drifting
            code = module.main([str(stl), str(output), str(metadata)])
            self.assertEqual(code, 1)
            self.assertFalse(output.exists())

    def test_shortest_float32_round_trips_every_awkward_value(self):
        module = self.load()
        for value in AWKWARD + (-1.0 / 7.0, 2.0 ** -126, 16777217.0):
            raw = struct.pack("<f", value)
            text = module.shortest_float32(raw)
            self.assertEqual(struct.pack("<f", float(text)), raw, (value, text))
            self.assertLessEqual(len(text.lstrip("-").replace(".", "").split("e")[0].lstrip("0") or "0"), 9)


if __name__ == "__main__":
    unittest.main()
