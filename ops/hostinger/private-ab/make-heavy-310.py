"""Synthetic heavy models for the 3.10.0 private A/B (no customer file)."""
import hashlib, json, sys
import numpy as np, trimesh

out = sys.argv[1]


def write(name, triangles):
    triangles = np.asarray(triangles, dtype=np.float32)
    record = np.zeros(len(triangles), dtype=[('normal', '<f4', 3), ('corners', '<f4', (3, 3)), ('attribute', '<u2')])
    record['corners'] = triangles
    data = b'\0' * 80 + np.uint32(len(triangles)).tobytes() + record.tobytes()
    open(f'{out}/{name}', 'wb').write(data)
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}, len(triangles)


manifest = {}
sphere = trimesh.creation.uv_sphere(radius=1.0, count=[368, 368])
sphere.apply_scale([30.0, 20.0, 12.0])
sphere.apply_transform(trimesh.transformations.rotation_matrix(0.5, [1, 0.3, 0]))
closed = np.asarray(sphere.triangles)
manifest['ellipsoid-540k.stl'], n1 = write('ellipsoid-540k.stl', closed)
hole = np.ones(len(closed), dtype=bool)
hole[np.argsort(closed[:, :, 2].mean(axis=1))[-60:]] = False   # 60 triangles off the top
manifest['ellipsoid-540k-open.stl'], n2 = write('ellipsoid-540k-open.stl', closed[hole])
# 900 pillars (subdivided boxes) standing on the plate; three of them lose a triangle.
box = trimesh.creation.box([3.0, 3.0, 8.0])
for _ in range(3):
    box = box.subdivide()
base = np.asarray(box.triangles)
pillars = []
for ix in range(30):
    for iy in range(30):
        pillars.append(base + np.array([ix * 5.0, iy * 5.0, 4.0]))
for index in (17, 404, 811):
    pillars[index] = pillars[index][:-1]
manifest['pillars-900-open.stl'], n3 = write('pillars-900-open.stl', np.concatenate(pillars))
print(json.dumps({'files': manifest, 'triangles': [n1, n2, n3]}))
