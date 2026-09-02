---
applyTo: "tests/testing-scripts/**"
---

# Testing Scripts Instructions

Last synchronized: 2026-09-02

## Test Entry Points
- slicing/full_api_test_runner.py
- slicing/full_api_orca_fdm_test_runner.py
- slicing/full_api_prusa_fdm_test_runner.py
- slicing/full_api_prusa_sl1_test_runner.py
- slicing/full_api_bambu_fdm_test_runner.py
- slicing/bambu_envelope_confirmation_runner.py
- slicing/unsupported_upload_test_runner.py
- slicing/orientation_visibility_test_runner.py
- slicing/native_envelope_sweep_runner.py
- render/render_preview_test_runner.py
- calibration/bambu_reference_comparison_runner.py (owner-run, private inputs)
- admin/admin_output_files_test_runner.py
- pricing/pricing_cycle_test_runner.py
- rate_limit/rate_limit_regression_test_runner.py
- queue/queue_concurrency_test_runner.py
- operations/operations_readiness_metrics_test_runner.py
- profiles/profile_catalogue_test_runner.py

## Reporting Rules
- Write reports to tests/testing-scripts/results/.
- After running tests, read markdown reports and summarize outcomes.
- The queue capacity runner is the exception: read its explicit create-new
  `--report` path and preserve its `--cleanup-manifest`.

## Execution Rules
- Prefer Docker-based API runtime for endpoint integration checks; behavior
  that depends on the slicer binaries is proven only on the built image.
- Keep queue/rate-limit regression checks in dedicated runners.
- Keep focused runners small; split complex runners by domain instead of adding unrelated checks.
- Keep stable deterministic runners unchanged unless endpoint behavior changes.
- Full slice matrix reports may mark explicitly declared fail-fast rejections
  as passing only when status and `errorCode` match the expected case exactly
  (for example Orca `infill=140` -> `400 INVALID_INFILL`).
- Queue concurrency reports use staggered completion as the black-box signal
  for serialized queue processing; client start-order matching is informational.
- Runners pace slice-service requests at 20 s and retry HTTP 429 with the
  advertised `Retry-After` (limiter: 3 per 60 s sustained, burst 5, per
  principal with IP fallback).
- `common/synthetic_fixtures.py` supplies deterministic privacy-safe STL/OBJ/
  ZIP fixtures whenever the gitignored `tests/testing-files` corpus is absent;
  `common/runner_support.py` holds the shared 429-aware slice POST, target
  redaction, and the optional `placement_mm` check.

## Environment Inputs
- SLICER_BASE_URL
- `SLICER_NATIVE_INFO_COMMAND_JSON` optionally supplies a bounded JSON argv
  template for the orientation/envelope native-info precondition (no shell,
  no credentials, only a source label in the report).
- `SLICE_SERVICE_API_KEY` is the runner input for slice, render, Bambu,
  envelope, calibration, queue, and unsupported-upload requests; send it only
  in `x-slicer-api-key`. Helpers never infer server slice mode, never add a
  second header, and never re-enable a server shared slot. The rate-limit
  regression intentionally omits it to prove exact pre-limit HTTP 401 before 429.
- PRICING_API_KEY for pricing lifecycle tests.
- ARTIFACT_API_KEY for output listing/download tests and the optional
  `.gcode.3mf` retention check of the Bambu matrix.
- OPERATIONS_API_KEY for detailed health/readiness/metrics tests.
- Never print any credential value in output or reports; pass authentication
  headers through the stdin-backed curl helper (`-H @-`).

## Contract Expectations
- Success assertions require machine-readable `engine_version`, lowercase
  64-hex `profiles.effective_profile_sha256`, `supports`, the schema-2
  `model_transform`, inclusive `build_volume_limits_mm.max`, and
  `stats.object_height_mm == final_dimensions_mm.z`. FDM successes on every
  engine require a positive direct mass and a catalogue-priced integer quote
  (Orca ABS/TPU included); SLA successes require null mass, hourly rate, and
  price. Bounds failures require `model_dimensions_mm`,
  `build_volume_limits_mm`, and the same transform.
- The Bambu matrix covers P1S x {0.12, 0.2, 0.28} x {PLA, PETG, ABS, TPU},
  H2D x 0.2 x PLA, the L-bracket with `supports=true|false`, one identical
  request pair proving a stable digest, and the strict rejections
  (`layerHeight=0.3`, `infill=140`, `printerProfile=X1C`, `supports=maybe`,
  `material=Standard`). Every success publishes `build_volume_limits_mm.max`
  equal to the measured envelope; `placement_mm`, when present, is a numeric
  `{x_min, y_min}` pair.
- The Bambu envelope confirmation uploads exact-edge cuboids in `preserve`
  mode: P1S `256 x 228 x 250` and the alternative `238 x 256` footprint pass,
  H2D `325 x 320 x 325` passes, `+0.1 mm` on any axis and P1S `256 x 256`
  return 422 `MODEL_OUT_OF_PRINTER_BOUNDS`, and the bambu catalogue rows
  publish the same triples.
- The render runner proves `image/png`, a 1024 x 768 IHDR, byte-identical
  PNGs for identical requests, a different PNG for `rotationZ=90`, and the
  exact 400/401 rejections.
- The calibration runner is owner-run only: models and readings are private;
  reports identify models by index and SHA-256 prefix; PASS means
  `max(|dt%|, |dg%|) <= 10`. The recorded 2026-09-02 result is -1.1..+0.1 %
  time and 0..0.2 % mass (supports off) on the ten reference models.
- The profile-catalogue runner proves public 200, exact FDM-only
  `r3d-profile-catalogue-v2` shape, canonical body digest, strong ETag/304,
  the 82-row generation (6 Prusa, 24 Orca, 28 Bambu P1S, 24 Bambu H2D), three
  engine-scoped fleets (bambu H2D, orca and prusa H2D-QUOTE), separate
  declared and inclusive dimensions, no cross-engine merge, no manual fleet
  maximum, and no generic SLA fallback machine. The retired 18-row set is
  recognised by name only so a regression is reported explicitly. The
  optional `--verify-prusa-slice-parity` lane binds one live Prusa digest to
  its catalogue entry.
- `GET /admin/output-files` may list `.gcode`, `.sl1`, and `.gcode.3mf` names only.
- Service-auth negative cases must assert exact HTTP 401
  `{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`.
- Principal migration coverage keeps `x-slicer-api-key` as the only slice
  header and never makes the service accept both slice and admin readers.
- Operations checks must prove public /ready is minimal, protected diagnostics
  return OPERATIONS_AUTH_REQUIRED without a key, and all outputs stay bounded and
  secret/path/filename-safe.
- The orientation runner (37 HTTP cases, both engines, `auto`/`preserve`,
  request-rotation composition, success and full K2 bounds parity, the
  separate legal zero-normal regression) and the native envelope sweep
  (measurement A / final-admission B phases behind the exact `/profiles`
  guard, exact expected `max` and `source_profile`) keep their J3B contracts;
  their historical results are recorded in `docs/codex/history-waves.md` and
  `docs/codex/evidence/`. Never commit generated reports.
