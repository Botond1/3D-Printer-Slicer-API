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
import hashlib
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


def _row_groups(columns):
    """Stable lexicographic order of rows given as columns (primary first) and
    the mask of rows that open a new group of equal rows in that order."""
    order = np.lexsort(tuple(reversed(columns)))
    change = np.zeros(len(order), dtype=bool)
    if len(order):
        change[0] = True
    for column in columns:
        ordered = column[order]
        change[1:] |= ordered[1:] != ordered[:-1]
    return order, change


def _analysis_copy(loaded):
    """Index the triangle soup exactly, then drop what carries no surface.

    STL repeats triangle vertices, so exact coordinate indexing is needed for
    any topology question. A zero-area triangle (repeated or collinear
    corners) and a second copy of the same triangle add no surface; the native
    slicer ignores both, so the description ignores them too. Nothing is
    written back.

    Since 3.10.0 the indexing is one stable lexicographic sort per question
    (the labels are those of `numpy.unique(axis=0)`: the sorted unique rows)
    instead of a sort of structured rows, which was the slowest single step.
    Returns the unique vertices, the kept faces, the kept faces' cross
    products, both dropped counts and the topology digest.
    """
    soup = np.asarray(loaded.vertices, dtype=np.float64)
    order, change = _row_groups((soup[:, 0], soup[:, 1], soup[:, 2]))
    inverse = np.empty(len(soup), dtype=np.int64)
    inverse[order] = np.cumsum(change) - 1
    first_seen = order[change]
    vertices = soup[first_seen]
    faces = inverse[np.asarray(loaded.faces)]
    crosses = trimesh.triangles.cross(vertices[faces])
    areas = trimesh.triangles.area(crosses=crosses)
    usable = np.isfinite(areas) & (areas > 0)
    dropped_degenerate = int(np.count_nonzero(~usable))
    kept = np.flatnonzero(usable)
    if len(kept) == 0:
        raise ValueError("degenerate_faces")
    corners = np.sort(faces[kept], axis=1)
    face_order, face_change = _row_groups((corners[:, 0], corners[:, 1], corners[:, 2]))
    unique_kept = kept[np.sort(face_order[face_change])]
    dropped_duplicate = int(len(kept) - len(unique_kept))
    clean_faces = faces[unique_kept]
    # The digest names the indexed surface independently of where it stands:
    # every corner is called by the file position where its coordinates first
    # appear, so a rigid motion or scale that keeps distinct corners distinct
    # and the triangle order intact gives the same digest, and nothing else does.
    digest = hashlib.sha256()
    digest.update(np.asarray([len(faces), len(soup)], dtype='<i8').tobytes())
    digest.update(np.ascontiguousarray(unique_kept, dtype='<i8').tobytes())
    digest.update(np.ascontiguousarray(first_seen[clean_faces], dtype='<i8').tobytes())
    return vertices, clean_faces, crosses[unique_kept], dropped_degenerate, dropped_duplicate, digest.hexdigest()


def _directed_edges(faces):
    """The three directed edges of every face, face by face (trimesh's order)."""
    return faces[:, [0, 1, 1, 2, 2, 0]].reshape((-1, 2))


