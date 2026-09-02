"""Run Orca FDM full API matrix for all files under tests/testing-files.

Materials cycle across PLA, PETG, ABS and TPU so every server-owned Orca
filament profile is exercised; each FDM success must now publish a positive
direct mass and a catalogue-priced quote (ABS/TPU are no longer manual), and
``stats.print_time_seconds`` is the total estimated time. One declared negative
request proves ``infill=140`` is rejected with ``400 INVALID_INFILL`` instead of
being clamped. Without a private corpus the synthetic fixture set is used.
"""

from __future__ import annotations

import sys
from pathlib import Path

_TESTING_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_TESTING_SCRIPTS))

from common.slice_matrix_runner import ORCA_SLICE_ENDPOINT, SliceScenario, run_scenario

SCRIPTS_ROOT = _TESTING_SCRIPTS

# (label, extra multipart fields, expected status, accepted error codes). The
# strict infill contract rejects out-of-range values instead of clamping them.
ORCA_NEGATIVE_REQUESTS = (
    ("infill 140 is rejected, never clamped", {"infill": "140"}, 400, ("INVALID_INFILL",)),
)

ORCA_FDM_SCENARIO = SliceScenario(
    key="orca_fdm",
    report_title="Full API Orca FDM Test Report",
    endpoint=ORCA_SLICE_ENDPOINT,
    technology="FDM",
    material="PLA",
    layer_heights=(0.1, 0.2, 0.3),
    report_filename="full_api_orca_fdm_test_result.md",
    legacy_report_files=(
        "full_api_orca_fdm_test_report.json",
        "full_api_orca_fdm_test_report.md",
    ),
    materials=("PLA", "PETG", "ABS", "TPU"),
    negative_requests=ORCA_NEGATIVE_REQUESTS,
)


def main() -> int:
    try:
        result = run_scenario(SCRIPTS_ROOT, ORCA_FDM_SCENARIO)
    except Exception as exc:
        print(f"[ORCA FDM TEST] ERROR: {exc}")
        return 1

    return 1 if result.failed_count > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
