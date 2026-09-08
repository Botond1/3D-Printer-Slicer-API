"""`orient.py` applies a reference pose exactly and refuses anything that is not this mesh.

The reference is the submitted triangle list rigidly moved by the printing
engine's own orienter. These tests run the real helper as a subprocess with
real trimesh/numpy and are skipped where those are unavailable; the built
image always has them.
"""

import importlib.util
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
ORIENT = ROOT / "app" / "orient.py"
HAS_GEOMETRY_STACK = (
    importlib.util.find_spec("trimesh") is not None
    and importlib.util.find_spec("numpy") is not None
)
# Rotation of 90 degrees about X in the column-vector convention the contract uses.
RX_90 = [[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]]
IDENTITY = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]


def _apply(matrix, point):
    return tuple(sum(matrix[row][column] * point[column] for column in range(3)) for row in range(3))


def _rot_x(degrees):
    c, s = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    return [[1.0, 0.0, 0.0], [0.0, c, -s], [0.0, s, c]]


def _rot_y(degrees):
    c, s = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    return [[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]]


def _matmul(left, right):
    return [[sum(left[i][k] * right[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def _box_triangles(size_x, size_y, size_z):
    x, y, z = size_x / 2.0, size_y / 2.0, size_z / 2.0
    vertices = [(-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z), (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]
    faces = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5),
             (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    return [tuple(vertices[index] for index in face) for face in faces]


def _tilted_box():
    """A 60 x 24 x 8 box tilted so that no face is flat: the heuristic would move it."""
    rotation = _matmul(_rot_y(20.0), _rot_x(35.0))
    return [tuple(_apply(rotation, point) for point in triangle) for triangle in _box_triangles(60.0, 24.0, 8.0)]


def _moved(triangles, rotation, translation=(3.0, -7.0, 11.0), cycle=1):
    """Rigidly move every triangle and cycle the vertex order inside it."""
    moved = []
    for triangle in triangles:
        points = [tuple(value + offset for value, offset in zip(_apply(rotation, point), translation)) for point in triangle]
        moved.append(tuple(points[(index + cycle) % 3] for index in range(3)))
    return moved


def _write_stl(path, triangles):
    with open(path, "wb") as handle:
        handle.write(b"reference pose test".ljust(80, b"\0"))
        handle.write(struct.pack("<I", len(triangles)))
        for a, b, c in triangles:
            u = [b[i] - a[i] for i in range(3)]
            w = [c[i] - a[i] for i in range(3)]
            normal = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
            length = math.sqrt(sum(value * value for value in normal)) or 1.0
            handle.write(struct.pack("<3f", *(value / length for value in normal)))
            for point in (a, b, c):
                handle.write(struct.pack("<3f", *point))
            handle.write(struct.pack("<H", 0))


def _extents(triangles):
    axes = list(zip(*[point for triangle in triangles for point in triangle]))
    return [max(axis) - min(axis) for axis in axes]


@unittest.skipUnless(HAS_GEOMETRY_STACK, "trimesh and numpy are required to run orient.py")
class ReferencePoseTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / "model.stl"
        self.output = self.root / "model_oriented.stl"
        self.metadata = self.root / "model_oriented.stl.orientation.json"
        self.triangles = _tilted_box()
        _write_stl(self.source, self.triangles)

    def run_orient(self, reference):
        return subprocess.run(
            [sys.executable, str(ORIENT), str(self.source), str(self.output), "FDM", "auto", str(self.metadata), str(reference)],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )

    def read_metadata(self):
        with open(self.metadata, "r", encoding="utf-8") as handle:
            return json.load(handle)

    def assert_matrix_close(self, actual, expected, tolerance=1e-6):
        for row in range(3):
            for column in range(3):
                self.assertAlmostEqual(actual[row][column], expected[row][column], delta=tolerance)

    def test_reference_rotation_is_recovered_and_applied_to_the_submitted_mesh(self):
        import trimesh

        reference = self.root / "reference.stl"
        _write_stl(reference, _moved(self.triangles, RX_90))

        completed = self.run_orient(reference)

        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        metadata = self.read_metadata()
        self.assertEqual(metadata["orientation_metadata_schema"], 1)
        self.assertEqual(metadata["orientation_mode"], "auto")
        self.assertEqual(metadata["orientation_outcome"], "applied")
        self.assert_matrix_close(metadata["rotation_matrix"], RX_90)
        oriented = trimesh.load_mesh(str(self.output), process=False)
        self.assertEqual(len(oriented.faces), 12)
        expected_extents = _extents(_moved(self.triangles, RX_90))
        for axis in range(3):
            self.assertAlmostEqual(float(oriented.extents[axis]), expected_extents[axis], delta=1e-3)
        self.assertAlmostEqual(float(oriented.bounds[0][2]), 0.0, delta=1e-6)

    def test_identity_reference_reports_unchanged_with_an_exact_identity(self):
        reference = self.root / "reference.stl"
        _write_stl(reference, _moved(self.triangles, IDENTITY, translation=(5.0, 5.0, 5.0), cycle=2))

        completed = self.run_orient(reference)

        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        metadata = self.read_metadata()
        self.assertEqual(metadata["orientation_outcome"], "unchanged")
        self.assertEqual(metadata["rotation_matrix"], IDENTITY)
        self.assertTrue(self.output.exists())

    def test_a_reference_with_another_triangle_count_is_refused_without_output(self):
        reference = self.root / "reference.stl"
        _write_stl(reference, _moved(self.triangles, RX_90)[:-1])

        completed = self.run_orient(reference)

        self.assertEqual(completed.returncode, 3)
        self.assertIn("ORIENTATION_REFERENCE_MISMATCH|", completed.stdout)
        self.assertIn("ORIENTATION_REFERENCE_MISMATCH|", completed.stderr)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.metadata.exists())

    def test_a_non_rigid_reference_is_refused(self):
        reference = self.root / "reference.stl"
        scaled = [tuple(tuple(value * 1.5 for value in point) for point in triangle) for triangle in self.triangles]
        _write_stl(reference, scaled)

        completed = self.run_orient(reference)

        self.assertEqual(completed.returncode, 3)
        self.assertIn("ORIENTATION_REFERENCE_MISMATCH|", completed.stdout)
        self.assertFalse(self.output.exists())

    def test_without_a_reference_the_heuristic_still_runs(self):
        completed = subprocess.run(
            [sys.executable, str(ORIENT), str(self.source), str(self.output), "FDM", "auto", str(self.metadata)],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )

        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertIn(self.read_metadata()["orientation_outcome"], {"applied", "unchanged"})


if __name__ == "__main__":
    unittest.main()
