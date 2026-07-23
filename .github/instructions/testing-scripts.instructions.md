---
applyTo: "tests/testing-scripts/**"
---

# Testing Scripts Instructions

Last synchronized: 2026-07-23

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
- SLICE_SERVICE_API_KEY for matrix, queue, and unsupported-upload requests; send
  it only in x-slicer-api-key. The rate-limit regression intentionally omits it
  to prove exact pre-limit HTTP 401 responses before HTTP 429.
- ADMIN_API_KEY for admin endpoint tests

Service-auth negative cases must assert exact HTTP 401
`{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`.
