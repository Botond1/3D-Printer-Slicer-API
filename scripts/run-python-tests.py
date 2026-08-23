#!/usr/bin/env python3
"""Discover and run the deterministic Python unit suite with truthful counts."""

from __future__ import annotations

import argparse
import sys
import unittest
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_START_DIRECTORY = REPOSITORY_ROOT / "tests" / "unit" / "python"
DEFAULT_PATTERN = "test_*.py"


@dataclass(frozen=True)
class TestSummary:
    """Stable aggregate counts and exit semantics for a unittest run."""

    discovered: int
    run: int
    passed: int
    failed: int
    errors: int
    skipped: int
    expected_failures: int
    successful: bool

    @property
    def exit_code(self) -> int:
        return 0 if self.discovered > 0 and self.successful else 1


def summarize_result(discovered: int, result: unittest.TestResult) -> TestSummary:
    failed = len(result.failures) + len(result.unexpectedSuccesses)
    errors = len(result.errors)
    skipped = len(result.skipped)
    expected_failures = len(result.expectedFailures)
    passed = max(0, result.testsRun - failed - errors - skipped - expected_failures)
    return TestSummary(
        discovered=discovered,
        run=result.testsRun,
        passed=passed,
        failed=failed,
        errors=errors,
        skipped=skipped,
        expected_failures=expected_failures,
        successful=result.wasSuccessful(),
    )


def print_summary(summary: TestSummary, stream: TextIO) -> None:
    """Print machine-readable counts without replacing unittest details."""

    print(
        "Python unit summary: "
        f"discovered={summary.discovered} "
        f"run={summary.run} "
        f"passed={summary.passed} "
        f"failed={summary.failed} "
        f"errors={summary.errors} "
        f"skipped={summary.skipped} "
        f"expected_failures={summary.expected_failures}",
        file=stream,
    )


def discover_and_run(
    start_directory: Path,
    *,
    pattern: str = DEFAULT_PATTERN,
    loader: unittest.TestLoader | None = None,
    output: TextIO = sys.stderr,
) -> TestSummary:
    """Discover tests, run non-empty suites, and preserve unittest output."""

    selected_loader = loader or unittest.TestLoader()
    try:
        suite = selected_loader.discover(str(start_directory), pattern=pattern)
    except Exception as error:  # unittest loaders may surface arbitrary import failures.
        print(
            f"Python unit discovery failed: {type(error).__name__}: {error}",
            file=output,
        )
        summary = TestSummary(0, 0, 0, 0, 1, 0, 0, False)
        print_summary(summary, output)
        return summary

    discovered = suite.countTestCases()
    if discovered == 0:
        print("Python unit discovery failed: no tests were discovered.", file=output)
        summary = TestSummary(0, 0, 0, 0, 0, 0, 0, False)
        print_summary(summary, output)
        return summary

    result = unittest.TextTestRunner(stream=output, verbosity=2).run(suite)
    summary = summarize_result(discovered, result)
    print_summary(summary, output)
    return summary


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--start-directory",
        type=Path,
        default=DEFAULT_START_DIRECTORY,
        help="Directory searched recursively for Python unit tests.",
    )
    parser.add_argument("--pattern", default=DEFAULT_PATTERN)
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    summary = discover_and_run(
        arguments.start_directory.resolve(),
        pattern=arguments.pattern,
    )
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
