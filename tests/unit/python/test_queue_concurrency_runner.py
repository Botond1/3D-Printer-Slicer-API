"""Unit and mutation coverage for bounded queue capacity qualification."""

from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest import mock


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS_ROOT = REPOSITORY_ROOT / "tests" / "testing-scripts"
RUNNER_PATH = SCRIPTS_ROOT / "queue" / "queue_concurrency_test_runner.py"
UTILS_PATH = SCRIPTS_ROOT / "common" / "queue_concurrency_utils.py"
MANIFEST_PATH = SCRIPTS_ROOT / "common" / "queue_cleanup_manifest.py"
sys.path.insert(0, str(SCRIPTS_ROOT))

from common import queue_concurrency_utils as queue_utils  # noqa: E402
from common import queue_cleanup_manifest as manifest_module  # noqa: E402
from common import queue_concurrency_reporting as reporting_module  # noqa: E402
from common import http_utils  # noqa: E402
from common.queue_cleanup_manifest import CleanupPair  # noqa: E402


def load_runner() -> ModuleType:
    spec = importlib.util.spec_from_file_location("queue_concurrency_runner_tests", RUNNER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load queue concurrency runner")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def observation(active: int, queued: int, maximum: int = 1) -> queue_utils.QueueObservation:
    return queue_utils.QueueObservation(
        200, True, "ok", queued, active, maximum, True,
    )


def request_result(index: int, *, success: bool = True, identity: bool = True):
    return queue_utils.QueueRequestResult(
        index=index,
        file=queue_utils.SYNTHETIC_FILE_LABEL,
        attempts=1,
        started_at=float(index),
        ended_at=float(index + 2),
        duration_sec=2.0,
        http_status=200 if success else 0,
        success=success,
        error_code=None if success else "REQUEST_TRANSPORT_FAILURE",
        job_id=f"job-{index:032x}" if identity else None,
        artifact_id=f"artifact-{index:032x}" if identity else None,
    )


def inventory(*indexes: int, valid: bool = True) -> manifest_module.ManagedOutputInventory:
    pairs = tuple(CleanupPair(f"job-{i:032x}", f"artifact-{i:032x}") for i in indexes)
    return manifest_module.ManagedOutputInventory(
        200 if valid else 0, valid, "ok" if valid else "failed", len(pairs) if valid else None, pairs,
    )


class SyntheticAndParsingTests(unittest.TestCase):
    def test_fixture_identity_and_secret_sanitization(self) -> None:
        expected = "2fd97b4f922acda13abdbdfd2587567e5610b362635b7f10807ceb674f7c44a1"
        with queue_utils.synthetic_queue_fixture() as fixture:
            parent = fixture.parent
            self.assertEqual(hashlib.sha256(fixture.read_bytes()).hexdigest(), expected)
        self.assertFalse(parent.exists())
        target = "https://user:secret@example.test:8443/private?token=secret"
        self.assertEqual(queue_utils.sanitized_target_label(target), "https://example.test:8443")
        self.assertIsNone(queue_utils.safe_error_code("BAD\nsecret"))

    def test_request_success_requires_exact_identity(self) -> None:
        valid_body = {
            "success": True,
            "job_id": "job-11111111111111111111111111111111",
            "artifact_id": "artifact-22222222222222222222222222222222",
        }
        invalid_body = {"success": True, "job_id": "job-../../x", "artifact_id": "bad"}
        args = (1, "/prusa/slice", Path("synthetic.stl"), "https://example.test", "key", 1)
        with mock.patch.object(queue_utils, "curl_multipart_slice", return_value=(200, valid_body, 0)):
            valid = queue_utils.run_one_request(*args)
        with mock.patch.object(queue_utils, "curl_multipart_slice", return_value=(200, invalid_body, 0)):
            invalid = queue_utils.run_one_request(*args)
        self.assertTrue(valid.success)
        self.assertFalse(invalid.success)
        self.assertEqual(invalid.error_code, "CLEANUP_IDENTITY_INVALID")

    def test_request_timeout_is_a_fixed_fail_closed_result(self) -> None:
        args = (1, "/prusa/slice", Path("synthetic.stl"), "https://example.test", "key", 1)
        with mock.patch.object(
            queue_utils,
            "curl_multipart_slice",
            return_value=(0, {"errorCode": "REQUEST_TOTAL_TIMEOUT"}, 180.0),
        ):
            result = queue_utils.run_one_request(*args)
        self.assertFalse(result.success)
        self.assertEqual(result.http_status, 0)
        self.assertEqual(result.error_code, "REQUEST_TOTAL_TIMEOUT")
        self.assertIsNone(result.job_id)
        self.assertIsNone(result.artifact_id)

    def test_future_drain_deadline_contains_all_bounded_attempts(self) -> None:
        self.assertEqual(queue_utils.future_drain_timeout_seconds(1), 190.0)
        self.assertEqual(queue_utils.future_drain_timeout_seconds(3), 570.0)
        for invalid in (0, 4, True):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                queue_utils.future_drain_timeout_seconds(invalid)

    def test_queue_parser_requires_exact_shape(self) -> None:
        payload = {
            "status": "OK",
            "subsystems": {"queue": {
                "queueLength": 1, "activeJobs": 1, "maxConcurrent": 2,
                "maxQueueLength": 100, "maxQueuePerClient": 5, "acceptingJobs": True,
            }},
        }
        self.assertTrue(queue_utils.parse_detailed_queue(200, payload).valid)
        payload["subsystems"]["queue"]["unexpected"] = 1
        self.assertFalse(queue_utils.parse_detailed_queue(200, payload).valid)

    def test_slice_curl_has_network_and_process_deadlines_with_sanitized_timeout(self) -> None:
        opaque = "private-slice-key"
        expired = subprocess.TimeoutExpired(cmd=["private", "slice-key"], timeout=185)
        with mock.patch.object(http_utils.subprocess, "run", side_effect=expired) as run:
            status, body, _duration = http_utils.curl_multipart_slice(
                base_url="https://example.test", endpoint="/prusa/slice",
                file_path=Path("synthetic.stl"), layer_height=0.2, material="PLA",
                slice_service_api_key=opaque,
            )
        command = run.call_args.args[0]
        self.assertEqual(command[command.index("--connect-timeout") + 1], "5")
        self.assertEqual(command[command.index("--max-time") + 1], "180")
        self.assertEqual(run.call_args.kwargs["timeout"], 185)
        self.assertFalse(any(opaque in argument for argument in command))
        self.assertEqual(command.count("@-"), 1)
        self.assertEqual(command[command.index("-H") + 1], "@-")
        self.assertEqual(
            run.call_args.kwargs["input"],
            "x-slicer-api-key: private-slice-key\n",
        )
        self.assertEqual((status, body), (0, {"errorCode": "REQUEST_TOTAL_TIMEOUT"}))
        self.assertNotIn("private-slice-key", json.dumps(body))

    def test_json_curl_credentials_use_stdin_and_never_argv(self) -> None:
        opaque = "private-admin-key"
        completed = subprocess.CompletedProcess(
            ["curl"], 0, stdout='{"success":true}\nHTTP_STATUS:200\n', stderr="",
        )
        with mock.patch.object(http_utils.subprocess, "run", return_value=completed) as run:
            status, body = http_utils.curl_json(
                method="GET", base_url="https://example.test", endpoint="/ready",
                api_key=opaque,
            )

        command = run.call_args.args[0]
        self.assertFalse(any(opaque in argument for argument in command))
        self.assertEqual(command.count("@-"), 1)
        self.assertEqual(command[command.index("-H") + 1], "@-")
        self.assertEqual(run.call_args.kwargs["input"], "x-api-key: private-admin-key\n")
        self.assertEqual((status, body), (200, {"success": True}))

        with mock.patch.object(http_utils.subprocess, "run", return_value=completed) as run:
            status, body, _headers = http_utils.curl_json_response(
                method="GET", base_url="https://example.test", endpoint="/profiles",
                api_key=opaque,
            )

        command = run.call_args.args[0]
        self.assertFalse(any(opaque in argument for argument in command))
        self.assertEqual(command.count("@-"), 1)
        self.assertEqual(command[command.index("-H") + 1], "@-")
        self.assertEqual(run.call_args.kwargs["input"], "x-api-key: private-admin-key\n")
        self.assertEqual((status, body), (200, {"success": True}))

    def test_curl_credential_header_rejects_multiline_values(self) -> None:
        for invalid in ("first\nsecond", "first\rsecond", "first\0second"):
            with self.subTest(invalid=repr(invalid)), self.assertRaises(ValueError):
                http_utils.curl_json(
                    method="GET", base_url="https://example.test", endpoint="/ready",
                    api_key=invalid,
                )

    def test_slice_curl_transport_failure_does_not_expose_stderr(self) -> None:
        opaque = "private-slice-key"
        completed = subprocess.CompletedProcess(
            ["curl"], 28, stdout="", stderr="private-slice-key transport details",
        )
        with mock.patch.object(http_utils.subprocess, "run", return_value=completed):
            status, body, _duration = http_utils.curl_multipart_slice(
                base_url="https://example.test", endpoint="/prusa/slice",
                file_path=Path("synthetic.stl"), layer_height=0.2, material="PLA",
                slice_service_api_key=opaque,
            )
        self.assertEqual((status, body), (0, {"errorCode": "REQUEST_TRANSPORT_FAILURE"}))
        self.assertNotIn("private-slice-key", json.dumps(body))


class ArtifactInventoryTests(unittest.TestCase):
    @staticmethod
    def payload(*indexes: int) -> dict:
        return {
            "success": True,
            "total": len(indexes),
            "files": [
                {"job_id": f"job-{i:032x}", "artifact_id": f"artifact-{i:032x}"}
                for i in indexes
            ],
        }

    def test_exact_empty_and_three_pair_inventory_parse(self) -> None:
        empty = manifest_module.parse_managed_output_inventory(200, self.payload())
        full = manifest_module.parse_managed_output_inventory(200, self.payload(1, 2, 3))
        self.assertTrue(empty.valid)
        self.assertEqual(empty.pairs, ())
        self.assertTrue(full.valid)
        self.assertEqual(len(full.pairs), 3)

    def test_malformed_duplicate_and_unbounded_inventory_fail_closed(self) -> None:
        malformed = self.payload(1)
        malformed["files"][0]["artifact_id"] = "artifact-invalid"
        duplicate = self.payload(1, 1)
        unbounded = self.payload(1, 2, 3, 4)
        for body in (malformed, duplicate, unbounded):
            with self.subTest(body=body):
                self.assertFalse(manifest_module.parse_managed_output_inventory(200, body).valid)

    def test_authenticated_reader_is_bounded_and_does_not_echo_key(self) -> None:
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_args): return False
            def getcode(self): return 200
            def read(self, _limit): return b"x" * (manifest_module.MAX_OUTPUT_INVENTORY_BYTES + 1)

        seen = {}

        def opener(request, **kwargs):
            seen["key"] = request.get_header("X-api-key")
            seen["timeout"] = kwargs["timeout"]
            return Response()

        result = manifest_module.request_managed_output_inventory(
            "https://example.test", "artifact-secret", opener=opener,
        )
        self.assertFalse(result.valid)
        self.assertEqual(result.reason, "artifact_inventory_response_too_large")
        self.assertEqual(seen, {"key": "artifact-secret", "timeout": 2.0})
        self.assertNotIn("secret", result.reason)


