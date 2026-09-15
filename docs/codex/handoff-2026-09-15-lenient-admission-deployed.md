# Lenient geometry admission + exact 3MF walk, release 3.6.0 — deployed 2026-09-15 (Europe/Budapest)

`POST /bambu/slice` admits ordinary real-world meshes and describes them in the
receipt instead of refusing them, and flattens 3MF by the API's own walk of the
build (PR #33, merge `bd41b667a38c3792d0e9ff5de6596b4c8a9c3134`). The owner
authorised the slicer change, the GitHub process and the VPS cutover on
2026-09-15 („a szeletelőhöz is hozzányúlhatsz… ha hibába ütközöl, akkor javítsd
és hozd mainre deployold commitold pushold"). No other consumer, route,
allowlist, pricing, registry (`configs/`) or credential changed.

## Why (measured, not assumed)

Every model in the owner's own download folder — 2 451 distinct files (1 910
STL, 216 3MF, 65 OBJ, 260 STEP/STP) — was run through the 3.5.0 `inspect_mesh.py`
rules with the image's pinned trimesh 5.1.0 / numpy 2.5.2 (2 159 meshes; STEP
was not inspected locally, 28 huge files exceeded the local 300 s budget):

| 3.5.0 verdict | files | reality |
| --- | ---: | --- |
| `valid` | 1 411 | closed, one shell |
| `open_mesh` | 316 | a few open edges (the reference Benchy: 29) |
| `ambiguous_scope` | 209 | several separate shells (a key ring: 8, a llama: 5) |
| `degenerate_faces` | 215 | zero-area / duplicated triangles (Benchy: 563) |
| other | 8 | |
| **refused** | **748 = 34.6 %** | |

Of the 216 3MFs the old `--3mf-scope` refused 125: Bambu Studio project files
keep their geometry in production-extension parts (`3D/Objects/object_N.model`
via `<component p:path=…>`), which the old check called unloadable; 37 more
failed the archive policy on `Auxiliaries/Model Pictures/*.webp`, `.pdf` and
`Cura/*.cfg` parts. The 3.6.0 rule admits **2 124 of 2 159 (98.4 %)**; the 30
left are zero-volume surfaces (architectural façade/skylight decor), which no
slicer prints as a solid.

## What changed (see CHANGELOG 3.6.0 and the integration guide)

- `inspect_mesh.py` → `r3d-mesh-inspection-v2`: degenerate/duplicate triangles
  are dropped from the analysis copy; open meshes and several shells are
  admitted and described (`watertight`, `winding_consistent`, `component_count`,
  `closed_component_count`, `open_edge_count`, `dropped_degenerate_faces`,
  `dropped_duplicate_faces`, `volume_source` = `validated_triangle_mesh` |
  `signed_volume_estimate`). Only unprintable geometry stays 400
  `INVALID_SOURCE_GEOMETRY`. Nothing is repaired; the submitted file is sliced.
- `technical_receipt.geometry` carries the description, `scope.object_count` /
  `instance_count` the 3MF build's own counts, an open mesh adds
  `GEOMETRY_NOT_WATERTIGHT` (`warnings` up to 3). Strict readers: the WordPress
  plugin accepts the description since its package 701 (deployed to staging
  before this cutover).
- `mesh2stl.py` flattens 3MF by its own walk (core + production extension):
  items → components (with transforms) → meshes, root `unit` applied. trimesh's
  3MF loader returned nine copies of a nine-item plate (146 610 triangles for
  16 290) and two copies of a six-item one on real files, so it is no longer
  used for 3MF. `--3mf-scope` rides the same walk; a build the walk cannot
  satisfy or a project with modifier/negative/blocker parts
  (`Metadata/model_settings.config` `subtype != normal_part`) stays 422
  `AMBIGUOUS_MANUFACTURING_SCOPE`.
- Archive policy: `.webp`, `.pdf` under `Metadata/`/`Auxiliaries/`, `Cura/`
  profile parts admitted.

## Immutable identities

- Source: PR #33 (`feat/lenient-geometry-admission`, head `5e16d7b` + `fix(ci)`
  lazy-import commit), merge `bd41b667a38c3792d0e9ff5de6596b4c8a9c3134` on
  protected main. Required checks: „Validate exact source candidate" run
  35025357491 PASS (47 s; the first attempt 35025066311 failed because the
  deterministic job has no numpy/lxml — the 3MF walk now imports them where it
  runs), „Build once, inspect, scan, and discard" run 35025357500 PASS (6 m 36 s).
