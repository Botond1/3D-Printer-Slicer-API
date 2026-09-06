"""Admission protects positive native statistics from invalid/ambiguous geometry."""
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

    def check_mesh(self, mesh, reason=None):
        with tempfile.TemporaryDirectory(prefix='r3d-bambu-unit-') as directory:
            file = pathlib.Path(directory) / 'model.stl'
            mesh.export(file)
            before = file.read_bytes()
            if reason:
                with self.assertRaisesRegex(ValueError, reason):
                    self.module.inspect_mesh(file)
            else:
                value = self.module.inspect_mesh(file)
                self.assertTrue(value['watertight'])
                self.assertEqual(value['component_count'], 1)
                self.assertAlmostEqual(value['volume_mm3'], 3000)
            self.assertEqual(before, file.read_bytes())

    def test_closed_control(self):
        self.check_mesh(trimesh.creation.box([20, 15, 10]))

    def test_open_mesh(self):
        mesh = trimesh.creation.box([20, 15, 10])
        mesh.update_faces(np.arange(len(mesh.faces) - 1))
        self.check_mesh(mesh, 'open_mesh')

    def test_empty_binary_stl_is_geometry_error_not_compound(self):
        with tempfile.TemporaryDirectory(prefix='r3d-bambu-unit-') as directory:
            file = pathlib.Path(directory) / 'empty.stl'
            file.write_bytes(b'empty synthetic STL'.ljust(80, b'\0') + b'\0' * 4)
            with self.assertRaisesRegex(ValueError, 'empty_mesh'):
                self.module.inspect_mesh(file)

    def test_reversed_solid(self):
        mesh = trimesh.creation.box([20, 15, 10]); mesh.invert()
        self.check_mesh(mesh, 'invalid_solid_winding')

    def test_degenerate_face(self):
        mesh = trimesh.creation.box([20, 15, 10])
        mesh.faces[0] = [0, 0, 0]
        self.check_mesh(mesh, 'degenerate_faces')

    def test_two_disconnected_bodies(self):
        one = trimesh.creation.box([20, 15, 10]); two = one.copy(); two.apply_translation([50, 0, 0])
        self.check_mesh(trimesh.util.concatenate([one, two]), 'ambiguous_scope')

    def test_3mf_instance_and_xml_guards(self):
        with tempfile.TemporaryDirectory(prefix='r3d-bambu-unit-') as directory:
            file = pathlib.Path(directory) / 'model.3mf'
            positive = '<model unit="inch"><resources><object id="1"><mesh/></object></resources><build><item objectid="1"/></build></model>'
            for xml, valid in [(positive, True), (positive.replace('</build>', '<item objectid="1"/></build>'), False),
                               ('<!DOCTYPE model [<!ENTITY x "safe">]>' + positive, False)]:
                with zipfile.ZipFile(file, 'w') as archive:
                    archive.writestr('3D/3dmodel.model', xml)
                if valid:
                    self.assertEqual(self.module.inspect_3mf_scope(file)['source_unit'], 'inch')
                else:
                    with self.assertRaises(ValueError): self.module.inspect_3mf_scope(file)


if __name__ == '__main__':
    unittest.main()
