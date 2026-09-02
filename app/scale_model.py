"""Scale, rotate, and optionally place STL models for slicing preprocessing.

Usage:
    python3 scale_model.py input.stl output.stl sx sy sz rx ry rz
    python3 scale_model.py input.stl output.stl sx sy sz rx ry rz \
        --place-min-x X --place-min-y Y

Where:
- sx/sy/sz are scaling factors (positive floats)
- rx/ry/rz are rotation angles in degrees
- ``--place-min-x``/``--place-min-y`` (optional, always both, in this exact
  order) translate the model AFTER scale, rotation, and grounding so its
  bounding-box minimum X/Y corner equals the given millimetre values. Z stays
  grounded at 0. Bambu Studio is invoked with ``--arrange 0`` and keeps the STL
  coordinates exactly, so the API owns placement through these flags. Without
  the flags the model is centred on the origin as before.
"""

import math
import shutil
import sys

import numpy as np
import trimesh


PLACE_MIN_X_FLAG = "--place-min-x"
PLACE_MIN_Y_FLAG = "--place-min-y"
BASE_ARGUMENT_COUNT = 9
PLACED_ARGUMENT_COUNT = BASE_ARGUMENT_COUNT + 4


def _load_as_mesh(input_path: str) -> trimesh.Trimesh:
    """Load a mesh or merge scene geometries into one mesh."""
    mesh = trimesh.load(input_path)
    if isinstance(mesh, trimesh.Scene):
        if not mesh.geometry:
            raise ValueError("The input model does not contain any geometry.")
        mesh = trimesh.util.concatenate(mesh.dump())
    return mesh


def _to_transform_matrix(scale_x: float, scale_y: float, scale_z: float) -> np.ndarray:
    """Build 4x4 non-uniform scale transform matrix.

    Args:
        scale_x: Scale factor on X axis.
        scale_y: Scale factor on Y axis.
        scale_z: Scale factor on Z axis.

    Returns:
        Homogeneous 4x4 scaling matrix.
    """
    matrix = np.eye(4)
    matrix[0, 0] = scale_x
    matrix[1, 1] = scale_y
    matrix[2, 2] = scale_z
    return matrix


def _apply_rotations(mesh: trimesh.Trimesh, rot_x_deg: float, rot_y_deg: float, rot_z_deg: float) -> None:
    """Apply intrinsic X->Y->Z rotations around the model origin."""
    rotations = [
        (rot_x_deg, [1, 0, 0]),
        (rot_y_deg, [0, 1, 0]),
        (rot_z_deg, [0, 0, 1]),
    ]

    for angle_deg, axis in rotations:
        if abs(angle_deg) < 1e-12:
            continue
        angle_rad = math.radians(angle_deg)
        transform = trimesh.transformations.rotation_matrix(angle_rad, axis)
        mesh.apply_transform(transform)


def _place_on_build_plate(mesh: trimesh.Trimesh) -> None:
    """Center model in XY and place lowest point at Z=0."""
    mesh.apply_translation(-mesh.centroid)
    min_z = float(mesh.bounds[0][2])
    mesh.apply_translation([0, 0, -min_z])


def _place_at_minimum_corner(mesh: trimesh.Trimesh, min_x: float, min_y: float) -> None:
    """Translate so the bounding-box minimum X/Y corner equals the given values.

    Z is untouched: the mesh is already grounded, and only X/Y placement is
    the API's responsibility.
    """
    current_min_x = float(mesh.bounds[0][0])
    current_min_y = float(mesh.bounds[0][1])
    mesh.apply_translation([min_x - current_min_x, min_y - current_min_y, 0.0])


def transform_model(
    input_path: str,
    output_path: str,
    scale_x: float,
    scale_y: float,
    scale_z: float,
    rot_x_deg: float,
    rot_y_deg: float,
    rot_z_deg: float,
    placement: tuple[float, float] | None = None,
) -> None:
    """Scale, rotate, ground, optionally place the model, then export as STL."""
    if scale_x <= 0 or scale_y <= 0 or scale_z <= 0:
        raise ValueError("Scale factors must be positive values.")

    mesh = _load_as_mesh(input_path)

    mesh.apply_translation(-mesh.centroid)
    mesh.apply_transform(_to_transform_matrix(scale_x, scale_y, scale_z))
    _apply_rotations(mesh, rot_x_deg, rot_y_deg, rot_z_deg)
    _place_on_build_plate(mesh)
    if placement is not None:
        _place_at_minimum_corner(mesh, placement[0], placement[1])

    mesh.export(output_path)


def _parse_placement(argv: list[str]) -> tuple[float, float] | None:
    """Parse the optional, strictly ordered placement flag pair.

    Raises:
        ValueError: If the flags are partial, misordered, or non-finite.
    """
    if len(argv) == BASE_ARGUMENT_COUNT:
        return None
    if len(argv) != PLACED_ARGUMENT_COUNT:
        raise ValueError(
            "Usage: python3 scale_model.py input.stl output.stl sx sy sz rx ry rz "
            f"[{PLACE_MIN_X_FLAG} X {PLACE_MIN_Y_FLAG} Y]"
        )
    if argv[9] != PLACE_MIN_X_FLAG or argv[11] != PLACE_MIN_Y_FLAG:
        raise ValueError(
            f"Placement requires exactly {PLACE_MIN_X_FLAG} X {PLACE_MIN_Y_FLAG} Y in that order."
        )
    min_x = float(argv[10])
    min_y = float(argv[12])
    if not (math.isfinite(min_x) and math.isfinite(min_y)):
        raise ValueError("Placement coordinates must be finite.")
    return min_x, min_y


def _parse_args(
    argv: list[str],
) -> tuple[str, str, float, float, float, float, float, float, tuple[float, float] | None]:
    """Parse CLI arguments for transformation operation.

    Args:
        argv: Raw command line argument list.

    Returns:
        Tuple of input path, output path, scale factors, rotation angles, and
        the optional placement pair.

    Raises:
        ValueError: If argument count or flag shape is invalid.
    """
    if len(argv) not in (BASE_ARGUMENT_COUNT, PLACED_ARGUMENT_COUNT):
        raise ValueError(
            "Usage: python3 scale_model.py input.stl output.stl sx sy sz rx ry rz "
            f"[{PLACE_MIN_X_FLAG} X {PLACE_MIN_Y_FLAG} Y]"
        )

    input_path = argv[1]
    output_path = argv[2]

    sx = float(argv[3])
    sy = float(argv[4])
    sz = float(argv[5])
    rx = float(argv[6])
    ry = float(argv[7])
    rz = float(argv[8])
    placement = _parse_placement(argv)

    return input_path, output_path, sx, sy, sz, rx, ry, rz, placement


if __name__ == "__main__":
    try:
        args = _parse_args(sys.argv)
        transform_model(*args)
        print(f"[PYTHON SCALE] Success! Saved transformed model: {args[1]}")
    except Exception as exc:
        print(f"[PYTHON SCALE] ERROR: {exc}")
        if len(sys.argv) >= 3:
            try:
                shutil.copy2(sys.argv[1], sys.argv[2])
            except Exception:
                pass
        sys.exit(1)
