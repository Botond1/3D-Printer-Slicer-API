"""Placement contract tests for app/scale_model.py without a real trimesh.

Bambu Studio is invoked with ``--arrange 0`` and keeps the STL coordinates
exactly, so the API owns placement through the strictly ordered
``--place-min-x X --place-min-y Y`` pair. These tests pin the argv contract and
the scale -> rotate -> ground -> place order with a fake mesh, so they run
wherever numpy is importable and never need trimesh.
"""

import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "app" / "scale_model.py"

try:  # scale_model builds its scale matrix with numpy; skip cleanly where absent.
    import numpy as np

    NUMPY_AVAILABLE = True
except ImportError:  # pragma: no cover - environment dependent
    NUMPY_AVAILABLE = False


class FakeMesh:
    """Axis-aligned box mesh that tracks the transforms scale_model applies.

    ``is_watertight``/``volume`` are omitted by default (matching a stand-in
    mesh with no meaningful volume concept), so accessing them raises
    ``AttributeError`` exactly like an unexpected trimesh failure would; the
    volume-marker tests below opt in explicitly.
    """

    def __init__(self, minimum, maximum, is_watertight=None, volume=None):
        self.minimum = np.array(minimum, dtype=float)
        self.maximum = np.array(maximum, dtype=float)
        self.translations = []
        self.transforms = []
        self.exported_to = None
        if is_watertight is not None:
            self.is_watertight = is_watertight
        if volume is not None:
            self.volume = volume

    @property
    def bounds(self):
        return np.array([self.minimum, self.maximum])

    @property
    def centroid(self):
        return (self.minimum + self.maximum) / 2.0

    def apply_transform(self, matrix):
        matrix = np.asarray(matrix, dtype=float)
        self.transforms.append(matrix)
        diagonal = np.array([matrix[0, 0], matrix[1, 1], matrix[2, 2]])
        self.minimum = self.minimum * diagonal
        self.maximum = self.maximum * diagonal

    def apply_translation(self, vector):
        vector = np.asarray(vector, dtype=float)
        self.translations.append(vector.tolist())
        self.minimum = self.minimum + vector
        self.maximum = self.maximum + vector

    def export(self, output_path):
        self.exported_to = output_path
        Path(output_path).write_bytes(b"solid placed\nendsolid placed\n")


