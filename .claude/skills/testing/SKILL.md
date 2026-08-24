---
name: testing
description: Execute Python-based validation and regression test suites for the 3D Printer Slicer API (Prusa/Orca). Use this when asked to run tests, verify endpoint behavior, check queue concurrency, or validate pricing lifecycles.
---

Use this skill whenever API endpoints, slicing logic, pricing, or queue concurrency needs to be tested.

Slash entrypoint:
- Use `/testing` to run the repository test workflow and summarize markdown report evidence.

Full agent definitions with scope, responsibilities, hard rules, and scope boundaries are mirrored in `.github/agents/test-engineer.md` and `.claude/agents/test-engineer.md`.
Read that file for complete context when writing new tests or extending existing ones.

## Quick Command Reference

1. Full suite wrapper
   - Command: `python tests/testing-scripts/slicing/full_api_test_runner.py`
   - Report: `tests/testing-scripts/results/full_api_test_result.md`

2. Engine-specific matrix runners
   - Orca FDM: `python tests/testing-scripts/slicing/full_api_orca_fdm_test_runner.py`
   - Prusa FDM: `python tests/testing-scripts/slicing/full_api_prusa_fdm_test_runner.py`
   - Prusa SLA: `python tests/testing-scripts/slicing/full_api_prusa_sl1_test_runner.py`

3. Isolated feature tests
   - Unsupported upload rejection: `python tests/testing-scripts/slicing/unsupported_upload_test_runner.py`
   - Pricing lifecycle: `python tests/testing-scripts/pricing/pricing_cycle_test_runner.py`
   - Admin output listing: `python tests/testing-scripts/admin/admin_output_files_test_runner.py`
   - Rate-limit regression: `python tests/testing-scripts/rate_limit/rate_limit_regression_test_runner.py`

4. Queue and concurrency test
   - Command: `python tests/testing-scripts/queue/queue_concurrency_test_runner.py --count N --expected-max-concurrent N --retry-on-429 1 --cleanup-manifest NEW_MANIFEST_PATH --report NEW_REPORT_PATH`
   - N must be 1..3. The manifest and report are mandatory create-new targets;
     the runner requires fresh queue state and an exactly empty artifact
     inventory before load.

## Execution Workflow

1. Identify which subsystem must be validated.
2. Run the exact matching test script.
3. Wait for completion.
4. Immediately read the generated report in `tests/testing-scripts/results/`.
5. Summarize pass/fail details and notable findings.

For I12 Hostinger capacity qualification, read the explicit `--report` path
instead of the normal results directory. The producer must run as the dynamic
non-root service identity through `scripts/i12-capacity-producer-exec.py` and
four root:root 0600 credential files; secret values must never enter argv.
Preserve the cleanup manifest, stop and verify the API, then use the same exact
image's network-none cleanup consumer according to `ops/hostinger/RUNBOOK.md`;
cleanup success never changes a failed result.

## Troubleshooting

- If capacity preflight fails, verify the slice, operations, and artifact
  audience keys and confirm the managed-artifact inventory is exactly empty.
- If slice tests fail with connection errors, verify API health endpoint before rerun.
- If a slice matrix row returns non-2xx but is marked successful, verify the report's `Expected`, `Status`, and `ErrorCode` columns match an explicitly declared fail-fast outcome.

## Validation Checklist

- [ ] Chosen runner matches requested behavior scope.
- [ ] Corresponding markdown report was read after execution.
- [ ] Capacity evidence used explicit expected concurrency plus create-new
      manifest/report targets and preserved the post-run cleanup boundary.
- [ ] Summary includes failures, retries, and key diagnostics.
