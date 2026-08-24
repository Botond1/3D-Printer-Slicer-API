#!/usr/bin/python3
"""Fail-closed credential handoff for the I12 capacity producer."""

from __future__ import annotations

import ctypes
import os
import posixpath
import re
import stat
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping, Sequence


PYTHON_EXECUTABLE = "/usr/bin/python3"
RUNNER_RELATIVE = (
    "tests",
    "testing-scripts",
    "queue",
    "queue_concurrency_test_runner.py",
)
ENVIRONMENT_NAMES = (
    "SLICER_BASE_URL",
    "SLICE_SERVICE_API_KEY",
    "OPERATIONS_API_KEY",
    "ARTIFACT_API_KEY",
)
OPTION_NAMES = (
    "--service-uid",
    "--service-gid",
    "--slicer-base-url-file",
    "--slice-service-api-key-file",
    "--operations-api-key-file",
    "--artifact-api-key-file",
    "--count",
    "--expected-max-concurrent",
    "--cleanup-manifest",
    "--report",
)
MAX_PATH_BYTES = 4096
MAX_BASE_URL_BYTES = 2048
MIN_API_KEY_BYTES = 32
MAX_API_KEY_BYTES = 256
MAX_POSIX_ID = 2_147_483_647
PR_SET_NO_NEW_PRIVS = 38
FAIL_EXIT = 78


class ContractError(Exception):
    """A deliberately nondisclosing contract failure."""


@dataclass(frozen=True)
class LaunchPlan:
    service_uid: int
    service_gid: int
    argv: tuple[str, ...]
    environment: Mapping[str, str]


def _canonical_positive_decimal(value: str, *, maximum: int) -> int:
    if not re.fullmatch(r"[1-9][0-9]*", value):
        raise ContractError
    parsed = int(value)
    if parsed > maximum:
        raise ContractError
    return parsed


def _canonical_absolute_path(value: str) -> str:
    if not value or len(value.encode("utf-8")) > MAX_PATH_BYTES:
        raise ContractError
    if not posixpath.isabs(value) or posixpath.normpath(value) != value:
        raise ContractError
    return value


def parse_arguments(args: Sequence[str]) -> dict[str, str]:
    if len(args) != len(OPTION_NAMES) * 2:
        raise ContractError
    values: dict[str, str] = {}
    for index, expected_name in enumerate(OPTION_NAMES):
        name = args[index * 2]
        value = args[index * 2 + 1]
        if name != expected_name or not value:
            raise ContractError
        values[name] = value
    return values


def _credential_identity(metadata: os.stat_result) -> tuple[int, ...]:
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_uid,
        metadata.st_gid,
        metadata.st_nlink,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    )


def _validate_credential_metadata(
    metadata: os.stat_result, *, minimum_bytes: int, maximum_bytes: int
) -> None:
    if not stat.S_ISREG(metadata.st_mode):
        raise ContractError
    if metadata.st_uid != 0 or metadata.st_gid != 0:
        raise ContractError
    if stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_nlink != 1:
        raise ContractError
    if metadata.st_size < minimum_bytes or metadata.st_size > maximum_bytes:
        raise ContractError


def _secure_open_flags(runtime: object) -> int:
    required = ("O_RDONLY", "O_CLOEXEC", "O_NOFOLLOW")
    if any(not hasattr(runtime, name) for name in required):
        raise ContractError
    return int(runtime.O_RDONLY | runtime.O_CLOEXEC | runtime.O_NOFOLLOW)


def read_root_credential(
    credential_path: str,
    *,
    minimum_bytes: int,
    maximum_bytes: int,
    runtime: object = os,
) -> str:
    path_value = _canonical_absolute_path(credential_path)
    if runtime.path.realpath(path_value) != path_value:
        raise ContractError
    before_path = runtime.lstat(path_value)
    _validate_credential_metadata(
        before_path, minimum_bytes=minimum_bytes, maximum_bytes=maximum_bytes
    )
    descriptor = runtime.open(path_value, _secure_open_flags(runtime))
    try:
        before_fd = runtime.fstat(descriptor)
        _validate_credential_metadata(
            before_fd, minimum_bytes=minimum_bytes, maximum_bytes=maximum_bytes
        )
        if _credential_identity(before_path) != _credential_identity(before_fd):
            raise ContractError
        content = bytearray()
        while len(content) <= maximum_bytes:
            chunk = runtime.read(descriptor, maximum_bytes + 1 - len(content))
            if not chunk:
                break
            content.extend(chunk)
        after_fd = runtime.fstat(descriptor)
    finally:
        runtime.close(descriptor)
    after_path = runtime.lstat(path_value)
    if (
        len(content) < minimum_bytes
        or len(content) > maximum_bytes
        or _credential_identity(before_fd) != _credential_identity(after_fd)
        or _credential_identity(after_fd) != _credential_identity(after_path)
        or len(content) != after_fd.st_size
    ):
        raise ContractError
    try:
        value = bytes(content).decode("ascii")
    except UnicodeDecodeError as error:
        raise ContractError from error
    if not all(0x20 <= byte <= 0x7E for byte in content):
        raise ContractError
    return value


