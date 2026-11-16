"""3.10.0: above HEURISTIC_MAX_TRIANGLES `orient.py` never runs the stable-pose heuristic.

A large mesh whose engine pose is missing or is not this mesh keeps the
submitted pose and says `fallback_unmodified`; a mismatching reference is
still refused with exit 3 (now read from the two STL headers); at or below the
threshold the helper behaves as before.
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ORIENT = ROOT / "app" / "orient.py"
try:
    import numpy as np
    import trimesh
    AVAILABLE = True
except ImportError:
    AVAILABLE = False
if not AVAILABLE and os.environ.get("R3D_REQUIRE_GEOMETRY_DEPS") == "1":
    raise ImportError("R3D_REQUIRE_GEOMETRY_DEPS=1: the pinned geometry stack is required here, not skipped")


def _write_binary_stl(path, triangles):
    triangles = np.asarray(triangles, dtype=np.float32)
    record = np.zeros(len(triangles), dtype=[('normal', '<f4', 3), ('corners', '<f4', (3, 3)), ('attribute', '<u2')])
    record['corners'] = triangles
    with open(path, 'wb') as handle:
        handle.write(b'\0' * 80)
        handle.write(np.uint32(len(triangles)).tobytes())
        handle.write(record.tobytes())


@unittest.skipUnless(AVAILABLE, 'Pinned geometry dependencies unavailable')
class LargeMeshOrientationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('orient_helper', ORIENT)
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)
        cls.directory = tempfile.TemporaryDirectory(prefix='r3d-orient-large-')
        sphere = trimesh.creation.icosphere(subdivisions=7, radius=30.0)
        sphere.apply_scale([1.0, 0.6, 0.3])
        sphere.apply_transform(trimesh.transformations.rotation_matrix(0.9, [1, 0.2, 0]))
        cls.large_triangles = np.asarray(sphere.triangles)
        cls.large = Path(cls.directory.name) / 'large.stl'
        _write_binary_stl(cls.large, cls.large_triangles)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def setUp(self):
        self.work = tempfile.TemporaryDirectory(prefix='r3d-orient-large-run-')
        self.output = Path(self.work.name) / 'out.stl'
        self.metadata = Path(self.work.name) / 'out.stl.orientation.json'

    def tearDown(self):
        self.work.cleanup()

    def run_orient(self, source, *extra, mode='auto'):
        started = time.perf_counter()
        completed = subprocess.run(
            [sys.executable, str(ORIENT), str(source), str(self.output), 'FDM', mode, str(self.metadata), *map(str, extra)],
            capture_output=True, text=True, timeout=300, check=False)
        return completed, time.perf_counter() - started

    def test_the_threshold_is_named_and_the_fixture_is_above_it(self):
        self.assertEqual(self.module.HEURISTIC_MAX_TRIANGLES, 300_000)
        self.assertGreater(len(self.large_triangles), self.module.HEURISTIC_MAX_TRIANGLES)
        self.assertEqual(self.module._binary_stl_triangle_count(str(self.large)), len(self.large_triangles))

    def test_a_large_mesh_without_a_reference_keeps_the_submitted_pose(self):
        completed, _seconds = self.run_orient(self.large)
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertIn('stable-pose heuristic skipped', completed.stdout)
        metadata = json.loads(self.metadata.read_text(encoding='utf-8'))
        self.assertEqual(metadata['orientation_outcome'], 'fallback_unmodified')
        self.assertEqual(metadata['orientation_mode'], 'auto')
        self.assertEqual(metadata['rotation_matrix'], [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
        self.assertEqual(self.output.read_bytes(), self.large.read_bytes())

    def test_a_large_mesh_with_another_triangle_count_is_refused_from_the_headers(self):
        reference = Path(self.work.name) / 'reference.stl'
        _write_binary_stl(reference, self.large_triangles[:-5])
        completed, _seconds = self.run_orient(self.large, reference)
        self.assertEqual(completed.returncode, 3)
        self.assertIn('ORIENTATION_REFERENCE_MISMATCH|reference triangle count differs from the submitted mesh', completed.stdout)
        self.assertIn('ORIENTATION_REFERENCE_MISMATCH|', completed.stderr)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.metadata.exists())

    def test_a_large_mesh_still_takes_the_engine_pose(self):
        rotation = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])[:3, :3]
        reference = Path(self.work.name) / 'reference.stl'
        _write_binary_stl(reference, self.large_triangles @ rotation.T + np.array([5.0, 6.0, 7.0]))
        completed, _seconds = self.run_orient(self.large, reference)
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        metadata = json.loads(self.metadata.read_text(encoding='utf-8'))
        self.assertEqual(metadata['orientation_outcome'], 'applied')
        np.testing.assert_allclose(np.asarray(metadata['rotation_matrix']), rotation, atol=1e-5)

    def test_a_large_mesh_in_preserve_mode_is_unchanged_by_the_rule(self):
        completed, _seconds = self.run_orient(self.large, mode='preserve')
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertEqual(json.loads(self.metadata.read_text(encoding='utf-8'))['orientation_outcome'], 'preserved')

    def test_a_small_mesh_still_runs_the_heuristic(self):
        small = Path(self.work.name) / 'small.stl'
        box = trimesh.creation.box([40, 10, 4])
        box.apply_transform(trimesh.transformations.rotation_matrix(0.6, [1, 0, 0]))
        _write_binary_stl(small, box.triangles)
        completed, _seconds = self.run_orient(small)
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertNotIn('heuristic skipped', completed.stdout)
        self.assertIn('stable orientations', completed.stdout)
        self.assertIn(json.loads(self.metadata.read_text(encoding='utf-8'))['orientation_outcome'], {'applied', 'unchanged'})


if __name__ == '__main__':
    unittest.main()
