"""Deterministic isometric PNG preview renderer for already-transformed STL models.

Usage:
    python3 render_preview.py input.stl output.png --width 1024 --height 768 \
        --caption "40.0 x 40.0 x 40.0 mm"

The renderer receives the exact STL the slice pipeline would hand to the native
slicer (after orientation, sizing, and requested rotation), so the preview shows
the same final pose. Rendering is fully deterministic: identical input bytes and
options produce byte-identical PNG output. No timestamps, random seeds, system
fonts, or wall-clock dependent values are used.

Rendering model:
- orthographic projection from azimuth 45 degrees / elevation 30 degrees
  (camera direction +X, -Y, +Z);
- painter's algorithm ordered by face depth;
- Lambert shading with mild edge darkening;
- supersampled 2x and downsampled with LANCZOS;
- light background, subtle build-plate grid, dimension caption bottom-left.

The renderer never repairs geometry. Degenerate zero-area faces are simply not
drawn; a model without any drawable face is rejected.
"""

from __future__ import annotations

import argparse
import io
import math
import os
import re
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont


BACKGROUND_RGB = (245, 245, 245)
MODEL_BASE_RGB = (92, 140, 196)
PLATE_LINE_RGB = (214, 214, 214)
PLATE_BORDER_RGB = (188, 188, 188)
CAPTION_RGB = (48, 48, 48)
EDGE_DARKENING = 0.82
AMBIENT = 0.30
DIFFUSE = 0.70
CAMERA_AZIMUTH_DEG = 45.0
CAMERA_ELEVATION_DEG = 30.0
LIGHT_DIRECTION = (0.35, -0.65, 0.68)
SUPERSAMPLE = 2
DEFAULT_WIDTH = 1024
DEFAULT_HEIGHT = 768
DEFAULT_MAX_FACES = 300_000
MIN_IMAGE_SIDE = 64
MAX_IMAGE_SIDE = 4096
MAX_CAPTION_CHARS = 128
OUTLINE_MIN_AREA_PX = 6.0
MARGIN_FRACTION = 0.06
CAPTION_BAND_FRACTION = 0.07
BINARY_STL_HEADER_BYTES = 80
BINARY_STL_RECORD_BYTES = 50

_ASCII_VERTEX_PATTERN = re.compile(
    rb"vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)"
)


def _normalize(vector: np.ndarray) -> np.ndarray:
    """Return the unit vector, rejecting a zero-length input."""
    length = float(np.linalg.norm(vector))
    if length <= 0.0 or not math.isfinite(length):
        raise ValueError("Cannot normalize a zero-length vector.")
    return vector / length


def load_stl_triangles(input_path: str) -> np.ndarray:
    """Load an STL file into an (n, 3, 3) float64 vertex array.

    Binary STL is detected by its exact record-length signature; everything
    else is parsed as ASCII STL. The file is read once and never mutated.

    Raises:
        ValueError: If the file is not a parseable STL or contains no faces.
    """
    with open(input_path, "rb") as handle:
        data = handle.read()

    triangles = _parse_binary_stl(data)
    if triangles is None:
        triangles = _parse_ascii_stl(data)

    if triangles.shape[0] == 0:
        raise ValueError("The STL model does not contain any triangle faces.")
    if not np.all(np.isfinite(triangles)):
        raise ValueError("The STL model contains non-finite vertex coordinates.")
    return triangles


def _parse_binary_stl(data: bytes) -> np.ndarray | None:
    """Parse binary STL bytes, or return None when the layout does not match."""
    header_and_count = BINARY_STL_HEADER_BYTES + 4
    if len(data) < header_and_count:
        return None
    (face_count,) = struct.unpack("<I", data[BINARY_STL_HEADER_BYTES:header_and_count])
    expected = header_and_count + BINARY_STL_RECORD_BYTES * face_count
    if len(data) != expected:
        return None
    record = np.dtype(
        [
            ("normal", "<f4", (3,)),
            ("vertices", "<f4", (3, 3)),
            ("attribute", "<u2"),
        ]
    )
    records = np.frombuffer(data, dtype=record, count=face_count, offset=header_and_count)
    return np.ascontiguousarray(records["vertices"].astype(np.float64))