def load_scale_model(mesh):
    """Import scale_model with a stub trimesh whose load() returns ``mesh``."""
    fake_trimesh = types.ModuleType("trimesh")
    fake_trimesh.Trimesh = FakeMesh
    fake_trimesh.Scene = type("Scene", (), {})
    fake_trimesh.util = types.SimpleNamespace(concatenate=lambda value: value)
    fake_trimesh.transformations = types.SimpleNamespace(
        rotation_matrix=lambda _angle, _axis: np.eye(4)
    )
    fake_trimesh.load = lambda _path: mesh
    previous = sys.modules.get("trimesh")
    sys.modules["trimesh"] = fake_trimesh
    try:
        spec = importlib.util.spec_from_file_location("scale_model_placement_under_test", MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            sys.modules.pop("trimesh", None)
        else:
            sys.modules["trimesh"] = previous


BASE_ARGV = ["scale_model.py", "in.stl", "out.stl", "1", "1", "1", "0", "0", "0"]


@unittest.skipUnless(NUMPY_AVAILABLE, "numpy is required to import scale_model.py")
class ScaleModelPlacementArgvTests(unittest.TestCase):
    def setUp(self):
        self.module = load_scale_model(FakeMesh([-5, -10, 0], [5, 10, 30]))

    def test_flag_constants_and_counts_are_pinned(self):
        self.assertEqual(self.module.PLACE_MIN_X_FLAG, "--place-min-x")
        self.assertEqual(self.module.PLACE_MIN_Y_FLAG, "--place-min-y")
        self.assertEqual(self.module.BASE_ARGUMENT_COUNT, 9)
        self.assertEqual(self.module.PLACED_ARGUMENT_COUNT, 13)

    def test_base_argv_has_no_placement(self):
        parsed = self.module._parse_args(BASE_ARGV)
        self.assertEqual(parsed[:2], ("in.stl", "out.stl"))
        self.assertEqual(parsed[2:8], (1.0, 1.0, 1.0, 0.0, 0.0, 0.0))
        self.assertIsNone(parsed[8])

    def test_ordered_placement_pair_is_parsed(self):
        argv = BASE_ARGV + ["--place-min-x", "18", "--place-min-y", "0"]
        self.assertEqual(self.module._parse_args(argv)[8], (18.0, 0.0))
        argv = BASE_ARGV + ["--place-min-x", "0.5", "--place-min-y", "27.9"]
        self.assertEqual(self.module._parse_placement(argv), (0.5, 27.9))

    def test_misordered_partial_or_unknown_flags_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "in that order"):
            self.module._parse_args(BASE_ARGV + ["--place-min-y", "0", "--place-min-x", "18"])
        with self.assertRaisesRegex(ValueError, "in that order"):
            self.module._parse_args(BASE_ARGV + ["--place-min-x", "18", "--other", "0"])
        with self.assertRaisesRegex(ValueError, "Usage"):
            self.module._parse_args(BASE_ARGV + ["--place-min-x", "18"])
        with self.assertRaisesRegex(ValueError, "Usage"):
            self.module._parse_args(BASE_ARGV[:-1])
        with self.assertRaisesRegex(ValueError, "Usage"):
            self.module._parse_args(BASE_ARGV + ["--place-min-x", "18", "--place-min-y", "0", "extra"])

    def test_non_finite_or_non_numeric_coordinates_fail_closed(self):
        for value in ("nan", "inf", "-inf"):
            with self.assertRaisesRegex(ValueError, "finite"):
                self.module._parse_args(BASE_ARGV + ["--place-min-x", value, "--place-min-y", "0"])
        with self.assertRaises(ValueError):
            self.module._parse_args(BASE_ARGV + ["--place-min-x", "abc", "--place-min-y", "0"])


@unittest.skipUnless(NUMPY_AVAILABLE, "numpy is required to import scale_model.py")
class ScaleModelPlacementTransformTests(unittest.TestCase):
    def run_transform(self, mesh, scale=(1.0, 1.0, 1.0), placement=None):
        module = load_scale_model(mesh)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        input_path = root / "input.stl"
        output_path = root / "output.stl"
        input_path.write_bytes(b"solid input\nendsolid input\n")
        module.transform_model(
            str(input_path), str(output_path), *scale, 0.0, 0.0, 0.0, placement=placement
        )
        return module, output_path

    def test_place_at_minimum_corner_moves_only_x_and_y(self):
        mesh = FakeMesh([-5, -10, 0], [5, 10, 30])
        module = load_scale_model(mesh)
        module._place_at_minimum_corner(mesh, 18.0, 0.0)
        self.assertEqual(mesh.translations, [[23.0, 10.0, 0.0]])
        self.assertEqual(mesh.bounds.tolist(), [[18.0, 0.0, 0.0], [28.0, 20.0, 30.0]])

    def test_placement_follows_scale_and_grounding(self):
        # A 10 x 20 x 30 box hovering 5 mm above the bed and off-centre.
        mesh = FakeMesh([100, 200, 5], [110, 220, 35])
        _module, output_path = self.run_transform(mesh, scale=(2.0, 2.0, 2.0), placement=(0.0, 28.0))
        self.assertTrue(output_path.is_file())
        self.assertEqual(mesh.exported_to, str(output_path))
        # Scale doubled the extents before any translation.
        self.assertEqual(len(mesh.transforms), 1)
        extents = (mesh.maximum - mesh.minimum).tolist()
        self.assertEqual(extents, [20.0, 40.0, 60.0])
        # Grounding centred XY and put the lowest point on Z=0; placement then set the corner.
        self.assertEqual(mesh.minimum.tolist(), [0.0, 28.0, 0.0])
        self.assertEqual(mesh.maximum.tolist(), [20.0, 68.0, 60.0])
        # Translation order: pre-scale -centroid, grounding -centroid and -min_z,
        # then the placement shift (Z untouched).
        self.assertEqual(len(mesh.translations), 4)
        self.assertEqual(mesh.translations[2][:2], [0.0, 0.0])
        self.assertEqual(mesh.translations[3][2], 0.0)

    def test_without_placement_the_model_stays_centred_on_the_origin(self):
        mesh = FakeMesh([100, 200, 5], [110, 220, 35])
        self.run_transform(mesh)
        self.assertEqual(mesh.minimum.tolist(), [-5.0, -10.0, 0.0])
        self.assertEqual(mesh.maximum.tolist(), [5.0, 10.0, 30.0])
        self.assertEqual(len(mesh.translations), 3)

    def test_non_positive_scale_is_rejected_before_loading(self):
        module = load_scale_model(FakeMesh([0, 0, 0], [1, 1, 1]))
        with self.assertRaisesRegex(ValueError, "positive"):
            module.transform_model("in.stl", "out.stl", 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, placement=(0.0, 0.0))


