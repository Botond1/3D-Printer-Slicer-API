"""End-to-end Git-index selection tests for the repository safety guard."""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
SAFETY_CORE = REPOSITORY_ROOT / "scripts" / "repository_safety.py"
SAFETY_CLI = REPOSITORY_ROOT / "scripts" / "validate-repository-safety.py"


def _load_safety_module() -> ModuleType:
    module_name = "repository_safety_scope_target"
    spec = importlib.util.spec_from_file_location(module_name, SAFETY_CORE)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load repository safety core.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(module_name, None)
        raise
    return module


class RepositorySafetyScopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.safety = _load_safety_module()

    def setUp(self) -> None:
        self._temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self._temporary_directory.name)
        self.git_environment = os.environ.copy()
        self.git_environment["GIT_CONFIG_GLOBAL"] = os.devnull
        self.git_environment["GIT_CONFIG_SYSTEM"] = os.devnull
        self.git_environment["PYTHONDONTWRITEBYTECODE"] = "1"
        self._git("init", "--quiet")
        self._git("config", "user.name", "S0.1 Inert Test")
        self._git("config", "user.email", "s0.1-inert@example.invalid")

    def tearDown(self) -> None:
        self._temporary_directory.cleanup()

    def _git(self, *arguments: str) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            ["git", *arguments],
            cwd=self.root,
            env=self.git_environment,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )

    def _write(self, relative_path: str, content: bytes) -> None:
        target = self.root.joinpath(*relative_path.split("/"))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    def _run_cli(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SAFETY_CLI), *arguments],
            cwd=self.root,
            env=self.git_environment,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=15,
        )

    def test_inspect_uses_selected_index_blobs_for_tracked_and_staged_scopes(self) -> None:
        self._write("safe.env", b"api_key=${ADMIN_API_KEY}\n")
        self._git("add", "--", "safe.env")
        self._git("commit", "--quiet", "-m", "inert baseline")

        tracked_findings, tracked_count = self.safety.inspect(
            "tracked",
            require_nonempty=True,
            root=str(self.root),
        )
        self.assertEqual(tracked_findings, [])
        self.assertEqual(tracked_count, 1)

        staged_findings, staged_count = self.safety.inspect(
            "staged",
            root=str(self.root),
        )
        self.assertEqual(staged_findings, [])
        self.assertEqual(staged_count, 0)

        required_findings, required_count = self.safety.inspect(
            "staged",
            require_nonempty=True,
            root=str(self.root),
        )
        self.assertEqual(required_count, 0)
        self.assertEqual(
            required_findings,
            [self.safety.Finding("<staged>", "EMPTY_SCOPE")],
        )

        allowed_empty = self._run_cli("--scope", "staged")
        self.assertEqual(allowed_empty.returncode, 0, allowed_empty.stderr)
        required_empty = self._run_cli("--scope", "staged", "--require-nonempty")
        self.assertEqual(required_empty.returncode, 1)
        self.assertIn("rule=EMPTY_SCOPE", required_empty.stderr)

        self._write("safe.env", b"api_key=test-unstaged-not-approved\n")
        index_findings, _ = self.safety.inspect("tracked", root=str(self.root))
        self.assertEqual(index_findings, [], "inspect() must read index blobs, not worktree bytes")

        self._write("candidate.env", b"api_key=test-staged-not-approved\n")
        self._git("add", "--", "candidate.env")
        staged_findings, staged_count = self.safety.inspect(
            "staged",
            require_nonempty=True,
            root=str(self.root),
        )
        self.assertEqual(staged_count, 1)
        self.assertEqual(
            staged_findings,
            [self.safety.Finding("candidate.env", "HIGH_RISK_SECRET_ASSIGNMENT")],
        )

    def test_end_to_end_policy_rules_and_redacted_output(self) -> None:
        private_marker = b"-----" + b"BEGIN " + b"PRIVATE KEY" + b"-----"
        synthetic_value = b"test-" + b"not-an-approved-value"
        files = {
            ".env": b"PORT=3000\n",
            "input/model.stl": b"inert model fixture\n",
            "output/model.gcode": b"inert output fixture\n",
            "tests/testing-files/private.stl": b"inert private fixture\n",
            "tests/testing-scripts/results/report.md": b"inert generated report\n",
            "candidate.env": b"api_key=" + synthetic_value + b"\n",
            "private-marker.txt": private_marker,
            "oversized.bin": b"x" * (self.safety.MAX_FILE_BYTES + 1),
        }
        for path, content in files.items():
            self._write(path, content)
        self._git("add", "--all")

        findings, scanned_count = self.safety.inspect(
            "staged",
            require_nonempty=True,
            root=str(self.root),
        )
        rules = {finding.rule_id for finding in findings}
        self.assertEqual(scanned_count, len(files))
        self.assertTrue(
            {
                "FORBIDDEN_ENV_FILE",
                "FORBIDDEN_RUNTIME_INPUT",
                "FORBIDDEN_RUNTIME_OUTPUT",
                "FORBIDDEN_PRIVATE_TEST_FIXTURE",
                "FORBIDDEN_GENERATED_REPORT",
                "HIGH_RISK_SECRET_ASSIGNMENT",
                "PRIVATE_KEY_MARKER",
                "FILE_EXCEEDS_1_MIB",
            }.issubset(rules)
        )

        completed = self._run_cli("--scope", "staged", "--require-nonempty")
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(completed.stdout, "")
        self.assertNotIn(synthetic_value.decode(), completed.stderr)
        self.assertIn("path=", completed.stderr)
        self.assertIn("rule=", completed.stderr)


if __name__ == "__main__":
    unittest.main()