def _parse_ascii_stl(data: bytes) -> np.ndarray:
    """Parse ASCII STL bytes into an (n, 3, 3) float64 vertex array."""
    if not data.lstrip().lower().startswith(b"solid"):
        raise ValueError("The input file is not a recognizable STL model.")
    values = [
        (float(x), float(y), float(z))
        for x, y, z in _ASCII_VERTEX_PATTERN.findall(data)
    ]
    if len(values) % 3 != 0:
        raise ValueError("The ASCII STL model has an incomplete facet definition.")
    array = np.asarray(values, dtype=np.float64).reshape(-1, 3, 3)
    return np.ascontiguousarray(array)


def camera_basis(azimuth_deg: float = CAMERA_AZIMUTH_DEG,
                 elevation_deg: float = CAMERA_ELEVATION_DEG) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return orthographic (right, up, toward-camera) unit vectors.

    The camera sits in the +X/-Y/+Z octant for the default azimuth/elevation
    and looks at the origin with world +Z as the up reference.
    """
    azimuth = math.radians(azimuth_deg)
    elevation = math.radians(elevation_deg)
    toward_camera = np.array(
        [
            math.cos(elevation) * math.cos(azimuth),
            -math.cos(elevation) * math.sin(azimuth),
            math.sin(elevation),
        ],
        dtype=np.float64,
    )
    world_up = np.array([0.0, 0.0, 1.0], dtype=np.float64)
    right = _normalize(np.cross(world_up, toward_camera))
    up = _normalize(np.cross(toward_camera, right))
    return right, up, toward_camera


def select_drawable_faces(triangles: np.ndarray, max_faces: int) -> np.ndarray:
    """Return the face indices that will be drawn, deterministically bounded.

    Zero-area faces are dropped (never repaired). When more than ``max_faces``
    remain, the faces with the largest surface area are kept so coverage is
    preserved while the painter's sort and polygon drawing stay bounded.
    """
    if max_faces < 1:
        raise ValueError("max_faces must be a positive integer.")
    edge_a = triangles[:, 1, :] - triangles[:, 0, :]
    edge_b = triangles[:, 2, :] - triangles[:, 0, :]
    doubled_area = np.linalg.norm(np.cross(edge_a, edge_b), axis=1)
    drawable = np.flatnonzero(doubled_area > 0.0)
    if drawable.shape[0] == 0:
        raise ValueError("The STL model has no drawable (non-degenerate) faces.")
    if drawable.shape[0] <= max_faces:
        return drawable
    order = np.argsort(-doubled_area[drawable], kind="stable")[:max_faces]
    return np.sort(drawable[order])


def _plate_geometry(triangles: np.ndarray) -> tuple[float, float, float, float, float]:
    """Return (min_x, max_x, min_y, max_y, step) for the build-plate grid."""
    minimum = triangles.reshape(-1, 3).min(axis=0)
    maximum = triangles.reshape(-1, 3).max(axis=0)
    extent = max(float(maximum[0] - minimum[0]), float(maximum[1] - minimum[1]), 1.0)
    step = 10.0 if extent <= 400.0 else 50.0
    half = math.ceil((extent * 1.25) / (2.0 * step)) * step
    half = max(half, step)
    center_x = float((minimum[0] + maximum[0]) / 2.0)
    center_y = float((minimum[1] + maximum[1]) / 2.0)
    # Snap the plate centre onto the grid so lines land on stable coordinates.
    center_x = round(center_x / step) * step
    center_y = round(center_y / step) * step
    return center_x - half, center_x + half, center_y - half, center_y + half, step


def _project(points: np.ndarray, right: np.ndarray, up: np.ndarray) -> np.ndarray:
    """Project world points to camera-plane coordinates (n, 2)."""
    flat = points.reshape(-1, 3)
    return np.stack((flat @ right, flat @ up), axis=1)


def _shade(color: tuple[int, int, int], intensity: float) -> tuple[int, int, int]:
    return tuple(int(round(channel * intensity)) for channel in color)


def _darken(color: tuple[int, int, int], factor: float) -> tuple[int, int, int]:
    return tuple(int(round(channel * factor)) for channel in color)


def _load_caption_font(size: int):
    """Load Pillow's bundled default font without touching system fonts."""
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def render_preview(triangles: np.ndarray, width: int, height: int, caption: str,
                   max_faces: int = DEFAULT_MAX_FACES) -> Image.Image:
    """Render the triangle soup into an RGB PIL image of the requested size."""
    if not (MIN_IMAGE_SIDE <= width <= MAX_IMAGE_SIDE and MIN_IMAGE_SIDE <= height <= MAX_IMAGE_SIDE):
        raise ValueError("Image dimensions are outside the supported range.")
    if len(caption) > MAX_CAPTION_CHARS:
        raise ValueError("Caption exceeds the supported length.")

    right, up, toward_camera = camera_basis()
    light = _normalize(np.asarray(LIGHT_DIRECTION, dtype=np.float64))

    face_indices = select_drawable_faces(triangles, max_faces)
    faces = triangles[face_indices]

    plate_min_x, plate_max_x, plate_min_y, plate_max_y, step = _plate_geometry(triangles)
    plate_corners = np.array(
        [
            [plate_min_x, plate_min_y, 0.0],
            [plate_max_x, plate_min_y, 0.0],
            [plate_max_x, plate_max_y, 0.0],
            [plate_min_x, plate_max_y, 0.0],
        ],
        dtype=np.float64,
    )

    projected_faces = _project(faces, right, up).reshape(-1, 3, 2)
    projected_plate = _project(plate_corners, right, up)
    all_points = np.concatenate((projected_faces.reshape(-1, 2), projected_plate), axis=0)
    minimum = all_points.min(axis=0)
    maximum = all_points.max(axis=0)
    span = np.maximum(maximum - minimum, 1e-9)

    canvas_width = width * SUPERSAMPLE
    canvas_height = height * SUPERSAMPLE
    margin_x = canvas_width * MARGIN_FRACTION
    margin_y = canvas_height * MARGIN_FRACTION
    caption_band = canvas_height * CAPTION_BAND_FRACTION
    usable_width = canvas_width - 2.0 * margin_x
    usable_height = canvas_height - 2.0 * margin_y - caption_band
    scale = min(usable_width / span[0], usable_height / span[1])
    offset_x = margin_x + (usable_width - span[0] * scale) / 2.0
    offset_y = margin_y + (usable_height - span[1] * scale) / 2.0

    def to_screen(points: np.ndarray) -> np.ndarray:
        screen_x = (points[:, 0] - minimum[0]) * scale + offset_x
        screen_y = canvas_height - caption_band - ((points[:, 1] - minimum[1]) * scale + offset_y)
        return np.stack((screen_x, screen_y), axis=1)

    image = Image.new("RGB", (canvas_width, canvas_height), BACKGROUND_RGB)
    draw = ImageDraw.Draw(image)

    _draw_plate(draw, to_screen, right, up, plate_min_x, plate_max_x, plate_min_y, plate_max_y, step)

    edge_a = faces[:, 1, :] - faces[:, 0, :]
    edge_b = faces[:, 2, :] - faces[:, 0, :]
    normals = np.cross(edge_a, edge_b)
    normals /= np.linalg.norm(normals, axis=1, keepdims=True)
    facing = normals @ toward_camera
    # Two-sided shading keeps open shells readable without altering geometry.
    oriented = normals * np.where(facing < 0.0, -1.0, 1.0)[:, np.newaxis]
    lambert = np.clip(oriented @ light, 0.0, 1.0)
    intensity = AMBIENT + DIFFUSE * lambert

    depth = faces.mean(axis=1) @ toward_camera
    order = np.argsort(depth, kind="stable")

    screen = to_screen(projected_faces.reshape(-1, 2)).reshape(-1, 3, 2)
    doubled_screen_area = np.abs(
        (screen[:, 1, 0] - screen[:, 0, 0]) * (screen[:, 2, 1] - screen[:, 0, 1])
        - (screen[:, 2, 0] - screen[:, 0, 0]) * (screen[:, 1, 1] - screen[:, 0, 1])
    )
    outline_threshold = OUTLINE_MIN_AREA_PX * 2.0 * SUPERSAMPLE * SUPERSAMPLE

    for index in order:
        fill = _shade(MODEL_BASE_RGB, float(intensity[index]))
        polygon = [
            (float(screen[index, 0, 0]), float(screen[index, 0, 1])),
            (float(screen[index, 1, 0]), float(screen[index, 1, 1])),
            (float(screen[index, 2, 0]), float(screen[index, 2, 1])),
        ]
        if doubled_screen_area[index] >= outline_threshold:
            draw.polygon(polygon, fill=fill, outline=_darken(fill, EDGE_DARKENING))
        else:
            draw.polygon(polygon, fill=fill)

    final = image.resize((width, height), Image.LANCZOS)
    _draw_caption(final, caption, width, height)
    return final


