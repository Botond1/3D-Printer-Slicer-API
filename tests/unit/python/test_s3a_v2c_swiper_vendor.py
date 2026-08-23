"""Bridge isolated S3a-V2C mutation suites into aggregate unittest discovery."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


FOCUSED_ROOT = Path(__file__).resolve().parents[2] / "s3a-v2c"
MODULES = (
    "test_swiper_archive_contract.py",
    "test_swiper_install_transaction.py",
    "test_swiper_source_contract.py",
)


def _load(path: Path):
    spec = importlib.util.spec_from_file_location(f"s3a_v2c_{path.stem}", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load focused suite: {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_tests(loader: unittest.TestLoader, _tests: unittest.TestSuite, _pattern: str | None):
    sys.path.insert(0, str(FOCUSED_ROOT))
    try:
        return unittest.TestSuite(loader.loadTestsFromModule(_load(FOCUSED_ROOT / name)) for name in MODULES)
    finally:
        sys.path.remove(str(FOCUSED_ROOT))
