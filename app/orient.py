"""Orientation optimizer for STL models.

Finds a stable orientation that minimizes print height and exports an
orientation-adjusted STL model.
"""

import json
import os
import shutil
import sys
import trimesh


ORIENTATION_METADATA_SCHEMA = 1
IDENTITY_ROTATION_MATRIX = [
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0],
]
# A reference pose is the submitted triangle list rigidly moved by the printing
# engine's own orienter. Binary STL stores float32, so a faithful rigid motion of
# a build-plate-sized model fits its own triangles to well under a hundredth of
# a millimetre; anything looser is not the same mesh and is refused.
REFERENCE_MAX_RMS_MM = 0.01
REFERENCE_MAX_DISTANCE_MM = 0.05
REFERENCE_IDENTITY_SNAP = 1e-6
REFERENCE_MISMATCH_MARKER = "ORIENTATION_REFERENCE_MISMATCH"
REFERENCE_MISMATCH_EXIT_CODE = 3


class ReferencePoseError(ValueError):
    """The reference pose is not a rigid motion of the submitted triangles."""


def _rotation_from_reference(input_path, reference_path):
    """Recover the proper rotation carrying the submitted mesh into the reference pose.

    Both files are read without processing so their triangles keep file order.
    The reference is expected to be the same triangle list in a rigidly moved
    pose, so a Kabsch fit on the triangle centroids (invariant to the vertex
    order inside a triangle) recovers the rotation exactly. A different
    triangle count or a residual above the float32 envelope is refused, never
    repaired: the caller decides which honest fallback follows.
    """
    import numpy as np

    source = trimesh.load_mesh(input_path, process=False)
    reference = trimesh.load_mesh(reference_path, process=False)
    if len(source.faces) == 0 or len(source.faces) != len(reference.faces):
        raise ReferencePoseError("reference triangle count differs from the submitted mesh")

    source_centres = np.asarray(source.triangles_center, dtype=float)
    reference_centres = np.asarray(reference.triangles_center, dtype=float)
    source_mean = source_centres.mean(axis=0)
    reference_mean = reference_centres.mean(axis=0)
    covariance = (source_centres - source_mean).T @ (reference_centres - reference_mean)
    left, _singular_values, right_transposed = np.linalg.svd(covariance)
    handedness = float(np.sign(np.linalg.det(right_transposed.T @ left.T)))
    if handedness == 0.0:
        raise ReferencePoseError("reference pose is degenerate")
    rotation = right_transposed.T @ np.diag([1.0, 1.0, handedness]) @ left.T
    translation = reference_mean - rotation @ source_mean
    distances = np.linalg.norm((source_centres @ rotation.T) + translation - reference_centres, axis=1)
    rms = float(np.sqrt(np.mean(distances ** 2)))
    if rms > REFERENCE_MAX_RMS_MM or float(distances.max()) > REFERENCE_MAX_DISTANCE_MM:
        raise ReferencePoseError("reference pose is not a rigid motion of the submitted mesh")

    matrix = [[float(rotation[row][column]) for column in range(3)] for row in range(3)]
    if _is_identity_rotation(matrix, REFERENCE_IDENTITY_SNAP):
        return [list(row) for row in IDENTITY_ROTATION_MATRIX]
    return matrix


