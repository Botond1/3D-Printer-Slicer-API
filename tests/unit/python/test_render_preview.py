"""Deterministic preview renderer contract tests for app/render_preview.py."""

import hashlib
import importlib.util
import io
import struct
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "app" / "render_preview.py"

try:  # The renderer needs numpy and Pillow; skip cleanly where they are absent.
    import numpy as np  # noqa: F401
    from PIL import Image
    DEPENDENCIES_AVAILABLE = True
except ImportError:  # pragma: no cover - environment dependent
    DEPENDENCIES_AVAILABLE = False

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def load_renderer():
    spec = importlib.util.spec_from_file_location("render_preview_under_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def box_triangles(size_x, size_y, size_z):
    x0, y0, z0 = -size_x / 2.0, -size_y / 2.0, 0.0
    x1, y1, z1 = size_x / 2.0, size_y / 2.0, size_z
    points = [
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
    ]
    faces = [
        (0, 2, 1), (0, 3, 2),
        (4, 5, 6), (4, 6, 7),
        (0, 1, 5), (0, 5, 4),
        (1, 2, 6), (1, 6, 5),
        (2, 3, 7), (2, 7, 6),
        (3, 0, 4), (3, 4, 7),
    ]
    return [[points[a], points[b], points[c]] for a, b, c in faces]


def write_binary_stl(path, triangles):
    with open(path, "wb") as handle:
        handle.write(b"\0" * 80)
        handle.write(struct.pack("<I", len(triangles)))
        for triangle in triangles:
            handle.write(struct.pack("<3f", 0.0, 0.0, 0.0))
            for vertex in triangle:
                handle.write(struct.pack("<3f", *vertex))
            handle.write(struct.pack("<H", 0))


def write_ascii_stl(path, triangles):
    lines = ["solid fixture"]
    for triangle in triangles:
        lines.append("  facet normal 0 0 0")
        lines.append("    outer loop")
        for vertex in triangle:
            lines.append("      vertex {:.6f} {:.6f} {:.6f}".format(*vertex))
        lines.append("    endloop")
        lines.append("  endfacet")
    lines.append("endsolid fixture")
    Path(path).write_text("\n".join(lines) + "\n", encoding="ascii")


@unittest.skipUnless(DEPENDENCIES_AVAILABLE, "numpy and Pillow are required for the renderer")
class RenderPreviewTests(unittest.TestCase):
    def setUp(self):
        self.module = load_renderer()
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.cube = self.root / "cube.stl"
        write_binary_stl(self.cube, box_triangles(40.0, 60.0, 25.0))

    def render(self, name, caption="40.0 x 60.0 x 25.0 mm", width=1024, height=768, source=None):
        output = self.root / name
        self.module.render_file(str(source or self.cube), str(output), width, height, caption)
        return output.read_bytes()

    def test_identical_input_and_options_produce_byte_identical_png(self):
        first = self.render("first.png")
        second = self.render("second.png")
        self.assertEqual(hashlib.sha256(first).hexdigest(), hashlib.sha256(second).hexdigest())
        self.assertTrue(first.startswith(PNG_SIGNATURE))
        with Image.open(io.BytesIO(first)) as image:
            self.assertEqual(image.size, (1024, 768))
            self.assertEqual(image.mode, "RGB")
            self.assertEqual(image.getpixel((2, 2)), (245, 245, 245))
            self.assertEqual(image.getpixel((1021, 2)), (245, 245, 245))
            # The model occupies the centre: it must not be background there.
            self.assertNotEqual(image.getpixel((512, 300)), (245, 245, 245))
            self.assertFalse(image.info.get("timestamp"))
            self.assertNotIn(b"tIME", first)

    def test_caption_and_geometry_changes_alter_the_image(self):
        baseline = self.render("baseline.png")
        other_caption = self.render("caption.png", caption="1.0 x 2.0 x 3.0 mm")
        self.assertNotEqual(baseline, other_caption)
        tall = self.root / "tall.stl"
        write_binary_stl(tall, box_triangles(40.0, 60.0, 80.0))
        other_geometry = self.render("tall.png", source=tall)
        self.assertNotEqual(baseline, other_geometry)

    def test_ascii_and_binary_stl_load_to_the_same_triangles(self):
        ascii_path = self.root / "cube_ascii.stl"
        write_ascii_stl(ascii_path, box_triangles(40.0, 60.0, 25.0))
        binary = self.module.load_stl_triangles(str(self.cube))
        ascii_triangles = self.module.load_stl_triangles(str(ascii_path))
        self.assertEqual(binary.shape, (12, 3, 3))
        self.assertTrue(np.allclose(binary, ascii_triangles))
        self.assertEqual(self.render("binary.png"), self.render("ascii.png", source=ascii_path))

    def test_invalid_or_empty_models_are_rejected_not_repaired(self):
        empty = self.root / "empty.stl"
        write_binary_stl(empty, [])
        with self.assertRaises(ValueError):
            self.module.load_stl_triangles(str(empty))
        garbage = self.root / "garbage.stl"
        garbage.write_bytes(b"this is not an stl file at all")
        with self.assertRaises(ValueError):
            self.module.load_stl_triangles(str(garbage))
        degenerate = np.zeros((3, 3, 3), dtype=np.float64)
        with self.assertRaises(ValueError):
            self.module.select_drawable_faces(degenerate, 300000)

    def test_face_cap_is_deterministic_and_keeps_the_largest_faces(self):
        triangles = np.asarray(box_triangles(10.0, 40.0, 5.0), dtype=np.float64)
        first = self.module.select_drawable_faces(triangles, 4)
        second = self.module.select_drawable_faces(triangles, 4)
        self.assertEqual(first.tolist(), second.tolist())
        self.assertEqual(len(first), 4)
        # The two largest faces are top and bottom (10 x 40); both halves of each must be kept.
        self.assertEqual(sorted(first.tolist()), [0, 1, 2, 3])
        full = self.module.select_drawable_faces(triangles, 300000)
        self.assertEqual(full.tolist(), list(range(12)))

    def test_output_is_created_exclusively_and_never_overwritten(self):
        target = self.root / "existing.png"
        target.write_bytes(b"existing")
        with self.assertRaises(FileExistsError):
            self.module.render_file(str(self.cube), str(target), 1024, 768, "x")
        self.assertEqual(target.read_bytes(), b"existing")

    def test_cli_exit_codes_and_argument_shape(self):
        output = self.root / "cli.png"
        status = self.module.main([
            str(self.cube), str(output), "--width", "1024", "--height", "768",
            "--caption", "40.0 x 60.0 x 25.0 mm",
        ])
        self.assertEqual(status, 0)
        self.assertTrue(output.read_bytes().startswith(PNG_SIGNATURE))
        self.assertEqual(self.module.main([str(self.root / "missing.stl"), str(self.root / "no.png")]), 1)
        self.assertEqual(self.module.main([str(self.cube), str(self.root / "bad.png"), "--width", "8"]), 1)

    def test_camera_sits_in_the_plus_x_minus_y_plus_z_octant(self):
        right, up, toward_camera = self.module.camera_basis()
        self.assertGreater(toward_camera[0], 0.0)
        self.assertLess(toward_camera[1], 0.0)
        self.assertGreater(toward_camera[2], 0.0)
        self.assertAlmostEqual(float(np.dot(right, up)), 0.0, places=9)
        self.assertAlmostEqual(float(np.dot(right, toward_camera)), 0.0, places=9)
        self.assertGreater(up[2], 0.0)


if __name__ == "__main__":
    unittest.main()
