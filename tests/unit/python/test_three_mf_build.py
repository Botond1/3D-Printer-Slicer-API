"""The 3MF build walk: exact flattening of items, components and external parts (3.6.0)."""
import importlib.util
import pathlib
import tempfile
import unittest
import zipfile

try:
    import numpy as np
    import trimesh
    from lxml import etree  # noqa: F401 - the walk streams with lxml
    AVAILABLE = True
except ImportError:
    AVAILABLE = False

ROOT = pathlib.Path(__file__).resolve().parents[3]
NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'
PNS = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06'

UNIT_CUBE = (
    '<vertices>'
    '<vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="10" y="10" z="0"/><vertex x="0" y="10" z="0"/>'
    '<vertex x="0" y="0" z="10"/><vertex x="10" y="0" z="10"/><vertex x="10" y="10" z="10"/><vertex x="0" y="10" z="10"/>'
    '</vertices><triangles>'
    '<triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="3" v3="2"/><triangle v1="4" v2="5" v3="6"/><triangle v1="4" v2="6" v3="7"/>'
    '<triangle v1="0" v2="1" v3="5"/><triangle v1="0" v2="5" v3="4"/><triangle v1="1" v2="2" v3="6"/><triangle v1="1" v2="6" v3="5"/>'
    '<triangle v1="2" v2="3" v3="7"/><triangle v1="2" v2="7" v3="6"/><triangle v1="3" v2="0" v3="4"/><triangle v1="3" v2="4" v3="7"/>'
    '</triangles>'
)


def model(body, unit='millimeter', production=False):
    extra = f' xmlns:p="{PNS}"' if production else ''
    return f'<?xml version="1.0" encoding="UTF-8"?><model unit="{unit}" xmlns="{NS}"{extra}>{body}</model>'


def mesh_object(object_id, mesh=UNIT_CUBE, kind=None):
    type_attr = f' type="{kind}"' if kind else ''
    return f'<object id="{object_id}"{type_attr}><mesh>{mesh}</mesh></object>'


