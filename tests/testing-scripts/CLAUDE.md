# Testing Scripts - Local Claude Guide

Last synchronized: 2026-08-31

## Scope

This folder contains API-level Python integration and workflow tests.

## Main Runner Groups

- `slicing/` — Full suite and slicer matrix runners
  - slicing/full_api_test_runner.py
  - slicing/full_api_orca_fdm_test_runner.py
  - slicing/full_api_prusa_fdm_test_runner.py
  - slicing/full_api_prusa_sl1_test_runner.py
  - slicing/unsupported_upload_test_runner.py
  - slicing/orientation_visibility_test_runner.py
  - slicing/native_envelope_sweep_runner.py

- `admin/` — Admin endpoint validations
  - admin/admin_output_files_test_runner.py

- `pricing/` — Pricing lifecycle validations
  - pricing/pricing_cycle_test_runner.py

- `queue/` — Queue concurrency validations
  - queue/queue_concurrency_test_runner.py

- `rate_limit/` — Rate-limit regression validations
  - rate_limit/rate_limit_regression_test_runner.py

- `operations/` - Public readiness and operations-scoped diagnostics
  - operations/operations_readiness_metrics_test_runner.py

- `profiles/` - Public startup profile-catalogue validation
  - profiles/profile_catalogue_test_runner.py

## Shared Helpers

Located in tests/testing-scripts/common/:

- env_utils.py
- http_utils.py
- queue_cleanup_manifest.py
- queue_concurrency_reporting.py
- queue_concurrency_utils.py
- slice_matrix_runner.py

Helpers resolve configured runner inputs for the matching audience. Slice uses
only `x-slicer-api-key`; pricing, artifact, and operations use `x-api-key`.
Never reuse one audience's key for another. The current Python slice helper
reads the runner input name `SLICE_SERVICE_API_KEY`; it does not infer server
slice mode or automatically read WooCommerce/LeadPilot variables. Supplying an
authorized principal value under that runner-only input can exercise the same
single header, but never add a second header or re-enable a server shared slot
solely for a runner.

`common/http_utils.py` also provides a bounded header-retaining JSON request
for conditional GET checks. It keeps the final HTTP response block so the
catalogue runner can verify ETag/304 without printing request credentials.
All shared curl helpers pass authentication headers through the child stdin
pipe (`-H @-`), never through process arguments or a retained temporary file.

## Reporting Contract

All test outputs must be written to tests/testing-scripts/results/.
After execution, always read the generated markdown report file.

The I12 queue capacity runner is an operator-evidence exception: it requires
explicit create-new `--report` and `--cleanup-manifest` paths in a private
run-owned directory. Read the supplied report path after execution and preserve
the manifest for the exact cleanup-consumer step.

## Execution Policy

- Prefer Docker-based API runtime for integration validations.
- Keep test runners deterministic and avoid changing endpoint contracts through tests.

## Runtime Inputs

- SLICER_BASE_URL from .env, fallback to default local base URL.
- `SLICE_SERVICE_API_KEY` is the current runner input for matrix, queue, and
  unsupported-upload endpoint tests. It is not proof of the server's active
  `legacy`/`migration`/`principals` mode and does not authorize dual-header or
  dual-reader behavior. The rate-limit regression intentionally omits it so it
  can prove exact pre-limit HTTP 401 responses before the limiter's HTTP 429.
- PRICING_API_KEY is required for pricing lifecycle tests.
- ARTIFACT_API_KEY is required for artifact/admin-output tests.
- OPERATIONS_API_KEY is required for detailed health/readiness/metrics tests.
- Never print credential values in reports or place them in process arguments.

## Queue Capacity Qualification Contract

Use:

```text
python tests/testing-scripts/queue/queue_concurrency_test_runner.py --count N --expected-max-concurrent N --retry-on-429 1 --cleanup-manifest NEW_MANIFEST_PATH --report NEW_REPORT_PATH
```