- Signed publication: run 35026359382 (`publish_new`,
  `PUBLISH_SIGNED_MAIN_CANDIDATE`, actor Botond1), image
  `ghcr.io/botond1/3d-printer-slicer-api@sha256:9aff946439db5350a2ccb651dce45994a7fb1020c0a48ca5855346404a4c9af3`
  (discovery tag `candidate-bd41b667…`, linux/amd64), `success` at 21:43 UTC.
  Independent local `gh attestation verify` (repo, cert identity
  `…/candidate-publication.yml@refs/heads/main`, signer/source digest = merge
  SHA, GitHub OIDC issuer): one entry each for `https://slsa.dev/provenance/v1`
  and `https://spdx.dev/Document/v2.3`, both with subject `sha256:9aff9464…`.
- Previous production image (rollback):
  `ghcr.io/botond1/3d-printer-slicer-api@sha256:220873a426488336af0a20d55580a0e0daba63615b8dd99c5417badd24eb34de`
  (source `5794efad764af0eb79a52747ce123c5e60c5ac44`, 3.5.0), retained as
  `local/rocket3d-slicer-api:retained-5794efad…`; the candidate is retained as
  `local/rocket3d-slicer-api:retained-bd41b667…`.
- Operator pack and registry stay the `5794efad…` release tree
  (`/opt/rocket3d/slicer-api-5794efad…`, `/etc/rocket3d/slicer-api/5794efad…/compose-n1-exact-configs.env`,
  only `SLICER_API_IMAGE` changed; the previous file is kept root-private under
  `/root/r3d-backup-20260915-lenient/`). Compose project `slicer-api`,
  `--no-deps --pull never`. Traefik, perimeter, service env, pricing state,
  CPU/memory (4.0 / 8 GiB) and mounts unchanged.

## Cutover evidence (bounded)

Cutover 2026-09-15 ~21:50 UTC with `/root/r3d-lenient-control-20260915/deploy-lenient.sh`
(root-private; the slice key is read into the shell only for the control
slices and never printed): revision label `bd41b667…` ok, service identity
999:999, `production_compose_contract=PASS`, rendered image = candidate,
atomic env rewrite, `Recreated` → `healthy after 6s`, runtime identity
`running true 0 false`, `/ready` 200, `/health` OK, catalogue
`r3d-profile-catalogue-v3` 96 rows / 60 Bambu rows, **`measurement_generation`
`0af5bd3e2fb980f41e754064b7f869038500f1523bbbb48a5d00b406aa394e27`** (was
`1ba2a759…`), no-key POST 401. Control slices on the live container (P1S,
0.2 mm, auto): `cube30.stl` 200 in 4.8 s — 1801 s / 11.08 g, `component_count 1`,
`watertight true` (identical to the 3.5.0 control); `keyring.stl` (8 shells,
refused as 422 by 3.5.0) 200 in 8.7 s — 1914 s / 12.4 g, `component_count 8`,
`watertight true`.

Before the release, the same files were bind-mounted over a throwaway
container of the 3.5.0 image (own `--internal` network, own `/opt/r3d-geom-probe-20260915/`,
throwaway keys; removed after the cutover): Benchy 200 (3613 s / 15.11 g),
`bottom-v1` (894 fragments, 214 open edges) 200 with `GEOMETRY_NOT_WATERTIGHT`
(1005 s / 4.8 g), llama (5 shells) 200 (4149 s / 22.95 g), Bambu project 3MFs
`102.3mf` 200, `fedo.3mf` (9 instances) 200 with `component_count 9` and a
volume of exactly 9 × the part, `Grey_Sled.3MF` (in-file component) 200,
`feherpla.3mf` (3 objects) 200; the empty 84-byte STL stayed 400.

## Rollback

`sh /root/r3d-lenient-control-20260915/deploy-lenient.sh <candidate ref> bd41b667a38c3792d0e9ff5de6596b4c8a9c3134 rollback`
restores the backed-up env (`SLICER_API_IMAGE=…220873a4…`) and recreates the
container from the retained 3.5.0 image; the plugin's package 701 validates the
3.5.0 receipt too, so no consumer change is needed for a rollback.

## What remains

- Zero-volume surfaces (30 of 2 159) are still 400 — correctly.
- STEP/IGES were not inspected locally (no gmsh on the workstation); the
  `cad2stl.py` path is unchanged and its STL goes through the new admission.
- Bambu projects with modifier/negative parts are 422 by design; a recipe/scope
  contract for those is separate work.
- Heavy meshes are bounded by the consumer's 100 s worker ceiling (Benchy's
  225 k triangles took 95 s on a 2-CPU probe container; the production
  container has 4 CPUs).
