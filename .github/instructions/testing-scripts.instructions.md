---
applyTo: "tests/testing-scripts/**"
---

# Testing Scripts Instructions

Last synchronized: 2026-08-26

## Test Entry Points
- slicing/full_api_test_runner.py
- slicing/full_api_orca_fdm_test_runner.py
- slicing/full_api_prusa_fdm_test_runner.py
- slicing/full_api_prusa_sl1_test_runner.py
- slicing/unsupported_upload_test_runner.py
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

The profile-catalogue runner must prove public 200, exact FDM-only v1 shape,
canonical body digest, strong ETag/304, and every per-printer/per-engine preset
row. It must independently rederive `machine_resolutions` and
`fleet_resolutions` per technology: FDM P1S engines currently agree at
`256 x 256 x 250 mm`; a mutated cross-engine conflict keeps all rows, publishes only that technology/printer pair as
excluded/null/`cross_engine_conflict`, repeats the exclusion in the fleet view,
and never selects component-wise smaller values. H2D remains the current
machine-attributed maximum at `350 x 320 x 325 mm`; a conflicting largest
machine must narrow the ceiling to a remaining resolved real machine. It must
reject intra-engine preset drift and any manual maximum field. It must prove the
generic
`120 x 120 x 150 mm` SLA fallback is absent as a machine envelope and must not
fabricate Elegoo Saturn 4 Ultra dimensions. A mixed synthetic FDM/SLA contract
must prove that each technology resolves independently in the same v1 schema.
It must also prove bounded generic
`engine`, generic endpoint plus ordered
`slice_selector.parameters[{name,value}]`, ordered path-free
`profile_components[{role,basename,selector_parameter}]`, exact nullable
component-to-selector bindings, exact
`effective_profile_identity_schema: r3d-effective-slice-profile-v2`, and
`build_volume_limits_mm.max_source_kind: profile-explicit`; `min` is not machine
metadata. This shape can later admit a real SLA row without a
schema-version change. Its optional
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
snapshot/flattened-parent lineage, or Orca `--arrange 1` / `--orient 0`; do not
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

Operations checks must prove public /ready is minimal, protected diagnostics
return OPERATIONS_AUTH_REQUIRED without a key, and all outputs stay bounded and
secret/path/filename-safe.