- `--expected-max-concurrent`, `--cleanup-manifest`, and `--report` are
  mandatory. N must be `1`, `2`, or `3`, and request count cannot exceed three.
- The runner requires fresh operations observations and an exact empty managed
  artifact inventory before starting synthetic load. It emits bounded,
  create-new evidence and never performs cleanup itself.
- Host capacity execution must run the producer as the dynamically resolved
  non-root service identity through `scripts/i12-capacity-producer-exec.py` and
  four root:root 0600 credential files; never pass secret values in argv.
  Afterward, stop the API and prove exact clean shutdown before the same exact
  image runs the network-none, non-root cleanup consumer described in
  `ops/hostinger/RUNBOOK.md`.
- Default concurrency remains N=1. N=2/N=3 are not qualified or deployed at
  the I12 local-implementation checkpoint.

## Profile Catalogue Contract

Use:

```text
python tests/testing-scripts/profiles/profile_catalogue_test_runner.py
```

- The required lane proves unauthenticated HTTP 200, exact FDM-only
  `r3d-profile-catalogue-v2` shape, canonical `catalogue_sha256`, strong ETag,
  conditional 304, and all 18 per-printer/per-engine preset rows. It validates
  the separate `declared_build_volume_dimensions_mm` metadata and authoritative
  inclusive `largest_passing_dimensions_inclusive_mm`, and independently
  rederives engine-scoped `machine_resolutions` and `fleet_resolutions` without
  cross-engine merging or component-wise synthesis. Preset drift inside one
  technology/printer/engine must fail catalogue construction. The runner also proves the generic
  `120 x 120 x 150 mm` SLA fallback is not advertised as a machine envelope.
- It also proves a bounded generic `engine`, generic endpoint plus ordered
  `slice_selector.parameters[{name,value}]`, ordered path-free
  `profile_components[{role,basename,selector_parameter}]`, exact nullable
  component-to-selector bindings, and exact
  `effective_profile_identity_schema: r3d-effective-slice-profile-v2`, and
  `declared_source_kind: profile-explicit`. Treat
  `minimum_dimensions_inclusive_mm` as a floor, not machine metadata.
- The owner-accepted P1S ceiling is Prusa `256 x 256 x 249.9 mm` and Orca
  `253.9 x 253.9 x 249.9 mm`. H2D-QUOTE is present on both engines with
  P1S-derived quote-only physics. Exact helper-image measurement A established
  Prusa `350 x 320 x 324.9 mm` and Orca `347.9 x 317.9 x 324.9 mm`. Prusa's
  native X/Y edge beyond its declared quote bed remains `UNESTABLISHED`. Exact
  local final-admission B confirmed all four tuples, and its catalogue lane
  passed 9/9 checks plus the optional Prusa digest-parity check.
- Do not fabricate Elegoo Saturn 4 Ultra dimensions. The generic v2 entry shape
  can later admit a truthful SLA printer without a schema-version change, after
  the owner-profiled Chitubox/Elegoo Satellite remediation wave.
- Add `--verify-prusa-slice-parity` only when a runnable native API and
  `SLICE_SERVICE_API_KEY` are available. That optional lane performs one
  synthetic Prusa slice and requires its effective profile digest to equal the
  matching catalogue entry.
- The generated report is
  `tests/testing-scripts/results/profile_catalogue_test_result.md`; read it
  immediately after every run. A local source/unit result is not exact-image,
  hosted, deployed, or production evidence.

## J3B orientation/original-measurement owner-VPS contract

Use the focused entry point:

```text
python tests/testing-scripts/slicing/orientation_visibility_test_runner.py
```

- Run it only against the separately owner-authorized exact container/VPS
  candidate. Repository-local unit results do not establish native or deployed
  behavior.