def _topology(clean_faces, vertex_count):
    """Edge-use counts, shells and their closedness in a fixed number of sorts.

    An undirected edge used by exactly two triangles joins them (trimesh's
    face adjacency); the shells are the connected components of that relation
    over every triangle. A shell is closed when each of its edges is used by
    exactly two of its own triangles. The surface is watertight when every
    edge is used exactly twice, and its winding is consistent when the two
    uses of every such edge run in opposite directions.
    """
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    face_count = len(clean_faces)
    edges = _directed_edges(clean_faces)
    low = np.minimum(edges[:, 0], edges[:, 1])
    high = np.maximum(edges[:, 0], edges[:, 1])
    key = low * np.int64(vertex_count) + high
    order = np.argsort(key, kind='stable')
    change = np.ones(len(order), dtype=bool)
    ordered_key = key[order]
    change[1:] = ordered_key[1:] != ordered_key[:-1]
    group_of_sorted = np.cumsum(change) - 1
    uses = np.bincount(group_of_sorted)
    starts = np.flatnonzero(change)
    paired = starts[uses == 2]
    first_use = order[paired]
    second_use = order[paired + 1]
    watertight = bool(len(paired) * 2 == len(edges))
    winding = bool(np.equal(edges[first_use, 1], edges[second_use, 0]).all())
    open_edges = 0 if watertight else int(np.count_nonzero(uses == 1))
    first_face = first_use // 3
    second_face = second_use // 3
    joined = coo_matrix((np.ones(len(first_face), dtype=np.int8), (first_face, second_face)), shape=(face_count, face_count))
    component_count, labels = connected_components(joined, directed=False)
    # A shell is open when one of its edges is not used exactly twice by its
    # own triangles. Edges used twice overall always join two triangles of one
    # shell; edges used once open their shell; only the edges used three times
    # or more need their uses counted shell by shell.
    open_shell = np.zeros(component_count, dtype=bool)
    edge_group = np.empty(len(edges), dtype=np.int64)
    edge_group[order] = group_of_sorted
    edge_label = labels[np.arange(len(edges)) // 3].astype(np.int64)
    edge_uses = uses[edge_group]
    open_shell[edge_label[edge_uses == 1]] = True
    crowded = np.flatnonzero(edge_uses > 2)
    if len(crowded):
        shell_key = edge_group[crowded] * np.int64(component_count) + edge_label[crowded]
        shell_order = np.argsort(shell_key, kind='stable')
        sorted_key = shell_key[shell_order]
        shell_change = np.ones(len(sorted_key), dtype=bool)
        shell_change[1:] = sorted_key[1:] != sorted_key[:-1]
        shell_uses = np.bincount(np.cumsum(shell_change) - 1)
        shell_of_group = edge_label[crowded][shell_order][shell_change]
        open_shell[shell_of_group[shell_uses != 2]] = True
    return {"watertight": watertight, "winding_consistent": winding, "open_edge_count": open_edges,
            "component_count": int(component_count),
            "closed_component_count": int(component_count - np.count_nonzero(open_shell)),
            "labels": labels, "open_shell": open_shell}


def _signed_volume(vertices, faces, crosses=None):
    """The divergence integral trimesh's mass properties report as the volume,
    term for term (the first row of its integral, summed the same way)."""
    triangles = vertices[faces]
    if crosses is None:
        crosses = trimesh.triangles.cross(triangles)
    integral = np.zeros((1, len(faces)))
    integral[0] = crosses[:, 0] * (triangles[:, 0, 0] + triangles[:, 1, 0] + triangles[:, 2, 0])
    return float(integral.sum(axis=1)[0] / 6.0), integral[0]


def _winding_flips(vertices, clean_faces):
    """Which triangles trimesh's `fix_winding` reverses: its own breadth-first
    walk over its own face adjacency (the walk decides which side of an open
    shell is kept), with the per-pair comparison done once for all pairs."""
    import networkx as nx

    mesh = trimesh.Trimesh(vertices=vertices, faces=clean_faces, process=False)
    adjacency = mesh.face_adjacency
    shared = mesh.face_adjacency_edges
    forward = []
    for column in (0, 1):
        face = clean_faces[adjacency[:, column]]
        runs = np.zeros(len(adjacency), dtype=bool)
        for corner in range(3):
            runs |= (face[:, corner] == shared[:, 0]) & (face[:, (corner + 1) % 3] == shared[:, 1])
        forward.append(runs)
    same_direction = forward[0] == forward[1]
    face_count = len(clean_faces)
    pair_key = adjacency[:, 0].astype(np.int64) * face_count + adjacency[:, 1]
    needs_flip = dict(zip(pair_key.tolist(), same_direction.tolist()))
    # Plain integers hash and compare as numpy's do, so the graph's node and
    # neighbour order (and with them networkx's own choice of each walk's first
    # triangle) are those of `nx.from_edgelist(mesh.face_adjacency)`.
    graph = nx.from_edgelist(adjacency.tolist())
    neighbours = graph._adj
    flipped = bytearray(face_count)
    for component in nx.connected_components(graph):
        start = next(iter(graph.subgraph(component).nodes()))
        # `nx.bfs_edges` order: parents in the order they were reached, each
        # parent's neighbours in the graph's insertion order.
        seen = {start}
        reached = [start]
        position = 0
        while position < len(reached):
            parent = reached[position]
            position += 1
            parent_flipped = bool(flipped[parent])
            for child in neighbours[parent]:
                if child in seen:
                    continue
                seen.add(child)
                reached.append(child)
                pair = parent * face_count + child if parent < child else child * face_count + parent
                if needs_flip[pair] != parent_flipped:
                    flipped[child] = 1
    return np.frombuffer(bytes(flipped), dtype=np.uint8).astype(bool)


def _inversion_flips(vertices, faces, labels, open_shell):
    """Which shells trimesh's `fix_inversion(multibody=True)` turns inside out:
    closed, consistently wound shells of four or more triangles whose own
    volume is negative."""
    shell_count = len(open_shell)
    candidate = ~open_shell & (np.bincount(labels, minlength=shell_count) >= 4)
    if not candidate.any():
        return np.zeros(len(faces), dtype=bool)
    edges = _directed_edges(faces)
    low = np.minimum(edges[:, 0], edges[:, 1])
    high = np.maximum(edges[:, 0], edges[:, 1])
    edge_label = labels[np.arange(len(edges)) // 3].astype(np.int64)
    # Inside a closed shell every edge is used exactly twice by the shell's
    # own triangles, so its sorted uses pair up two by two; the uses of open
    # shells are left out before pairing.
    own = np.flatnonzero(candidate[edge_label])
    order = own[np.lexsort((high[own], low[own], edge_label[own]))]
    first = order[0::2]
    second = order[1::2]
    unwound = np.zeros(shell_count, dtype=bool)
    unwound[edge_label[first[edges[first, 1] != edges[second, 0]]]] = True
    candidate &= ~unwound
    _, terms = _signed_volume(vertices, faces)
    volume = np.bincount(labels, weights=terms, minlength=shell_count)
    scale = np.bincount(labels, weights=np.abs(terms), minlength=shell_count)
    negative = candidate & (volume < 0.0)
    # A shell whose integral is lost in its own rounding (a flat sliver) has
    # no sign of its own: it is whatever trimesh's sum over trimesh's own
    # triangle order reads, so exactly that sum is taken for those shells.
    unsettled = candidate & (np.abs(volume) <= 1e-6 * scale)
    if unsettled.any():
        mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
        triangles = mesh.triangles
        triangle_crosses = mesh.triangles_cross
        for index in trimesh.graph.connected_components(mesh.face_adjacency):
            shell = labels[index[0]]
            if not unsettled[shell]:
                continue
            own_volume = trimesh.triangles.mass_properties(
                triangles[index], crosses=triangle_crosses[index], skip_inertia=True).volume
            negative[shell] = bool(own_volume < 0.0)
    return negative[labels]


def _volume(vertices, clean_faces, crosses, topology):
    """The enclosed volume, exact for a closed consistent solid.

    For anything else the divergence integral of a winding-fixed copy is the
    best available estimate (a few open edges hardly move it; the reference
    Benchy's 29 open edges still give its 15.5 cm3). It is reported with its
    own source label so no reader mistakes it for a validated measurement.
    The winding fix is trimesh's `fix_normals(multibody=True)` decision for
    decision; only the work per decision is done for all triangles at once.
    """
    if topology["watertight"] and topology["winding_consistent"]:
        volume, _ = _signed_volume(vertices, clean_faces, crosses)
        return abs(volume), "validated_triangle_mesh"
    fixed = clean_faces
    try:
        if not topology["winding_consistent"]:
            flips = _winding_flips(vertices, clean_faces)
            if flips.any():
                fixed = clean_faces.copy()
                fixed[flips] = fixed[flips][:, ::-1]
        turned = _inversion_flips(vertices, fixed, topology["labels"], topology["open_shell"])
        if turned.any():
            fixed = fixed.copy()
            fixed[turned] = np.fliplr(fixed[turned])
    except Exception:  # noqa: BLE001 - the estimate falls back to the integral of what was fixed so far
        pass
    volume, _ = _signed_volume(vertices, fixed)
    return abs(volume), "signed_volume_estimate"


def _verified_prior(prior, digest):
    """The earlier inspection of this request, when it describes this very
    indexed surface (same digest) and that surface is a closed, consistently
    wound solid. Its shell and edge facts then hold here by construction."""
    if not isinstance(prior, dict) or prior.get("schema") != INSPECTION_SCHEMA or prior.get("valid") is not True:
        return None
    if (prior.get("topology_sha256") != digest or prior.get("watertight") is not True
            or prior.get("winding_consistent") is not True or prior.get("open_edge_count") != 0):
        return None
    counts = [prior.get("component_count"), prior.get("closed_component_count")]
    if any(type(value) is not int or value < 1 for value in counts):
        return None
    return {"watertight": True, "winding_consistent": True, "open_edge_count": 0,
            "component_count": counts[0], "closed_component_count": counts[1]}


def inspect_mesh(file_path, prior=None):
    """Describe the mesh in `file_path`.

    `prior` is this request's inspection of the same surface before a rigid
    motion or scale. When the file's own topology digest equals the prior's
    and the prior found a closed consistent solid, the shell and edge facts
    are taken from it (`topology_evidence: verified_digest`); the indexing,
    both dropped counts, the dimensions and the volume are always measured on
    this file. Any other case is inspected in full.
    """
    loaded = _load_single_mesh(file_path)
    vertices, clean_faces, crosses, dropped_degenerate, dropped_duplicate, digest = _analysis_copy(loaded)
    referenced = np.zeros(len(vertices), dtype=bool)
    referenced[clean_faces] = True
    in_mesh = vertices[referenced]
    dimensions = [float(v) for v in (in_mesh.max(axis=0) - in_mesh.min(axis=0))]
    if any(not np.isfinite(v) or v <= 0 for v in dimensions):
        raise ValueError("zero_extent")
    topology = _verified_prior(prior, digest)
    evidence = "verified_digest"
    if topology is None:
        topology = _topology(clean_faces, len(vertices))
        evidence = "measured"
    watertight = topology["watertight"]
    winding_consistent = bool(watertight and topology["winding_consistent"])
    volume, volume_source = _volume(vertices, clean_faces, crosses, topology)
    if not np.isfinite(volume) or volume <= 0:
        raise ValueError("zero_volume")
    return {"schema": INSPECTION_SCHEMA, "valid": True, "watertight": watertight,
            "winding_consistent": winding_consistent, "component_count": topology["component_count"],
            "closed_component_count": topology["closed_component_count"],
            "open_edge_count": topology["open_edge_count"],
            "dropped_degenerate_faces": dropped_degenerate, "dropped_duplicate_faces": dropped_duplicate,
            "volume_mm3": volume, "volume_source": volume_source,
            "dimensions_mm": dict(zip("xyz", dimensions)), "triangle_count": int(len(clean_faces)),
            "topology_sha256": digest, "topology_evidence": evidence}


def _main(argv):
    if argv[1] == '--3mf-scope':
        return inspect_3mf_scope(argv[2])
    prior = None
    if len(argv) > 3 and argv[2] == '--prior':
        try:
            prior = json.loads(argv[3])
        except ValueError:
            prior = None
    return inspect_mesh(argv[1], prior)


if __name__ == "__main__":
    try:
        result = _main(sys.argv)
        print(json.dumps(result, allow_nan=False, separators=(",", ":")))
    except (MemoryError, OSError):
        raise
    except Exception as error:
        reason = str(error) if isinstance(error, ValueError) else "unloadable_mesh"
        if reason not in REASONS:
            reason = "unloadable_mesh"
        print("INVALID_SOURCE_GEOMETRY|" + reason, file=sys.stderr)
        sys.exit(2)