def _apply_reference_pose(mesh, input_path, reference_path, output_path, orientation_mode, metadata_path):
    """Rotate the mesh into the engine's reference pose and export it with its metadata."""
    rotation = _rotation_from_reference(input_path, reference_path)
    transform = [
        [rotation[0][0], rotation[0][1], rotation[0][2], 0.0],
        [rotation[1][0], rotation[1][1], rotation[1][2], 0.0],
        [rotation[2][0], rotation[2][1], rotation[2][2], 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]
    if not _is_identity_rotation(rotation):
        mesh.apply_transform(transform)
    _place_on_build_plate(mesh)
    mesh.export(output_path)
    _write_orientation_metadata(
        metadata_path,
        orientation_mode,
        'unchanged' if _is_identity_rotation(rotation) else 'applied',
        rotation,
    )
    print(f"[PYTHON ORIENT] Applied the engine reference pose: {output_path}")


def _pose_score(mesh, technology, stability_probability=0.0):
    """Compute orientation score; lower is better."""
    z_height = float(mesh.extents[2])
    xy_area = float(mesh.extents[0] * mesh.extents[1])
    footprint_scale = max(xy_area, 1.0) ** 0.5

    tech = technology.upper()
    if tech == 'SLA':
        # SLA: keep height low, but avoid very large peel area.
        score = z_height + (0.15 * footprint_scale)
    else:
        # FDM/default: keep height low and increase footprint for support/stability.
        score = z_height - (0.35 * footprint_scale)

    score -= float(stability_probability) * 2.0
    return score, z_height, xy_area


def _place_on_build_plate(mesh):
    """Center XY and place the model on Z=0."""
    mesh.apply_translation(-mesh.centroid)
    min_z = mesh.bounds[0][2]
    mesh.apply_translation([0, 0, -min_z])


def _rotation_matrix(transform):
    """Return the proper 3x3 rotation component of a homogeneous transform."""
    return [
        [float(transform[row][column]) for column in range(3)]
        for row in range(3)
    ]


def _is_identity_rotation(matrix, tolerance=1e-7):
    """Return whether a rotation matrix is effectively the identity."""
    return all(
        abs(matrix[row][column] - IDENTITY_ROTATION_MATRIX[row][column]) <= tolerance
        for row in range(3)
        for column in range(3)
    )


def _write_orientation_metadata(metadata_path, mode, outcome, rotation_matrix):
    """Create bounded machine-readable orientation metadata beside the output STL."""
    if metadata_path is None:
        return
    payload = {
        "orientation_metadata_schema": ORIENTATION_METADATA_SCHEMA,
        "orientation_mode": mode,
        "orientation_outcome": outcome,
        "rotation_matrix": rotation_matrix,
    }
    encoded = json.dumps(payload, separators=(",", ":"), allow_nan=False)
    serialized = encoded + "\n"
    if len(serialized.encode("utf-8")) > 4096:
        raise ValueError("Orientation metadata exceeds the allowed size.")
    descriptor = os.open(metadata_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            descriptor = None
            handle.write(serialized)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        if descriptor is not None:
            os.close(descriptor)
        try:
            os.remove(metadata_path)
        except FileNotFoundError:
            pass
        raise


def optimize_orientation(
    input_path,
    output_path,
    technology='FDM',
    orientation_mode='auto',
    metadata_path=None,
    reference_path=None,
):
    """Optimize model orientation for printing.

    Args:
        input_path: Path to source STL file.
        output_path: Destination STL output path.
        technology: Printing technology label (FDM or SLA).
        orientation_mode: Automatic stable-pose selection or submitted-pose preservation.
        metadata_path: Optional exclusive-create JSON metadata destination.
        reference_path: Optional STL of the same triangles in the printing
            engine's own chosen pose; in `auto` mode its rotation is applied
            instead of the stable-pose heuristic.

    Returns:
        None. Writes oriented STL output and optional metadata to disk.

    Raises:
        SystemExit: If optimization fails after fallback copy, or with
            REFERENCE_MISMATCH_EXIT_CODE (and no output) when the reference
            pose is not this mesh.
    """
    if orientation_mode not in {'auto', 'preserve'}:
        raise ValueError("orientation_mode must be auto or preserve")

    print(f"[PYTHON ORIENT] Analyzing orientation for {technology}: {input_path}")

    try:
        # 1. Load the mesh
        mesh = trimesh.load(input_path)

        if isinstance(mesh, trimesh.Scene):
            print("[PYTHON ORIENT] Merging scene into single mesh...")
            mesh = trimesh.util.concatenate(mesh.dump())

        # 2. Original dimensions
        original_height = mesh.extents[2]
        print(f"[PYTHON ORIENT] Original Z-Height: {original_height:.2f}mm")

        if orientation_mode == 'preserve':
            _place_on_build_plate(mesh)
            mesh.export(output_path)
            _write_orientation_metadata(
                metadata_path,
                orientation_mode,
                'preserved',
                IDENTITY_ROTATION_MATRIX,
            )
            print(f"[PYTHON ORIENT] Preserved submitted orientation: {output_path}")
            return

        if reference_path is not None:
            _apply_reference_pose(mesh, input_path, reference_path, output_path, orientation_mode, metadata_path)
            return

        # 3. Compute stable poses
        pose_computation_failed = False
        try:
            poses, probabilities = mesh.compute_stable_poses(n_samples=12, threshold=0.01)
        except Exception as e:
            print(f"[PYTHON ORIENT] Warning: Could not compute stable poses ({e}). Keeping original.")
            poses = []
            probabilities = []
            pose_computation_failed = True

        best_pose = None
        min_score = float('inf')

        if len(poses) == 0:
            print("[PYTHON ORIENT] No stable poses found (maybe a sphere?). keeping original.")
            _place_on_build_plate(mesh)
            mesh.export(output_path)
            _write_orientation_metadata(
                metadata_path,
                orientation_mode,
                'fallback_unmodified' if pose_computation_failed else 'unchanged',
                IDENTITY_ROTATION_MATRIX,
            )
            return

        print(f"[PYTHON ORIENT] Found {len(poses)} stable orientations. Evaluating...")

        # 4. Scoring each pose
        for i, tf in enumerate(poses):
            temp_mesh = mesh.copy()
            temp_mesh.apply_transform(tf)

            probability = probabilities[i] if i < len(probabilities) else 0.0
            score, z_height, xy_area = _pose_score(temp_mesh, technology, probability)

            print(f" - Pose {i}: Z={z_height:.2f}mm, Footprint={xy_area:.2f}mm^2, Stability={probability:.3f}")

            if score < min_score:
                min_score = score
                best_pose = tf

        # 5. Apply the best orientation
        applied_rotation = IDENTITY_ROTATION_MATRIX
        if best_pose is not None:
            print(f"[PYTHON ORIENT] Applying optimal orientation (score: {min_score:.2f})")
            applied_rotation = _rotation_matrix(best_pose)
            mesh.apply_transform(best_pose)
        
        _place_on_build_plate(mesh)
        
        # 6. Final export
        mesh.export(output_path)
        _write_orientation_metadata(
            metadata_path,
            orientation_mode,
            'unchanged' if _is_identity_rotation(applied_rotation) else 'applied',
            applied_rotation,
        )
        print(f"[PYTHON ORIENT] Success! Saved to {output_path}")

    except ReferencePoseError as e:
        # No output and no fallback copy: the caller chooses the next honest step.
        marker = f"{REFERENCE_MISMATCH_MARKER}|{e}"
        print(marker)
        print(marker, file=sys.stderr)
        sys.exit(REFERENCE_MISMATCH_EXIT_CODE)
    except Exception as e:
        print(f"[PYTHON ORIENT] ERROR: Could not optimize orientation from this input file. {str(e)}")
        shutil.copy2(input_path, output_path)
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 orient.py input.stl output.stl [FDM/SLA] [auto/preserve] [metadata.json] [reference.stl]")
        sys.exit(1)

    tech = "FDM"
    if len(sys.argv) > 3:
        tech = sys.argv[3]

    mode = "auto"
    if len(sys.argv) > 4:
        mode = sys.argv[4]

    metadata = None
    if len(sys.argv) > 5:
        metadata = sys.argv[5]

    reference = None
    if len(sys.argv) > 6:
        reference = sys.argv[6]

    optimize_orientation(sys.argv[1], sys.argv[2], tech, mode, metadata, reference)