- Normal rows use privacy-safe generated asymmetric fixtures with valid
  outward non-zero facet normals, including
  `20 x 255 x 255 mm`, `20 x 240 x 245 mm`, and all-axes-distinct
  `18 x 130 x 240 mm`. The 37-case HTTP matrix retains every section-0 row:
  among them are `20 x 240 x 245 mm` auto with zero request transform, exact
  `18 x 130 x 240 mm` automatic replay, preserve plus requested X90 on that
  fixture, and invalid `sideways`. It covers both engines, `auto`/`preserve`,
  request rotation composition, success, and `MODEL_OUT_OF_PRINTER_BOUNDS`
  parity.
- Every normal fixture must pass `prusa-slicer --info` immediately before the
  row. The deliberate zero-normal regression is a legal binary STL with SHA-256
  `60affa17c1470817223a10f1d39475e437090d696ece969a87b06d3bf1c7721bb`.
  Exact J2 image
  `sha256:0d81837cdd5c3b56383580eb28df799686103bb4663a9f4016e9fbc89e4e31ea`
  returned HTTP 200 on Prusa and Orca. Exact local B returned HTTP 200 for both
  engines in `auto` and `preserve`, with
  `original_dimensions_available:false` and `original_dimensions_mm:null`.
  It is separate from normal fixture preconditions and does not stand in for an
  unavailable-oriented-dimension test.
- The native-info probe defaults to the host executable. Exact-container use may
  provide only a bounded fixture-addressing JSON argv template through
  `--native-info-command-json` or `SLICER_NATIVE_INFO_COMMAND_JSON`; execution is
  no-shell with a credential-free child environment, and the report stores only
  the `host-default`/`configured`/`invalid` source label.
- For P1S, `20 x 255 x 255 mm` in `preserve` mode is an expected HTTP 422
  bounds result, not success. Bounds acceptance requires the same complete
  versioned transform contract as success.
- Every accepted payload must prove `transform_schema: 2`, exact orientation
  mode/outcome, rotation matrices, the true/object or false/null original-
  availability invariant, canonical measured `height_mm == z`, positive
  oriented/final dimensions, and
  `stats.object_height_mm == model_transform.final_dimensions_mm.z` on
  success. A malformed tagged original measurement degrades to false/null;
  malformed tagged oriented/final measurements return controlled 422. Never
  infer a rotation only from swapped dimensions.
- Keep credentials in the existing stdin-backed request path and keep reports
  free of filenames, paths, keys, customer data, and private network identity.
  Always read
  `tests/testing-scripts/results/orientation_visibility_test_result.md` after
  execution. Exact local B passed 12/12 fixture checks, 4/4 selector checks, and
  all 37/37 HTTP cases. The owner VPS rerun remains `PENDING_OWNER`.

## J3B native-envelope sweep contract

Use:

```text
python tests/testing-scripts/slicing/native_envelope_sweep_runner.py
```

- Normal sweep fixtures use outward non-zero facet normals and the same exact
  native `prusa-slicer --info` precondition. Sweep both axes and Z for P1S and
  H2D-QUOTE on both engines, repeat the combined X/Y corner probe, and retain
  prevalidation versus native-rejection evidence as distinct outcomes.
- The `native-measurement` (A) and `final-admission` (B) phases are fail-closed
  behind an exact catalogue-v2 `/profiles` guard. A requires declared admission
  on the H2D-QUOTE selectors; B requires the published largest-passing limits
  on all four engine/profile selectors. Every HTTP point must echo the exact
  expected `build_volume_limits_mm.max` and `source_profile`. Prusa's source is
  the selected layer-height INI; Orca's is its stable machine profile, never the
  process profile.
- P1S accepted evidence is Prusa `256/256/249.9` and Orca
  `253.9/253.9/249.9`. Prusa's native edge beyond the declared physical profile
  remains `UNESTABLISHED`; policy rejection at `256.1` is not a native edge.
