"""Unit coverage for the staged/tracked repository safety guard."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from types import ModuleType


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
SAFETY_SCRIPT = REPOSITORY_ROOT / "scripts" / "validate-repository-safety.py"


def _load_safety_module() -> ModuleType:
    module_name = "repository_safety_unit_target"
    spec = importlib.util.spec_from_file_location(module_name, SAFETY_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load repository safety validator.")

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(module_name, None)
        raise
    return module


class RepositorySafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.safety = _load_safety_module()

    def test_lowercase_and_mixed_case_credential_assignments_are_detected(self) -> None:
        candidates = (
            b'api_key = "s0-inert-sensitive-value"\n',
            b'export Password="s0-inert-sensitive-value"\n',
            b'const Client_Secret = "s0-inert-sensitive-value";\n',
        )

        for content in candidates:
            with self.subTest(content=content):
                findings = self.safety.content_findings("candidate.env", content)
                self.assertIn(
                    "HIGH_RISK_SECRET_ASSIGNMENT",
                    {finding.rule_id for finding in findings},
                )

    def test_placeholder_and_environment_references_are_not_reported(self) -> None:
        candidates = (
            ("candidate.env", b'api_key = "test-placeholder-value"\n'),
            ("candidate.js", b'password = process.env.PASSWORD\n'),
            ("candidate.py", b'client_secret = getenv("CLIENT_SECRET")\n'),
            ("candidate.py", b'layer_token = normalize_layer_height(layer_height)\n'),
            (
                "candidate.py",
                b'admin_api_key = environment["ADMIN_API_KEY"] or TEST_ADMIN_API_KEY\n',
            ),
        )

        for path, content in candidates:
            with self.subTest(path=path, content=content):
                findings = self.safety.content_findings(path, content)
                self.assertNotIn(
                    "HIGH_RISK_SECRET_ASSIGNMENT",
                    {finding.rule_id for finding in findings},
                )

    def test_structured_lowercase_credential_name_is_detected(self) -> None:
        findings = self.safety.content_findings(
            "candidate.yaml",
            b'api_key: "s0-inert-sensitive-value"\n',
        )
        self.assertIn(
            "HIGH_RISK_SECRET_ASSIGNMENT",
            {finding.rule_id for finding in findings},
        )

    def test_unquoted_env_and_yaml_literals_with_expression_characters_are_detected(self) -> None:
        candidates = (
            ("candidate.env", b'api_key=s0-inert-[sensitive]-value\n'),
            ("candidate.yaml", b'password: s0-inert-sensitive(value)\n'),
        )

        for path, content in candidates:
            with self.subTest(path=path):
                findings = self.safety.content_findings(path, content)
                self.assertIn(
                    "HIGH_RISK_SECRET_ASSIGNMENT",
                    {finding.rule_id for finding in findings},
                )


if __name__ == "__main__":
    unittest.main()
