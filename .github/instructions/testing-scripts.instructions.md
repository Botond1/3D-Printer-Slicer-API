---
applyTo: "tests/testing-scripts/**"
---

# Testing Scripts Instructions

Last synchronized: 2026-08-31

## Test Entry Points
- slicing/full_api_test_runner.py
- slicing/full_api_orca_fdm_test_runner.py
- slicing/full_api_prusa_fdm_test_runner.py
- slicing/full_api_prusa_sl1_test_runner.py
- slicing/unsupported_upload_test_runner.py
- slicing/orientation_visibility_test_runner.py
- slicing/native_envelope_sweep_runner.py
- admin/admin_output_files_test_runner.py
- pricing/pricing_cycle_test_runner.py
- rate_limit/rate_limit_regression_test_runner.py
- queue/queue_concurrency_test_runner.py
- operations/operations_readiness_metrics_test_runner.py
- profiles/profile_catalogue_test_runner.py

## Reporting Rules
- Write reports to tests/testing-scripts/results/.
- After running tests, read markdown reports and summarize outcomes.

## Execution Rules
- Prefer Docker-based API runtime for endpoint integration checks.
- Keep queue/rate-limit regression checks in dedicated runners.
- Keep focused runners small; split complex runners by domain instead of adding unrelated checks.
- Keep stable deterministic runners unchanged unless endpoint behavior changes.
- Full slice matrix reports may mark explicitly declared fail-fast rejections as passing only when status and `errorCode` match the expected case exactly.
- Queue concurrency reports use staggered completion as the black-box signal for serialized queue processing; client start-order matching is informational.

## Environment Inputs
- SLICER_BASE_URL
- `SLICER_NATIVE_INFO_COMMAND_JSON` optionally supplies a bounded JSON argv
  template for the orientation/envelope native-info precondition. It must
  address the generated fixture through admitted placeholders, runs with no
  shell and no service credentials, and reports only a command-source label.
- `SLICE_SERVICE_API_KEY` is the current runner input for matrix, queue, and
  unsupported-upload requests; send its authorized value only in
  `x-slicer-api-key`. The helper does not infer server slice mode or
  automatically read WooCommerce/LeadPilot variables. If a principal value is
  supplied under the runner-only input name, do not add a second header or
  re-enable the server shared slot. The rate-limit regression intentionally
  omits it to prove exact pre-limit HTTP 401 before 429.
- PRICING_API_KEY for pricing lifecycle tests.
- ARTIFACT_API_KEY for output listing/download tests.
- OPERATIONS_API_KEY for detailed health/readiness/metrics tests.
- Never print any credential value in output or reports, and use the shared
  stdin-backed curl authentication helper so the value never enters process
  arguments or a retained temporary file.

The profile-catalogue runner must prove public 200, exact FDM-only
`r3d-profile-catalogue-v2` shape, canonical body digest, strong ETag/304, and
all 18 per-printer/per-engine preset rows. It must separately validate physical/
profile-declared `declared_build_volume_dimensions_mm` and the exact-boundary,
inclusive admission authority
`largest_passing_dimensions_inclusive_mm`. Machine and fleet resolutions are
engine-scoped; never merge Prusa and Orca ceilings or synthesize a component-
wise minimum. Reject preset drift inside one technology/printer/engine and any
manual fleet maximum. Prove `declared_source_kind: profile-explicit`, bounded
generic `engine`, generic endpoint plus ordered
`slice_selector.parameters[{name,value}]`, ordered path-free
`profile_components[{role,basename,selector_parameter}]`, exact nullable
component-to-selector bindings, and exact
`effective_profile_identity_schema: r3d-effective-slice-profile-v2`.
`minimum_dimensions_inclusive_mm` remains a compatibility floor, not machine
metadata. The owner-accepted P1S ceiling is Prusa
`256 x 256 x 249.9 mm` and Orca `253.9 x 253.9 x 249.9 mm`; Prusa's native X/Y
edge beyond its declared profile is `UNESTABLISHED`. H2D-QUOTE must exist on
both engines with P1S physics and quote-only semantics. Exact helper-image
measurement A established Prusa `350 x 320 x 324.9 mm` and Orca
`347.9 x 317.9 x 324.9 mm`; Prusa beyond its declared X/Y edge remains
`UNESTABLISHED`. Exact local final-admission B confirmed all four published
tuples; its catalogue lane passed 9/9 checks and the optional Prusa digest-
parity lane ran and passed. The generic
`120 x 120 x 150 mm` SLA fallback must remain absent as a
machine envelope, and Elegoo Saturn 4 Ultra dimensions must not be fabricated.
The v2 entry shape can later admit a truthful SLA row without another schema
change. The runner's optional
`--verify-prusa-slice-parity` lane runs only with an available native API and
slice key, and must bind the live success digest to the matching catalogue
entry. Always read `results/profile_catalogue_test_result.md` after execution;
do not promote source-only results to exact-image, hosted, or live evidence.

Service-auth negative cases must assert exact HTTP 401
`{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`.