def _draw_plate(draw, to_screen, right, up, min_x, max_x, min_y, max_y, step) -> None:
    """Draw the subtle build-plate grid on the Z=0 plane."""
    line_width = SUPERSAMPLE

    def segment(start, end, color, width_px):
        points = to_screen(_project(np.array([start, end], dtype=np.float64), right, up))
        draw.line(
            [(float(points[0, 0]), float(points[0, 1])), (float(points[1, 0]), float(points[1, 1]))],
            fill=color,
            width=width_px,
        )

    x_values = np.arange(min_x, max_x + step / 2.0, step)
    y_values = np.arange(min_y, max_y + step / 2.0, step)
    for x in x_values[1:-1]:
        segment([float(x), min_y, 0.0], [float(x), max_y, 0.0], PLATE_LINE_RGB, line_width)
    for y in y_values[1:-1]:
        segment([min_x, float(y), 0.0], [max_x, float(y), 0.0], PLATE_LINE_RGB, line_width)
    border = [
        ([min_x, min_y, 0.0], [max_x, min_y, 0.0]),
        ([max_x, min_y, 0.0], [max_x, max_y, 0.0]),
        ([max_x, max_y, 0.0], [min_x, max_y, 0.0]),
        ([min_x, max_y, 0.0], [min_x, min_y, 0.0]),
    ]
    for start, end in border:
        segment(start, end, PLATE_BORDER_RGB, line_width)


