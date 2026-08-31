import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import types
import unittest


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "app" / "orient.py"
X_90 = [
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 0.0, -1.0, 0.0],
    [0.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 1.0],
]
IDENTITY = [
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0],
]


class FakeVector:
    def __neg__(self):
        return [0.0, 0.0, 0.0]


class FakeMesh:
    def __init__(self, pose_failure=False):
        self.extents = [20.0, 240.0, 245.0]
        self.centroid = FakeVector()
        self.bounds = [[0.0, 0.0, 0.0], [20.0, 240.0, 245.0]]
        self.pose_failure = pose_failure
        self.applied_transforms = []
        self.stable_pose_calls = 0

    def compute_stable_poses(self, **_kwargs):
        self.stable_pose_calls += 1
        if self.pose_failure:
            raise RuntimeError("synthetic pose failure")
        return [X_90], [0.9]

    def copy(self):
        return FakeMesh(self.pose_failure)

    def apply_transform(self, transform):
        self.applied_transforms.append(transform)
        self.extents = [20.0, 245.0, 240.0]
        self.bounds = [[0.0, 0.0, 0.0], [20.0, 245.0, 240.0]]

    def apply_translation(self, _translation):
        return None

    def export(self, output_path):
        Path(output_path).write_bytes(b"solid j3\nendsolid j3\n")


def load_orient_module():
    fake_trimesh = types.ModuleType("trimesh")
    fake_trimesh.Scene = type("Scene", (), {})
    fake_trimesh.util = types.SimpleNamespace(concatenate=lambda value: value)
    fake_trimesh.load = lambda _path: FakeMesh()
    previous = sys.modules.get("trimesh")
    sys.modules["trimesh"] = fake_trimesh
    try:
        spec = importlib.util.spec_from_file_location("j3_orient_test_module", MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            sys.modules.pop("trimesh", None)
        else:
            sys.modules["trimesh"] = previous


class OrientationMetadataTests(unittest.TestCase):
    def setUp(self):
        self.module = load_orient_module()

    def run_orientation(self, mesh, mode):
        self.module.trimesh.load = lambda _path: mesh
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        input_path = root / "input.stl"
        output_path = root / "output.stl"
        metadata_path = root / "orientation.json"
        input_path.write_bytes(b"solid input\nendsolid input\n")
        self.module.optimize_orientation(
            str(input_path),
            str(output_path),
            "FDM",
            mode,
            str(metadata_path),
        )
        return output_path, metadata_path, json.loads(metadata_path.read_text(encoding="utf-8"))

    def test_auto_records_the_actual_applied_rotation_after_export(self):
        mesh = FakeMesh()
        output_path, metadata_path, metadata = self.run_orientation(mesh, "auto")

        self.assertTrue(output_path.is_file())
        self.assertEqual(
            set(metadata),
            {
                "orientation_metadata_schema",
                "orientation_mode",
                "orientation_outcome",
                "rotation_matrix",
            },
        )
        self.assertEqual(metadata["orientation_metadata_schema"], 1)
        self.assertEqual(metadata["orientation_mode"], "auto")
        self.assertEqual(metadata["orientation_outcome"], "applied")
        self.assertEqual(metadata["rotation_matrix"], [row[:3] for row in X_90[:3]])
        self.assertEqual(mesh.applied_transforms, [X_90])
        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(metadata_path.stat().st_mode), 0o600)

    def test_preserve_keeps_identity_rotation_and_skips_stable_pose_selection(self):
        mesh = FakeMesh()
        _output_path, _metadata_path, metadata = self.run_orientation(mesh, "preserve")

        self.assertEqual(mesh.stable_pose_calls, 0)
        self.assertEqual(mesh.applied_transforms, [])
        self.assertEqual(metadata["orientation_outcome"], "preserved")
        self.assertEqual(metadata["rotation_matrix"], IDENTITY)

    def test_pose_failure_is_explicit_identity_fallback(self):
        mesh = FakeMesh(pose_failure=True)
        _output_path, _metadata_path, metadata = self.run_orientation(mesh, "auto")

        self.assertEqual(mesh.stable_pose_calls, 1)
        self.assertEqual(mesh.applied_transforms, [])
        self.assertEqual(metadata["orientation_outcome"], "fallback_unmodified")
        self.assertEqual(metadata["rotation_matrix"], IDENTITY)

    def test_metadata_is_exclusive_create(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "orientation.json"
            target.write_text("existing", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                self.module._write_orientation_metadata(
                    str(target), "auto", "unchanged", IDENTITY
                )
            self.assertEqual(target.read_text(encoding="utf-8"), "existing")


if __name__ == "__main__":
    unittest.main()