def _resolve_runner() -> str:
    script_path = posixpath.abspath(__file__)
    script_metadata = os.lstat(script_path)
    if (
        not stat.S_ISREG(script_metadata.st_mode)
        or os.path.realpath(script_path) != script_path
        or stat.S_IMODE(script_metadata.st_mode) & 0o022
    ):
        raise ContractError
    repository_root = str(Path(script_path).parent.parent)
    runner_path = posixpath.join(repository_root, *RUNNER_RELATIVE)
    runner_metadata = os.lstat(runner_path)
    if (
        not stat.S_ISREG(runner_metadata.st_mode)
        or os.path.realpath(runner_path) != runner_path
        or stat.S_IMODE(runner_metadata.st_mode) & 0o022
    ):
        raise ContractError
    return runner_path


def build_launch_plan(
    args: Sequence[str],
    *,
    credential_reader: Callable[..., str] = read_root_credential,
    runner_resolver: Callable[[], str] = _resolve_runner,
) -> LaunchPlan:
    values = parse_arguments(args)
    service_uid = _canonical_positive_decimal(
        values["--service-uid"], maximum=MAX_POSIX_ID
    )
    service_gid = _canonical_positive_decimal(
        values["--service-gid"], maximum=MAX_POSIX_ID
    )
    count = _canonical_positive_decimal(values["--count"], maximum=3)
    expected = _canonical_positive_decimal(
        values["--expected-max-concurrent"], maximum=3
    )
    cleanup_manifest = _canonical_absolute_path(values["--cleanup-manifest"])
    report = _canonical_absolute_path(values["--report"])
    if cleanup_manifest == report or posixpath.dirname(cleanup_manifest) != posixpath.dirname(report):
        raise ContractError

    credential_specs = (
        ("SLICER_BASE_URL", "--slicer-base-url-file", 1, MAX_BASE_URL_BYTES),
        ("SLICE_SERVICE_API_KEY", "--slice-service-api-key-file", MIN_API_KEY_BYTES, MAX_API_KEY_BYTES),
        ("OPERATIONS_API_KEY", "--operations-api-key-file", MIN_API_KEY_BYTES, MAX_API_KEY_BYTES),
        ("ARTIFACT_API_KEY", "--artifact-api-key-file", MIN_API_KEY_BYTES, MAX_API_KEY_BYTES),
    )
    environment = {
        name: credential_reader(
            values[option], minimum_bytes=minimum_bytes, maximum_bytes=maximum_bytes
        )
        for name, option, minimum_bytes, maximum_bytes in credential_specs
    }
    if tuple(environment) != ENVIRONMENT_NAMES or len(set(environment.values())) != len(environment):
        raise ContractError

    runner_path = runner_resolver()
    runner_argv = (
        PYTHON_EXECUTABLE,
        runner_path,
        "--count",
        str(count),
        "--expected-max-concurrent",
        str(expected),
        "--retry-on-429",
        "1",
        "--cleanup-manifest",
        cleanup_manifest,
        "--report",
        report,
    )
    return LaunchPlan(service_uid, service_gid, runner_argv, environment)


def _set_no_new_privileges() -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    prctl = libc.prctl
    prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    prctl.restype = ctypes.c_int
    if prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        raise ContractError


def execute_launch_plan(
    plan: LaunchPlan,
    *,
    runtime: object = os,
    no_new_privileges: Callable[[], None] = _set_no_new_privileges,
) -> None:
    if (
        runtime.geteuid() != 0
        or not 0 < plan.service_uid <= MAX_POSIX_ID
        or not 0 < plan.service_gid <= MAX_POSIX_ID
        or tuple(plan.environment) != ENVIRONMENT_NAMES
        or len(set(plan.environment.values())) != len(ENVIRONMENT_NAMES)
        or not plan.argv
        or plan.argv[0] != PYTHON_EXECUTABLE
        or any(value in argument for value in plan.environment.values() for argument in plan.argv)
    ):
        raise ContractError
    no_new_privileges()
    runtime.setgroups([])
    runtime.setresgid(plan.service_gid, plan.service_gid, plan.service_gid)
    runtime.setresuid(plan.service_uid, plan.service_uid, plan.service_uid)
    if (
        runtime.getresgid() != (plan.service_gid,) * 3
        or runtime.getresuid() != (plan.service_uid,) * 3
        or runtime.getgroups()
    ):
        raise ContractError
    runtime.execve(PYTHON_EXECUTABLE, list(plan.argv), dict(plan.environment))
    raise ContractError


def main(args: Sequence[str] | None = None) -> int:
    try:
        if sys.platform != "linux" or os.geteuid() != 0:
            raise ContractError
        plan = build_launch_plan(sys.argv[1:] if args is None else args)
        execute_launch_plan(plan)
    except BaseException:
        try:
            os.write(2, b"capacity_producer_exec=FAIL\n")
        except BaseException:
            pass
        return FAIL_EXIT
    return FAIL_EXIT


if __name__ == "__main__":
    raise SystemExit(main())