- H2D-QUOTE exact-image measurement A passed 44/44 fixture preconditions,
  10/10 brackets, and 2/2 combined corners. It established Prusa
  `350/320/324.9` and Orca `347.9/317.9/324.9`; at layer height `0.3`, `325`
  returned the full K2 HTTP 422 twice on each engine after the exact conjunctive
  last-layer classifier. Exact local final-admission B passed 88/88 fixture
  preconditions, 20/20 brackets, and 4/4 combined corners, confirming P1S
  Prusa `256/256/249.9`, P1S Orca `253.9/253.9/249.9`, H2D-QUOTE Prusa
  `350/320/324.9`, and H2D-QUOTE Orca `347.9/317.9/324.9`.
- Exact local B also proved Orca `253 x 253 x 20 mm`, preserve, `0.3 mm` at
  `456.33 g`. Its `249 x 100 x 20 mm` Orca outer-wall G-code footprint matches
  exact J2 at `248.600 x 99.600 mm`, 500 segments, and bounds
  `x=3.700..252.300`, `y=78.200..177.800`.
- Read `results/native_envelope_sweep_measurement_result.md` after the native-
  measurement phase and `results/native_envelope_sweep_result.md` after final
  admission. Keep both generated reports local and uncommitted; the sanitized
  evidence belongs in `docs/codex/evidence`. Exact local image proof is not
  hosted, deployed, or owner-VPS evidence.

## Local Rules

- Prefer existing runner patterns over adding ad-hoc scripts.
- Keep reports deterministic and easy to diff.
- Preserve endpoint coverage when endpoint behavior changes.
- Keep focused runners behavior-specific; split oversized runners into domain-focused suites.
- Keep stable deterministic runners unchanged unless changed endpoint behavior requires edits.
- Full slice matrix reports may mark explicitly declared fail-fast rejections as passing only when status and `errorCode` match the expected case exactly.
- A J0 success-contract assertion must require machine-readable
  `engine_version` and lowercase 64-hex `profiles.effective_profile_sha256`
  while retaining original selected profile basenames. Bounds failures require
  both dimension payloads. OpenAPI slice-500 assertions must retain the complete
  live enum: `INTERNAL_PROCESSING_ERROR`, `QUEUE_INTERNAL_ERROR`,
  `UPLOAD_STORAGE_ERROR`, and `INTERNAL_SERVER_ERROR`. The current Python matrix
  helper does not yet prove
  actual-binary version, digest/snapshot/flattened-parent lineage, or Orca
  `--arrange 1` / `--orient 0` / `--allow-rotations=0`; its result alone is not complete J0 response-
  contract evidence. Focused contracts cover the corrected placement/orientation
  and digest policy, and final exact-image evidence covers startup version
  resolution plus the HTTP transform/final-dimensions E2E for both principals.
  The exact local code/image identity and aggregate are recorded in J0 evidence;
  the Python matrix alone still does not establish these facts.
- The native Orca smoke accepts positive `G1 ... E` only after the exact
  `;BEFORE_LAYER_CHANGE` marker; prelude/purge extrusion does not establish
  model-layer extrusion.
- Keep the native Orca smoke split into its thin Docker orchestrator and
  side-effect-free fixture, container-script, and contract builders; preserve
  the bounded file/function guards and exact generated-script behavior.
- Nine numeric Bambu references plus the `M03` P1S-boundary result are recorded,
  but the matching Orca calibration is
  `BLOCKED_VENDOR_PROFILE_AND_LOCAL_DOCKER`. Do not treat the reference side or
  the profile-catalogue runner as time/mass or automatic-pricing acceptance.
- Queue timing and client start order are informational; fresh queue-state and
  exact artifact-inventory observations are authoritative. Staggered completion
  is used only as an N=1 serialization diagnostic.
- Service-auth regression cases must preserve the exact HTTP 401 body:
  `{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`.
- Principal migration coverage must keep `x-slicer-api-key` as the only slice
  header and must not make the service accept both slice and admin readers.
- Operations checks must prove public /ready is minimal, protected diagnostics
  return OPERATIONS_AUTH_REQUIRED without a key, and response/report content is
  bounded and secret/path/filename-safe.
