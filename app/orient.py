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
):
    """Optimize model orientation for printing.

    Args:
        input_path: Path to source STL file.
        output_path: Destination STL output path.
        technology: Printing technology label (FDM or SLA).
        orientation_mode: Automatic stable-pose selection or submitted-pose preservation.
        metadata_path: Optional exclusive-create JSON metadata destination.

    Returns:
        None. Writes oriented STL output and optional metadata to disk.

    Raises:
        SystemExit: If optimization fails after fallback copy.
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

    except Exception as e:
        print(f"[PYTHON ORIENT] ERROR: Could not optimize orientation from this input file. {str(e)}")
        shutil.copy2(input_path, output_path)
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 orient.py input.stl output.stl [FDM/SLA] [auto/preserve] [metadata.json]")
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

    optimize_orientation(sys.argv[1], sys.argv[2], tech, mode, metadata)
