"""Regression coverage for fail-closed Python discovery and syntax gates."""

from __future__ import annotations

import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest import mock


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
PYTHON_TEST_RUNNER = REPOSITORY_ROOT / "scripts" / "run-python-tests.py"
PYTHON_SYNTAX_VALIDATOR = REPOSITORY_ROOT / "scripts" / "validate-python-syntax.py"


def _load_module(module_name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {path.name}.")

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(module_name, None)
        raise
    return module


class PythonTestRunnerTests(unittest.TestCase):
    def _run_runner(self, start_directory: Path) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        return subprocess.run(
            [
                sys.executable,
                str(PYTHON_TEST_RUNNER),
                "--start-directory",
                str(start_directory),
            ],
            cwd=REPOSITORY_ROOT,
            env=environment,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=10,
        )

    def test_nonempty_passing_suite_reports_truthful_counts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            (root / "test_passing.py").write_text(
                "import unittest\n\n"
                "class PassingTest(unittest.TestCase):\n"
                "    def test_passes(self):\n"
                "        self.assertTrue(True)\n",
                encoding="utf-8",
            )

            completed = self._run_runner(root)

            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertIn(
                "discovered=1 run=1 passed=1 failed=0 errors=0 skipped=0",
                completed.stderr,
            )
            self.assertFalse(any(root.rglob("__pycache__")))
            self.assertFalse(any(root.rglob("*.pyc")))

    def test_empty_suite_is_an_expected_fail_closed_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            completed = self._run_runner(root)

            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("no tests were discovered", completed.stderr)
            self.assertIn(
                "discovered=0 run=0 passed=0 failed=0 errors=0 skipped=0",
                completed.stderr,
            )

    def test_failure_and_import_error_exit_nonzero_with_counts(self) -> None:
        cases = {
            "failure": (
                "import unittest\n\n"
                "class FailingTest(unittest.TestCase):\n"
                "    def test_fails(self):\n"
                "        self.fail('intentional inert failure')\n",
                "failed=1 errors=0",
            ),
            "import_error": (
                "raise RuntimeError('intentional inert import failure')\n",
                "failed=0 errors=1",
            ),
        }

        for name, (source, expected_counts) in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                (root / f"test_{name}.py").write_text(source, encoding="utf-8")
                completed = self._run_runner(root)

                self.assertNotEqual(completed.returncode, 0)
                self.assertIn(expected_counts, completed.stderr)


class PythonSyntaxGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.validator = _load_module(
            "python_syntax_validation_unit_target",
            PYTHON_SYNTAX_VALIDATOR,
        )

    def test_empty_python_syntax_scope_is_an_expected_fail_closed_mutation(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()
        validator = mock.Mock()

        exit_code = self.validator.validate_python_files(
            REPOSITORY_ROOT,
            [],
            validator=validator,
            stdout=stdout,
            stderr=stderr,
        )

        self.assertEqual(exit_code, 1)
        self.assertIn("no applicable tracked files", stderr.getvalue())
        validator.assert_not_called()

    def test_explicit_nonempty_python_syntax_scope_is_validated(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()
        validator = mock.Mock()

        exit_code = self.validator.validate_python_files(
            REPOSITORY_ROOT,
            ["synthetic.py"],
            validator=validator,
            stdout=stdout,
            stderr=stderr,
        )

        self.assertEqual(exit_code, 0)
        validator.assert_called_once_with(REPOSITORY_ROOT, "synthetic.py")
        self.assertIn("1 tracked file(s)", stdout.getvalue())
        self.assertEqual(stderr.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
