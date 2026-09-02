"""Converter contract: unit scaling, deprecation-free scene merge, and the
machine-readable ``INVALID_SOURCE_GEOMETRY|<reason>`` marker on both streams
with exit status 2. The real trimesh/gmsh packages are replaced by fakes so
the tests run wherever the unit suite runs."""

import contextlib
import importlib.util
import io
import sys
import tempfile
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MESH2STL_PATH = ROOT / "app" / "mesh2stl.py"
CAD2STL_PATH = ROOT / "app" / "cad2stl.py"
MARKER = "INVALID_SOURCE_GEOMETRY"


class FakeMesh:
    def __init__(self, units=None, faces=3, vertices=3, extents=(10.0, 20.0, 30.0)):
        self.metadata = {} if units is None else {"units": units}
        self.faces = [(0, 1, 2)] * faces
        self.vertices = [(0.0, 0.0, 0.0)] * vertices
        self.extents = list(extents)
        self.scales = []
        self.exports = []

    def apply_scale(self, factor):
        self.scales.append(factor)
        self.extents = [value * factor for value in self.extents]

    def export(self, output_path):
        self.exports.append(output_path)
        Path(output_path).write_bytes(b"solid fake\nendsolid fake\n")


class FakeScene:
    def __init__(self, mesh, units=None):
        self.geometry = {} if mesh is None else {"body": mesh}
        self.metadata = {} if units is None else {"units": units}
        self.mesh = mesh
        self.to_mesh_calls = 0

    def to_mesh(self):
        self.to_mesh_calls += 1
        return self.mesh

    def dump(self, **_kwargs):
        raise AssertionError("Scene.dump must not be used any more")


