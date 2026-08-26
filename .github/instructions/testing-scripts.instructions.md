---
applyTo: "tests/testing-scripts/**"
---

# Testing Scripts Instructions

Last synchronized: 2026-08-25

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
- Never print any credential value in output or reports.

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
Filament-profile identity and
`material_used_g` are W8 `BLOCKED_OWNER_INPUT / NOT_STARTED`, not current
expectations.

Operations checks must prove public /ready is minimal, protected diagnostics
return OPERATIONS_AUTH_REQUIRED without a key, and all outputs stay bounded and
secret/path/filename-safe.
