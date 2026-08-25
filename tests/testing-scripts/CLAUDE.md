# Testing Scripts - Local Claude Guide

Last synchronized: 2026-08-25

## Scope

This folder contains API-level Python integration and workflow tests.

## Main Runner Groups

- `slicing/` — Full suite and slicer matrix runners
  - slicing/full_api_test_runner.py
  - slicing/full_api_orca_fdm_test_runner.py
  - slicing/full_api_prusa_fdm_test_runner.py
  - slicing/full_api_prusa_sl1_test_runner.py
  - slicing/unsupported_upload_test_runner.py

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
- Never print credential values in reports.

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
  `--arrange 1` / `--orient 0`; its result alone is not complete J0 response-
  contract evidence. Focused contracts cover the corrected placement/orientation
  and digest policy, and separate exact-image evidence covers startup version
  resolution plus the corrected HTTP transform/final-dimensions E2E. The final
  rebuilt image identity is not yet recorded; the Python matrix alone still
  does not establish these facts.
- The native Orca smoke accepts positive `G1 ... E` only after the exact
  `;BEFORE_LAYER_CHANGE` marker; prelude/purge extrusion does not establish
  model-layer extrusion.
- Keep the native Orca smoke split into its thin Docker orchestrator and
  side-effect-free fixture, container-script, and contract builders; preserve
  the bounded file/function guards and exact generated-script behavior.
- Filament-profile identity and `material_used_g` are W8
  `BLOCKED_OWNER_INPUT / NOT_STARTED`, not current test expectations.
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
