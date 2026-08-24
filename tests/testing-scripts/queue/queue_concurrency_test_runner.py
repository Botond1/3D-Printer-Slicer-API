"""Bounded black-box queue concurrency qualification with exact cleanup evidence."""

from __future__ import annotations

import argparse
import sys as _sys
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError, as_completed
from pathlib import Path
from typing import NamedTuple

_sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from common.env_utils import (  # noqa: E402
    resolve_artifact_api_key_candidates,
    resolve_base_url,
    resolve_operations_api_key_candidates,
    resolve_slice_service_api_key,
)
from common.queue_cleanup_manifest import (  # noqa: E402
    CleanupManifestError,
    CleanupManifestWriter,
    CreateNewFileWriter,
    authenticate_artifact_inventory,
    request_managed_output_inventory,
    serialize_cleanup_manifest,
)
from common.queue_concurrency_reporting import (  # noqa: E402
    QualificationOutcome,
    build_postflight_outcome,
    failed_preflight_outcome,
    publish_evidence,
    render_preflight_failure,
)
from common.queue_concurrency_utils import (  # noqa: E402
    MAX_QUEUE_REQUESTS,
    MAX_REPORT_BYTES,
    QueueObservation,
    QueueRequestResult,
    authenticate_operations_observer,
    bounded_failed_request_result,
    bounded_timeout_request_result,
    future_drain_timeout_seconds,
    observe_queue_while_pending,
    preflight_allows_load,
    request_fresh_queue_state,
    run_one_request,
    synthetic_queue_fixture,
)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
PRUSA_SLICE_ENDPOINT = "/prusa/slice"
ORCA_SLICE_ENDPOINT = "/orca/slice"


class LoadExecutionOutcome(NamedTuple):
    during: list[QueueObservation]
    queue_postflight: QueueObservation | None
    workers_settled: bool


def resolve_runtime_env() -> tuple[str, str | None, list[str], list[str]]:
    return (
        resolve_base_url(PROJECT_ROOT),
        resolve_slice_service_api_key(PROJECT_ROOT),
        resolve_operations_api_key_candidates(PROJECT_ROOT),
        resolve_artifact_api_key_candidates(PROJECT_ROOT),
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--endpoint", default=PRUSA_SLICE_ENDPOINT,
        choices=[PRUSA_SLICE_ENDPOINT, ORCA_SLICE_ENDPOINT],
    )
    parser.add_argument("--count", type=int, default=3, help="number of synthetic requests")
    parser.add_argument(
        "--expected-max-concurrent", type=int, required=True, choices=[1, 2, 3],
        help="expected fresh queue maxConcurrent value",
    )
    parser.add_argument(
        "--retry-on-429", type=int, default=1,
        help="bounded maximum request attempts; any retry makes qualification fail",
    )
    parser.add_argument("--cleanup-manifest", required=True, help="create-new cleanup manifest path")
    parser.add_argument("--report", required=True, help="create-new bounded Markdown report path")
    return parser


def validate_arguments(args: argparse.Namespace) -> str | None:
    if args.count < args.expected_max_concurrent or args.count > MAX_QUEUE_REQUESTS:
        return "count must be between expected-max-concurrent and 3"
    if args.retry_on_429 < 1 or args.retry_on_429 > 3:
        return "retry-on-429 must be between 1 and 3"
    return None


def execute_load(
    args: argparse.Namespace,
    base_url: str,
    slice_key: str,
    operations_key: str,
    results: list[QueueRequestResult],
) -> LoadExecutionOutcome:
    with synthetic_queue_fixture() as fixture:
        executor = ThreadPoolExecutor(max_workers=args.count)
        all_workers_settled = False
        try:
            submitted_at = time.monotonic()
            future_indexes = {
                executor.submit(
                    run_one_request, index, args.endpoint, fixture, base_url,
                    slice_key, args.retry_on_429,
                ): index
                for index in range(1, args.count + 1)
            }
            during = observe_queue_while_pending(base_url, operations_key, list(future_indexes))
            drain_timeout = max(
                0.001,
                future_drain_timeout_seconds(args.retry_on_429)
                - (time.monotonic() - submitted_at),
            )
            completed = set()
            try:
                completed_iterator = as_completed(future_indexes, timeout=drain_timeout)
                for future in completed_iterator:
                    completed.add(future)
                    index = future_indexes[future]
                    try:
                        result = future.result()
                    except Exception:
                        result = bounded_failed_request_result(index)
                    results.append(result)
                    print(
                        f"[QUEUE TEST] req#{result.index} status={result.http_status} "
                        f"success={result.success} duration={result.duration_sec}s"
                    )
            except FuturesTimeoutError:
                pass
            for future, index in future_indexes.items():
                if future in completed:
                    continue
                if future.done():
                    try:
                        result = future.result()
                    except Exception:
                        result = bounded_failed_request_result(index)
                else:
                    future.cancel()
                    result = bounded_timeout_request_result(index)
                results.append(result)
                print(
                    f"[QUEUE TEST] req#{result.index} status={result.http_status} "
                    f"success={result.success} duration={result.duration_sec}s"
                )
            all_workers_settled = all(future.done() for future in future_indexes)
        finally:
            executor.shutdown(wait=all_workers_settled, cancel_futures=True)
    if not all_workers_settled:
        return LoadExecutionOutcome(during, None, False)
    return LoadExecutionOutcome(
        during, request_fresh_queue_state(base_url, operations_key), True,
    )