@unittest.skipUnless(AVAILABLE, 'Pinned geometry dependencies unavailable')
class ThreeMfBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('mesh2stl_three_mf', ROOT / 'app/mesh2stl.py')
        cls.mesh2stl = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.mesh2stl)
        spec = importlib.util.spec_from_file_location('inspect_three_mf', ROOT / 'app/inspect_mesh.py')
        cls.inspect = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.inspect)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='r3d-3mf-unit-')
        self.addCleanup(self.temporary.cleanup)
        self.file = pathlib.Path(self.temporary.name) / 'model.3mf'

    def write(self, parts):
        with zipfile.ZipFile(self.file, 'w') as archive:
            for name, content in parts.items():
                archive.writestr(name, content)
        return self.file

    def flatten(self, with_geometry=True):
        with zipfile.ZipFile(self.file) as archive:
            return self.mesh2stl.flatten_three_mf(archive, with_geometry=with_geometry)

    def test_plain_single_object(self):
        self.write({'3D/3dmodel.model': model(f'<resources>{mesh_object(1)}</resources><build><item objectid="1"/></build>')})
        mesh, scope = self.flatten()
        self.assertEqual(len(mesh.faces), 12)
        self.assertEqual(scope, {'unit': 'millimeter', 'object_count': 1, 'instance_count': 1, 'triangle_count': 12})
        self.assertTrue(mesh.is_watertight)
        self.assertAlmostEqual(mesh.volume, 1000)

    def test_production_extension_instances_external_part_exactly_once_per_item(self):
        # Nine build items -> nine component objects -> one external mesh: nine cubes, not eighty-one.
        objects = ''.join(f'<object id="{i}"><components><component objectid="1" p:path="/3D/Objects/object_1.model" '
                          f'transform="1 0 0 0 1 0 0 0 1 {20 * i} 0 0"/></components></object>' for i in range(2, 11))
        items = ''.join(f'<item objectid="{i}"/>' for i in range(2, 11))
        self.write({'3D/3dmodel.model': model(f'<resources>{objects}</resources><build>{items}</build>', production=True),
                    '3D/Objects/object_1.model': model(f'<resources>{mesh_object(1)}</resources><build/>', production=True)})
        mesh, scope = self.flatten()
        self.assertEqual(len(mesh.faces), 9 * 12)
        self.assertEqual(scope['object_count'], 1)
        self.assertEqual(scope['instance_count'], 9)
        self.assertAlmostEqual(mesh.extents[0], 20 * 8 + 10)
        self.assertAlmostEqual(mesh.volume, 9000)

    def test_transforms_compose_component_first_then_item(self):
        # Component: translate +5 in X. Item: rotate 90 deg about Z (row-vector convention), then translate +100 in Y.
        objects = ('<object id="2"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 5 0 0"/></components></object>'
                   + mesh_object(1))
        build = '<item objectid="2" transform="0 1 0 -1 0 0 0 0 1 0 100 0"/>'
        self.write({'3D/3dmodel.model': model(f'<resources>{objects}</resources><build>{build}</build>')})
        mesh, scope = self.flatten()
        # Cube spans x 5..15 after the component; rotating (x, y) -> (-y, x) puts it at x -10..0, y 105..115.
        low, high = mesh.bounds
        np.testing.assert_allclose(low, [-10, 105, 0], atol=1e-9)
        np.testing.assert_allclose(high, [0, 115, 10], atol=1e-9)
        self.assertEqual(scope['object_count'], 1)

    def test_unit_scales_the_whole_build_to_millimetres(self):
        self.write({'3D/3dmodel.model': model(f'<resources>{mesh_object(1)}</resources><build><item objectid="1"/></build>', unit='inch')})
        mesh, scope = self.flatten()
        self.assertAlmostEqual(mesh.extents[0], 254)
        self.assertEqual(scope['unit'], 'inch')

    def test_unprinted_object_types_are_skipped(self):
        objects = mesh_object(1) + mesh_object(2, kind='other')
        self.write({'3D/3dmodel.model': model(f'<resources>{objects}</resources><build><item objectid="1"/><item objectid="2"/></build>')})
        mesh, scope = self.flatten()
        self.assertEqual(len(mesh.faces), 12)
        self.assertEqual(scope['object_count'], 1)
        self.assertEqual(scope['instance_count'], 2)

    def test_refusals_name_the_defect_and_never_guess(self):
        cases = {
            'missing part': {'3D/3dmodel.model': model('<resources><object id="2"><components><component objectid="1" p:path="/3D/Objects/gone.model"/></components></object></resources><build><item objectid="2"/></build>', production=True)},
            'missing object': {'3D/3dmodel.model': model(f'<resources>{mesh_object(1)}</resources><build><item objectid="9"/></build>')},
            'entities': {'3D/3dmodel.model': '<!DOCTYPE model [<!ENTITY x "safe">]>' + model(f'<resources>{mesh_object(1)}</resources><build><item objectid="1"/></build>')},
            'no triangles': {'3D/3dmodel.model': model('<resources><object id="1"><mesh><vertices/><triangles/></mesh></object></resources><build><item objectid="1"/></build>')},
            'no root': {'3D/other.model': model(f'<resources>{mesh_object(1)}</resources><build><item objectid="1"/></build>')},
            'bad index': {'3D/3dmodel.model': model('<resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build>')},
            'self reference': {'3D/3dmodel.model': model('<resources><object id="1"><components><component objectid="1"/></components></object></resources><build><item objectid="1"/></build>')},
        }
        for label, parts in cases.items():
            self.write(parts)
            with self.assertRaises(self.mesh2stl.InvalidSourceGeometry, msg=label):
                self.flatten()

    def test_scope_helper_counts_and_refuses_slicer_modifiers(self):
        body = f'<resources>{mesh_object(1)}{mesh_object(2)}</resources><build><item objectid="1"/><item objectid="2"/><item objectid="1"/></build>'
        self.write({'3D/3dmodel.model': model(body)})
        self.assertEqual(self.inspect.inspect_3mf_scope(self.file), {'source_unit': 'millimeter', 'instance_count': 3, 'object_count': 2})
        settings = '<config><object id="1"><part id="1" subtype="normal_part"/><part id="2" subtype="modifier_part"/></object></config>'
        self.write({'3D/3dmodel.model': model(body), 'Metadata/model_settings.config': settings})
        with self.assertRaisesRegex(ValueError, 'ambiguous_scope'):
            self.inspect.inspect_3mf_scope(self.file)
        self.write({'3D/3dmodel.model': model('<resources/><build/>')})
        with self.assertRaisesRegex(ValueError, 'empty_mesh'):
            self.inspect.inspect_3mf_scope(self.file)
        self.write({'3D/3dmodel.model': model(f'<resources>{mesh_object(1)}</resources><build><item objectid="7"/></build>')})
        with self.assertRaisesRegex(ValueError, 'ambiguous_scope'):
            self.inspect.inspect_3mf_scope(self.file)

    def test_converter_writes_the_flattened_stl(self):
        objects = ''.join(f'<object id="{i}"><components><component objectid="1" p:path="/3D/Objects/object_1.model" '
                          f'transform="1 0 0 0 1 0 0 0 1 {20 * i} 0 0"/></components></object>' for i in range(2, 4))
        self.write({'3D/3dmodel.model': model(f'<resources>{objects}</resources><build><item objectid="2"/><item objectid="3"/></build>', production=True),
                    '3D/Objects/object_1.model': model(f'<resources>{mesh_object(1)}</resources><build/>', production=True)})
        output = self.file.with_suffix('.stl')
        self.mesh2stl.convert_mesh_to_stl(str(self.file), str(output))
        exported = trimesh.load(str(output), process=False)
        self.assertEqual(len(exported.faces), 24)
        self.assertAlmostEqual(float(exported.extents[0]), 30)


if __name__ == '__main__':
    unittest.main()
