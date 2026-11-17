"""Read-only geometry admission and evidence; never export, repair or mutate source bytes.

Since 3.6.0 the admission is what a print shop's own slicer does with a
customer file: an ordinary real-world mesh (a few zero-area or duplicated
triangles, a handful of open edges, several separate shells in one file) is
admitted and DESCRIBED, and only geometry that cannot be printed at all is
refused (nothing loads, no finite vertices, every triangle degenerate, a zero
extent). The native slicer's own positive-toolpath checks remain the last
gate. The analysis copy below drops degenerate and duplicate triangles and
fixes its winding for the volume integral; the submitted file is untouched
and is what gets sliced.
"""
import importlib.util
import json
import os
import sys
import zipfile
import xml.etree.ElementTree as ET
import numpy as np
import trimesh

INSPECTION_SCHEMA = "r3d-mesh-inspection-v2"
REASONS = {"empty_mesh", "nonfinite_vertices", "degenerate_faces", "zero_extent", "zero_volume", "ambiguous_scope"}


def _mesh2stl():
    """The converter module beside this file: its 3MF walk is the one contract."""
    spec = importlib.util.spec_from_file_location('r3d_mesh2stl', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mesh2stl.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BAMBU_PLAIN_PART = 'normal_part'


def _refuse_slicer_modifiers(archive):
    """A slicer project whose parts are modifiers, negative volumes or support
    blockers/enforcers is not the printed geometry its meshes describe; the
    walk cannot tell those parts from printed ones, so the build is refused."""
    settings = next((name for name in archive.namelist()
                     if name.replace('\\', '/').lstrip('/').lower() == 'metadata/model_settings.config'), None)
    if settings is None:
        return
    content = archive.read(settings)
    if b'<!doctype' in content.lower() or b'<!entity' in content.lower():
        raise ValueError('unloadable_mesh')
    root = ET.fromstring(content)
    for node in root.iter():
        if node.tag.rsplit('}', 1)[-1] == 'part' and (node.get('subtype') or BAMBU_PLAIN_PART) != BAMBU_PLAIN_PART:
            raise ValueError('ambiguous_scope')


def inspect_3mf_scope(filename):
    """Describe the 3MF build the converter will flatten: how many build items
    it places and how many distinct mesh objects they reach, after the same
    walk (3MF core plus production-extension parts) `mesh2stl.py` performs.

    A build the walk cannot satisfy (a missing part or object, an entity
    declaration, unbounded nesting) is the converter's refusal too; a slicer
    project carrying modifier or negative parts is refused as ambiguous.
    """
    # Node has already enforced ZIP paths, counts and actual-byte limits.
    mesh2stl = _mesh2stl()
    with zipfile.ZipFile(filename) as archive:
        _refuse_slicer_modifiers(archive)
        try:
            _, scope = mesh2stl.flatten_three_mf(archive, with_geometry=False)
        except mesh2stl.InvalidSourceGeometry as error:
            reason = str(error)
            if 'entities' in reason or 'well-formed' in reason or 'malformed' in reason:
                raise ValueError('unloadable_mesh') from error
            if 'no printable triangles' in reason or 'no root model' in reason:
                raise ValueError('empty_mesh') from error
            raise ValueError('ambiguous_scope') from error
    return {'source_unit': scope['unit'], 'instance_count': scope['instance_count'], 'object_count': scope['object_count']}


def _load_single_mesh(file_path):
    loaded = trimesh.load(file_path, process=False)
    if isinstance(loaded, trimesh.Scene):
        if len(loaded.geometry) == 0:
            raise ValueError("empty_mesh")
        loaded = loaded.to_mesh()
    if not isinstance(loaded, trimesh.Trimesh) or len(loaded.faces) == 0:
        raise ValueError("empty_mesh")
    if not np.isfinite(loaded.vertices).all():
        raise ValueError("nonfinite_vertices")
    return loaded


def _analysis_copy(loaded):
    """Index the triangle soup exactly, then drop what carries no surface.

    STL repeats triangle vertices, so exact coordinate indexing is needed for
    any topology question. A zero-area triangle (repeated or collinear
    corners) and a second copy of the same triangle add no surface; the native
    slicer ignores both, so the description ignores them too. Nothing is
    written back.
    """
    vertices, inverse = np.unique(loaded.vertices, axis=0, return_inverse=True)
    faces = np.asarray(inverse).reshape(-1)[loaded.faces]
    indexed = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    areas = indexed.area_faces
    usable = np.isfinite(areas) & (areas > 0)
    dropped_degenerate = int(np.count_nonzero(~usable))
    kept = np.flatnonzero(usable)
    _, first = np.unique(np.sort(faces[kept], axis=1), axis=0, return_index=True)
    unique_kept = kept[np.sort(first)]
    dropped_duplicate = int(len(kept) - len(unique_kept))
    if len(unique_kept) == 0:
        raise ValueError("degenerate_faces")
    clean = trimesh.Trimesh(vertices=vertices, faces=faces[unique_kept], process=False)
    return clean, dropped_degenerate, dropped_duplicate


def _open_edge_count(mesh):
    if mesh.is_watertight:
        return 0
    edges = mesh.edges_sorted
    if len(edges) == 0:
        return 0
    _, counts = np.unique(edges, axis=0, return_counts=True)
    return int(np.count_nonzero(counts == 1))


def _volume(clean, watertight, winding_consistent):
    """The enclosed volume, exact for a closed consistent solid.

    For anything else the divergence integral of a winding-fixed copy is the
    best available estimate (a few open edges hardly move it; the reference
    Benchy's 29 open edges still give its 15.5 cm3). It is reported with its
    own source label so no reader mistakes it for a validated measurement.
    """
    if watertight and winding_consistent:
        volume = float(clean.volume)
        return abs(volume), "validated_triangle_mesh"
    fixed = clean.copy()
    try:
        trimesh.repair.fix_normals(fixed, multibody=True)
    except Exception:  # noqa: BLE001 - the estimate falls back to the raw integral
        pass
    return abs(float(fixed.volume)), "signed_volume_estimate"


def inspect_mesh(file_path):
    loaded = _load_single_mesh(file_path)
    clean, dropped_degenerate, dropped_duplicate = _analysis_copy(loaded)
    dimensions = [float(v) for v in clean.extents]
    if any(not np.isfinite(v) or v <= 0 for v in dimensions):
        raise ValueError("zero_extent")
    watertight = bool(clean.is_watertight)
    winding_consistent = bool(watertight and clean.is_winding_consistent)
    components = trimesh.graph.connected_components(clean.face_adjacency, nodes=np.arange(len(clean.faces)))
    closed = 0
    for component in components:
        shell = trimesh.Trimesh(vertices=clean.vertices, faces=clean.faces[component], process=False)
        if shell.is_watertight:
            closed += 1
    volume, volume_source = _volume(clean, watertight, winding_consistent)
    if not np.isfinite(volume) or volume <= 0:
        raise ValueError("zero_volume")
    return {"schema": INSPECTION_SCHEMA, "valid": True, "watertight": watertight,
            "winding_consistent": winding_consistent, "component_count": int(len(components)),
            "closed_component_count": int(closed), "open_edge_count": _open_edge_count(clean),
            "dropped_degenerate_faces": dropped_degenerate, "dropped_duplicate_faces": dropped_duplicate,
            "volume_mm3": volume, "volume_source": volume_source,
            "dimensions_mm": dict(zip("xyz", dimensions)), "triangle_count": int(len(clean.faces))}


if __name__ == "__main__":
    try:
        result = inspect_3mf_scope(sys.argv[2]) if sys.argv[1] == '--3mf-scope' else inspect_mesh(sys.argv[1])
        print(json.dumps(result, allow_nan=False, separators=(",", ":")))
    except (MemoryError, OSError):
        raise
    except Exception as error:
        reason = str(error) if isinstance(error, ValueError) else "unloadable_mesh"
        if reason not in REASONS:
            reason = "unloadable_mesh"
        print("INVALID_SOURCE_GEOMETRY|" + reason, file=sys.stderr)
        sys.exit(2)
