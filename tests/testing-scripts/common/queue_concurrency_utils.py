"""Bounded, secret-safe helpers for the black-box queue concurrency runner."""

from __future__ import annotations

import hashlib
import json
import re
import tempfile
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator, Sequence
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

from .http_utils import CURL_SLICE_SUBPROCESS_TIMEOUT_SECONDS, curl_multipart_slice
from .queue_cleanup_manifest import (
    ARTIFACT_ID_PATTERN,
    JOB_ID_PATTERN,
    valid_cleanup_pair,
)


MAX_DETAILED_HEALTH_BYTES = 16 * 1024
MAX_REPORT_BYTES = 32 * 1024
MAX_QUEUE_REQUESTS = 3
MAX_QUEUE_OBSERVATIONS = 20
OBSERVATION_INTERVAL_SECONDS = 0.1
OBSERVATION_TIMEOUT_SECONDS = 2.0
MAX_RETRY_DELAY_SECONDS = 5
FUTURE_DRAIN_GRACE_SECONDS = 5
SYNTHETIC_FILE_LABEL = "synthetic/queue-cube.stl"
SYNTHETIC_LAYER_HEIGHT = 0.2
SYNTHETIC_MATERIAL = "PLA"
QUEUE_KEYS = frozenset({
    "queueLength",
    "activeJobs",
    "maxConcurrent",
    "maxQueueLength",
    "maxQueuePerClient",
    "acceptingJobs",
})
SAFE_ERROR_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")

_CUBE_VERTICES = (
    (0, 0, 0), (20, 0, 0), (20, 20, 0), (0, 20, 0),
    (0, 0, 20), (20, 0, 20), (20, 20, 20), (0, 20, 20),
)
_CUBE_FACES = (
    ((0, 0, -1), (0, 2, 1)), ((0, 0, -1), (0, 3, 2)),
    ((0, 0, 1), (4, 5, 6)), ((0, 0, 1), (4, 6, 7)),
    ((0, -1, 0), (0, 1, 5)), ((0, -1, 0), (0, 5, 4)),
    ((0, 1, 0), (3, 7, 6)), ((0, 1, 0), (3, 6, 2)),
    ((-1, 0, 0), (0, 4, 7)), ((-1, 0, 0), (0, 7, 3)),
    ((1, 0, 0), (1, 2, 6)), ((1, 0, 0), (1, 6, 5)),
)


def _build_synthetic_cube() -> str:
    lines = ["solid queue_cube"]
    for normal, indices in _CUBE_FACES:
        lines.append(f"  facet normal {normal[0]} {normal[1]} {normal[2]}")
        lines.append("    outer loop")
        for index in indices:
            vertex = _CUBE_VERTICES[index]
            lines.append(f"      vertex {vertex[0]} {vertex[1]} {vertex[2]}")
        lines.extend(("    endloop", "  endfacet"))
    lines.append("endsolid queue_cube")
    return "\n".join(lines) + "\n"


SYNTHETIC_CUBE_STL = _build_synthetic_cube()
SYNTHETIC_FIXTURE_SHA256 = hashlib.sha256(
    SYNTHETIC_CUBE_STL.encode("ascii")
).hexdigest()


@dataclass(frozen=True)
class QueueRequestResult:
    index: int
    file: str
    attempts: int
    started_at: float
    ended_at: float
    duration_sec: float
    http_status: int
    success: bool
    error_code: str | None
    job_id: str | None = None
    artifact_id: str | None = None


@dataclass(frozen=True)
class QueueObservation:
    http_status: int
    valid: bool
    reason: str
    queue_length: int | None = None
    active_jobs: int | None = None
    max_concurrent: int | None = None
    accepting_jobs: bool | None = None


def preflight_allows_load(preflight: QueueObservation, expected: int) -> bool:
    return (
        preflight.valid and preflight.max_concurrent == expected
        and preflight.active_jobs == 0 and preflight.queue_length == 0
        and preflight.accepting_jobs is True
    )


def safe_error_code(value: object) -> str | None:
    if isinstance(value, str) and SAFE_ERROR_CODE.fullmatch(value):
        return value
    return None


def resolve_engine_name(endpoint: str) -> str:
    return "Orca" if endpoint == "/orca/slice" else "Prusa"


def format_layer_height_token(layer_height: float) -> str:
    return f"{layer_height:.3f}".rstrip("0").rstrip(".")