A J0 success-contract assertion must require machine-readable `engine_version`,
lowercase 64-hex `profiles.effective_profile_sha256`, and stable original
profile basenames; bounds failures require both dimension payloads. OpenAPI
slice-500 assertions must retain `INTERNAL_PROCESSING_ERROR`,
`QUEUE_INTERNAL_ERROR`, `UPLOAD_STORAGE_ERROR`, and `INTERNAL_SERVER_ERROR`.
The current Python matrix helper does not yet establish actual-binary version, digest/
snapshot/flattened-parent lineage, or Orca `--arrange 1` / `--orient 0` /
`--allow-rotations=0`; do not
classify its result alone as complete J0 proof. Focused contracts cover the
corrected placement/orientation and digest policy, and final exact-image
evidence covers startup version resolution plus the HTTP transform/final-
dimensions E2E for both principals. The exact code/image identity and local
aggregate are recorded in `docs/codex/evidence/j0-w2-w3-response-auth-contract.md`;
the Python matrix alone still does not establish these facts.
The native Orca smoke accepts positive `G1 ... E` only after exact
`;BEFORE_LAYER_CHANGE`; prelude/purge extrusion does not establish model-layer
extrusion.
Keep the smoke split into its thin Docker orchestrator and side-effect-free
fixture, container-script, and contract builders; preserve the bounded file/
function guards and exact generated-script behavior.
Nine numeric Bambu references plus the `M03` P1S-boundary result are recorded,
but the matching Orca calibration is
`BLOCKED_VENDOR_PROFILE_AND_LOCAL_DOCKER`. Do not treat the reference side or
the profile-catalogue runner as time/mass or automatic-pricing acceptance.

The focused J3B owner-VPS entry point is
`slicing/orientation_visibility_test_runner.py`. It uses generated privacy-safe
fixtures with valid outward non-zero facet normals, including
`20 x 255 x 255 mm`, `20 x 240 x 245 mm`, and all-axes-distinct
`18 x 130 x 240 mm`. Its 37-case HTTP matrix retains every section-0 row,
including `20 x 240 x 245 mm` auto with zero request transform, exact automatic
replay on `18 x 130 x 240 mm`, preserve plus X90 on that fixture, and invalid
`sideways`. Every normal row
must first pass immediate native `prusa-slicer --info` dimension validation.
The deliberately zero-normal regression is a separate row and must never be
reported as a normal-fixture service defect. It is a legal binary STL with
SHA-256 `60affa17c1470817223a10f1d39475e437090d696ece969a87b06d3bf1c7721bb`;
exact J2 and exact local B returned HTTP 200 on both engines, with B exposing
the schema-2 false/null original-dimensions degradation. Cover both engines,
both orientation modes, request-rotation composition, success, and full K2
bounds parity. P1S `20 x 255 x 255 mm` in `preserve` mode is an expected HTTP
422.
Require `transform_schema: 2`, exact mode/outcome and matrices, mandatory
`original_dimensions_available`, the true/object or false/null invariant with
no oriented fallback, positive oriented/final dimensions, and canonical
`height_mm == z`; success height also equals final Z. A malformed tagged
original measurement degrades to false/null, while a malformed load-bearing
oriented/final measurement must be controlled HTTP 422
`MODEL_DIMENSIONS_UNAVAILABLE`; an explicit native
placement/volume refusal must be full K2 HTTP 422
`MODEL_OUT_OF_PRINTER_BOUNDS`. J3 itself passed the owner exact-container matrix
on `58c0ccb`; exact local J3B passed 12/12 fixture checks, 4/4 selector checks,
and 37/37 HTTP cases. The owner later passed the production-identical VPS rerun
from exact tree `db42b93` after independently matching all 445 tracked files;
the separately built owner image ID is not byte-identical-image evidence. Read
`results/orientation_visibility_test_result.md`; never promote local unit
evidence to container, hosted, deployed, or live proof.

The J3B native envelope entry point is
`slicing/native_envelope_sweep_runner.py`. Sweep X, Y, and Z for P1S and
H2D-QUOTE on both engines and repeat the X/Y corner probe. Keep policy
prevalidation and native rejection distinct. Before requests, require the exact
catalogue-v2 `/profiles` phase guard: measurement A must expose declared
admission for H2D-QUOTE, while final-admission B must expose the published
largest-passing limits for all four engine/profile selectors. Every accepted
success and full K2 rejection must carry the exact expected response `max` and
`source_profile`; Prusa must report the actual layer-height INI selected by the
request, while Orca reports its stable machine profile rather than the process
profile. Fail closed on phase, selector, shape, or value drift. Read
`results/native_envelope_sweep_measurement_result.md` after measurement and
`results/native_envelope_sweep_result.md` after final admission. Measurement A
passed 44/44 native fixture preconditions, 10/10 brackets, and 2/2 combined
corners on its exact helper image; `325 mm` at `0.3 mm` returned the full K2
HTTP 422 twice on each engine after the exact conjunctive last-layer classifier.
Exact local final-admission B passed 88/88 fixture preconditions, 20/20
brackets, and 4/4 combined corners. It confirmed Prusa P1S
`256/256/249.9`, Orca P1S `253.9/253.9/249.9`, Prusa H2D-QUOTE
`350/320/324.9`, and Orca H2D-QUOTE `347.9/317.9/324.9`; the catalogue lane
passed 9/9 and its optional Prusa digest-parity check ran and passed. Preserve
the exact local mass check (`253 x 253 x 20`, Orca preserve, layer `0.3` =
`456.33 g`) and exact J2/B outer-wall footprint parity (`248.600 x 99.600 mm`,
500 segments, `x=3.700..252.300`, `y=78.200..177.800`). The owner VPS matrix on
exact tree `db42b93` independently confirmed all four inclusive selectors,
former native 500 cases as full K2 422, zero-normal false/null, distinct
applied/preserved/unchanged outcomes, the mass/no-yaw guards, and all three
enlarged Prusa layer profiles. Do not invent an owner image identity, promote
these results to deployment, or commit either generated report.

Operations checks must prove public /ready is minimal, protected diagnostics
return OPERATIONS_AUTH_REQUIRED without a key, and all outputs stay bounded and
secret/path/filename-safe.
