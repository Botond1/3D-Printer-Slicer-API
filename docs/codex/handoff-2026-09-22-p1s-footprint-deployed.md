# The P1S alternative footprint in catalogue v3, release 3.7.0 — deployed 2026-09-22 (Europe/Budapest)

Catalogue v3 (`GET /profiles?contract=material-v1`) publishes the Bambu P1S's
second admission footprint (PR #35, merge `a7f167f95753f5f1e47adedeb4a07643024a7489`).
The owner authorised the change, the GitHub process and the VPS cutover on
2026-09-22 („javítsd akkor ezt is majd mehet az egész deploy meg merge meg
minden"). No route, admission rule, placement, allowlist, pricing, registry
(`configs/`), credential or catalogue v2 byte changed.

## Why (measured, not assumed)

The P1S bed excludes an `18 x 28 mm` corner at the origin, so `bambu-placement.js`
admits `256 x 228` above the corner or `238 x 256` beside it. The catalogue
published only the `256 x 228 x 249.9` triple. The R3D plugin checks the slicer's
final dimensions against that triple, so it refused a `179 x 233.8 x 84.5 mm`
customer pose this endpoint had accepted and moved the job to the H2D.

Re-measured on the live 3.6.0 engine before the change (P1S, 0.2 mm, PLA, 20 %,
21 s apart, inside the VPS against the container):

| probe | result |
| --- | --- |
| `238 x 256 x 10` preserve | 200, placement `(18, 0)` |
| `238.1 x 256 x 10` preserve | 422 `MODEL_OUT_OF_PRINTER_BOUNDS` |
| `256 x 228 x 10` preserve | 200, placement `(0, 28)` |
| the customer file, auto | 200, final `179.006 x 233.845 x 84.511`, placement `(38.497, 11.078)`, 22 058 s, 112.15 g |

## What changed (see CHANGELOG 3.7.0)

- `BAMBU_ALTERNATIVE_FOOTPRINTS_INCLUSIVE_MM` in `app/config/constants.js`
  (P1S `[238 x 256]`, H2D `[]`), bound to the real placement by a unit test.
- Every catalogue v3 row carries `build_volume_limits_mm.alternative_footprints_inclusive_mm`.
  The validator allows at most four exact `{x, y}` pairs, only on Bambu rows,
  each inside the declared bed and extending the triple on exactly one axis,
  and one bed shape per machine across its presets.
- Catalogue v2 rows are the v3 rows without the opt-in fields, so v2 is
  byte-identical. The live runner's material parity check compares through
  `v2_projection()`.
- No file in the Bambu generation's processing list changed, so
  `measurement_generation` did not move and no consumer's cached fact changed identity.
- An independent review before merge found the parity runner, the per-axis
  engine and the per-machine agreement gaps; all were fixed in the PR.

## Release and cutover

- Candidate publication run 35783792232 →
  `ghcr.io/botond1/3d-printer-slicer-api@sha256:59a44481731f36910c1b398cf4b607212e098b9e670ceb487ab04ac8b9a49681`;
  `gh attestation verify` passes for SLSA provenance v1 and SPDX 2.3 (subject
  `59a44481…`, source digest `a7f167f…`, signer workflow on `refs/heads/main`).
- Cutover ~21:10 UTC with `/root/r3d-footprint-control-20260922/deploy-footprint.sh`
  (root-private; same steps as the 3.6.0 script): revision label ok, identity
  999:999, retention tags for `bd41b667…` and `a7f167f…`,
  `production_compose_contract=PASS`, atomic env rewrite (backup in
  `/root/r3d-backup-20260922-footprint/`), healthy after 6 s, runtime identity
  `running true 0 false`, `/ready` 200, no-key POST 401.
- The script stops unless catalogue v2 and the generation are unchanged. After
  the cutover v2 `catalogue_sha256` was still `bb07e0c325041bef95475db892e98de4c77125c59b54a4a6c3d3b59d4c19916c`
  and the Bambu `measurement_generation` still `0af5bd3e2fb980f41e754064b7f869038500f1523bbbb48a5d00b406aa394e27`.
  Catalogue v3 is `08afef2f…` (was `45510de9…`). All 32 P1S rows carry
  `[{x: 238, y: 256}]`, every other row `[]`.
- Control slices on the live container: `cube30.stl` 200, 1801 s / 11.08 g,
  the same as the 3.6.0 control. `keyring.stl` 200, 1916 s / 12.4 g, 8
  components. `238 x 256 x 10` 200 at `(18, 0)`. `238.1 x 256 x 10` 422.
- Consumer proof: the R3D plugin's staging package 810 reads the footprint and
  locks the customer file on the P1S with one slice. The quote reads
  179 x 233.8 x 84.5 mm, 6 h 6 min, 112 g. The same file had gone P1S → H2D in
  80 s with two slices.

## Rollback

`sh /root/r3d-footprint-control-20260922/deploy-footprint.sh ghcr.io/botond1/3d-printer-slicer-api@sha256:59a44481731f36910c1b398cf4b607212e098b9e670ceb487ab04ac8b9a49681 a7f167f95753f5f1e47adedeb4a07643024a7489 rollback`
restores the backed-up env (`SLICER_API_IMAGE=…9aff9464…`, 3.6.0) and
recreates the container from the retained image. The plugin reads an absent
footprint as none, so no consumer change is needed for a rollback.
