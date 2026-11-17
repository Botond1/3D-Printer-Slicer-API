"""3.10.0: the linear-time inspection answers what the 3.9.0 inspection answered.

`reference/inspect_mesh_3_9_0.py` is the 3.9.0 helper byte for byte (the blob
at abe8997). Every mesh below is inspected by both and the shared fields must
be equal exactly, the volume and the dimensions to the last bit. The reuse of
an earlier inspection (`prior`) is held to the same answer.
"""
import importlib.util
import os
import pathlib
import struct
import subprocess
import sys
import tempfile
import unittest

try:
    import numpy as np
    import trimesh
    AVAILABLE = True
except ImportError:
    AVAILABLE = False
if not AVAILABLE and os.environ.get("R3D_REQUIRE_GEOMETRY_DEPS") == "1":
    raise ImportError("R3D_REQUIRE_GEOMETRY_DEPS=1: the pinned geometry stack is required here, not skipped")

ROOT = pathlib.Path(__file__).resolve().parents[3]
NEW_ONLY = {"topology_sha256", "topology_evidence"}


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _write_soup(path, triangles):
    """Binary STL of the given (n, 3, 3) triangles, in order, without processing."""
    triangles = np.asarray(triangles, dtype=np.float32)
    with open(path, "wb") as handle:
        handle.write(b"\0" * 80 + struct.pack("<I", len(triangles)))
        for triangle in triangles:
            handle.write(struct.pack("<12fH", 0.0, 0.0, 0.0, *triangle.reshape(-1).tolist(), 0))


def _triangles(mesh):
    return np.asarray(mesh.triangles, dtype=np.float64)


def _cases():
    rng = np.random.default_rng(20261116)
    box = trimesh.creation.box([20, 15, 10])
    sphere = trimesh.creation.icosphere(subdivisions=3, radius=9.0)
    torus = trimesh.creation.torus(12.0, 3.0)
    cases = {"box": _triangles(box), "sphere": _triangles(sphere), "torus": _triangles(torus)}
    cases["open_box"] = _triangles(box)[:-1]
    cases["open_sphere"] = _triangles(sphere)[5:]
    far = box.copy()
    far.apply_translation([60, 0, 0])
    cases["two_shells"] = np.concatenate([_triangles(box), _triangles(far)])
    cases["closed_and_open_shell"] = np.concatenate([_triangles(sphere), _triangles(far)[:-2]])
    inverted = _triangles(sphere)[:, ::-1, :]
    cases["inverted_closed_shell"] = inverted
    cases["inverted_beside_open"] = np.concatenate([inverted, _triangles(far)[:-1]])
    mixed = _triangles(sphere).copy()
    flip = rng.random(len(mixed)) < 0.3
    mixed[flip] = mixed[flip][:, ::-1, :]
    cases["closed_shell_mixed_winding"] = mixed
    mixed_open = mixed[7:]
    cases["open_shell_mixed_winding"] = mixed_open
    cases["two_mixed_shells"] = np.concatenate([mixed, _triangles(far)[:, ::-1, :][:-3]])
    degenerate = np.concatenate([_triangles(box), [[[0, 0, 0], [0, 0, 0], [1, 1, 1]]], [[[0, 0, 0], [1, 1, 1], [2, 2, 2]]]])
    cases["degenerate_and_collinear"] = degenerate
    cases["duplicate_triangles"] = np.concatenate([_triangles(box), _triangles(box)[:4], _triangles(box)[2:3][:, ::-1, :]])
    # Two boxes sharing one whole edge: that edge is used by four triangles.
    touching = box.copy()
    touching.apply_translation([20, 15, 0])
    cases["shells_sharing_an_edge"] = np.concatenate([_triangles(box), _triangles(touching)])
    # A fin on a closed box: one edge used by three triangles.
    fin = np.array([[[-10, -7.5, -5], [10, -7.5, -5], [0, -20, -12]]], dtype=np.float64)
    cases["fin_on_a_box"] = np.concatenate([_triangles(box), fin])
    cases["lone_triangles"] = rng.random((40, 3, 3)) * 30
    soup = _triangles(trimesh.creation.icosphere(subdivisions=2, radius=5.0)).copy()
    rng.shuffle(soup)
    cases["shuffled_sphere"] = soup
    moebius = []
    steps = 24
    for index in range(steps):
        a0, a1 = 2 * np.pi * index / steps, 2 * np.pi * (index + 1) / steps
        def point(angle, side):
            half = angle / 2
            radius = 10 + side * 2 * np.cos(half)
            return [radius * np.cos(angle), radius * np.sin(angle), side * 2 * np.sin(half)]
        p0, p1, p2, p3 = point(a0, -1), point(a0, 1), point(a1, -1), point(a1, 1)
        if index == steps - 1:
            p2, p3 = point(0, 1), point(0, -1)
        moebius += [[p0, p2, p1], [p1, p2, p3]]
    cases["moebius_band_beside_a_box"] = np.concatenate([np.array(moebius), _triangles(far)])
    # Closed, consistently wound shells without volume (flattened tetrahedra):
    # the sign of their integral is rounding, so it must be read as 3.9.0 read it.
    tetrahedron = np.array([[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]])
    slivers = []
    for _ in range(60):
        corners = rng.random((4, 3)) * 7.3
        corners[:, 2] = 0.0
        tilt = trimesh.transformations.rotation_matrix(rng.random() * 3, rng.random(3) + 0.1)[:3, :3]
        slivers.append((corners @ tilt.T + rng.random(3) * 90)[tetrahedron])
    cases["flat_closed_shells_beside_mixed_open"] = np.concatenate([mixed_open, np.concatenate(slivers)])
    return cases