def build_extra_fields(endpoint: str, layer_height: float) -> dict[str, str]:
    layer_token = format_layer_height_token(layer_height)
    technology = "FDM" if endpoint == "/orca/slice" or layer_height > 0.05 else "SLA"
    fields: dict[str, str] = {
        "sizeUnit": "mm", "keepProportions": "true", "scalePercent": "100",
        "rotationX": "0", "rotationY": "0", "rotationZ": "0",
    }
    if endpoint == "/orca/slice":
        fields["printerProfile"] = "Bambu_P1S_0.4_nozzle.json"
        fields["processProfile"] = f"FDM_{layer_token}mm.json"
    else:
        fields["printerProfile"] = f"{technology}_{layer_token}mm.ini"
    return fields


def validated_response_identity(body: object) -> tuple[str | None, str | None]:
    if not isinstance(body, dict):
        return None, None
    raw_job_id = body.get("job_id")
    raw_artifact_id = body.get("artifact_id")
    job_id = raw_job_id if isinstance(raw_job_id, str) and JOB_ID_PATTERN.fullmatch(raw_job_id) else None
    artifact_id = raw_artifact_id if (
        isinstance(raw_artifact_id, str) and ARTIFACT_ID_PATTERN.fullmatch(raw_artifact_id)
    ) else None
    return job_id, artifact_id


def run_one_request(
    index: int,
    endpoint: str,
    file_path: Path,
    base_url: str,
    slice_service_api_key: str,
    retry_on_429: int,
) -> QueueRequestResult:
    attempts = 0
    started = time.perf_counter()
    status = 0
    body: dict | str | None = None
    transport_failure = False
    while attempts < retry_on_429:
        attempts += 1
        try:
            status, body, _ = curl_multipart_slice(
                base_url=base_url,
                endpoint=endpoint,
                file_path=file_path,
                layer_height=SYNTHETIC_LAYER_HEIGHT,
                material=SYNTHETIC_MATERIAL,
                slice_service_api_key=slice_service_api_key,
                extra_fields=build_extra_fields(endpoint, SYNTHETIC_LAYER_HEIGHT),
            )
        except (OSError, ValueError):
            transport_failure = True
            break
        if status != 429:
            break
        retry_after = 2
        if isinstance(body, dict):
            try:
                retry_after = int(body.get("retryAfterSeconds") or 2)
            except (TypeError, ValueError):
                retry_after = 2
        if attempts < retry_on_429:
            time.sleep(min(MAX_RETRY_DELAY_SECONDS, max(1, retry_after)))
    ended = time.perf_counter()
    response_success = (
        not transport_failure and 200 <= status < 300
        and isinstance(body, dict) and body.get("success") is True
    )
    job_id, artifact_id = validated_response_identity(body)
    success = response_success and valid_cleanup_pair(job_id, artifact_id)
    error_code = "REQUEST_TRANSPORT_FAILURE" if transport_failure else None
    if response_success and not success:
        error_code = "CLEANUP_IDENTITY_INVALID"
    elif isinstance(body, dict) and not success:
        error_code = safe_error_code(body.get("errorCode")) or "REQUEST_REJECTED"
    elif not success and error_code is None:
        error_code = "REQUEST_REJECTED"
    return QueueRequestResult(
        index, SYNTHETIC_FILE_LABEL, attempts, started, ended,
        round(ended - started, 3), status, success, error_code, job_id, artifact_id,
    )


def bounded_failed_request_result(index: int) -> QueueRequestResult:
    """Convert an unexpected worker failure into a fixed, nondisclosing result."""
    observed = time.perf_counter()
    return QueueRequestResult(
        index=index,
        file=SYNTHETIC_FILE_LABEL,
        attempts=1,
        started_at=observed,
        ended_at=observed,
        duration_sec=0.0,
        http_status=0,
        success=False,
        error_code="REQUEST_WORKER_FAILURE",
    )


def bounded_timeout_request_result(index: int) -> QueueRequestResult:
    """Represent an unsettled worker without leaking response or thread state."""
    observed = time.perf_counter()
    return QueueRequestResult(
        index=index,
        file=SYNTHETIC_FILE_LABEL,
        attempts=1,
        started_at=observed,
        ended_at=observed,
        duration_sec=0.0,
        http_status=0,
        success=False,
        error_code="REQUEST_FUTURE_TIMEOUT",
    )


