# J3 orientation visibility and total-rotation contract

Date: 2026-08-31

## Classification

`J3_SCHEMA_OWNER_APPROVED;
J3_LOCAL_SOURCE_TESTS_VERIFIED;
J3_ORCA_FLAG_OWNER_VERIFIED_INPUT;
J3_CONTAINER_VPS_MATRIX_PENDING_OWNER;
J3_NO_DEPLOY_NO_ROUTE_MUTATION`.

J3 starts from J2 commit
`9b28b95cfa9f931092044300ebfca912421bac32` on the isolated
`codex/j3-orientation-visibility` branch. The exact code-bearing J3 commit is
`c404326f535fcc70ba62aa923fa6652f4fba5019`. Its complete local source gate is
green at the counts recorded below. No image was published or deployed, and no
public route or consumer repository was changed.

## Owner-approved wire contract

The 2026-08-31 owner review approved:

1. optional multipart `orientationMode`, accepting only exact `auto` or
   `preserve` and defaulting omission to `auto`;
2. `transform_schema: 1` in every complete `model_transform`;
3. identical transform provenance on success and
   `MODEL_OUT_OF_PRINTER_BOUNDS`;
4. a full-path authoritative rotation matrix, including prevention or explicit
   accounting of any later native arrange rotation.

The implementation defines:

- `orientation_outcome`: `applied`, `unchanged`, `preserved`, or
  `fallback_unmodified`;
- `original_dimensions_mm`: after safe source conversion and before service
  orientation or requested transforms;
- `oriented_dimensions_mm`: after `auto` orientation or `preserve`
  normalization and before requested sizing/rotation;
- `final_dimensions_mm`: after requested sizing/rotation and before native
  slicing;
- `automatic_rotation_matrix`: automatic orientation only;
- `rotation_matrix`: total effective rotation only, composed for column vectors
  as `R_total = R_requested * R_automatic`, with
  `R_requested = Rz * Ry * Rx` for requested X, then Y, then Z;
- `rotation_deg`: a canonical Euler summary of the total matrix;
- `stats.object_height_mm`: exactly `final_dimensions_mm.z` on success.

Matrices deliberately exclude scaling, centering, grounding, and translation.
The matrix is the authoritative rotation representation; Euler fields are
human-readable canonical summaries.

## K2 bounds-error parity

`MODEL_OUT_OF_PRINTER_BOUNDS` keeps its existing public `errorCode` and error
sentence, and now includes all of:

- `model_dimensions_mm`;
- `build_volume_limits_mm`;
- the same complete `model_transform` required on success.

The consumer can therefore choose its customer-facing message from
`orientation_mode` and `orientation_outcome`. Only `applied` supports “does not
fit even after automatic rotation”; `unchanged` means automatic evaluation
kept the pose, `preserved` identifies the submitted pose, and
`fallback_unmodified` must disclose that automatic orientation was unavailable.
No dimension comparison or client-side inference is required.

## K3 ZIP and native-rotation decision

The source path proves that current ZIP input does not create an independently
packable multi-object plate:

1. [`zip.js`](../../../app/services/slice/zip.js) rejects an outer ZIP unless it
   contains exactly one supported source file.
2. [`mesh2stl.py`](../../../app/mesh2stl.py) loads a scene, dumps its geometries,
   and concatenates them into one STL mesh.
3. [`pipeline.js`](../../../app/services/slice/pipeline.js) passes one
   processable model file to native slicing, and the command requests no
   split-to-objects operation.

A 3MF can contain multiple disconnected geometries, but after conversion they
are one compound STL whose shells retain their relative placement; creating
independently arranged objects would require an explicit split/import path that
this API does not expose. Disabling whole-compound yaw therefore removes no
existing independent multi-object packing capability. Orca retains:

- `--arrange 1` for translation/placement;
- `--orient 0` to keep native auto-orientation off;
- exactly one single-token `--allow-rotations=0` to prevent later arrange yaw.

Prusa receives the already transformed model and adds no native rotation.
These choices make the service-side total matrix authoritative for the complete
rotation path.

## Owner-supplied Orca flag evidence

The owner measured the exact Orca 2.3.1 AppImage independently:

| Argument form | Owner observation | Classification |
| --- | --- | --- |
| `--allow-rotations=0` | Slice completed and produced real G-code with 6.25 g | `OWNER_VERIFIED_INPUT` |
| `--allow-rotations 0` | Failed with `No such file: 0` because `0` was parsed as an input file | `OWNER_VERIFIED_INPUT` |

This establishes the required one-token argument shape. It is not evidence that
the final J3 candidate image uses it correctly, and it is not full HTTP
contract evidence.

## Verification boundary

| Evidence lane | State |
| --- | --- |
| Owner schema review and K1-K3 authorization | `APPROVED 2026-08-31` |
| ZIP/multi-object source trace | `SOURCE_PROVEN` |
| Exact Orca 2.3.1 flag shape | `OWNER_VERIFIED_INPUT` |
| Aggregate JavaScript tests | `2352/2352 PASS` |
| Aggregate Python tests | `132 discovered; 132 run; 131 PASS; 0 failed; 0 errors; 1 expected Windows POSIX-permission skip` |
| Tracked syntax gate | `259 JavaScript and 44 Python files PASS` |
| Staged repository-safety gate | `37/37 indexed files PASS` |
| Production dependency audit | `0 vulnerabilities` |
| Cached and working-tree diff checks | `PASS` |
| Code-bearing J3 commit SHA | `c404326f535fcc70ba62aa923fa6652f4fba5019` |
| Exact candidate container/VPS HTTP matrix | `PENDING_OWNER / NOT VERIFIED` |
| Hosted exact-SHA Source/Image validation | `NOT VERIFIED` |
| Registry publication or deployment | `NOT RUN / NOT AUTHORIZED` |
| Public route, customer traffic, consumer repositories | `UNCHANGED / NOT AUTHORIZED` |

The owner-VPS entry point is
[`orientation_visibility_test_runner.py`](../../../tests/testing-scripts/slicing/orientation_visibility_test_runner.py).
Its privacy-safe matrix includes both engines, `auto` and `preserve`, requested
rotation composition, success and bounds parity, a `20 x 255 x 255 mm`
asymmetric case, and a second all-axes-distinct `20 x 240 x 245 mm` fixture.
For the P1S envelope, `20 x 255 x 255 mm` in `preserve` mode is expected to
return HTTP 422; treating it as success would be an invalid matrix.

The owner will run and read the generated report on the VPS. Until that occurs,
the container/native and deployed claims remain explicitly unverified.