@unittest.skipUnless(NUMPY_AVAILABLE, "numpy is required to import scale_model.py")
class ScaleModelVolumeMarkerTests(unittest.TestCase):
    """``R3D_MESH_VOLUME_MM3`` is scale_model.py's final stdout line (SLA
    model-volume support). Only a watertight mesh reports a real volume; a
    non-watertight mesh, or one whose volume evaluation raises, reports
    explicit unavailability instead of a misleading number.
    """

    def test_watertight_mesh_reports_absolute_volume(self):
        module = load_scale_model(FakeMesh([0, 0, 0], [1, 1, 1]))
        mesh = FakeMesh([0, 0, 0], [1, 1, 1], is_watertight=True, volume=-24320.5)
        self.assertEqual(module._format_volume_marker(mesh), "R3D_MESH_VOLUME_MM3=24320.5")

    def test_non_watertight_mesh_reports_unavailable(self):
        module = load_scale_model(FakeMesh([0, 0, 0], [1, 1, 1]))
        mesh = FakeMesh([0, 0, 0], [1, 1, 1], is_watertight=False, volume=1000.0)
        self.assertEqual(module._format_volume_marker(mesh), "R3D_MESH_VOLUME_MM3=unavailable")

    def test_missing_watertight_attribute_reports_unavailable_without_raising(self):
        module = load_scale_model(FakeMesh([0, 0, 0], [1, 1, 1]))
        mesh = FakeMesh([0, 0, 0], [1, 1, 1])  # no is_watertight/volume at all
        self.assertEqual(module._format_volume_marker(mesh), "R3D_MESH_VOLUME_MM3=unavailable")

    def test_non_finite_volume_reports_unavailable(self):
        module = load_scale_model(FakeMesh([0, 0, 0], [1, 1, 1]))
        mesh = FakeMesh([0, 0, 0], [1, 1, 1], is_watertight=True, volume=float("nan"))
        self.assertEqual(module._format_volume_marker(mesh), "R3D_MESH_VOLUME_MM3=unavailable")

    def test_transform_model_returns_the_volume_marker(self):
        mesh = FakeMesh([0, 0, 0], [10, 10, 10], is_watertight=True, volume=1000.0)
        module = load_scale_model(mesh)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        input_path = root / "input.stl"
        output_path = root / "output.stl"
        input_path.write_bytes(b"solid input\nendsolid input\n")
        marker = module.transform_model(str(input_path), str(output_path), 2.0, 2.0, 2.0, 0.0, 0.0, 0.0)
        # Scaling by 2 on every axis does not change this stand-in mesh's
        # reported .volume (a real trimesh mesh would scale by 2**3); the
        # marker only proves the return value is threaded through.
        self.assertEqual(marker, "R3D_MESH_VOLUME_MM3=1000.0")
        self.assertTrue(output_path.is_file())


if __name__ == "__main__":
    unittest.main()
