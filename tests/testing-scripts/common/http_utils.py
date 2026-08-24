from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path
from typing import Mapping


CURL_CONNECT_TIMEOUT_SECONDS = 5
CURL_JSON_TOTAL_TIMEOUT_SECONDS = 30
CURL_SLICE_TOTAL_TIMEOUT_SECONDS = 180
SUBPROCESS_SETTLEMENT_GRACE_SECONDS = 5
CURL_JSON_SUBPROCESS_TIMEOUT_SECONDS = (
    CURL_JSON_TOTAL_TIMEOUT_SECONDS + SUBPROCESS_SETTLEMENT_GRACE_SECONDS
)
CURL_SLICE_SUBPROCESS_TIMEOUT_SECONDS = (
    CURL_SLICE_TOTAL_TIMEOUT_SECONDS + SUBPROCESS_SETTLEMENT_GRACE_SECONDS
)


def _bounded_curl_command(command: list[str], total_timeout_seconds: int) -> list[str]:
    return [
        *command[:2],
        "--connect-timeout",
        str(CURL_CONNECT_TIMEOUT_SECONDS),
        "--max-time",
        str(total_timeout_seconds),
        *command[2:],
    ]


def _run_bounded_curl(
    command: list[str], *, subprocess_timeout_seconds: int,
) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=subprocess_timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired:
        # subprocess.run kills and waits for the child before raising. Do not
        # expose the exception, command, partial output, or credential headers.
        return None


def parse_curl_output(output: str) -> tuple[int, dict | str | None]:
    if "HTTP_STATUS:" in output:
        body_text, status_text = output.rsplit("HTTP_STATUS:", 1)
        status = int((status_text or "").strip() or "0")
        body_text = body_text.strip()
    else:
        status = 0
        body_text = output.strip()

    if not body_text:
        return status, None

    try:
        return status, json.loads(body_text)
    except json.JSONDecodeError:
        return status, body_text


def curl_json(
    *,
    method: str,
    base_url: str,
    endpoint: str,
    json_body: dict | None = None,
    api_key: str | None = None,
) -> tuple[int, dict | str | None]:
    cmd = [
        "curl",
        "-sS",
        "-X",
        method,
        f"{base_url}{endpoint}",
        "-w",
        "\nHTTP_STATUS:%{http_code}\n",
    ]

    if json_body is not None:
        cmd.extend(["-H", "Content-Type: application/json", "--data", json.dumps(json_body)])

    if api_key:
        cmd.extend(["-H", f"x-api-key: {api_key}"])

    cmd = _bounded_curl_command(cmd, CURL_JSON_TOTAL_TIMEOUT_SECONDS)
    completed = _run_bounded_curl(
        cmd, subprocess_timeout_seconds=CURL_JSON_SUBPROCESS_TIMEOUT_SECONDS,
    )
    if completed is None:
        return 0, {"errorCode": "REQUEST_TOTAL_TIMEOUT"}
    if completed.returncode != 0:
        return 0, {"errorCode": "REQUEST_TRANSPORT_FAILURE"}

    return parse_curl_output(completed.stdout.strip())


def curl_multipart_slice(
    *,
    base_url: str,
    endpoint: str,
    file_path: Path,
    layer_height: float,
    material: str,
    slice_service_api_key: str,
    extra_fields: Mapping[str, str | int | float | bool] | None = None,
) -> tuple[int, dict | str | None, float]:
    cmd = [
        "curl",
        "-sS",
        "-X",
        "POST",
        f"{base_url}{endpoint}",
        "-H",
        f"x-slicer-api-key: {slice_service_api_key}",
        "-F",
        f"choosenFile=@{file_path}",
        "-F",
        f"layerHeight={layer_height}",
        "-F",
        f"material={material}",
    ]

    if extra_fields:
        for key, value in extra_fields.items():
            if isinstance(value, bool):
                normalized = "true" if value else "false"
            else:
                normalized = str(value)
            cmd.extend(["-F", f"{key}={normalized}"])

    cmd.extend([
        "-w",
        "\nHTTP_STATUS:%{http_code}\n",
    ])

    cmd = _bounded_curl_command(cmd, CURL_SLICE_TOTAL_TIMEOUT_SECONDS)
    started = time.perf_counter()
    completed = _run_bounded_curl(
        cmd, subprocess_timeout_seconds=CURL_SLICE_SUBPROCESS_TIMEOUT_SECONDS,
    )
    duration = time.perf_counter() - started

    if completed is None:
        return 0, {"errorCode": "REQUEST_TOTAL_TIMEOUT"}, duration
    if completed.returncode != 0:
        return 0, {"errorCode": "REQUEST_TRANSPORT_FAILURE"}, duration

    status, body = parse_curl_output(completed.stdout.strip())
    return status, body, duration
