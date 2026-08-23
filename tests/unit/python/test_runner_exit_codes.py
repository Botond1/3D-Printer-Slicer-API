"""Unit coverage for slicing runner exit-code semantics."""

from __future__ import annotations

import importlib.util
import io
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest import mock


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
RUNNER_ROOT = REPOSITORY_ROOT / "tests" / "testing-scripts" / "slicing"
FOCUSED_RUNNER_FILES = (
    "full_api_orca_fdm_test_runner.py",
    "full_api_prusa_fdm_test_runner.py",
    "full_api_prusa_sl1_test_runner.py",
)


def _load_runner(module_name: str, filename: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(module_name, RUNNER_ROOT / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load runner: {filename}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RunnerExitCodeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.full_runner = _load_runner(
            "runner_exit_codes_full_api",
            "full_api_test_runner.py",
        )
        cls.focused_runners = {
            "orca_fdm": _load_runner(
                "runner_exit_codes_orca_fdm",
                "full_api_orca_fdm_test_runner.py",
            ),
            "prusa_fdm": _load_runner(
                "runner_exit_codes_prusa_fdm",
                "full_api_prusa_fdm_test_runner.py",
            ),
            "prusa_sl1": _load_runner(
                "runner_exit_codes_prusa_sl1",
                "full_api_prusa_sl1_test_runner.py",
            ),
        }

    def test_focused_runners_return_zero_when_scenarios_pass(self) -> None:
        for name, runner in self.focused_runners.items():
            with self.subTest(runner=name):
                result = SimpleNamespace(failed_count=0)
                with mock.patch.object(runner, "run_scenario", return_value=result):
                    with redirect_stdout(io.StringIO()):
                        exit_code = runner.main()

                self.assertEqual(exit_code, 0)

    def test_focused_runners_return_nonzero_when_scenarios_fail(self) -> None:
        for name, runner in self.focused_runners.items():
            with self.subTest(runner=name):
                result = SimpleNamespace(failed_count=1)
                with mock.patch.object(runner, "run_scenario", return_value=result):
                    with redirect_stdout(io.StringIO()):
                        exit_code = runner.main()

                self.assertNotEqual(exit_code, 0)

    def test_combined_runner_returns_zero_when_all_scenarios_pass(self) -> None:
        self.assertEqual(self._run_combined_runner((0, 0, 0)), 0)

    def test_combined_runner_returns_nonzero_when_any_scenario_fails(self) -> None:
        self.assertNotEqual(self._run_combined_runner((0, 1, 0)), 0)

    def test_runner_entrypoints_propagate_success_to_process_exit(self) -> None:
        cases = (("full_api_test_runner.py", (0, 0, 0)),) + tuple(
            (filename, (0,)) for filename in FOCUSED_RUNNER_FILES
        )
        for filename, failed_counts in cases:
            with self.subTest(runner=filename):
                self.assertEqual(
                    self._run_entrypoint_process(filename, failed_counts),
                    0,
                )

    def test_runner_entrypoints_propagate_failure_to_process_exit(self) -> None:
        cases = (("full_api_test_runner.py", (0, 1, 0)),) + tuple(
            (filename, (1,)) for filename in FOCUSED_RUNNER_FILES
        )
        for filename, failed_counts in cases:
            with self.subTest(runner=filename):
                self.assertNotEqual(
                    self._run_entrypoint_process(filename, failed_counts),
                    0,
                )

    def _run_combined_runner(self, failed_counts: tuple[int, ...]) -> int:
        scenario_results = [
            SimpleNamespace(total=1, failed_count=failed_count)
            for failed_count in failed_counts
        ]

        with tempfile.TemporaryDirectory() as temporary_directory:
            results_dir = Path(temporary_directory) / "results"
            report_path = results_dir / "full_api_test_result.md"

            with (
                mock.patch.object(self.full_runner, "RESULTS_DIR", results_dir),
                mock.patch.object(self.full_runner, "REPORT_PATH", report_path),
                mock.patch.object(self.full_runner, "LEGACY_REPORT_FILES", ()),
                mock.patch.object(
                    self.full_runner,
                    "run_scenario",
                    side_effect=scenario_results,
                ) as run_scenario,
                mock.patch.object(
                    self.full_runner,
                    "build_suite_summary_markdown",
                    return_value="# Temporary test report\n",
                ),
                redirect_stdout(io.StringIO()),
            ):
                exit_code = self.full_runner.main()

            self.assertEqual(run_scenario.call_count, len(failed_counts))
            self.assertEqual(
                report_path.read_text(encoding="utf-8"),
                "# Temporary test report\n",
            )

        return exit_code

    def _run_entrypoint_process(
        self,
        filename: str,
        failed_counts: tuple[int, ...],
    ) -> int:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            slicing_root = temporary_root / "slicing"
            common_root = temporary_root / "common"
            slicing_root.mkdir()
            common_root.mkdir()
            (common_root / "__init__.py").write_text("", encoding="utf-8")

            runner_path = slicing_root / filename
            shutil.copyfile(RUNNER_ROOT / filename, runner_path)
            (common_root / "slice_matrix_runner.py").write_text(
                self._stub_matrix_runner_source(failed_counts),
                encoding="utf-8",
            )

            environment = os.environ.copy()
            environment["PYTHONDONTWRITEBYTECODE"] = "1"
            completed = subprocess.run(
                [sys.executable, str(runner_path)],
                cwd=temporary_root,
                env=environment,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=10,
            )
            self.assertEqual(completed.stderr, "", completed.stderr)
            return completed.returncode

    @staticmethod
    def _stub_matrix_runner_source(failed_counts: tuple[int, ...]) -> str:
        return f'''from types import SimpleNamespace

ORCA_SLICE_ENDPOINT = "/stub/orca"
PRUSA_SLICE_ENDPOINT = "/stub/prusa"
_FAILED_COUNTS = {list(failed_counts)!r}

class _Record:
    def __init__(self, **fields):
        self.__dict__.update(fields)

ExpectedFailure = _Record
SliceScenario = _Record

def run_scenario(*_args, **_kwargs):
    return SimpleNamespace(total=1, failed_count=_FAILED_COUNTS.pop(0))

def build_suite_summary_markdown(**_kwargs):
    return "# Temporary process report\\n"
'''


if __name__ == "__main__":
    unittest.main()
