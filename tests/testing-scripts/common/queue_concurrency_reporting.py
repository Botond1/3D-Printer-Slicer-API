"""Bounded Markdown rendering for queue concurrency qualification."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import NamedTuple

from .queue_cleanup_manifest import (
    CleanupPair,
    CreateNewFileWriter,
    CreateNewPublicationError,
    ManagedOutputInventory,
    evaluate_inventory_contract,
)
from .queue_concurrency_utils import (
    QueueObservation,
    QueueRequestResult,
    bounded_report_payload,
    evaluate_completion_order,
    evaluate_runtime_contract,
    markdown_summary,
    resolve_engine_name,
    sanitized_target_label,
)


class QualificationOutcome(NamedTuple):
    exit_code: int
    report_payload: bytes | None
    cleanup_pairs: tuple[CleanupPair, ...] | None


def render_queue_report(
    results: list[QueueRequestResult],
    endpoint: str,
    base_url: str,
    order_check: dict,
    runtime_check: dict,
) -> bytes:
    report = markdown_summary(
        results,
        generated_at=datetime.now(timezone.utc).isoformat(),
        endpoint=endpoint,
        engine=resolve_engine_name(endpoint),
        target_label=sanitized_target_label(base_url),
        order_check=order_check,
        runtime_check=runtime_check,
    )
    return bounded_report_payload(report)


def render_preflight_failure(
    endpoint: str,
    base_url: str,
    preflight: QueueObservation,
    expected_max_concurrent: int,
    reason: str = "load not started because fresh preflight failed",
) -> bytes:
    runtime_check = evaluate_runtime_contract(
        preflight=preflight,
        during=[],
        postflight=preflight,
        results=[],
        expected_max_concurrent=expected_max_concurrent,
    )
    return render_queue_report(
        [],
        endpoint,
        base_url,
        {"reason": reason},
        runtime_check,
    )


def failed_preflight_outcome(
    endpoint: str,
    base_url: str,
    expected_max_concurrent: int,
    reason: str,
) -> QualificationOutcome:
    observation = QueueObservation(0, False, reason)
    payload = render_preflight_failure(
        endpoint, base_url, observation, expected_max_concurrent, reason,
    )
    return QualificationOutcome(1, payload, None)


def build_postflight_outcome(
    *,
    results: list[QueueRequestResult],
    endpoint: str,
    base_url: str,
    expected_max_concurrent: int,
    expected_count: int,
    queue_preflight: QueueObservation,
    queue_during: list[QueueObservation],
    queue_postflight: QueueObservation,
    inventory_preflight: ManagedOutputInventory,
    inventory_postflight: ManagedOutputInventory,
) -> QualificationOutcome:
    cleanup_pairs = inventory_postflight.pairs if inventory_postflight.valid else None
    try:
        inventory_check = evaluate_inventory_contract(
            preflight=inventory_preflight, postflight=inventory_postflight,
            results=results, expected_count=expected_count,
        )
        runtime_check = evaluate_runtime_contract(
            preflight=queue_preflight, during=queue_during, postflight=queue_postflight,
            results=results, expected_max_concurrent=expected_max_concurrent,
            inventory_check=inventory_check,
        )
        payload = render_queue_report(
            results, endpoint, base_url,
            evaluate_completion_order(results, expected_max_concurrent), runtime_check,
        )
    except Exception:
        return QualificationOutcome(1, None, cleanup_pairs)
    failures = sum(not result.success for result in results)
    print(
        f"[QUEUE TEST] request_failures={failures} "
        f"runtime_contract_passed={runtime_check['runtime_contract_passed']} "
        f"peak_active={runtime_check['peak_active_jobs']}"
    )
    exit_code = 0 if failures == 0 and runtime_check["runtime_contract_passed"] else 1
    return QualificationOutcome(exit_code, payload, cleanup_pairs)


def publish_evidence(label: str, writer: CreateNewFileWriter, payload: bytes) -> bool:
    try:
        byte_count = writer.publish_bytes(payload)
    except CreateNewPublicationError as exc:
        writer.abort()
        print(
            f"[QUEUE TEST] {label}_state={exc.state} stage={exc.stage} "
            f"bytes={exc.byte_count}"
        )
        return False
    except Exception:
        writer.abort()
        print(f"[QUEUE TEST] ERROR: {label} publication failed")
        return False
    print(f"[QUEUE TEST] {label}_state=committed bytes={byte_count}")
    return True