def _draw_caption(image: Image.Image, caption: str, width: int, height: int) -> None:
    """Draw the dimension caption at the bottom-left of the final image."""
    if not caption:
        return
    draw = ImageDraw.Draw(image)
    font_size = max(12, int(round(min(width, height) * 0.03)))
    font = _load_caption_font(font_size)
    padding = max(8, int(round(min(width, height) * 0.02)))
    left, top, right, bottom = draw.textbbox((0, 0), caption, font=font)
    text_height = bottom - top
    position = (padding - left, height - padding - text_height - top)
    draw.text(position, caption, fill=CAPTION_RGB, font=font)


def encode_png(image: Image.Image) -> bytes:
    """Encode the image as PNG without metadata that could vary between runs."""
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=False, compress_level=6)
    return buffer.getvalue()


def write_exclusive(output_path: str, payload: bytes) -> None:
    """Create the output file exclusively; never overwrite an existing path."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    descriptor = os.open(output_path, flags, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
    except Exception:
        try:
            os.unlink(output_path)
        except OSError:
            pass
        raise


def render_file(input_path: str, output_path: str, width: int, height: int,
                caption: str, max_faces: int = DEFAULT_MAX_FACES) -> None:
    """Render ``input_path`` and write the PNG to ``output_path``."""
    triangles = load_stl_triangles(input_path)
    image = render_preview(triangles, width, height, caption, max_faces)
    write_exclusive(output_path, encode_png(image))


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render a deterministic STL preview PNG.")
    parser.add_argument("input_path")
    parser.add_argument("output_path")
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    parser.add_argument("--height", type=int, default=DEFAULT_HEIGHT)
    parser.add_argument("--caption", default="")
    parser.add_argument("--max-faces", type=int, default=DEFAULT_MAX_FACES)
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    try:
        arguments = _parse_args(argv)
        render_file(
            arguments.input_path,
            arguments.output_path,
            arguments.width,
            arguments.height,
            arguments.caption,
            arguments.max_faces,
        )
    except Exception as exc:  # The API maps the non-zero exit; the message stays bounded.
        print(f"[PYTHON RENDER] ERROR: {type(exc).__name__}: {exc}")
        return 1
    print("[PYTHON RENDER] Success! Saved preview image.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
