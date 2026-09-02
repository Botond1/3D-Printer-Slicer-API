"""The Bambu reference comparison runner never prints the private models or
reference paths, even when the filesystem raises an ``OSError`` whose message
embeds the absolute path."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
RUNNER_PATH = REPOSITORY_ROOT / "tests" / "testing-scripts" / "calibration" / "bambu_reference_comparison_runner.py"


def load_runner():
    spec = importlib.util.spec_from_file_location("bambu_reference_runner_privacy", RUNNER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load the Bambu reference runner")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BambuReferenceRunnerPrivacyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.runner = load_runner()

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="bambu-reference-privacy-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.missing_models = self.root / "private-models-that-do-not-exist"
        self.reference = self.root / "meres.json"

    def assert_path_free(self, text: str) -> None:
        self.assertNotIn(str(self.root), text)
        self.assertNotIn("private-models-that-do-not-exist", text)
        self.assertNotIn("meres.json", text)

    def test_missing_models_dir_raises_a_fixed_path_free_reference_error(self) -> None:
        with self.assertRaises(self.runner.ReferenceFileError) as caught:
            self.runner.resolve_model_path(self.missing_models, "model.stl")
        self.assertEqual(str(caught.exception), "models directory is missing or unreadable")
        self.assert_path_free(str(caught.exception))
        self.assertIsInstance(caught.exception.__cause__, OSError)

    def test_missing_reference_file_raises_a_fixed_path_free_reference_error(self) -> None:
        models = self.root / "models"
        models.mkdir()
        with self.assertRaises(self.runner.ReferenceFileError) as caught:
            self.runner.load_reference(self.reference, models)
        self.assertEqual(str(caught.exception), "reference file is missing or too large")
        self.assert_path_free(str(caught.exception))

    def test_reference_pointing_at_a_missing_models_dir_stays_path_free(self) -> None:
        self.reference.write_text(
            json.dumps({"modellek": [{"fajl": "model.stl", "ido_perc": 42.5, "anyag_g": 12.3}]}),
            encoding="utf-8",
        )
        with self.assertRaises(self.runner.ReferenceFileError) as caught:
            self.runner.load_reference(self.reference, self.missing_models)
        self.assert_path_free(str(caught.exception))

    def run_main(self, argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), mock.patch.object(
            self.runner, "resolve_base_url", return_value="http://localhost:3000"
        ), mock.patch.object(
            self.runner, "resolve_slice_service_api_key", return_value="inert-test-key"
        ):
            code = self.runner.main(argv)
        return code, out.getvalue()

    def test_main_prints_only_a_fixed_reason_for_a_missing_models_dir(self) -> None:
        self.reference.write_text(
            json.dumps({"modellek": [{"fajl": "model.stl", "ido_perc": 42.5, "anyag_g": 12.3}]}),
            encoding="utf-8",
        )
        code, out = self.run_main(["--models-dir", str(self.missing_models), "--reference", str(self.reference)])
        self.assertEqual(code, 1)
        self.assertIn("reading file unusable: models directory is missing or unreadable", out)
        self.assert_path_free(out)

    def test_main_prints_only_the_error_class_for_an_unexpected_os_error(self) -> None:
        models = self.root / "models"
        models.mkdir()
        self.reference.write_text("{}", encoding="utf-8")
        leaking = PermissionError(13, "Permission denied", str(self.reference))
        with mock.patch.object(self.runner, "load_reference", side_effect=leaking):
            code, out = self.run_main(["--models-dir", str(models), "--reference", str(self.reference)])
        self.assertEqual(code, 1)
        self.assertIn("reading file unusable: PermissionError", out)
        self.assertNotIn("Permission denied", out)
        self.assert_path_free(out)


if __name__ == "__main__":
    unittest.main()