def load_module(path, module_name, fake_modules):
    previous = {name: sys.modules.get(name) for name in fake_modules}
    sys.modules.update(fake_modules)
    try:
        spec = importlib.util.spec_from_file_location(module_name, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, value in previous.items():
            if value is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = value


def fake_trimesh(loaded):
    module = types.ModuleType("trimesh")
    module.Scene = FakeScene
    module.util = types.SimpleNamespace(concatenate=lambda value: value)
    module.load = lambda _path: loaded() if callable(loaded) else loaded
    return module


def capture(callable_):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            callable_()
            code = None
        except SystemExit as exit_:
            code = exit_.code
    return code, out.getvalue(), err.getvalue()


def marker_lines(text):
    return [line for line in text.splitlines() if line.startswith(MARKER + "|")]


class Mesh2StlTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.input_path = self.root / "model.3mf"
        self.output_path = self.root / "model.3mf.stl"
        self.input_path.write_bytes(b"not really a 3mf")

    def convert(self, loaded):
        module = load_module(MESH2STL_PATH, "mesh2stl_under_test", {"trimesh": fake_trimesh(loaded)})
        return module, capture(lambda: module.convert_mesh_to_stl(str(self.input_path), str(self.output_path)))

    def test_inch_scene_is_merged_without_dump_and_scaled_to_millimetres(self):
        mesh = FakeMesh()
        scene = FakeScene(mesh, units="inch")
        _module, (code, out, err) = self.convert(scene)
        self.assertIsNone(code)
        self.assertEqual(scene.to_mesh_calls, 1)
        self.assertEqual(mesh.scales, [25.4])
        self.assertEqual(mesh.exports, [str(self.output_path)])
        self.assertTrue(self.output_path.is_file())
        self.assertEqual(marker_lines(out) + marker_lines(err), [])

    def test_millimetre_and_undeclared_units_are_not_rescaled(self):
        for units in (None, "millimeter", "MM"):
            mesh = FakeMesh(units=units)
            _module, (code, _out, _err) = self.convert(mesh)
            self.assertIsNone(code, units)
            self.assertEqual(mesh.scales, [], units)

    def test_every_3mf_unit_maps_to_the_exact_millimetre_factor(self):
        module = load_module(MESH2STL_PATH, "mesh2stl_units", {"trimesh": fake_trimesh(FakeMesh())})
        expected = {
            "micron": 0.001,
            "millimeter": 1.0,
            "centimeter": 10.0,
            "inch": 25.4,
            "foot": 304.8,
            "meter": 1000.0,
        }
        for label, factor in expected.items():
            self.assertEqual(module.unit_scale_to_mm(label), factor, label)
            self.assertEqual(module.unit_scale_to_mm(label.upper()), factor, label)
        self.assertEqual(module.unit_scale_to_mm(None), 1.0)
        self.assertEqual(module.unit_scale_to_mm("  "), 1.0)
        with self.assertRaises(module.InvalidSourceGeometry):
            module.unit_scale_to_mm("parsec")

    def test_geometry_metadata_units_are_honoured_when_the_scene_declares_none(self):
        mesh = FakeMesh(units="centimeter")
        _module, (code, _out, _err) = self.convert(FakeScene(mesh))
        self.assertIsNone(code)
        self.assertEqual(mesh.scales, [10.0])

    def assert_marker(self, loaded, reason_fragment):
        _module, (code, out, err) = self.convert(loaded)
        self.assertEqual(code, 2)
        self.assertEqual(len(marker_lines(out)), 1, out)
        self.assertEqual(marker_lines(out), marker_lines(err))
        marker = marker_lines(out)[0]
        self.assertIn(reason_fragment, marker)
        self.assertNotIn(str(self.root), marker)
        self.assertFalse(self.output_path.exists())

    def test_empty_scene_reports_the_marker_on_both_streams_with_exit_2(self):
        self.assert_marker(FakeScene(None), f"{MARKER}|scene is empty")

    def test_degenerate_meshes_report_the_marker(self):
        self.assert_marker(FakeMesh(faces=0), f"{MARKER}|mesh has no faces")
        self.assert_marker(FakeMesh(vertices=0), f"{MARKER}|mesh has no vertices")
        self.assert_marker(FakeMesh(extents=(0.0, 0.0, 0.0)), f"{MARKER}|mesh has zero extent")
        self.assert_marker(FakeMesh(extents=(1.0, float("nan"), 1.0)), f"{MARKER}|mesh extents are not finite")

    def test_unsupported_unit_and_unloadable_sources_report_the_marker(self):
        self.assert_marker(FakeMesh(units="parsec"), f"{MARKER}|unsupported unit parsec")

        def explode():
            raise RuntimeError("corrupt archive | with pipe")

        self.assert_marker(explode, f"{MARKER}|unloadable RuntimeError")

    def test_missing_input_and_export_failures_keep_exit_1_without_marker(self):
        def missing():
            raise FileNotFoundError("gone")

        _module, (code, out, err) = self.convert(missing)
        self.assertEqual(code, 1)
        self.assertEqual(marker_lines(out) + marker_lines(err), [])

        class ExportFailure(FakeMesh):
            def export(self, _output_path):
                raise OSError("disk full")

        _module, (code, out, err) = self.convert(ExportFailure())
        self.assertEqual(code, 1)
        self.assertEqual(marker_lines(out) + marker_lines(err), [])

    def test_reasons_are_bounded_printable_ascii_without_the_separator(self):
        module = load_module(MESH2STL_PATH, "mesh2stl_reason", {"trimesh": fake_trimesh(FakeMesh())})
        self.assertEqual(module._short_reason("a|b\ncé" + "x" * 200), "a/bc" + "x" * 76)
        self.assertEqual(module._short_reason("\n"), "unspecified")


class FakeGmsh:
    def __init__(self, surfaces=1, volumes=0, nodes=3, elements=1, merge_error=None, generate_error=None):
        self.initialized = False
        self.writes = []
        self.merged = []
        self.options = []
        gmsh = self

        class Occ:
            @staticmethod
            def synchronize():
                return None

        class MeshApi:
            @staticmethod
            def generate(dimension):
                if generate_error is not None:
                    raise generate_error
                gmsh.generated = dimension

            @staticmethod
            def getNodes():
                return list(range(nodes)), [], []

            @staticmethod
            def getElements(_dimension):
                if elements == 0:
                    return [], [], []
                return [2], [list(range(elements))], [[]]

        class Model:
            occ = Occ
            mesh = MeshApi

            @staticmethod
            def getEntities(dimension):
                count = surfaces if dimension == 2 else volumes
                return [(dimension, index) for index in range(count)]

        class Option:
            @staticmethod
            def setNumber(name, value):
                gmsh.options.append((name, value))

        self.model = Model
        self.option = Option
        self.merge_error = merge_error

    def initialize(self):
        self.initialized = True

    def finalize(self):
        self.initialized = False

    def isInitialized(self):
        return self.initialized

    def merge(self, path):
        if self.merge_error is not None:
            raise self.merge_error
        self.merged.append(path)

    def write(self, path):
        self.writes.append(path)
        Path(path).write_bytes(b"solid cad\nendsolid cad\n")


class Cad2StlTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.input_path = self.root / "part.step"
        self.output_path = self.root / "part.step.stl"
        self.input_path.write_bytes(b"ISO-10303-21;\nHEADER;\n")

    def convert(self, gmsh):
        module = load_module(CAD2STL_PATH, "cad2stl_under_test", {"gmsh": gmsh})
        return capture(lambda: module.convert_cad_to_stl(str(self.input_path), str(self.output_path)))

    def assert_marker(self, gmsh, reason_fragment):
        code, out, err = self.convert(gmsh)
        self.assertEqual(code, 2)
        self.assertEqual(len(marker_lines(out)), 1, out)
        self.assertEqual(marker_lines(out), marker_lines(err))
        self.assertIn(reason_fragment, marker_lines(out)[0])
        self.assertFalse(gmsh.initialized, "gmsh is always finalized")
        self.assertFalse(self.output_path.exists())

    def test_valid_cad_writes_stl_and_finalizes(self):
        gmsh = FakeGmsh()
        code, out, err = self.convert(gmsh)
        self.assertIsNone(code)
        self.assertEqual(gmsh.writes, [str(self.output_path)])
        self.assertEqual(gmsh.merged, [str(self.input_path)])
        self.assertFalse(gmsh.initialized)
        self.assertEqual(marker_lines(out) + marker_lines(err), [])

    def test_html_download_reports_the_marker(self):
        self.input_path.write_bytes(b"<!DOCTYPE html><html><body>login</body></html>")
        self.assert_marker(FakeGmsh(), f"{MARKER}|html document instead of cad")

    def test_unloadable_cad_reports_the_marker(self):
        self.assert_marker(FakeGmsh(merge_error=Exception("Could not create any geometry")), f"{MARKER}|unloadable Exception")

    def test_cad_without_surfaces_reports_the_marker(self):
        self.assert_marker(FakeGmsh(surfaces=0, volumes=0), f"{MARKER}|no surfaces in cad model")

    def test_mesh_generation_without_triangles_reports_the_marker(self):
        self.assert_marker(FakeGmsh(elements=0), f"{MARKER}|mesh has no triangles")
        self.assert_marker(FakeGmsh(nodes=0), f"{MARKER}|mesh has no nodes")
        self.assert_marker(FakeGmsh(generate_error=RuntimeError("periodic surface")), f"{MARKER}|mesh generation failed RuntimeError")

    def test_missing_input_keeps_exit_1_without_marker(self):
        self.input_path.unlink()
        code, out, err = self.convert(FakeGmsh())
        self.assertEqual(code, 1)
        self.assertEqual(marker_lines(out) + marker_lines(err), [])


if __name__ == "__main__":
    unittest.main()