class ContractEvaluationTests(unittest.TestCase):
    def test_over_capacity_load_requires_observed_queue_peak(self) -> None:
        results = [request_result(1), request_result(2), request_result(3)]
        passed = queue_utils.evaluate_runtime_contract(
            preflight=observation(0, 0), during=[observation(1, 1)],
            postflight=observation(0, 0), results=results, expected_max_concurrent=1,
        )
        failed = queue_utils.evaluate_runtime_contract(
            preflight=observation(0, 0), during=[observation(1, 0)],
            postflight=observation(0, 0), results=results, expected_max_concurrent=1,
        )
        self.assertNotIn("expected_queue_peak_not_observed", passed["reason_codes"])
        self.assertIn("expected_queue_peak_not_observed", failed["reason_codes"])

    def test_post_inventory_reconciles_transport_lost_identity(self) -> None:
        results = [request_result(1), request_result(2, success=False, identity=False)]
        value = manifest_module.evaluate_inventory_contract(
            preflight=inventory(), postflight=inventory(1, 2),
            results=results, expected_count=2,
        )
        self.assertTrue(value["inventory_contract_passed"])
        self.assertEqual(value["response_loss_reconciled_count"], 1)

    def test_missing_or_unrelated_inventory_identity_fails(self) -> None:
        missing = manifest_module.evaluate_inventory_contract(
            preflight=inventory(), postflight=inventory(2),
            results=[request_result(1)], expected_count=1,
        )
        unrelated = manifest_module.evaluate_inventory_contract(
            preflight=inventory(), postflight=inventory(1, 2),
            results=[request_result(1)], expected_count=1,
        )
        self.assertIn("response_identity_missing_from_inventory", missing["reason_codes"])
        self.assertIn("managed_output_count_mismatch", unrelated["reason_codes"])
        self.assertIn("inventory_identity_not_correlated", unrelated["reason_codes"])


class RunnerIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.runner = load_runner()

    def test_parser_requires_both_create_new_evidence_paths(self) -> None:
        parser = self.runner.build_parser()
        args = parser.parse_args([
            "--expected-max-concurrent", "1", "--cleanup-manifest", "cleanup.json",
            "--report", "report.md",
        ])
        self.assertEqual(args.expected_max_concurrent, 1)
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            parser.parse_args(["--expected-max-concurrent", "1", "--cleanup-manifest", "x"])

    def test_execute_load_drains_all_futures_after_one_worker_exception(self) -> None:
        args = SimpleNamespace(count=3, endpoint="/prusa/slice", retry_on_429=1)

        def worker(index, *_args):
            if index == 2:
                raise LookupError("private exception text")
            return request_result(index)

        results = []
        with (
            mock.patch.object(self.runner, "run_one_request", side_effect=worker),
            mock.patch.object(self.runner, "observe_queue_while_pending", return_value=[]),
            mock.patch.object(self.runner, "request_fresh_queue_state", return_value=observation(0, 0)),
            contextlib.redirect_stdout(io.StringIO()) as output,
        ):
            outcome = self.runner.execute_load(
                args, "https://example.test", "slice-key", "ops-key", results,
            )
        self.assertEqual(sorted(result.index for result in results), [1, 2, 3])
        self.assertTrue(outcome.workers_settled)
        self.assertIsNotNone(outcome.queue_postflight)
        failed = next(result for result in results if result.index == 2)
        self.assertEqual(failed.error_code, "REQUEST_WORKER_FAILURE")
        self.assertNotIn("private exception", output.getvalue())

    def test_execute_load_bounds_future_drain_and_records_uncertainty(self) -> None:
        args = SimpleNamespace(count=2, endpoint="/prusa/slice", retry_on_429=1)
        release = threading.Event()

        def worker(index, *_args):
            if index == 2:
                release.wait(1)
            return request_result(index)

        results = []
        try:
            with (
                mock.patch.object(self.runner, "run_one_request", side_effect=worker),
                mock.patch.object(self.runner, "future_drain_timeout_seconds", return_value=0.01),
                mock.patch.object(self.runner, "observe_queue_while_pending", return_value=[]),
                mock.patch.object(
                    self.runner, "request_fresh_queue_state", return_value=observation(0, 0),
                ),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                outcome = self.runner.execute_load(
                    args, "https://example.test", "slice-key", "ops-key", results,
                )
        finally:
            release.set()
        self.assertEqual(sorted(result.index for result in results), [1, 2])
        timed_out = next(result for result in results if result.index == 2)
        self.assertEqual(timed_out.error_code, "REQUEST_FUTURE_TIMEOUT")
        self.assertFalse(outcome.workers_settled)
        self.assertIsNone(outcome.queue_postflight)

    def test_unsettled_worker_skips_postflight_inventory_and_both_publications(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "cleanup.json"
            report_path = Path(directory) / "report.md"
            argv = [
                "queue-runner", "--count", "1", "--expected-max-concurrent", "1",
                "--cleanup-manifest", str(manifest_path), "--report", str(report_path),
            ]
            post_inventory = mock.Mock(return_value=inventory(1))
            with (
                mock.patch.object(sys, "argv", argv),
                mock.patch.object(
                    self.runner, "resolve_runtime_env",
                    return_value=("https://example.test", "slice", ["ops"], ["artifact"]),
                ),
                mock.patch.object(
                    self.runner, "authenticate_artifact_inventory",
                    return_value=("artifact", inventory()),
                ),
                mock.patch.object(
                    self.runner, "authenticate_operations_observer",
                    return_value=("ops", observation(0, 0)),
                ),
                mock.patch.object(
                    self.runner,
                    "execute_load",
                    return_value=self.runner.LoadExecutionOutcome([], None, False),
                ),
                mock.patch.object(
                    self.runner, "request_managed_output_inventory", post_inventory,
                ),
                contextlib.redirect_stdout(io.StringIO()) as output,
            ):
                code = self.runner.main()
            self.assertEqual(code, 1)
            post_inventory.assert_not_called()
            self.assertFalse(report_path.exists())
            self.assertFalse(manifest_path.exists())
            self.assertIn("workers_settled=false", output.getvalue())
            self.assertIn(
                "cleanup_manifest_state=not_published_post_inventory_unverified",
                output.getvalue(),
            )

    def _run_main(
        self, directory: str, *, response: QueueRequestResult, post_inventory,
        report_failure: bool = False,
    ):
        manifest_path = Path(directory) / "cleanup.json"
        report_path = Path(directory) / "report.md"
        argv = [
            "queue-runner", "--count", "1", "--expected-max-concurrent", "1",
            "--cleanup-manifest", str(manifest_path), "--report", str(report_path),
        ]
        with (
            mock.patch.object(sys, "argv", argv),
            mock.patch.object(
                self.runner, "resolve_runtime_env",
                return_value=("https://example.test", "slice-key", ["ops-key"], ["artifact-key"]),
            ),
            mock.patch.object(
                self.runner, "authenticate_artifact_inventory",
                return_value=("artifact-key", inventory()),
            ),
            mock.patch.object(
                self.runner, "authenticate_operations_observer",
                return_value=("ops-key", observation(0, 0)),
            ),
            mock.patch.object(self.runner, "run_one_request", return_value=response),
            mock.patch.object(
                self.runner, "observe_queue_while_pending", return_value=[observation(1, 0)],
            ),
            mock.patch.object(
                self.runner, "request_fresh_queue_state", return_value=observation(0, 0),
            ),
            mock.patch.object(
                self.runner, "request_managed_output_inventory", return_value=post_inventory,
            ),
            mock.patch.object(
                reporting_module, "render_queue_report", side_effect=RuntimeError("synthetic"),
            ) if report_failure else contextlib.nullcontext(),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            exit_code = self.runner.main()
        return exit_code, manifest_path, report_path

    def test_success_writes_secret_free_report_and_inventory_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            code, manifest_path, report_path = self._run_main(
                directory, response=request_result(1), post_inventory=inventory(1),
            )
            self.assertEqual(code, 0)
            report = report_path.read_text(encoding="utf-8")
            self.assertIn("Runtime contract: **PASS**", report)
            self.assertNotIn(request_result(1).job_id, report)
            document = json.loads(manifest_path.read_text(encoding="ascii"))
            self.assertEqual(document["artifacts"], [{
                "job_id": request_result(1).job_id,
                "artifact_id": request_result(1).artifact_id,
            }])

    def test_response_loss_is_nonzero_but_post_inventory_still_drives_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            code, manifest_path, report_path = self._run_main(
                directory,
                response=request_result(1, success=False, identity=False),
                post_inventory=inventory(1),
            )
            self.assertEqual(code, 1)
            self.assertTrue(report_path.exists())
            self.assertIn(request_result(1).artifact_id, manifest_path.read_text(encoding="ascii"))

    def test_request_timeout_still_publishes_fail_closed_report_and_cleanup_manifest(self) -> None:
        timed_out = queue_utils.QueueRequestResult(
            index=1, file=queue_utils.SYNTHETIC_FILE_LABEL, attempts=1,
            started_at=1.0, ended_at=181.0, duration_sec=180.0,
            http_status=0, success=False, error_code="REQUEST_TOTAL_TIMEOUT",
        )
        with tempfile.TemporaryDirectory() as directory:
            code, manifest_path, report_path = self._run_main(
                directory, response=timed_out, post_inventory=inventory(1),
            )
            self.assertEqual(code, 1)
            self.assertTrue(report_path.exists())
            self.assertIn("REQUEST_TOTAL_TIMEOUT", report_path.read_text(encoding="utf-8"))
            self.assertIn(request_result(1).artifact_id, manifest_path.read_text(encoding="ascii"))

    def test_post_inventory_survives_later_report_evaluation_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            code, manifest_path, report_path = self._run_main(
                directory, response=request_result(1), post_inventory=inventory(1),
                report_failure=True,
            )
            self.assertEqual(code, 1)
            self.assertTrue(manifest_path.exists())
            self.assertFalse(report_path.exists())

    def test_nonempty_inventory_preflight_never_starts_load_or_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "cleanup.json"
            report_path = Path(directory) / "report.md"
            argv = [
                "queue-runner", "--expected-max-concurrent", "1",
                "--cleanup-manifest", str(manifest_path), "--report", str(report_path),
            ]
            with (
                mock.patch.object(sys, "argv", argv),
                mock.patch.object(
                    self.runner, "resolve_runtime_env",
                    return_value=("https://example.test", "slice", ["ops"], ["artifact"]),
                ),
                mock.patch.object(
                    self.runner, "authenticate_artifact_inventory",
                    return_value=("artifact", inventory(1)),
                ),
                mock.patch.object(self.runner, "run_one_request") as run_request,
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(self.runner.main(), 1)
            run_request.assert_not_called()
            self.assertFalse(manifest_path.exists())
            self.assertTrue(report_path.exists())

    def test_existing_report_is_preserved_before_qualification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "cleanup.json"
            report_path = Path(directory) / "report.md"
            report_path.write_text("operator-owned", encoding="ascii")
            argv = [
                "queue-runner", "--expected-max-concurrent", "1",
                "--cleanup-manifest", str(manifest_path), "--report", str(report_path),
            ]
            with (
                mock.patch.object(sys, "argv", argv),
                mock.patch.object(self.runner, "run_qualification") as qualification,
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(self.runner.main(), 1)
            qualification.assert_not_called()
            self.assertEqual(report_path.read_text(encoding="ascii"), "operator-owned")
            self.assertFalse(manifest_path.exists())

    def test_committed_uncertain_report_is_preserved_and_returns_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "report.md"
            writer = manifest_module.CreateNewFileWriter.prepare(str(target), 64)
            with (
                mock.patch.object(manifest_module.os, "fchmod", side_effect=OSError("synthetic")),
                contextlib.redirect_stdout(io.StringIO()) as output,
            ):
                self.assertFalse(self.runner.publish_evidence("report", writer, b"bounded\n"))
            self.assertTrue(target.exists())
            self.assertEqual(target.read_bytes(), b"bounded\n")
            self.assertIn("report_state=committed_uncertain", output.getvalue())
            self.assertNotIn("absent", output.getvalue())


class SourceMutationContracts(unittest.TestCase):
    def test_no_clobber_report_inventory_and_queue_gate_tokens_are_required(self) -> None:
        runner = RUNNER_PATH.read_text(encoding="utf-8")
        utils = UTILS_PATH.read_text(encoding="utf-8")
        publisher = MANIFEST_PATH.read_text(encoding="utf-8")
        for token in (
            'parser.add_argument("--report", required=True',
            "request_managed_output_inventory(base_url, artifact_key)",
            "bounded_failed_request_result(index)",
            "as_completed(future_indexes, timeout=drain_timeout)",
            "bounded_timeout_request_result(index)",
        ):
            self.assertIn(token, runner)
        self.assertNotIn("LEGACY_REPORT_FILES", runner)
        self.assertIn("if not load_outcome.workers_settled", runner)
        self.assertIn('postflight_inventory=not_requested', runner)
        self.assertLess(
            runner.index("if not load_outcome.workers_settled"),
            runner.index("inventory_postflight = request_managed_output_inventory"),
        )
        self.assertIn('reasons.append("expected_queue_peak_not_observed")', utils)
        http_source = (SCRIPTS_ROOT / "common" / "http_utils.py").read_text(encoding="utf-8")
        self.assertIn('"--connect-timeout"', http_source)
        self.assertIn('"--max-time"', http_source)
        self.assertIn("except subprocess.TimeoutExpired:", http_source)
        self.assertIn("timeout=subprocess_timeout_seconds", http_source)
        self.assertIn('headers={"Accept": "application/json", "x-api-key": artifact_key}', publisher)
        self.assertIn("os.link(self.temporary, self.target, follow_symlinks=False)", publisher)
        self.assertNotIn("os.replace(", publisher)
        self.assertIn('self.state = "committed_uncertain"', publisher)


if __name__ == "__main__":
    unittest.main()