def run_qualification(args: argparse.Namespace, results: list[QueueRequestResult]) -> QualificationOutcome:
    base_url, slice_key, operations_candidates, artifact_candidates = resolve_runtime_env()
    print(
        "[QUEUE TEST] "
        f"slice_key_found={bool(slice_key)} operations_key_found={bool(operations_candidates)} "
        f"artifact_key_found={bool(artifact_candidates)}"
    )
    if not slice_key or not operations_candidates or not artifact_candidates:
        return failed_preflight_outcome(
            args.endpoint, base_url, args.expected_max_concurrent,
            "required_audience_credential_missing",
        )
    try:
        artifact_key, inventory_preflight = authenticate_artifact_inventory(
            base_url, artifact_candidates,
        )
    except RuntimeError:
        return failed_preflight_outcome(
            args.endpoint, base_url, args.expected_max_concurrent,
            "artifact_inventory_authentication_failure",
        )
    if not inventory_preflight.valid or inventory_preflight.total != 0 or inventory_preflight.pairs:
        return failed_preflight_outcome(
            args.endpoint, base_url, args.expected_max_concurrent,
            "managed_output_preflight_not_exact_empty",
        )
    try:
        operations_key, queue_preflight = authenticate_operations_observer(
            base_url, operations_candidates,
        )
    except RuntimeError:
        return failed_preflight_outcome(
            args.endpoint, base_url, args.expected_max_concurrent,
            "operations_observer_authentication_failure",
        )
    if not preflight_allows_load(queue_preflight, args.expected_max_concurrent):
        payload = render_preflight_failure(
            args.endpoint, base_url, queue_preflight, args.expected_max_concurrent,
        )
        return QualificationOutcome(1, payload, None)
    print(
        f"[QUEUE TEST] endpoint={args.endpoint} synthetic_count={args.count} "
        f"expected_max_concurrent={args.expected_max_concurrent}"
    )
    load_outcome = execute_load(
        args, base_url, slice_key, operations_key, results,
    )
    results.sort(key=lambda result: result.index)
    if not load_outcome.workers_settled or load_outcome.queue_postflight is None:
        print("[QUEUE TEST] workers_settled=false postflight_inventory=not_requested")
        return QualificationOutcome(1, None, None)
    inventory_postflight = request_managed_output_inventory(base_url, artifact_key)
    return build_postflight_outcome(
        results=results, endpoint=args.endpoint, base_url=base_url,
        expected_max_concurrent=args.expected_max_concurrent, expected_count=args.count,
        queue_preflight=queue_preflight, queue_during=load_outcome.during,
        queue_postflight=load_outcome.queue_postflight,
        inventory_preflight=inventory_preflight, inventory_postflight=inventory_postflight,
    )


def main() -> int:
    args = build_parser().parse_args()
    argument_error = validate_arguments(args)
    if argument_error:
        print(f"[QUEUE TEST] ERROR: {argument_error}")
        return 1
    manifest_writer: CleanupManifestWriter | None = None
    report_writer: CreateNewFileWriter | None = None
    try:
        manifest_writer = CleanupManifestWriter.prepare(args.cleanup_manifest)
        report_writer = CreateNewFileWriter.prepare(args.report, MAX_REPORT_BYTES)
        if manifest_writer.target == report_writer.target:
            raise CleanupManifestError("evidence_targets_must_differ")
    except Exception:
        if manifest_writer is not None:
            manifest_writer.abort()
        if report_writer is not None:
            report_writer.abort()
        print("[QUEUE TEST] ERROR: evidence path preflight failed")
        return 1
    results: list[QueueRequestResult] = []
    try:
        outcome = run_qualification(args, results)
    except Exception:
        print("[QUEUE TEST] ERROR: qualification execution failed")
        outcome = QualificationOutcome(1, None, None)
    publication_ok = True
    if outcome.report_payload is None:
        report_writer.abort()
        publication_ok = False
    else:
        publication_ok = publish_evidence("report", report_writer, outcome.report_payload)
    if outcome.cleanup_pairs is None:
        manifest_writer.abort()
        print("[QUEUE TEST] cleanup_manifest_state=not_published_post_inventory_unverified")
        publication_ok = False
    else:
        try:
            payload = serialize_cleanup_manifest(outcome.cleanup_pairs)
        except Exception:
            manifest_writer.abort()
            print("[QUEUE TEST] ERROR: cleanup manifest serialization failed")
            publication_ok = False
        else:
            publication_ok = publish_evidence(
                "cleanup_manifest", manifest_writer.writer, payload,
            ) and publication_ok
            if manifest_writer.state in {"committed", "committed_uncertain"}:
                print(f"[QUEUE TEST] cleanup_pairs={len(outcome.cleanup_pairs)}")
    return outcome.exit_code if publication_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
