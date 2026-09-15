"""Admission describes ordinary real-world meshes and refuses only unprintable geometry (3.6.0)."""
import importlib.util
import pathlib
import tempfile
import unittest
import zipfile

try:
    import numpy as np
    import trimesh
    AVAILABLE = True
except ImportError:
    AVAILABLE = False

ROOT = pathlib.Path(__file__).resolve().parents[3]


@unittest.skipUnless(AVAILABLE, 'Pinned geometry dependencies unavailable')
class BambuGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('bambu_inspection', ROOT / 'app/inspect_mesh.py')
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def inspect(self, mesh, reason=None):
        """Inspect an exported STL; the file bytes must be untouched afterwards."""
        with tempfile.TemporaryDirectory(prefix='r3d-bambu-unit-') as directory:
            file = pathlib.Path(directory) / 'model.stl'
            mesh.export(file)
            before = file.read_bytes()
            if reason:
                with self.assertRaisesRegex(ValueError, reason):
                    self.module.inspect_mesh(file)
                value = None
            else:
                value = self.module.inspect_mesh(file)
                self.assertEqual(value['schema'], 'r3d-mesh-inspection-v2')
                self.assertTrue(value['valid'])
                self.assertGreater(value['volume_mm3'], 0)
            self.assertEqual(before, file.read_bytes())
            return value

    def test_closed_control(self):
        value = self.inspect(trimesh.creation.box([20, 15, 10]))
        self.assertTrue(value['watertight'])
        self.assertTrue(value['winding_consistent'])
        self.assertEqual(value['component_count'], 1)
        self.assertEqual(value['closed_component_count'], 1)
        self.assertEqual(value['open_edge_count'], 0)
        self.assertEqual((value['dropped_degenerate_faces'], value['dropped_duplicate_faces']), (0, 0))
        self.assertEqual(value['volume_source'], 'validated_triangle_mesh')
        self.assertAlmostEqual(value['volume_mm3'], 3000)
        self.assertEqual(value['triangle_count'], 12)

    def test_open_mesh_is_admitted_and_described(self):
        mesh = trimesh.creation.box([20, 15, 10])
        mesh.update_faces(np.arange(len(mesh.faces) - 1))
        value = self.inspect(mesh)
        self.assertFalse(value['watertight'])
        self.assertFalse(value['winding_consistent'])
        self.assertEqual(value['closed_component_count'], 0)
        self.assertEqual(value['open_edge_count'], 3)
        self.assertEqual(value['volume_source'], 'signed_volume_estimate')
        # One missing triangle of a box: the divergence integral is still close to the solid.
        self.assertGreater(value['volume_mm3'], 2000)
        self.assertLess(value['volume_mm3'], 3000)

    def test_empty_binary_stl_is_geometry_error_not_compound(self):
        with tempfile.TemporaryDirectory(prefix='r3d-bambu-unit-') as directory:
            file = pathlib.Path(directory) / 'empty.stl'
            file.write_bytes(b'empty synthetic STL'.ljust(80, b'\0') + b'\0' * 4)
            with self.assertRaisesRegex(ValueError, 'empty_mesh'):
                self.module.inspect_mesh(file)

    def test_reversed_solid_is_admitted_with_its_true_volume(self):
        mesh = trimesh.creation.box([20, 15, 10]); mesh.invert()
        value = self.inspect(mesh)
        self.assertTrue(value['watertight'])
        self.assertTrue(value['winding_consistent'])
        self.assertAlmostEqual(value['volume_mm3'], 3000)

    def test_degenerate_and_duplicate_faces_are_dropped_from_the_description(self):
        mesh = trimesh.creation.box([20, 15, 10])
        faces = np.vstack([mesh.faces, [[0, 0, 0]], mesh.faces[:2], mesh.faces[[3]][:, ::-1]])
        value = self.inspect(trimesh.Trimesh(vertices=mesh.vertices, faces=faces, process=False))
        self.assertEqual(value['dropped_degenerate_faces'], 1)
        self.assertEqual(value['dropped_duplicate_faces'], 3)
        self.assertEqual(value['triangle_count'], 12)
        self.assertTrue(value['watertight'])
        self.assertAlmostEqual(value['volume_mm3'], 3000)

    def test_only_degenerate_faces_is_refused(self):
        mesh = trimesh.Trimesh(vertices=[[0, 0, 0], [1, 0, 0], [2, 0, 0]], faces=[[0, 1, 2], [0, 0, 1]], process=False)
        self.inspect(mesh, 'degenerate_faces')

    def test_flat_sheet_has_no_volume(self):
        sheet = trimesh.Trimesh(vertices=[[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
                                faces=[[0, 1, 2], [0, 2, 3]], process=False)
        self.inspect(sheet, 'zero_extent')

    def test_two_disconnected_bodies_are_one_compound_unit(self):
        one = trimesh.creation.box([20, 15, 10]); two = one.copy(); two.apply_translation([50, 0, 0])
        value = self.inspect(trimesh.util.concatenate([one, two]))
        self.assertTrue(value['watertight'])
        self.assertEqual(value['component_count'], 2)
        self.assertEqual(value['closed_component_count'], 2)
        self.assertEqual(value['volume_source'], 'validated_triangle_mesh')
        self.assertAlmostEqual(value['volume_mm3'], 6000)
        self.assertAlmostEqual(value['dimensions_mm']['x'], 70)


if __name__ == '__main__':
    unittest.main()
