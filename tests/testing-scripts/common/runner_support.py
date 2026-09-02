"""Small shared helpers for focused HTTP runners (Bambu, render, calibration).

Everything here is side-effect free apart from the bounded sleep inside the
429 retry loop. Reports built on these helpers never retain the base URL,
hostnames, credentials, private paths, or customer file names.
"""

from __future__ import annotations

import ipaddress
import math
import re
import time
from pathlib import Path
from typing import Mapping
from urllib.parse import urlsplit

from common.http_utils import curl_multipart_slice

SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
ENGINE_VERSION_PATTERN = re.compile(r"^[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9.]{1,32})?$")
ARTIFACT_ID_PATTERN = re.compile(r"^artifact-[a-f0-9]{32}$")
AXES = ("x", "y", "z")
DEFAULT_RETRY_WAIT_SECONDS = 20
MAX_RETRY_WAIT_SECONDS = 60
MAX_HTTP_ATTEMPTS = 3
SLICE_SERVICE_AUTH_REQUIRED_BODY = {
    "success": False,
    "error": "Slice service authentication is required.",
    "errorCode": "SLICE_SERVICE_AUTH_REQUIRED",
}


def report_target_class(base_url: str) -> str:
    """Classify the target without repeating its host, port, or address."""
    try:
        hostname = urlsplit(base_url).hostname
    except ValueError:
        return "invalid-redacted"
    if not hostname:
        return "invalid-redacted"
    if hostname.lower() == "localhost":
        return "local-loopback"
    try:
        return "local-loopback" if ipaddress.ip_address(hostname).is_loopback else "external-redacted"
    except ValueError:
        return "external-redacted"


def retry_wait_seconds(body: object) -> int:
    """Honour ``retryAfterSeconds`` from a 429 body within a bounded window."""
    if isinstance(body, dict):
        try:
            value = int(body.get("retryAfterSeconds") or DEFAULT_RETRY_WAIT_SECONDS)
        except (TypeError, ValueError):
            value = DEFAULT_RETRY_WAIT_SECONDS
        return max(1, min(value, MAX_RETRY_WAIT_SECONDS))
    return DEFAULT_RETRY_WAIT_SECONDS


def post_slice_with_retry(
    *,
    base_url: str,
    endpoint: str,
    file_path: Path,
    layer_height: float | str,
    material: str,
    slice_service_api_key: str,
    extra_fields: Mapping[str, str | int | float | bool] | None = None,
    max_attempts: int = MAX_HTTP_ATTEMPTS,
    sleep=time.sleep,
) -> tuple[int, dict | str | None, float]:
    """POST one slice request, retrying only on HTTP 429 with bounded waits."""
    total_duration = 0.0
    status = 0
    body: dict | str | None = None
    for attempt in range(1, max(1, max_attempts) + 1):
        status, body, duration = curl_multipart_slice(
            base_url=base_url,
            endpoint=endpoint,
            file_path=file_path,
            layer_height=layer_height,
            material=material,
            slice_service_api_key=slice_service_api_key,
            extra_fields=extra_fields,
        )
        total_duration += duration
        if status != 429 or attempt == max_attempts:
            break
        sleep(retry_wait_seconds(body))
    return status, body, total_duration


def is_positive_number(value: object) -> bool:
    """True for a finite number strictly greater than zero (booleans excluded)."""
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value > 0
    )


def is_lower_hex_sha256(value: object) -> bool:
    return isinstance(value, str) and SHA256_PATTERN.fullmatch(value) is not None


def is_engine_version(value: object) -> bool:
    return isinstance(value, str) and ENGINE_VERSION_PATTERN.fullmatch(value) is not None


def axis_map_equals(observed: object, expected: Mapping[str, float], tolerance: float = 1e-9) -> bool:
    """Exact (tolerance-bounded) equality of two ``{x, y, z}`` maps."""
    if not isinstance(observed, dict) or set(observed) != set(AXES):
        return False
    try:
        return all(abs(float(observed[axis]) - float(expected[axis])) <= tolerance for axis in AXES)
    except (KeyError, TypeError, ValueError):
        return False


def validate_optional_placement(body: object) -> tuple[bool, str]:
    """``placement_mm`` is optional; when present it must be numeric ``{x_min, y_min}``.

    A parallel track adds the field to Bambu responses. Its absence is never a
    failure, but a present value that is not a finite numeric pair is.
    """
    if not isinstance(body, dict) or "placement_mm" not in body:
        return True, "placement_mm absent"
    placement = body.get("placement_mm")
    if not isinstance(placement, dict) or not all(
        isinstance(placement.get(key), (int, float))
        and not isinstance(placement.get(key), bool)
        and math.isfinite(placement.get(key))
        for key in ("x_min", "y_min")
    ):
        return False, "placement_mm is present but not a numeric x_min/y_min pair"
    return True, "placement_mm numeric"


def error_code_of(body: object) -> str | None:
    if isinstance(body, dict) and isinstance(body.get("errorCode"), str):
        return body["errorCode"]
    return None


def format_number(value: float) -> str:
    """Compact decimal rendering used in fixture names and report cells."""
    text = f"{float(value):.3f}".rstrip("0").rstrip(".")
    return text if text else "0"
