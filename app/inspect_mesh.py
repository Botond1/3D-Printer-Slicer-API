"""Read-only solid/scope admission; never export, repair or mutate source bytes."""
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
import numpy as np
import trimesh


def inspect_3mf_scope(filename):
    # Node has already enforced ZIP paths, counts and actual-byte limits.
    with zipfile.ZipFile(filename) as archive:
        models = [name for name in archive.namelist() if name.lower().endswith('.model')]
        if len(models) != 1 or models[0].lower() != '3d/3dmodel.model':
            raise ValueError('ambiguous_scope')
        content = archive.read(models[0])
        if b'<!doctype' in content.lower() or b'<!entity' in content.lower():
            raise ValueError('unloadable_mesh')
        root = ET.fromstring(content)
        local = lambda node: node.tag.rsplit('}', 1)[-1]
        objects = [node for node in root.iter() if local(node) == 'object']
        items = [node for node in root.iter() if local(node) == 'item']
        if len(objects) != 1 or len(items) != 1 or items[0].get('objectid') != objects[0].get('id'):
            raise ValueError('ambiguous_scope')
        if any(local(node) in {'components', 'component'} for node in root.iter()):
            raise ValueError('ambiguous_scope')
        for node in root.iter():
            if any(key.rsplit('}', 1)[-1] in {'path', 'href'} for key in node.attrib):
                raise ValueError('unloadable_mesh')
        return {'source_unit': root.get('unit', 'millimeter'), 'instance_count': 1, 'object_count': 1}


def inspect_mesh(file_path):
    loaded = trimesh.load(file_path, process=False)
    if isinstance(loaded, trimesh.Scene):
        if len(loaded.geometry) == 0:
            raise ValueError("empty_mesh")
        if len(loaded.graph.nodes_geometry) != 1 or len(loaded.geometry) != 1:
            raise ValueError("ambiguous_scope")
        loaded = loaded.to_mesh()
    if not isinstance(loaded, trimesh.Trimesh) or len(loaded.faces) == 0:
        raise ValueError("empty_mesh")
    if not np.isfinite(loaded.vertices).all():
        raise ValueError("nonfinite_vertices")
    # STL repeats triangle vertices. Exact coordinate indexing is used ONLY
    # for topology analysis; no vertex movement, face deletion or repair.
    vertices, inverse = np.unique(loaded.vertices, axis=0, return_inverse=True)
    mesh = trimesh.Trimesh(vertices=vertices, faces=inverse[loaded.faces], process=False)
    if not np.isfinite(mesh.area_faces).all() or np.any(mesh.area_faces <= 0):
        raise ValueError("degenerate_faces")
    if not mesh.is_watertight:
        raise ValueError("open_mesh")
    if not mesh.is_winding_consistent or not np.isfinite(mesh.volume) or mesh.volume <= 0:
        raise ValueError("invalid_solid_winding")
    count = len(trimesh.graph.connected_components(mesh.face_adjacency, nodes=np.arange(len(mesh.faces))))
    if count != 1:
        raise ValueError("ambiguous_scope")
    dimensions = [float(v) for v in mesh.extents]
    if any(not np.isfinite(v) or v <= 0 for v in dimensions):
        raise ValueError("zero_extent")
    return {"schema": "r3d-mesh-inspection-v1", "valid": True, "watertight": True,
            "winding_consistent": True, "component_count": count,
            "volume_mm3": float(mesh.volume), "volume_source": "validated_triangle_mesh",
            "dimensions_mm": dict(zip("xyz", dimensions)), "triangle_count": len(mesh.faces)}


if __name__ == "__main__":
    try:
        result = inspect_3mf_scope(sys.argv[2]) if sys.argv[1] == '--3mf-scope' else inspect_mesh(sys.argv[1])
        print(json.dumps(result, allow_nan=False, separators=(",", ":")))
    except (MemoryError, OSError):
        raise
    except Exception as error:
        reason = str(error) if isinstance(error, ValueError) else "unloadable_mesh"
        if reason not in {"ambiguous_scope", "empty_mesh", "nonfinite_vertices", "degenerate_faces",
                          "open_mesh", "invalid_solid_winding", "zero_extent"}:
            reason = "unloadable_mesh"
        print("INVALID_SOURCE_GEOMETRY|" + reason, file=sys.stderr)
        sys.exit(2)
