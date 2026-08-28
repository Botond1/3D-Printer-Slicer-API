from __future__ import annotations

import json
import re
import subprocess
import tempfile
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
    stdin_text: str | None = None,
) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(
            command,
            capture_output=True,
            text=True,
            input=stdin_text,
            timeout=subprocess_timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired:
        # subprocess.run kills and waits for the child before raising. Do not
        # expose the exception, command, partial output, or credential headers.
        return None


def _credential_header_stdin(name: str, value: str) -> tuple[list[str], str]:
    """Keep credential values out of the curl process argument vector.

    curl accepts one header per line from ``-H @-``. The fixed header name and
    single-line value are sent through the child's stdin pipe, so neither the
    service key nor an administrative principal is observable in a process
    listing or persisted in a temporary file.
    """
    if any(character in value for character in ("\r", "\n", "\0")):
        raise ValueError("HTTP credential values must be single-line strings.")
    return ["-H", "@-"], f"{name}: {value}\n"


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
    credential_stdin = None
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
        credential_args, credential_stdin = _credential_header_stdin(
            "x-api-key", api_key,
        )
        cmd.extend(credential_args)

    cmd = _bounded_curl_command(cmd, CURL_JSON_TOTAL_TIMEOUT_SECONDS)
    completed = _run_bounded_curl(
        cmd,
        subprocess_timeout_seconds=CURL_JSON_SUBPROCESS_TIMEOUT_SECONDS,
        stdin_text=credential_stdin,
    )
    if completed is None:
        return 0, {"errorCode": "REQUEST_TOTAL_TIMEOUT"}
    if completed.returncode != 0:
        return 0, {"errorCode": "REQUEST_TRANSPORT_FAILURE"}

    return parse_curl_output(completed.stdout.strip())


def _parse_response_headers(header_text: str) -> dict[str, str]:
    """Parse the final HTTP response block emitted by curl.

    A request may contain an informational response before its terminal
    response. Selecting the last HTTP block keeps conditional GET handling
    deterministic without exposing curl command lines or request headers.
    """
    blocks = [
        block.strip()
        for block in re.split(r"\r?\n\r?\n", header_text.strip())
        if block.strip().lower().startswith("http/")
    ]
    if not blocks:
        return {}

    headers: dict[str, str] = {}
    for line in blocks[-1].splitlines()[1:]:
        if ":" not in line:
            continue
        name, value = line.split(":", 1)
        headers[name.strip().lower()] = value.strip()
    return headers


def curl_json_response(
    *,
    method: str,
    base_url: str,
    endpoint: str,
    json_body: dict | None = None,
    api_key: str | None = None,
    request_headers: Mapping[str, str] | None = None,
) -> tuple[int, dict | str | None, dict[str, str]]:
    """Issue a bounded JSON request and retain terminal response headers."""
    credential_stdin = None
    with tempfile.TemporaryDirectory(prefix="slicer-http-headers-") as temp_dir:
        header_path = Path(temp_dir) / "response-headers.txt"
        cmd = [
            "curl",
            "-sS",
            "-X",
            method,
            f"{base_url}{endpoint}",
            "--dump-header",
            str(header_path),
            "-w",
            "\nHTTP_STATUS:%{http_code}\n",
        ]

        if json_body is not None:
            cmd.extend([
                "-H",
                "Content-Type: application/json",
                "--data",
                json.dumps(json_body),
            ])

        if api_key:
            credential_args, credential_stdin = _credential_header_stdin(
                "x-api-key", api_key,
            )
            cmd.extend(credential_args)

        for name, value in (request_headers or {}).items():
            if "\r" in name or "\n" in name or "\r" in value or "\n" in value:
                raise ValueError("HTTP header names and values must be single-line strings.")
            cmd.extend(["-H", f"{name}: {value}"])

        cmd = _bounded_curl_command(cmd, CURL_JSON_TOTAL_TIMEOUT_SECONDS)
        completed = _run_bounded_curl(
            cmd,
            subprocess_timeout_seconds=CURL_JSON_SUBPROCESS_TIMEOUT_SECONDS,
            stdin_text=credential_stdin,
        )
        if completed is None:
            return 0, {"errorCode": "REQUEST_TOTAL_TIMEOUT"}, {}
        if completed.returncode != 0:
            return 0, {"errorCode": "REQUEST_TRANSPORT_FAILURE"}, {}

        status, body = parse_curl_output(completed.stdout.strip())
        try:
            response_headers = _parse_response_headers(
                header_path.read_text(encoding="iso-8859-1")
            )
        except OSError:
            response_headers = {}
        return status, body, response_headers


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
    credential_args, credential_stdin = _credential_header_stdin(
        "x-slicer-api-key", slice_service_api_key,
    )
    cmd = [
        "curl",
        "-sS",
        "-X",
        "POST",
        f"{base_url}{endpoint}",
        *credential_args,
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
        cmd,
        subprocess_timeout_seconds=CURL_SLICE_SUBPROCESS_TIMEOUT_SECONDS,
        stdin_text=credential_stdin,
    )
    duration = time.perf_counter() - started

    if completed is None:
        return 0, {"errorCode": "REQUEST_TOTAL_TIMEOUT"}, duration
    if completed.returncode != 0:
        return 0, {"errorCode": "REQUEST_TRANSPORT_FAILURE"}, duration

    status, body = parse_curl_output(completed.stdout.strip())
    return status, body, duration
