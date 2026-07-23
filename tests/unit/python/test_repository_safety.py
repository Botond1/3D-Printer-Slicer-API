"""Focused policy tests for the Git-index repository safety guard."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from types import ModuleType


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
SAFETY_CORE = REPOSITORY_ROOT / "scripts" / "repository_safety.py"


def _load_safety_module() -> ModuleType:
    module_name = "repository_safety_unit_target"
    spec = importlib.util.spec_from_file_location(module_name, SAFETY_CORE)
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


class RepositorySafetyContentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.safety = _load_safety_module()

    def assert_secret_assignment(self, path: str, content: bytes) -> None:
        rules = {finding.rule_id for finding in self.safety.content_findings(path, content)}
        self.assertIn("HIGH_RISK_SECRET_ASSIGNMENT", rules)

    def assert_no_secret_assignment(self, path: str, content: bytes) -> None:
        rules = {finding.rule_id for finding in self.safety.content_findings(path, content)}
        self.assertNotIn("HIGH_RISK_SECRET_ASSIGNMENT", rules)

    def test_mixed_case_credential_names_are_detected(self) -> None:
        candidates = (
            b'api_key = "s0-inert-sensitive-value"\n',
            b'export Password="s0-inert-sensitive-value"\n',
            b'const Client_Secret = "s0-inert-sensitive-value";\n',
        )

        for content in candidates:
            with self.subTest(content=content):
                self.assert_secret_assignment("candidate.env", content)

    def test_former_placeholder_prefixes_are_not_blanket_exempt(self) -> None:
        prefixes = ("test", "dummy", "example", "inert", "placeholder")
        for prefix in prefixes:
            with self.subTest(prefix=prefix):
                content = f'api_key="{prefix}-not-an-approved-sentinel"\n'.encode()
                self.assert_secret_assignment("candidate.env", content)

    def test_literal_plus_interpolation_is_detected(self) -> None:
        candidates = (
            ("candidate.env", b'api_key="static-fragment-${ADMIN_API_KEY}"\n'),
            (
                "candidate.js",
                b'const CLIENT_SECRET = `static-fragment-${process.env.CLIENT_SECRET}`;\n',
            ),
        )

        for path, content in candidates:
            with self.subTest(path=path):
                self.assert_secret_assignment(path, content)

    def test_function_wrapped_literal_is_detected(self) -> None:
        self.assert_secret_assignment(
            "candidate.js",
            b'const CLIENT_SECRET = loadSecret("not-an-approved-literal");\n',
        )

    def test_pure_runtime_references_remain_allowed(self) -> None:
        candidates = (
            ("candidate.env", b'api_key=${ADMIN_API_KEY}\n'),
            ("candidate.js", b'password = process.env.PASSWORD\n'),
            ("candidate.py", b'client_secret = getenv("CLIENT_SECRET")\n'),
            ("candidate.py", b'layer_token = normalize_layer_height(layer_height)\n'),
            (
                "candidate.py",
                b'admin_api_key = environment["ADMIN_API_KEY"] or TEST_ADMIN_API_KEY\n',
            ),
            ("candidate.yaml", b'client_secret: ${{ secrets.CLIENT_SECRET }}\n'),
        )

        for path, content in candidates:
            with self.subTest(path=path, content=content):
                self.assert_no_secret_assignment(path, content)

    def test_no_literal_credential_assignment_is_exempt_in_env_example(self) -> None:
        candidates = (
            b"ADMIN_API_KEY=exampleKEY-6.7.\n",
            b"ADMIN_API_KEY=example-not-an-approved-sentinel\n",
            b"SLICE_SERVICE_API_KEY=example-inert-slice-service-key-000000000001\n",
            b"SLICE_SERVICE_API_KEY=example-inert-slice-service-key-000000000002\n",
        )
        for content in candidates:
            with self.subTest(content=content):
                self.assert_secret_assignment(".env.example", content)

    def test_structured_and_unquoted_literals_are_detected(self) -> None:
        candidates = (
            ("candidate.yaml", b'api_key: "s0-inert-sensitive-value"\n'),
            ("candidate.env", b"api_key=s0-inert-[sensitive]-value\n"),
            ("candidate.yaml", b"password: s0-inert-sensitive(value)\n"),
        )

        for path, content in candidates:
            with self.subTest(path=path):
                self.assert_secret_assignment(path, content)

    def test_private_key_marker_is_detected_from_inert_fragments(self) -> None:
        marker = b"-----" + b"BEGIN " + b"PRIVATE KEY" + b"-----"
        rules = {
            finding.rule_id
            for finding in self.safety.content_findings("candidate.txt", marker)
        }
        self.assertIn("PRIVATE_KEY_MARKER", rules)

    def test_path_policy_is_narrow_and_preserves_only_exact_sentinels(self) -> None:
        forbidden = {
            ".env": "FORBIDDEN_ENV_FILE",
            ".env.local": "FORBIDDEN_ENV_FILE",
            "input/model.stl": "FORBIDDEN_RUNTIME_INPUT",
            "output/model.gcode": "FORBIDDEN_RUNTIME_OUTPUT",
            "tests/testing-files/private.stl": "FORBIDDEN_PRIVATE_TEST_FIXTURE",
            "tests/testing-scripts/results/report.md": "FORBIDDEN_GENERATED_REPORT",
        }
        for path, expected_rule in forbidden.items():
            with self.subTest(path=path):
                rules = {finding.rule_id for finding in self.safety.path_policy_findings(path)}
                self.assertIn(expected_rule, rules)

        allowed = (
            ".env.example",
            "input/.gitkeep",
            "output/.gitkeep",
            "tests/testing-files/.gitkeep",
            "tests/testing-scripts/results/.gitkeep",
        )
        for path in allowed:
            with self.subTest(path=path):
                self.assertEqual(self.safety.path_policy_findings(path), [])


if __name__ == "__main__":
    unittest.main()
