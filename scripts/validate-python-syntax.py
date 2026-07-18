#!/usr/bin/env python3
"""Validate tracked Python source without importing it or writing bytecode."""

from __future__ import annotations

import ast
import subprocess
import sys
import tokenize
from collections.abc import Callable, Sequence
from pathlib import Path, PurePosixPath
from typing import TextIO


EXCLUDED_PREFIXES = (
    "input/",
    "output/",
    "tests/testing-scripts/results/",
    "coverage/",
    "dist/",
    "build/",
)

EXCLUDED_SEGMENTS = frozenset(
    {
        ".git",
        "node_modules",
        ".venv",
        "venv",
        "__pycache__",
        ".cache",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
    }
)


def run_git(arguments: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[bytes]:
    """Run Git without a shell and retain NUL-delimited output as bytes."""

    return subprocess.run(
        ["git", *arguments],
        cwd=cwd,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def repository_root() -> Path:
    result = run_git(["rev-parse", "--show-toplevel"])
    if result.returncode != 0:
        raise RuntimeError("Python syntax validation must run inside a Git worktree.")
    return Path(result.stdout.decode("utf-8", errors="strict").strip()).resolve()


def is_excluded(relative_path: str) -> bool:
    normalized = relative_path.replace("\\", "/")
    if normalized.startswith(EXCLUDED_PREFIXES):
        return True
    return any(part in EXCLUDED_SEGMENTS for part in PurePosixPath(normalized).parts)


def tracked_python_files(root: Path) -> list[str]:
    result = run_git(["ls-files", "--cached", "-z", "--", "*.py"], cwd=root)
    if result.returncode != 0:
        raise RuntimeError("Unable to enumerate tracked Python files from the Git index.")

    paths = result.stdout.decode("utf-8", errors="surrogateescape").split("\0")
    return sorted(
        path
        for path in paths
        if path and path.endswith(".py") and not is_excluded(path)
    )


def validate_file(root: Path, relative_path: str) -> None:
    source_path = root.joinpath(*PurePosixPath(relative_path).parts)
    with tokenize.open(source_path) as source_file:
        source = source_file.read()
    compile(
        source,
        str(source_path),
        "exec",
        flags=ast.PyCF_ONLY_AST,
        dont_inherit=True,
    )


def validate_python_files(
    root: Path,
    files: Sequence[str],
    *,
    validator: Callable[[Path, str], None] = validate_file,
    stdout: TextIO = sys.stdout,
    stderr: TextIO = sys.stderr,
) -> int:
    """Validate an explicit file set and fail closed when the set is empty."""

    if not files:
        print(
            "Python syntax validation failed: no applicable tracked files were found.",
            file=stderr,
        )
        return 1

    failures = 0
    for relative_path in files:
        try:
            validator(root, relative_path)
        except (OSError, SyntaxError, UnicodeError) as error:
            print(f"Python syntax validation failed: {relative_path}: {error}", file=stderr)
            failures += 1

    if failures:
        print(
            f"Python syntax validation failed for {failures} of {len(files)} tracked file(s).",
            file=stderr,
        )
        return 1

    print(f"Python syntax OK: {len(files)} tracked file(s).", file=stdout)
    return 0


def main() -> int:
    try:
        root = repository_root()
        files = tracked_python_files(root)
    except (OSError, RuntimeError, UnicodeError) as error:
        print(str(error), file=sys.stderr)
        return 1

    return validate_python_files(root, files)


if __name__ == "__main__":
    raise SystemExit(main())