def future_drain_timeout_seconds(retry_on_429: int) -> float:
    """Return a batch deadline that strictly contains every bounded attempt."""
    if (
        not isinstance(retry_on_429, int)
        or isinstance(retry_on_429, bool)
        or retry_on_429 < 1
        or retry_on_429 > 3
    ):
        raise ValueError("retry_attempt_limit_invalid")
    retry_waits = max(0, retry_on_429 - 1)
    return float(
        retry_on_429 * CURL_SLICE_SUBPROCESS_TIMEOUT_SECONDS
        + retry_waits * MAX_RETRY_DELAY_SECONDS
        + FUTURE_DRAIN_GRACE_SECONDS
    )


def cleanup_identity_shape(result: QueueRequestResult) -> str:
    if valid_cleanup_pair(result.job_id, result.artifact_id):
        return "VALID_PAIR"
    if result.job_id is not None or result.artifact_id is not None:
        return "PARTIAL"
    return "ABSENT"


def sanitized_target_label(base_url: str) -> str:
    try:
        parsed = urllib_parse.urlsplit(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return "invalid-target"
        host = parsed.hostname
        if ":" in host:
            host = f"[{host}]"
        port = f":{parsed.port}" if parsed.port is not None else ""
        return f"{parsed.scheme}://{host}{port}"
    except (TypeError, ValueError):
        return "invalid-target"


@contextmanager
def synthetic_queue_fixture() -> Iterator[Path]:
    with tempfile.TemporaryDirectory(prefix="slicer-queue-synthetic-") as directory:
        target = Path(directory) / "queue-cube.stl"
        with target.open("x", encoding="ascii", newline="\n") as handle:
            handle.write(SYNTHETIC_CUBE_STL)
        try:
            target.chmod(0o600)
        except OSError:
            pass
        actual = hashlib.sha256(target.read_bytes()).hexdigest()
        if actual != SYNTHETIC_FIXTURE_SHA256:
            raise RuntimeError("synthetic_fixture_identity_failure")
        yield target


def parse_detailed_queue(http_status: int, body: object) -> QueueObservation:
    if http_status != 200:
        reason = "operations_auth_rejected" if http_status == 401 else "detailed_health_unavailable"
        return QueueObservation(http_status, False, reason)
    if not isinstance(body, dict) or body.get("status") != "OK":
        return QueueObservation(http_status, False, "detailed_health_shape_invalid")
    subsystems = body.get("subsystems")
    queue = subsystems.get("queue") if isinstance(subsystems, dict) else None
    if not isinstance(queue, dict) or set(queue) != QUEUE_KEYS:
        return QueueObservation(http_status, False, "queue_observation_shape_invalid")
    integer_keys = QUEUE_KEYS - {"acceptingJobs"}
    if any(
        not isinstance(queue.get(key), int)
        or isinstance(queue.get(key), bool)
        or queue[key] < 0
        for key in integer_keys
    ):
        return QueueObservation(http_status, False, "queue_observation_value_invalid")
    if queue["maxConcurrent"] <= 0 or not isinstance(queue["acceptingJobs"], bool):
        return QueueObservation(http_status, False, "queue_observation_value_invalid")
    return QueueObservation(
        http_status=http_status,
        valid=True,
        reason="ok",
        queue_length=queue["queueLength"],
        active_jobs=queue["activeJobs"],
        max_concurrent=queue["maxConcurrent"],
        accepting_jobs=queue["acceptingJobs"],
    )


def request_fresh_queue_state(
    base_url: str,
    operations_key: str,
    *,
    opener=urllib_request.urlopen,
) -> QueueObservation:
    target = f"{base_url.rstrip('/')}/health/detailed"
    request = urllib_request.Request(
        target,
        headers={"Accept": "application/json", "x-api-key": operations_key},
        method="GET",
    )
    try:
        with opener(request, timeout=OBSERVATION_TIMEOUT_SECONDS) as response:
            status = int(response.getcode())
            raw = response.read(MAX_DETAILED_HEALTH_BYTES + 1)
    except urllib_error.HTTPError as exc:
        return parse_detailed_queue(int(exc.code), None)
    except (OSError, TimeoutError, ValueError):
        return QueueObservation(0, False, "operations_observation_transport_failure")
    if len(raw) > MAX_DETAILED_HEALTH_BYTES:
        return QueueObservation(status, False, "detailed_health_response_too_large")
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return QueueObservation(status, False, "detailed_health_json_invalid")
    return parse_detailed_queue(status, body)


def authenticate_operations_observer(
    base_url: str,
    candidates: Sequence[str],
) -> tuple[str, QueueObservation]:
    for candidate in candidates:
        observation = request_fresh_queue_state(base_url, candidate)
        if observation.http_status != 401:
            return candidate, observation
    raise RuntimeError("operations_observer_authentication_failure")


def observe_queue_while_pending(
    base_url: str,
    operations_key: str,
    futures: Sequence[object],
) -> list[QueueObservation]:
    observations: list[QueueObservation] = []
    for _ in range(MAX_QUEUE_OBSERVATIONS):
        observation = request_fresh_queue_state(base_url, operations_key)
        observations.append(observation)
        if not observation.valid or all(future.done() for future in futures):
            break
        time.sleep(OBSERVATION_INTERVAL_SECONDS)
    return observations


def evaluate_completion_order(
    results: list[QueueRequestResult],
    expected_max_concurrent: int,
) -> dict:
    if len(results) < 2:
        return {
            "client_start_order_kept": None,
            "staggered": None,
            "reason": "at least 2 requests required for timing comparison",
        }
    ordered_start = sorted(results, key=lambda result: result.started_at)
    ordered_end = sorted(results, key=lambda result: result.ended_at)
    spread = ordered_end[-1].ended_at - ordered_end[0].ended_at
    value = {
        "client_start_order_kept": [item.index for item in ordered_end]
        == [item.index for item in ordered_start],
        "completion_order": [item.index for item in ordered_end],
        "client_start_order": [item.index for item in ordered_start],
        "spread_sec": round(spread, 3),
    }
    if any(result.attempts > 1 for result in results):
        value.update(staggered=None, reason="rate-limited retry makes timing inconclusive")
        return value
    if expected_max_concurrent != 1:
        value.update(
            staggered=None,
            reason="fresh authenticated queue samples are authoritative for concurrent modes",
        )
        return value
    minimum = min(result.duration_sec for result in results)
    expected_spread = max(0.0, minimum * (len(results) - 1) * 0.35)
    value.update(
        staggered=spread >= expected_spread,
        min_single_duration_sec=round(minimum, 3),
        expected_min_spread_sec=round(expected_spread, 3),
        reason="timing is informational; fresh authenticated queue samples are authoritative",
    )
    return value


def evaluate_runtime_contract(
    *,
    preflight: QueueObservation,
    during: Sequence[QueueObservation],
    postflight: QueueObservation,
    results: Sequence[QueueRequestResult],
    expected_max_concurrent: int,
    inventory_check: dict | None = None,
) -> dict:
    observations = [preflight, *during, postflight]
    reasons: list[str] = []
    if not preflight.valid:
        reasons.append("preflight_observation_invalid")
    elif preflight.active_jobs != 0 or preflight.queue_length != 0:
        reasons.append("queue_not_idle_before_load")
    if any(not observation.valid for observation in observations):
        reasons.append("fresh_observation_invalid")
    configured = sorted({
        observation.max_concurrent
        for observation in observations
        if observation.valid and observation.max_concurrent is not None
    })
    if configured != [expected_max_concurrent]:
        reasons.append("configured_concurrency_mismatch")
    active_values = [
        observation.active_jobs
        for observation in observations
        if observation.valid and observation.active_jobs is not None
    ]
    queue_values = [
        observation.queue_length
        for observation in observations
        if observation.valid and observation.queue_length is not None
    ]
    peak_active = max(active_values, default=0)
    if peak_active > expected_max_concurrent:
        reasons.append("active_concurrency_exceeded")
    if len(results) >= expected_max_concurrent and peak_active < expected_max_concurrent:
        reasons.append("expected_active_peak_not_observed")
    peak_queue = max(queue_values, default=0)
    if len(results) > expected_max_concurrent and peak_queue < 1:
        reasons.append("expected_queue_peak_not_observed")
    if not postflight.valid:
        reasons.append("postflight_observation_invalid")
    elif postflight.active_jobs != 0 or postflight.queue_length != 0:
        reasons.append("queue_not_idle_after_load")
    if any(result.attempts != 1 for result in results):
        reasons.append("rate_limited_retry_observed")
    if any(not result.success for result in results):
        reasons.append("slice_request_failure")
    if inventory_check is not None:
        reasons.extend(inventory_check.get("reason_codes") or [])
    reasons = list(dict.fromkeys(reasons))
    return {
        "runtime_contract_passed": not reasons,
        "reason_codes": reasons,
        "expected_max_concurrent": expected_max_concurrent,
        "configured_values": configured,
        "fresh_observation_count": len(observations),
        "invalid_observation_count": sum(not item.valid for item in observations),
        "peak_active_jobs": peak_active,
        "peak_queue_length": peak_queue,
        "preflight_idle": preflight.valid
        and preflight.active_jobs == 0 and preflight.queue_length == 0,
        "postflight_idle": postflight.valid and postflight.active_jobs == 0 and postflight.queue_length == 0,
        "inventory_contract_passed": inventory_check is not None
        and inventory_check.get("inventory_contract_passed") is True,
        "inventory_postflight_pair_count": (
            inventory_check.get("postflight_pair_count") if inventory_check is not None else None
        ),
        "inventory_reconciled_response_loss": (
            inventory_check.get("response_loss_reconciled_count") if inventory_check is not None else None
        ),
    }


def markdown_summary(
    results: Iterable[QueueRequestResult],
    *,
    generated_at: str,
    endpoint: str,
    engine: str,
    target_label: str,
    order_check: dict,
    runtime_check: dict,
) -> str:
    rows = list(results)
    successful = sum(result.success for result in rows)
    response_pairs = sum(
        result.success and valid_cleanup_pair(result.job_id, result.artifact_id)
        for result in rows
    )
    reasons = runtime_check.get("reason_codes") or ["none"]
    lines = [
        "# Queue Concurrency Test Report",
        "",
        f"Generated at (UTC): **{generated_at}**",
        f"Target origin: **{target_label}**",
        f"Endpoint: **{endpoint}**",
        f"Slicer engine: **{engine}**",
        f"Expected max concurrent: **{runtime_check['expected_max_concurrent']}**",
        f"Total synthetic requests: **{len(rows)}**",
        f"Success: **{successful}**",
        f"Failed: **{len(rows) - successful}**",
        f"Response identity proof: **{response_pairs}/{successful} valid successful pairs**",
        f"Postflight inventory pairs: **{runtime_check['inventory_postflight_pair_count']}**",
        f"Response-loss pairs reconciled: **{runtime_check['inventory_reconciled_response_loss']}**",
        f"Inventory contract: **{'PASS' if runtime_check['inventory_contract_passed'] else 'FAIL'}**",
        f"Fresh observations: **{runtime_check['fresh_observation_count']}**",
        f"Peak active jobs: **{runtime_check['peak_active_jobs']}**",
        f"Peak queued jobs: **{runtime_check['peak_queue_length']}**",
        f"Preflight idle: **{runtime_check['preflight_idle']}**",
        f"Postflight idle: **{runtime_check['postflight_idle']}**",
        f"Runtime contract: **{'PASS' if runtime_check['runtime_contract_passed'] else 'FAIL'}**",
        f"Runtime reason codes: **{', '.join(reasons)}**",
        f"Timing heuristic: **{order_check.get('reason')}**",
        "",
        "| # | Engine | Fixture | Attempts | Status | Success | Duration(s) | IdentityShape | ErrorCode |",
        "|---:|:------:|:--------|---------:|------:|:-------:|-----------:|:--------------|:---------|",
    ]
    for result in rows:
        lines.append(
            f"| {result.index} | {engine} | `{result.file}` | {result.attempts} | "
            f"{result.http_status} | {'PASS' if result.success else 'FAIL'} | "
            f"{result.duration_sec} | {cleanup_identity_shape(result)} | "
            f"{result.error_code or '-'} |"
        )
    report = "\n".join(lines) + "\n"
    if len(report.encode("utf-8")) > MAX_REPORT_BYTES:
        raise RuntimeError("queue_report_size_exceeded")
    return report


def bounded_report_payload(report: str) -> bytes:
    payload = report.encode("utf-8")
    if len(payload) > MAX_REPORT_BYTES:
        raise RuntimeError("queue_report_size_exceeded")
    return payload