@unittest.skipUnless(AVAILABLE, 'Pinned geometry dependencies unavailable')
class LinearInspectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.new = _load(ROOT / 'app/inspect_mesh.py', 'inspect_mesh_new')
        cls.old = _load(ROOT / 'tests/unit/python/reference/inspect_mesh_3_9_0.py', 'inspect_mesh_3_9_0')
        cls.directory = tempfile.TemporaryDirectory(prefix='r3d-inspect-linear-')
        cls.cases = _cases()

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def file(self, name, triangles):
        path = pathlib.Path(self.directory.name) / f'{name}.stl'
        _write_soup(path, triangles)
        return path

    def both(self, path):
        answers = []
        for module in (self.old, self.new):
            try:
                answers.append(module.inspect_mesh(path))
            except ValueError as error:
                answers.append({'refused': str(error)})
        return answers

    def test_every_case_matches_the_3_9_0_inspection_exactly(self):
        for name, triangles in self.cases.items():
            with self.subTest(case=name):
                old, new = self.both(self.file(name, triangles))
                self.assertEqual(old, {key: value for key, value in new.items() if key not in NEW_ONLY})

    def test_the_cases_cover_open_mixed_and_crowded_surfaces(self):
        seen = {name: self.new.inspect_mesh(self.file(name, triangles)) for name, triangles in self.cases.items()
                if name not in {'lone_triangles'}}
        self.assertTrue(seen['box']['watertight'] and seen['box']['winding_consistent'])
        self.assertEqual(seen['open_box']['volume_source'], 'signed_volume_estimate')
        self.assertFalse(seen['closed_shell_mixed_winding']['winding_consistent'])
        self.assertTrue(seen['closed_shell_mixed_winding']['watertight'])
        self.assertEqual(seen['two_shells']['closed_component_count'], 2)
        self.assertEqual((seen['closed_and_open_shell']['component_count'], seen['closed_and_open_shell']['closed_component_count']), (2, 1))
        self.assertEqual(seen['shells_sharing_an_edge']['closed_component_count'], 2)
        self.assertFalse(seen['shells_sharing_an_edge']['watertight'])
        self.assertGreater(seen['degenerate_and_collinear']['dropped_degenerate_faces'], 0)
        self.assertGreater(seen['duplicate_triangles']['dropped_duplicate_faces'], 0)

    def test_refusals_are_the_same(self):
        flat = np.array([[[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[1, 0, 0], [1, 1, 0], [0, 1, 0]]], dtype=np.float64)
        for name, triangles, reason in (('all_degenerate', np.zeros((3, 3, 3)), 'degenerate_faces'),
                                        ('flat', flat, 'zero_extent')):
            with self.subTest(case=name):
                old, new = self.both(self.file(name, triangles))
                self.assertEqual(old, new)
                self.assertEqual(new, {'refused': reason})

    def moved(self, triangles, scale=(1.0, 1.0, 1.0)):
        rotation = trimesh.transformations.rotation_matrix(0.7, [0.3, -0.5, 0.8])[:3, :3]
        return (np.asarray(triangles) * np.asarray(scale)) @ rotation.T + np.array([12.5, -3.25, 40.0])

    def test_a_moved_closed_solid_reuses_the_prior_topology_and_measures_the_rest(self):
        for name in ('box', 'sphere', 'two_shells', 'torus'):
            for scale in ((1.0, 1.0, 1.0), (0.5, 0.5, 0.5), (2.0, 0.75, 1.25)):
                with self.subTest(case=name, scale=scale):
                    prior = self.new.inspect_mesh(self.file(name, self.cases[name]))
                    target = self.file(f'{name}_moved', self.moved(self.cases[name], scale))
                    reused = self.new.inspect_mesh(target, prior)
                    measured = self.new.inspect_mesh(target)
                    self.assertEqual(reused['topology_evidence'], 'verified_digest')
                    self.assertEqual(measured['topology_evidence'], 'measured')
                    self.assertEqual({**reused, 'topology_evidence': 'measured'}, measured)
                    self.assertEqual(self.old.inspect_mesh(target),
                                     {key: value for key, value in reused.items() if key not in NEW_ONLY})

    def test_a_prior_is_not_used_for_an_open_surface_or_another_surface(self):
        open_prior = self.new.inspect_mesh(self.file('open_box', self.cases['open_box']))
        moved_open = self.file('open_box_moved', self.moved(self.cases['open_box']))
        self.assertEqual(self.new.inspect_mesh(moved_open, open_prior)['topology_evidence'], 'measured')
        box_prior = self.new.inspect_mesh(self.file('box', self.cases['box']))
        other = self.file('sphere', self.cases['sphere'])
        answer = self.new.inspect_mesh(other, box_prior)
        self.assertEqual(answer['topology_evidence'], 'measured')
        self.assertEqual(answer, self.new.inspect_mesh(other))
        # A forged prior that claims a closed solid for another digest changes nothing.
        forged = {**box_prior, 'component_count': 7, 'closed_component_count': 7}
        self.assertEqual(self.new.inspect_mesh(other, forged), self.new.inspect_mesh(other))
        # A triangle order change is another digest: measured, same facts.
        reordered = self.file('box_reordered', self.cases['box'][::-1])
        self.assertEqual(self.new.inspect_mesh(reordered, box_prior)['topology_evidence'], 'measured')

    def test_a_motion_that_merges_corners_is_measured_again(self):
        # Scaling by 1e-30 collapses float32 corners: the digest differs and
        # the file is refused on its own evidence, never described by the prior.
        prior = self.new.inspect_mesh(self.file('box', self.cases['box']))
        collapsed = self.file('box_collapsed', np.asarray(self.cases['box']) * 1e-30 * np.array([1, 1, 1e-30]))
        with self.assertRaises(ValueError):
            self.new.inspect_mesh(collapsed, prior)

    def test_the_command_line_takes_the_prior_and_ignores_a_malformed_one(self):
        import json
        source = self.file('box', self.cases['box'])
        target = self.file('box_moved_cli', self.moved(self.cases['box']))
        helper = str(ROOT / 'app/inspect_mesh.py')
        first = subprocess.run([sys.executable, helper, str(source)], capture_output=True, text=True, timeout=120, check=True)
        prior = json.loads(first.stdout)
        second = subprocess.run([sys.executable, helper, str(target), '--prior', json.dumps(prior)],
                                capture_output=True, text=True, timeout=120, check=True)
        self.assertEqual(json.loads(second.stdout)['topology_evidence'], 'verified_digest')
        third = subprocess.run([sys.executable, helper, str(target), '--prior', '{not json'],
                               capture_output=True, text=True, timeout=120, check=True)
        self.assertEqual(json.loads(third.stdout)['topology_evidence'], 'measured')


if __name__ == '__main__':
    unittest.main()
